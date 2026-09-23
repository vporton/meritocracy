#!/usr/bin/env node
// Synthetic-only bounded migration-receipt archive capacity proof. It uses no
// PostgreSQL, source rows, credentials, importer, archive service, or target API.
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const picRoot = path.resolve(__dirname, "../../node_modules/ic-mops/node_modules/pic-js-mops");
const coreRoot = path.resolve(__dirname, "../../node_modules/ic-mops/node_modules/@icp-sdk/core");
const { PocketIc, PocketIcServer } = require(picRoot);
const { IDL } = require(path.join(coreRoot, "lib/cjs/candid/index.js"));
const { Principal } = require(path.join(coreRoot, "lib/cjs/principal/index.js"));
const [bin, fixtureWasm, sinkWasm, reportPath] = process.argv.slice(2);
if (!bin || !fixtureWasm || !sinkWasm || !reportPath) throw new Error("Expected PocketIC binary, capacity Wasms, and report path");
const Hash = IDL.Vec(IDL.Nat8), P = IDL.Principal;
const Input = IDL.Record({ logicalId: IDL.Text, migrationId: IDL.Text, sourceTable: IDL.Text, chunk: IDL.Nat64, rowCount: IDL.Nat32, payloadHash: Hash, desiredVersion: IDL.Nat64, contentHash: Hash });
const Tuple = IDL.Record({ logicalId: IDL.Text, version: IDL.Nat64, contentHash: Hash });
const Upload = IDL.Record({ canister_id: P, chunk: Hash });
const Chunk = IDL.Record({ hash: Hash });
const Install = IDL.Record({ arg: Hash, chunk_hashes_list: IDL.Vec(Chunk), mode: IDL.Variant({ install: IDL.Null }), sender_canister_version: IDL.Opt(IDL.Nat64), store_canister: IDL.Opt(P), canister_id: P, target_canister: P, wasm_module_hash: Hash });
const management = Principal.fromText("aaaaa-aa");
const fixtureIdl = ({ IDL: C }) => C.Service({ retainBatch: C.Func([C.Vec(Input)], [C.Vec(Tuple)], []), retainedCount: C.Func([], [C.Nat], []) });
const hash = n => Uint8Array.from({ length: 32 }, (_, i) => (n + i) % 256);
async function reject(f, label) { try { await f(); } catch (_) { return; } throw new Error(`${label}: expected rejected ingress`); }
async function managementCall(pic, sender, method, type, value) { return pic.client.updateCall({ canisterId: management, sender, method, payload: new Uint8Array(IDL.encode([type], [value])) }); }
async function install(pic, sender, id, wasmPath, arg) { const wasm = fs.readFileSync(wasmPath), chunks = []; for (let offset = 0; offset < wasm.length; offset += 1_000_000) { const chunk = new Uint8Array(wasm.subarray(offset, Math.min(offset + 1_000_000, wasm.length))); await managementCall(pic, sender, "upload_chunk", Upload, { canister_id: id, chunk }); chunks.push({ hash: new Uint8Array(crypto.createHash("sha256").update(chunk).digest()) }); } await managementCall(pic, sender, "install_chunked_code", Install, { arg: new Uint8Array(arg), chunk_hashes_list: chunks, mode: { install: null }, sender_canister_version: [], store_canister: [], canister_id: id, target_canister: id, wasm_module_hash: new Uint8Array(crypto.createHash("sha256").update(wasm).digest()) }); }
function batch(name, count) { return Array.from({ length: count }, (_, ordinal) => ({ logicalId: `migration-receipt:v1:archive-capacity:${name}:${ordinal}`, migrationId: `migration:archive-capacity:${name}`, sourceTable: "User", chunk: BigInt(ordinal + 1), rowCount: 1, payloadHash: hash(ordinal), desiredVersion: 1n, contentHash: hash(128 + ordinal) })); }
async function scenario(pic, installer, operator, name, count) {
  const fixtureId = await pic.createCanister({ sender: installer, controllers: [installer], cycles: 20_000_000_000_000n });
  const sinkId = await pic.createCanister({ sender: installer, controllers: [installer], cycles: 20_000_000_000_000n });
  await install(pic, installer, fixtureId, fixtureWasm, IDL.encode([P, P], [operator, sinkId]));
  await install(pic, installer, sinkId, sinkWasm, IDL.encode([P], [fixtureId]));
  const fixture = pic.createActor(fixtureIdl, fixtureId); fixture.setPrincipal(operator);
  const values = batch(name, count), before = await pic.getCyclesBalance(fixtureId);
  await reject(() => fixture.retainBatch(batch(`${name}:too-many`, 33)), `${name} rejects 33 bindings before archive insertion`);
  if (await fixture.retainedCount() !== 0n) throw new Error(`${name}: oversized batch reached archive`);
  await reject(() => fixture.retainBatch([{ ...values[0], logicalId: "x".repeat(513) }]), `${name} rejects oversized logical ID before archive insertion`);
  if (await fixture.retainedCount() !== 0n) throw new Error(`${name}: oversized logical ID reached archive`);
  const first = await fixture.retainBatch(values); const second = await fixture.retainBatch(values);
  if (first.length !== count || second.length !== count || await fixture.retainedCount() !== BigInt(count)) throw new Error(`${name}: exact archive retry was not idempotent`);
  const after = await pic.getCyclesBalance(fixtureId);
  return { name, bindings: count, exactRetries: count, encodedInputBytes: IDL.encode([IDL.Vec(Input)], [values]).byteLength, fixtureCycleDelta: (before - after).toString() };
}
async function main() { const server = await PocketIcServer.start({ binPath: bin, ttl: 60, showRuntimeLogs: false, showCanisterLogs: false }); const pic = await PocketIc.create(server.getUrl()); try { const installer = Principal.fromUint8Array(Uint8Array.of(12, 41)), operator = Principal.fromUint8Array(Uint8Array.of(12, 42)); const report = { schemaVersion: 1, component: "M1 synthetic canonical migration-receipt archive capacity", emulator: "PocketIC synthetic-only", scenarios: [await scenario(pic, installer, operator, "expected", 16), await scenario(pic, installer, operator, "two_x", 32)], rejection: { maxBindings: 32, oversizedBatch: 33, logicalIdBytes: 513, result: "blocked before synthetic archive insertion" }, limitations: ["Cycle deltas are emulator measurements, not a production instruction or cycle budget.", "This does not prove an authenticated importer, archive policy, canonical source export, migration rehearsal, or G2 evidence."] }; fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: "wx" }); console.log(JSON.stringify(report)); } finally { await pic.tearDown(); await server.stop(); } }
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
