#!/usr/bin/env node
// Isolated synthetic outbox/inbox proof; no target data, payment, signer,
// ledger, chain call, wallet, identity, or deployment is involved.
const path = require("node:path"), fs = require("node:fs"), crypto = require("node:crypto");
const { PocketIc, PocketIcServer } = require(path.resolve(__dirname, "../../node_modules/ic-mops/node_modules/pic-js-mops"));
const { IDL } = require(path.resolve(__dirname, "../../node_modules/ic-mops/node_modules/@icp-sdk/core/lib/cjs/candid/index.js"));
const { Principal } = require(path.resolve(__dirname, "../../node_modules/ic-mops/node_modules/@icp-sdk/core/lib/cjs/principal/index.js"));
const [bin, applicationWasm, treasuryWasm] = process.argv.slice(2);
if (!bin || !applicationWasm || !treasuryWasm) throw new Error("Expected PocketIC binary and two fixture Wasms");
const Hash = IDL.Vec(IDL.Nat8), Input = IDL.Record({ logicalId: IDL.Text, version: IDL.Nat64, contentHash: Hash });
const Receipt = IDL.Record({ version: IDL.Nat64, contentHash: Hash });
const Decision = IDL.Variant({ acknowledge: IDL.Null, retryIdentical: IDL.Null, conflict: IDL.Null, blocked: IDL.Null });
const applicationIdl = ({ IDL: C }) => C.Service({ retainThenLoseReply: C.Func([Input], [], []), reconcile: C.Func([], [Decision], []), retryThenLoseReply: C.Func([], [], []), isActive: C.Func([], [C.Bool], []), retainedCount: C.Func([], [C.Nat], []) });
const treasuryIdl = ({ IDL: C }) => C.Service({ submit: C.Func([Input], [Receipt], []), lookup: C.Func([C.Text], [C.Opt(Receipt)], []), count: C.Func([], [C.Nat], []) });
const management = Principal.fromText("aaaaa-aa"), Upload = IDL.Record({ canister_id: IDL.Principal, chunk: Hash }), Chunk = IDL.Record({ hash: Hash });
const Install = IDL.Record({ arg: Hash, chunk_hashes_list: IDL.Vec(Chunk), mode: IDL.Variant({ install: IDL.Null, upgrade: IDL.Opt(IDL.Record({ skip_pre_upgrade: IDL.Opt(IDL.Bool), wasm_memory_persistence: IDL.Opt(IDL.Variant({ keep: IDL.Null, replace: IDL.Null })) })) }), sender_canister_version: IDL.Opt(IDL.Nat64), store_canister: IDL.Opt(IDL.Principal), canister_id: IDL.Principal, target_canister: IDL.Principal, wasm_module_hash: Hash });
async function managementCall(pic, sender, method, type, value) { return pic.client.updateCall({ canisterId: management, sender, method, payload: new Uint8Array(IDL.encode([type], [value])) }); }
async function install(pic, sender, id, wasmPath, arg, mode = { install: null }) { const bytes = fs.readFileSync(wasmPath), chunks = []; for (let p = 0; p < bytes.length; p += 1_000_000) { const chunk = new Uint8Array(bytes.subarray(p, Math.min(p + 1_000_000, bytes.length))); await managementCall(pic, sender, "upload_chunk", Upload, { canister_id: id, chunk }); chunks.push({ hash: new Uint8Array(crypto.createHash("sha256").update(chunk).digest()) }); } await managementCall(pic, sender, "install_chunked_code", Install, { arg: new Uint8Array(arg), chunk_hashes_list: chunks, mode, sender_canister_version: [], store_canister: [], canister_id: id, target_canister: id, wasm_module_hash: new Uint8Array(crypto.createHash("sha256").update(bytes).digest()) }); }
async function rejected(f, label) { try { await f(); } catch (_) { return; } throw new Error(`${label}: expected rejection`); }
function expect(v, tag, label) { if (!(tag in v) || Object.keys(v).length !== 1) throw new Error(`${label}: expected ${tag}`); }
async function main() { const server = await PocketIcServer.start({ binPath: bin, ttl: 60, showRuntimeLogs: false, showCanisterLogs: false }); const pic = await PocketIc.create(server.getUrl()); try {
  const installer = Principal.fromUint8Array(Uint8Array.of(6, 1)), operator = Principal.fromUint8Array(Uint8Array.of(6, 2)), outsider = Principal.fromUint8Array(Uint8Array.of(6, 3));
  const applicationId = await pic.createCanister({ sender: installer, controllers: [installer] }), treasuryId = await pic.createCanister({ sender: installer, controllers: [installer] });
  await install(pic, installer, applicationId, applicationWasm, IDL.encode([IDL.Principal, IDL.Principal], [operator, treasuryId])); await install(pic, installer, treasuryId, treasuryWasm, IDL.encode([IDL.Principal], [applicationId]));
  const application = pic.createActor(applicationIdl, applicationId), treasury = pic.createActor(treasuryIdl, treasuryId), hash = n => Uint8Array.from({ length: 32 }, () => n), input = { logicalId: "application-outbox:v1:129", version: 1n, contentHash: hash(19) };
  application.setPrincipal(outsider); await rejected(() => application.reconcile(), "outsider application recovery denied"); treasury.setPrincipal(outsider); await rejected(() => treasury.lookup(input.logicalId), "outsider treasury lookup denied");
  application.setPrincipal(operator); await rejected(() => application.retainThenLoseReply({ ...input, contentHash: new Uint8Array() }), "malformed tuple rejected before treasury"); if (await application.retainedCount() !== 0n) throw new Error("malformed tuple reached treasury");
  await rejected(() => application.retainThenLoseReply(input), "successful treasury reply deliberately lost"); if (await application.isActive()) throw new Error("lost reply activated application result");
  await install(pic, installer, treasuryId, treasuryWasm, IDL.encode([IDL.Principal], [applicationId]), { upgrade: [{ skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }] }); await install(pic, installer, applicationId, applicationWasm, IDL.encode([IDL.Principal, IDL.Principal], [operator, treasuryId]), { upgrade: [{ skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }] });
  application.setPrincipal(operator); expect(await application.reconcile(), "acknowledge", "exact treasury receipt reconciles after EOP upgrades"); if (!await application.isActive()) throw new Error("exact receipt did not activate application result"); await rejected(() => application.retryThenLoseReply(), "duplicate delivery loses reply"); expect(await application.reconcile(), "acknowledge", "duplicate delivery remains exact"); if (await application.retainedCount() !== 1n) throw new Error("duplicate delivery made another treasury receipt");
  console.log("application treasury operation saga proof passed");
} finally { await pic.tearDown(); await server.stop(); } }
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
