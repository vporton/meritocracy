#!/usr/bin/env node
// Synthetic-only low-cycle recovery proof for consolidated application-private
// identity/role adapters. It exercises a disposable fixture, never the target
// application actor or a public application Candid method.
const path = require("node:path"), fs = require("node:fs"), crypto = require("node:crypto");
const { PocketIc, PocketIcServer } = require(path.resolve(__dirname, "../../node_modules/ic-mops/node_modules/pic-js-mops"));
const { IDL } = require(path.resolve(__dirname, "../../node_modules/ic-mops/node_modules/@icp-sdk/core/lib/cjs/candid/index.js"));
const { Principal } = require(path.resolve(__dirname, "../../node_modules/ic-mops/node_modules/@icp-sdk/core/lib/cjs/principal/index.js"));
const [bin, wasm] = process.argv.slice(2);
if (!bin || !wasm) throw new Error("Expected PocketIC binary and fixture Wasm");
const Hash = IDL.Vec(IDL.Nat8), P = IDL.Principal, Factor = IDL.Variant({ internetIdentity: IDL.Null, oauth: IDL.Null });
const Binding = IDL.Record({ logicalId: IDL.Text, desiredVersion: IDL.Nat64, contentHash: Hash, userId: IDL.Nat64, principal: P, factor: Factor, provider: IDL.Opt(IDL.Text), subjectHash: IDL.Opt(Hash) });
const Role = IDL.Record({ logicalId: IDL.Text, desiredVersion: IDL.Nat64, contentHash: Hash, principal: P, role: IDL.Text });
const Result = IDL.Variant({ acknowledged: IDL.Null, blocked: IDL.Null, conflict: IDL.Null, storageError: IDL.Null });
const ChunkHash = IDL.Record({ hash: Hash }), Upload = IDL.Record({ canister_id: P, chunk: Hash });
const Install = IDL.Record({ arg: Hash, chunk_hashes_list: IDL.Vec(ChunkHash), mode: IDL.Variant({ install: IDL.Null }), sender_canister_version: IDL.Opt(IDL.Nat64), store_canister: IDL.Opt(P), canister_id: P, target_canister: P, wasm_module_hash: Hash });
const management = Principal.fromText("aaaaa-aa"), lowInstallationCycles = 900_000_000_000n;
const idl = ({ IDL: C }) => C.Service({ retainBindingThenWrite: C.Func([Binding], [Result], []), retryRetainedBinding: C.Func([], [Result], []), retainRoleThenWrite: C.Func([Role], [Result], []), retryRetainedRole: C.Func([], [Result], []) });
const hash = n => Uint8Array.from({ length: 32 }, (_, i) => (n + i) % 256);
function expect(v, tag, label) { if (Object.keys(v).length !== 1 || !(tag in v)) throw new Error(`${label}: expected ${tag}, got ${JSON.stringify(v)}`); }
async function mgmt(pic, sender, method, type, value) { return pic.client.updateCall({ canisterId: management, sender, method, payload: new Uint8Array(IDL.encode([type], [value])) }); }
async function install(pic, sender, id) { const bytes = fs.readFileSync(wasm), chunks = []; for (let i = 0; i < bytes.length; i += 1_000_000) { const chunk = new Uint8Array(bytes.subarray(i, Math.min(i + 1_000_000, bytes.length))); await mgmt(pic, sender, "upload_chunk", Upload, { canister_id: id, chunk }); chunks.push({ hash: new Uint8Array(crypto.createHash("sha256").update(chunk).digest()) }); } await mgmt(pic, sender, "install_chunked_code", Install, { arg: new Uint8Array(), chunk_hashes_list: chunks, mode: { install: null }, sender_canister_version: [], store_canister: [], canister_id: id, target_canister: id, wasm_module_hash: new Uint8Array(crypto.createHash("sha256").update(bytes).digest()) }); }
async function main() { const server = await PocketIcServer.start({ binPath: bin, ttl: 60, showRuntimeLogs: false, showCanisterLogs: false }); const pic = await PocketIc.create(server.getUrl()); try { const installer = Principal.fromUint8Array(Uint8Array.of(4, 1)), subject = Principal.fromUint8Array(Uint8Array.of(4, 42)); const id = await pic.createCanister({ sender: installer, controllers: [installer], cycles: lowInstallationCycles }); await install(pic, installer, id); const actor = pic.createActor(idl, id); actor.setPrincipal(installer); const binding = { logicalId: "principal-binding:v1:low-cycles", desiredVersion: 1n, contentHash: hash(1), userId: 42n, principal: subject, factor: { internetIdentity: null }, provider: [], subjectHash: [] }; const role = { logicalId: "role-assignment:v1:low-cycles:auditor", desiredVersion: 1n, contentHash: hash(2), principal: subject, role: "auditor" };
  expect(await actor.retainBindingThenWrite(binding), "blocked", "low-cycle binding is retained but not written");
  expect(await actor.retainRoleThenWrite(role), "blocked", "low-cycle role is retained but not written");
  expect(await actor.retainBindingThenWrite({ ...binding, contentHash: hash(3) }), "blocked", "retained binding cannot be replaced");
  expect(await actor.retainRoleThenWrite({ ...role, contentHash: hash(4) }), "blocked", "retained role cannot be replaced");
  if ((await pic.addCycles(id, 2_000_000_000_000n)) < 1_000_000_000_000n) throw new Error("low-cycle proof failed to replenish disposable application fixture");
  expect(await actor.retryRetainedBinding(), "acknowledged", "replenished binding writes only retained input");
  expect(await actor.retryRetainedRole(), "acknowledged", "replenished role writes only retained input");
  expect(await actor.retryRetainedBinding(), "blocked", "consumed binding intent cannot be replayed");
  expect(await actor.retryRetainedRole(), "blocked", "consumed role intent cannot be replayed");
} finally { await pic.tearDown(); await server.stop(); } }
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
