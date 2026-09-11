#!/usr/bin/env node
// Synthetic-only PocketIC execution proof for the two fixed M1 adapter
// collections. This process accepts just a pinned binary and fixture Wasm.
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const picMopsRoot = path.resolve(__dirname, "../../node_modules/ic-mops/node_modules/pic-js-mops");
const coreRoot = path.resolve(__dirname, "../../node_modules/ic-mops/node_modules/@icp-sdk/core");
const { PocketIc, PocketIcServer } = require(picMopsRoot);
const { IDL } = require(path.join(coreRoot, "lib/cjs/candid/index.js"));
const { Principal } = require(path.join(coreRoot, "lib/cjs/principal/index.js"));

const [pocketIcBin, wasm] = process.argv.slice(2);
if (!pocketIcBin || !wasm) throw new Error("Expected PocketIC binary and embedded identity/role fixture Wasm");

const Hash = IDL.Vec(IDL.Nat8);
const Factor = IDL.Variant({ internetIdentity: IDL.Null, oauth: IDL.Null });
const Binding = IDL.Record({ logicalId: IDL.Text, contentHash: Hash, userId: IDL.Nat64, principal: IDL.Principal, factor: Factor, provider: IDL.Opt(IDL.Text), subjectHash: IDL.Opt(Hash) });
const Role = IDL.Record({ logicalId: IDL.Text, contentHash: Hash, principal: IDL.Principal, role: IDL.Text });
const Result = IDL.Variant({ acknowledged: IDL.Null, blocked: IDL.Null, conflict: IDL.Null, storageError: IDL.Null });
const ChunkHash = IDL.Record({ hash: IDL.Vec(IDL.Nat8) });
const ManagementUploadChunk = IDL.Record({
  canister_id: IDL.Principal,
  chunk: IDL.Vec(IDL.Nat8),
});
const ManagementInstallChunkedCode = IDL.Record({
  arg: IDL.Vec(IDL.Nat8),
  chunk_hashes_list: IDL.Vec(ChunkHash),
  mode: IDL.Variant({ install: IDL.Null }),
  sender_canister_version: IDL.Opt(IDL.Nat64),
  store_canister: IDL.Opt(IDL.Principal),
  // PocketIC 12.0.0 predates the management-interface rename to
  // `target_canister`; its chunked installer accepts `canister_id`.
  canister_id: IDL.Principal,
  wasm_module_hash: IDL.Vec(IDL.Nat8),
});
const managementCanister = Principal.fromText("aaaaa-aa");
// PocketIC's chunk store accepts at most 1 MiB; leave room below that bound
// while also remaining well below the 2 MiB ingress ceiling.
const maxChunkBytes = 1_000_000;
const idl = ({ IDL: Candid }) => Candid.Service({
  writeBinding: Candid.Func([Binding], [Result], []),
  writeRole: Candid.Func([Role], [Result], []),
});
const hash = (byte) => Uint8Array.from({ length: 32 }, () => byte);
function expect(actual, key, label) {
  if (Object.keys(actual).length !== 1 || !(key in actual)) throw new Error(`${label}: expected ${key}, got ${JSON.stringify(actual)}`);
}

async function managementUpdate(pic, sender, method, type, value) {
  const payload = IDL.encode([type], [value]);
  return pic.client.updateCall({
    canisterId: managementCanister,
    sender,
    method,
    payload: new Uint8Array(payload),
  });
}

async function installChunkedCode(pic, sender, canisterId, wasmPath) {
  const wasm = fs.readFileSync(wasmPath);
  const chunkHashes = [];
  for (let offset = 0; offset < wasm.length; offset += maxChunkBytes) {
    const chunk = new Uint8Array(wasm.subarray(offset, Math.min(offset + maxChunkBytes, wasm.length)));
    await managementUpdate(pic, sender, "upload_chunk", ManagementUploadChunk, {
      canister_id: canisterId,
      chunk,
    });
    // `upload_chunk` defines this hash as SHA-256(chunk). The low-level
    // PocketIC client confirms the update succeeded but does not preserve a
    // decodable Candid reply for this management call. `install_chunked_code`
    // verifies every supplied hash against the canister's stored chunks.
    chunkHashes.push({ hash: new Uint8Array(crypto.createHash("sha256").update(chunk).digest()) });
  }
  const wasmHash = crypto.createHash("sha256").update(wasm).digest();
  await managementUpdate(pic, sender, "install_chunked_code", ManagementInstallChunkedCode, {
    arg: new Uint8Array(),
    chunk_hashes_list: chunkHashes,
    mode: { install: null },
    sender_canister_version: [],
    store_canister: [],
    canister_id: canisterId,
    wasm_module_hash: new Uint8Array(wasmHash),
  });
}

async function main() {
  const server = await PocketIcServer.start({ binPath: pocketIcBin, ttl: 60, showRuntimeLogs: false, showCanisterLogs: false });
  const pic = await PocketIc.create(server.getUrl());
  try {
    const bootstrap = Principal.fromUint8Array(Uint8Array.of(1, 1));
    const subject = Principal.fromUint8Array(Uint8Array.of(1, 42));
    const canisterId = await pic.createCanister({ sender: bootstrap, controllers: [bootstrap] });
    await installChunkedCode(pic, bootstrap, canisterId, wasm);
    const actor = pic.createActor(idl, canisterId);
    actor.setPrincipal(bootstrap);
    const binding = { logicalId: "principal-binding:v1:synthetic-42", contentHash: hash(1), userId: 42n, principal: subject, factor: { internetIdentity: null }, provider: [], subjectHash: [] };
    const role = { logicalId: "role-assignment:v1:synthetic-42:auditor", contentHash: hash(2), principal: subject, role: "auditor" };
    expect(await actor.writeBinding(binding), "acknowledged", "initial binding write");
    expect(await actor.writeBinding(binding), "acknowledged", "exact binding retry");
    expect(await actor.writeBinding({ ...binding, contentHash: hash(3) }), "conflict", "binding hash conflict");
    expect(await actor.writeRole(role), "acknowledged", "initial role write");
    expect(await actor.writeRole(role), "acknowledged", "exact role retry");
    expect(await actor.writeRole({ ...role, contentHash: hash(4) }), "conflict", "role hash conflict");
    expect(await actor.writeRole({ ...role, logicalId: "bad\nlogical-id" }), "blocked", "malformed role rejected");
    expect(await actor.writeBinding({ ...binding, principal: Principal.anonymous() }), "blocked", "anonymous identity rejected");
  } finally {
    await pic.tearDown();
    await server.stop();
  }
}
main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
