#!/usr/bin/env node
// Synthetic-only PocketIC execution proof for the consolidated application's
// fixed private workflow-receipt adapter. It accepts only a pinned binary and
// a checksum-verified disposable fixture Wasm.
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const picMopsRoot = path.resolve(__dirname, "../../node_modules/ic-mops/node_modules/pic-js-mops");
const coreRoot = path.resolve(__dirname, "../../node_modules/ic-mops/node_modules/@icp-sdk/core");
const { PocketIc, PocketIcServer } = require(picMopsRoot);
const { IDL } = require(path.join(coreRoot, "lib/cjs/candid/index.js"));
const { Principal } = require(path.join(coreRoot, "lib/cjs/principal/index.js"));

const [pocketIcBin, wasmPath] = process.argv.slice(2);
if (!pocketIcBin || !wasmPath) throw new Error("Expected PocketIC binary and embedded workflow receipt fixture Wasm");

const Hash = IDL.Vec(IDL.Nat8);
const Input = IDL.Record({
  logicalId: IDL.Text,
  cycleId: IDL.Text,
  operationName: IDL.Text,
  desiredVersion: IDL.Nat64,
  contentHash: Hash,
});
const Result = IDL.Variant({ acknowledged: IDL.Null, blocked: IDL.Null, conflict: IDL.Null, storageError: IDL.Null });
const ChunkHash = IDL.Record({ hash: Hash });
const UploadChunk = IDL.Record({ canister_id: IDL.Principal, chunk: Hash });
const InstallChunkedCode = IDL.Record({
  arg: Hash,
  chunk_hashes_list: IDL.Vec(ChunkHash),
  mode: IDL.Variant({
    install: IDL.Null,
    upgrade: IDL.Opt(IDL.Record({
      skip_pre_upgrade: IDL.Opt(IDL.Bool),
      wasm_memory_persistence: IDL.Opt(IDL.Variant({ keep: IDL.Null, replace: IDL.Null })),
    })),
  }),
  sender_canister_version: IDL.Opt(IDL.Nat64),
  store_canister: IDL.Opt(IDL.Principal),
  // PocketIC 12 needs this routing field in addition to target_canister.
  canister_id: IDL.Principal,
  target_canister: IDL.Principal,
  wasm_module_hash: Hash,
});
const fixtureIdl = ({ IDL: C }) => C.Service({ writeReceipt: C.Func([Input], [Result], []) });
const managementCanister = Principal.fromText("aaaaa-aa");
const maxChunkBytes = 1_000_000;

function expect(actual, expected, label) {
  if (Object.keys(actual).length !== 1 || !(expected in actual)) {
    throw new Error(`${label}: expected ${expected}, got ${JSON.stringify(actual)}`);
  }
}

async function managementUpdate(pic, sender, method, type, value) {
  return pic.client.updateCall({
    canisterId: managementCanister,
    sender,
    method,
    payload: new Uint8Array(IDL.encode([type], [value])),
  });
}

async function install(pic, sender, canisterId, mode = { install: null }) {
  const wasm = fs.readFileSync(wasmPath);
  const chunkHashes = [];
  for (let offset = 0; offset < wasm.length; offset += maxChunkBytes) {
    const chunk = new Uint8Array(wasm.subarray(offset, Math.min(offset + maxChunkBytes, wasm.length)));
    await managementUpdate(pic, sender, "upload_chunk", UploadChunk, { canister_id: canisterId, chunk });
    chunkHashes.push({ hash: new Uint8Array(crypto.createHash("sha256").update(chunk).digest()) });
  }
  await managementUpdate(pic, sender, "install_chunked_code", InstallChunkedCode, {
    arg: new Uint8Array(),
    chunk_hashes_list: chunkHashes,
    mode,
    sender_canister_version: [],
    store_canister: [],
    canister_id: canisterId,
    target_canister: canisterId,
    wasm_module_hash: new Uint8Array(crypto.createHash("sha256").update(wasm).digest()),
  });
}

const hash = (byte) => Uint8Array.from({ length: 32 }, () => byte);

async function main() {
  const server = await PocketIcServer.start({ binPath: pocketIcBin, ttl: 60, showRuntimeLogs: false, showCanisterLogs: false });
  const pic = await PocketIc.create(server.getUrl());
  try {
    const installer = Principal.fromUint8Array(Uint8Array.of(2, 1));
    const canisterId = await pic.createCanister({ sender: installer, controllers: [installer] });
    await install(pic, installer, canisterId);
    const actor = pic.createActor(fixtureIdl, canisterId);
    actor.setPrincipal(installer);
    const input = {
      logicalId: "workflow-completion:v1:application-fixture:42",
      cycleId: "application-fixture-cycle-42",
      operationName: "publish-result",
      desiredVersion: 1n,
      contentHash: hash(9),
    };

    // Model an unknown completed ingress response by intentionally discarding
    // the first reply. The exact retry is the only permitted acknowledgement.
    await actor.writeReceipt(input);
    expect(await actor.writeReceipt(input), "acknowledged", "exact retry after discarded reply");
    expect(await actor.writeReceipt({ ...input, desiredVersion: 2n }), "conflict", "version replacement rejected");
    expect(await actor.writeReceipt({ ...input, contentHash: hash(10) }), "conflict", "hash replacement rejected");
    expect(await actor.writeReceipt({ ...input, logicalId: "bad\nlogical-id" }), "blocked", "malformed logical ID rejected");
    expect(await actor.writeReceipt({ ...input, cycleId: "" }), "blocked", "empty cycle rejected");

    await install(pic, installer, canisterId, {
      upgrade: [{ skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }],
    });
    expect(await actor.writeReceipt(input), "acknowledged", "exact retry after EOP upgrade");
    expect(await actor.writeReceipt({ ...input, desiredVersion: 2n }), "conflict", "version replacement rejected after EOP upgrade");
    expect(await actor.writeReceipt({ ...input, contentHash: hash(10) }), "conflict", "hash replacement rejected after EOP upgrade");
  } finally {
    await pic.tearDown();
    await server.stop();
  }
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
