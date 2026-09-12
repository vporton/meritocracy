#!/usr/bin/env node
// Isolated M1 fixture proof. It never supplies a signer, destination address,
// transaction material, chain endpoint, wallet, or target-canister identity.
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const picRoot = path.resolve(__dirname, "../../node_modules/ic-mops/node_modules/pic-js-mops");
const coreRoot = path.resolve(__dirname, "../../node_modules/ic-mops/node_modules/@icp-sdk/core");
const { PocketIc, PocketIcServer } = require(picRoot);
const { IDL } = require(path.join(coreRoot, "lib/cjs/candid/index.js"));
const { Principal } = require(path.join(coreRoot, "lib/cjs/principal/index.js"));
const [bin, authorityWasm, treasuryWasm] = process.argv.slice(2);
if (!bin || !authorityWasm || !treasuryWasm) throw new Error("Expected PocketIC binary, authority Wasm, and treasury Wasm");

const Hash = IDL.Vec(IDL.Nat8);
const Config = IDL.Record({ core: IDL.Principal, workflow: IDL.Principal, treasury: IDL.Principal, archive: IDL.Principal, evidence: IDL.Principal, governance: IDL.Principal });
const Input = IDL.Record({ logicalId: IDL.Text, desiredVersion: IDL.Nat64, contentHash: Hash, operationId: IDL.Text, obligationId: IDL.Text, assetId: IDL.Text, amountBaseUnits: IDL.Nat, assetDecimals: IDL.Nat8, destinationHash: Hash });
const Write = IDL.Variant({ acknowledged: IDL.Null, blocked: IDL.Null, conflict: IDL.Null, storageError: IDL.Null });
const Observation = IDL.Variant({ absent: IDL.Null, present: IDL.Record({ version: IDL.Nat64, contentHash: Hash }), conflict: IDL.Null, storageError: IDL.Null });
const Recovery = IDL.Variant({ acknowledge: IDL.Null, retryIdentical: IDL.Null, conflict: IDL.Null, blocked: IDL.Null });
const authorityIdl = ({ IDL: C }) => C.Service({ writeTreasuryPaymentOperation: C.Func([Input], [Write], []), lookupTreasuryPaymentOperation: C.Func([C.Text], [Observation], []) });
const treasuryIdl = ({ IDL: C }) => C.Service({ writeThenLoseReply: C.Func([Input], [], []), reconcileLostReply: C.Func([], [Recovery], []), retryJournaledWriteThenLoseReply: C.Func([], [], []) });
const Chunk = IDL.Record({ hash: IDL.Vec(IDL.Nat8) });
const Upload = IDL.Record({ canister_id: IDL.Principal, chunk: IDL.Vec(IDL.Nat8) });
const Install = IDL.Record({ arg: IDL.Vec(IDL.Nat8), chunk_hashes_list: IDL.Vec(Chunk), mode: IDL.Variant({ install: IDL.Null, upgrade: IDL.Opt(IDL.Record({ skip_pre_upgrade: IDL.Opt(IDL.Bool), wasm_memory_persistence: IDL.Opt(IDL.Variant({ keep: IDL.Null, replace: IDL.Null })) })) }), sender_canister_version: IDL.Opt(IDL.Nat64), store_canister: IDL.Opt(IDL.Principal), canister_id: IDL.Principal, target_canister: IDL.Principal, wasm_module_hash: IDL.Vec(IDL.Nat8) });
const management = Principal.fromText("aaaaa-aa");
function expect(value, tag, label) { if (Object.keys(value).length !== 1 || !(tag in value)) throw new Error(`${label}: expected ${tag}`); }
async function reject(f, label) { try { await f(); } catch (_) { return; } throw new Error(`${label}: expected rejected ingress`); }
async function update(pic, sender, method, type, value) { return pic.client.updateCall({ canisterId: management, sender, method, payload: new Uint8Array(IDL.encode([type], [value])) }); }
async function install(pic, sender, id, wasmPath, arg, mode = { install: null }) {
  const wasm = fs.readFileSync(wasmPath), hashes = [];
  for (let offset = 0; offset < wasm.length; offset += 1_000_000) { const chunk = new Uint8Array(wasm.subarray(offset, Math.min(offset + 1_000_000, wasm.length))); await update(pic, sender, "upload_chunk", Upload, { canister_id: id, chunk }); hashes.push({ hash: new Uint8Array(crypto.createHash("sha256").update(chunk).digest()) }); }
  await update(pic, sender, "install_chunked_code", Install, { arg: new Uint8Array(arg), chunk_hashes_list: hashes, mode, sender_canister_version: [], store_canister: [], canister_id: id, target_canister: id, wasm_module_hash: new Uint8Array(crypto.createHash("sha256").update(wasm).digest()) });
}
async function main() {
  const server = await PocketIcServer.start({ binPath: bin, ttl: 60, showRuntimeLogs: false, showCanisterLogs: false }); const pic = await PocketIc.create(server.getUrl());
  try {
    const installer = Principal.fromUint8Array(Uint8Array.of(2, 1)), operator = Principal.fromUint8Array(Uint8Array.of(2, 2)), outsider = Principal.fromUint8Array(Uint8Array.of(2, 3));
    const authorityId = await pic.createCanister({ sender: installer, controllers: [installer] }), treasuryId = await pic.createCanister({ sender: installer, controllers: [installer] });
    const config = { core: Principal.fromUint8Array(Uint8Array.of(2, 4)), workflow: Principal.fromUint8Array(Uint8Array.of(2, 5)), treasury: treasuryId, archive: Principal.fromUint8Array(Uint8Array.of(2, 6)), evidence: Principal.fromUint8Array(Uint8Array.of(2, 7)), governance: Principal.fromUint8Array(Uint8Array.of(2, 8)) };
    await install(pic, installer, authorityId, authorityWasm, IDL.encode([Config], [config]));
    await install(pic, installer, treasuryId, treasuryWasm, IDL.encode([IDL.Principal, IDL.Principal], [operator, authorityId]));
    const authority = pic.createActor(authorityIdl, authorityId), treasury = pic.createActor(treasuryIdl, treasuryId);
    const h = (n) => Uint8Array.from({ length: 32 }, () => n);
    const input = { logicalId: "payment-operation:v1:synthetic-1", desiredVersion: 1n, contentHash: h(11), operationId: "operation:synthetic-1", obligationId: "obligation:synthetic-1", assetId: "ICP", amountBaseUnits: 1n, assetDecimals: 8, destinationHash: h(12) };
    authority.setPrincipal(outsider); expect(await authority.writeTreasuryPaymentOperation(input), "blocked", "direct write denied"); expect(await authority.lookupTreasuryPaymentOperation(input.logicalId), "conflict", "direct lookup denied");
    treasury.setPrincipal(outsider); await reject(() => treasury.reconcileLostReply(), "outsider recovery denied");
    treasury.setPrincipal(operator); await reject(() => treasury.writeThenLoseReply(input), "deliberately lost first reply");
    await install(pic, installer, authorityId, authorityWasm, IDL.encode([Config], [config]), { upgrade: [{ skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }] });
    await install(pic, installer, treasuryId, treasuryWasm, IDL.encode([IDL.Principal, IDL.Principal], [operator, authorityId]), { upgrade: [{ skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }] });
    treasury.setPrincipal(operator); expect(await treasury.reconcileLostReply(), "acknowledge", "exact recovery after EOP upgrades");
    await reject(() => treasury.writeThenLoseReply(input), "duplicate delivery loses reply"); expect(await treasury.reconcileLostReply(), "acknowledge", "duplicate reconciles exact tuple");
  } finally { await pic.tearDown(); await server.stop(); }
}
main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
