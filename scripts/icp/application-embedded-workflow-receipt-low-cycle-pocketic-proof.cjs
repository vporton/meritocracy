#!/usr/bin/env node
// Synthetic-only low-cycle recovery proof for the consolidated application's
// private workflow-completion receipt collection. It has no application API.
const path = require("node:path"), fs = require("node:fs"), crypto = require("node:crypto");
const { PocketIc, PocketIcServer } = require(path.resolve(__dirname, "../../node_modules/ic-mops/node_modules/pic-js-mops"));
const { IDL } = require(path.resolve(__dirname, "../../node_modules/ic-mops/node_modules/@icp-sdk/core/lib/cjs/candid/index.js"));
const { Principal } = require(path.resolve(__dirname, "../../node_modules/ic-mops/node_modules/@icp-sdk/core/lib/cjs/principal/index.js"));

const [bin, wasm] = process.argv.slice(2);
if (!bin || !wasm) throw new Error("Expected PocketIC binary and fixture Wasm");
const Hash = IDL.Vec(IDL.Nat8), P = IDL.Principal;
const Input = IDL.Record({ logicalId: IDL.Text, cycleId: IDL.Text, operationName: IDL.Text, desiredVersion: IDL.Nat64, contentHash: Hash });
const Result = IDL.Variant({ acknowledged: IDL.Null, blocked: IDL.Null, conflict: IDL.Null, storageError: IDL.Null });
const ChunkHash = IDL.Record({ hash: Hash }), Upload = IDL.Record({ canister_id: P, chunk: Hash });
const Install = IDL.Record({ arg: Hash, chunk_hashes_list: IDL.Vec(ChunkHash), mode: IDL.Variant({ install: IDL.Null, upgrade: IDL.Opt(IDL.Record({ skip_pre_upgrade: IDL.Opt(IDL.Bool), wasm_memory_persistence: IDL.Opt(IDL.Variant({ keep: IDL.Null, replace: IDL.Null })) })) }), sender_canister_version: IDL.Opt(IDL.Nat64), store_canister: IDL.Opt(P), canister_id: P, target_canister: P, wasm_module_hash: Hash });
const management = Principal.fromText("aaaaa-aa"), lowInstallationCycles = 100_000_000_000n;
const idl = ({ IDL: C }) => C.Service({ retainReceiptThenWrite: C.Func([Input], [Result], []), retainReceiptForOperatorRepair: C.Func([Input], [Result], []), retryRetainedReceipt: C.Func([], [Result], []), repairRetainedReceipt: C.Func([], [Result], []) });
const hash = n => Uint8Array.from({ length: 32 }, (_, i) => (n + i) % 256);
function expect(value, tag, label) { if (Object.keys(value).length !== 1 || !(tag in value)) throw new Error(`${label}: expected ${tag}, got ${JSON.stringify(value)}`); }
async function mgmt(pic, sender, method, type, value) { return pic.client.updateCall({ canisterId: management, sender, method, payload: new Uint8Array(IDL.encode([type], [value])) }); }
async function install(pic, sender, id, mode = { install: null }) {
  const bytes = fs.readFileSync(wasm), chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 1_000_000) { const chunk = new Uint8Array(bytes.subarray(offset, Math.min(offset + 1_000_000, bytes.length))); await mgmt(pic, sender, "upload_chunk", Upload, { canister_id: id, chunk }); chunks.push({ hash: new Uint8Array(crypto.createHash("sha256").update(chunk).digest()) }); }
  await mgmt(pic, sender, "install_chunked_code", Install, { arg: new Uint8Array(), chunk_hashes_list: chunks, mode, sender_canister_version: [], store_canister: [], canister_id: id, target_canister: id, wasm_module_hash: new Uint8Array(crypto.createHash("sha256").update(bytes).digest()) });
}
async function main() {
  const server = await PocketIcServer.start({ binPath: bin, ttl: 60, showRuntimeLogs: false, showCanisterLogs: false });
  const pic = await PocketIc.create(server.getUrl());
  try {
    const installer = Principal.fromUint8Array(Uint8Array.of(4, 1));
    const id = await pic.createCanister({ sender: installer, controllers: [installer], cycles: lowInstallationCycles });
    await install(pic, installer, id);
    const actor = pic.createActor(idl, id); actor.setPrincipal(installer);
    const input = { logicalId: "workflow-completion:v1:low-cycles", cycleId: "cycle:low-cycles", operationName: "publish-result", desiredVersion: 1n, contentHash: hash(7) };
    expect(await actor.retainReceiptThenWrite(input), "blocked", "low-cycle receipt is retained but not written");
    expect(await actor.retainReceiptThenWrite({ ...input, contentHash: hash(8) }), "blocked", "retained receipt rejects a replacement");
    expect(await actor.retryRetainedReceipt(), "blocked", "low-cycle retry has no private write");
    // The retained intent is durable state. An EOP-preserving same-Wasm
    // upgrade while funds are unavailable must not discard it or create a
    // substitute write path; only the later no-input retry may resume it.
    await install(pic, installer, id, {
      upgrade: [{ skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }],
    });
    expect(await actor.retryRetainedReceipt(), "blocked", "upgraded low-cycle retry retains intent but has no private write");
    if ((await pic.addCycles(id, 2_000_000_000_000n)) < 1_000_000_000_000n) throw new Error("low-cycle proof failed to replenish disposable workflow fixture");
    expect(await actor.retryRetainedReceipt(), "acknowledged", "replenished retry writes only retained receipt");
    expect(await actor.retryRetainedReceipt(), "blocked", "consumed receipt cannot replay");
    const interrupted = { ...input, logicalId: "workflow-completion:v1:operator-repair", cycleId: "cycle:operator-repair", contentHash: hash(9) };
    expect(await actor.retainReceiptForOperatorRepair(interrupted), "blocked", "interrupted receipt retains no automatic write path");
    expect(await actor.retryRetainedReceipt(), "blocked", "ordinary retry cannot bypass operator repair");
    actor.setPrincipal(Principal.fromUint8Array(Uint8Array.of(4, 9)));
    expect(await actor.repairRetainedReceipt(), "blocked", "outsider cannot repair retained receipt");
    actor.setPrincipal(installer);
    await install(pic, installer, id, {
      upgrade: [{ skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }],
    });
    expect(await actor.repairRetainedReceipt(), "acknowledged", "authorized no-input repair writes retained receipt after upgrade");
    expect(await actor.repairRetainedReceipt(), "blocked", "consumed repaired receipt cannot replay");
    console.log("application embedded workflow receipt low-cycle proof passed");
  } finally { await pic.tearDown(); await server.stop(); }
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
