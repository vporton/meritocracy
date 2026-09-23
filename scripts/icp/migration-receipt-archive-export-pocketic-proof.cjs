#!/usr/bin/env node
// Isolated synthetic archive proof: no PostgreSQL, importer credential,
// source row, target interface, identity, wallet, or production data is used.
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const picRoot = path.resolve(__dirname, "../../node_modules/ic-mops/node_modules/pic-js-mops");
const coreRoot = path.resolve(__dirname, "../../node_modules/ic-mops/node_modules/@icp-sdk/core");
const { PocketIc, PocketIcServer } = require(picRoot);
const { IDL } = require(path.join(coreRoot, "lib/cjs/candid/index.js"));
const { Principal } = require(path.join(coreRoot, "lib/cjs/principal/index.js"));
const [bin, fixtureWasm, sinkWasm] = process.argv.slice(2);
if (!bin || !fixtureWasm || !sinkWasm) throw new Error("Expected PocketIC binary, fixture Wasm, and sink Wasm");
const Hash = IDL.Vec(IDL.Nat8);
const Tuple = IDL.Record({ logicalId: IDL.Text, version: IDL.Nat64, contentHash: Hash });
const Binding = IDL.Record({ tuple: Tuple, bytes: IDL.Vec(IDL.Nat8) });
const Input = IDL.Record({ logicalId: IDL.Text, migrationId: IDL.Text, sourceTable: IDL.Text, chunk: IDL.Nat64, rowCount: IDL.Nat32, payloadHash: Hash, desiredVersion: IDL.Nat64, contentHash: Hash });
const Decision = IDL.Variant({ acknowledge: IDL.Null, remainPending: IDL.Null, blocked: IDL.Null });
const fixtureIdl = ({ IDL: C }) => C.Service({ retainThenLoseReply: C.Func([Input], [], []), reconcile: C.Func([], [Decision], []), retryThenLoseReply: C.Func([], [], []), retainForOperatorRepair: C.Func([Input], [], []), repairThenLoseReply: C.Func([], [], []), reconcileRepair: C.Func([], [Decision], []), isAcknowledged: C.Func([], [C.Bool], []), retainedCount: C.Func([], [C.Nat], []) });
const sinkIdl = ({ IDL: C }) => C.Service({ retain: C.Func([Binding], [Tuple], []), lookup: C.Func([C.Text], [C.Opt(Tuple)], []), count: C.Func([], [C.Nat], []) });
const management = Principal.fromText("aaaaa-aa");
// Below the fixed proof-only CycleReserve minimum. Only this disposable
// fixture is replenished in the synthetic low-cycle path.
const lowCycleFixtureInstallationCycles = 900_000_000_000n;
const Upload = IDL.Record({ canister_id: IDL.Principal, chunk: IDL.Vec(IDL.Nat8) });
const Chunk = IDL.Record({ hash: Hash });
const Install = IDL.Record({ arg: IDL.Vec(IDL.Nat8), chunk_hashes_list: IDL.Vec(Chunk), mode: IDL.Variant({ install: IDL.Null, upgrade: IDL.Opt(IDL.Record({ skip_pre_upgrade: IDL.Opt(IDL.Bool), wasm_memory_persistence: IDL.Opt(IDL.Variant({ keep: IDL.Null, replace: IDL.Null })) })) }), sender_canister_version: IDL.Opt(IDL.Nat64), store_canister: IDL.Opt(IDL.Principal), canister_id: IDL.Principal, target_canister: IDL.Principal, wasm_module_hash: Hash });
function expect(value, tag, label) { if (Object.keys(value).length !== 1 || !(tag in value)) throw new Error(`${label}: expected ${tag}`); }
async function reject(f, label) { try { await f(); } catch (_) { return; } throw new Error(`${label}: expected rejected ingress`); }
async function managementCall(pic, sender, method, type, value) { return pic.client.updateCall({ canisterId: management, sender, method, payload: new Uint8Array(IDL.encode([type], [value])) }); }
async function install(pic, sender, id, wasmPath, arg, mode = { install: null }) {
  const wasm = fs.readFileSync(wasmPath), chunks = [];
  for (let offset = 0; offset < wasm.length; offset += 1_000_000) {
    const chunk = new Uint8Array(wasm.subarray(offset, Math.min(offset + 1_000_000, wasm.length)));
    await managementCall(pic, sender, "upload_chunk", Upload, { canister_id: id, chunk });
    chunks.push({ hash: new Uint8Array(crypto.createHash("sha256").update(chunk).digest()) });
  }
  await managementCall(pic, sender, "install_chunked_code", Install, { arg: new Uint8Array(arg), chunk_hashes_list: chunks, mode, sender_canister_version: [], store_canister: [], canister_id: id, target_canister: id, wasm_module_hash: new Uint8Array(crypto.createHash("sha256").update(wasm).digest()) });
}
async function main() {
  const server = await PocketIcServer.start({ binPath: bin, ttl: 60, showRuntimeLogs: false, showCanisterLogs: false });
  const pic = await PocketIc.create(server.getUrl());
  try {
    const installer = Principal.fromUint8Array(Uint8Array.of(12, 1));
    const operator = Principal.fromUint8Array(Uint8Array.of(12, 2));
    const outsider = Principal.fromUint8Array(Uint8Array.of(12, 3));
    const repairOperator = Principal.fromUint8Array(Uint8Array.of(12, 4));
    const fixtureId = await pic.createCanister({ sender: installer, controllers: [installer] });
    const sinkId = await pic.createCanister({ sender: installer, controllers: [installer] });
    await install(pic, installer, fixtureId, fixtureWasm, IDL.encode([IDL.Principal, IDL.Principal, IDL.Principal], [operator, repairOperator, sinkId]));
    await install(pic, installer, sinkId, sinkWasm, IDL.encode([IDL.Principal], [fixtureId]));
    const fixture = pic.createActor(fixtureIdl, fixtureId);
    const sink = pic.createActor(sinkIdl, sinkId);
    const hash = byte => Uint8Array.from({ length: 32 }, () => byte);
    const input = { logicalId: "migration-receipt:v1:archive-eop", migrationId: "migration:archive-eop", sourceTable: "User", chunk: 7n, rowCount: 2, payloadHash: hash(20), desiredVersion: 1n, contentHash: hash(21) };
    fixture.setPrincipal(outsider); await reject(() => fixture.reconcile(), "outsider reconciliation denied");
    sink.setPrincipal(outsider); await reject(() => sink.lookup(input.logicalId), "outsider archive lookup denied");
    fixture.setPrincipal(operator); await reject(() => fixture.retainThenLoseReply({ ...input, rowCount: 0 }), "invalid receipt rejected before sink");
    if (await fixture.retainedCount() !== 0n) throw new Error("invalid receipt reached synthetic archive sink");
    await reject(() => fixture.retainThenLoseReply(input), "archive acknowledgement deliberately lost");
    if (await fixture.isAcknowledged()) throw new Error("lost archive reply activated receipt");
    await install(pic, installer, sinkId, sinkWasm, IDL.encode([IDL.Principal], [fixtureId]), { upgrade: [{ skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }] });
    await install(pic, installer, fixtureId, fixtureWasm, IDL.encode([IDL.Principal, IDL.Principal, IDL.Principal], [operator, repairOperator, sinkId]), { upgrade: [{ skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }] });
    fixture.setPrincipal(operator); expect(await fixture.reconcile(), "acknowledge", "exact archive receipt reconciles after EOP upgrades");
    if (!await fixture.isAcknowledged()) throw new Error("exact receipt did not acknowledge retained archive binding");
    await reject(() => fixture.retryThenLoseReply(), "duplicate archive delivery deliberately loses reply");
    expect(await fixture.reconcile(), "acknowledge", "duplicate delivery reconciles exact retained receipt");
    if (await fixture.retainedCount() !== 1n) throw new Error("duplicate delivery retained a second archive binding");

    // The binding must survive a reserve rejection before the sink await.
    // Same-Wasm EOP preserves it; only no-input retry after test-only
    // replenishment can dispatch the exact retained canonical binding.
    const lowFixtureId = await pic.createCanister({ sender: installer, controllers: [installer], cycles: lowCycleFixtureInstallationCycles });
    const lowSinkId = await pic.createCanister({ sender: installer, controllers: [installer] });
    await install(pic, installer, lowFixtureId, fixtureWasm, IDL.encode([IDL.Principal, IDL.Principal, IDL.Principal], [operator, repairOperator, lowSinkId]));
    await install(pic, installer, lowSinkId, sinkWasm, IDL.encode([IDL.Principal], [lowFixtureId]));
    const lowFixture = pic.createActor(fixtureIdl, lowFixtureId);
    lowFixture.setPrincipal(operator);
    const lowInput = { ...input, logicalId: "migration-receipt:v1:archive-low-cycles", migrationId: "migration:archive-low-cycles", contentHash: hash(22) };
    await reject(() => lowFixture.retainThenLoseReply(lowInput), "low-cycle archive dispatch is blocked after binding retention");
    if (await lowFixture.retainedCount() !== 0n) throw new Error("low-cycle archive dispatch reached synthetic sink");
    await install(pic, installer, lowFixtureId, fixtureWasm, IDL.encode([IDL.Principal, IDL.Principal, IDL.Principal], [operator, repairOperator, lowSinkId]), { upgrade: [{ skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }] });
    lowFixture.setPrincipal(operator);
    if ((await pic.addCycles(lowFixtureId, 2_000_000_000_000n)) < 1_000_000_000_000n) throw new Error("low-cycle archive proof failed to replenish disposable migration fixture");
    await reject(() => lowFixture.retryThenLoseReply(), "replenished retry deliberately loses only retained archive binding reply");
    expect(await lowFixture.reconcile(), "acknowledge", "replenished retry reconciles exact retained archive binding");
    if (await lowFixture.retainedCount() !== 1n) throw new Error("replenished low-cycle retry retained an unexpected binding");

    // A pre-await interruption has no ordinary retry or reconciliation path.
    // Only the separate, input-free repair principal may deliver its binding.
    const repairFixtureId = await pic.createCanister({ sender: installer, controllers: [installer] });
    const repairSinkId = await pic.createCanister({ sender: installer, controllers: [installer] });
    await install(pic, installer, repairFixtureId, fixtureWasm, IDL.encode([IDL.Principal, IDL.Principal, IDL.Principal], [operator, repairOperator, repairSinkId]));
    await install(pic, installer, repairSinkId, sinkWasm, IDL.encode([IDL.Principal], [repairFixtureId]));
    const repairFixture = pic.createActor(fixtureIdl, repairFixtureId);
    const repairInput = { ...input, logicalId: "migration-receipt:v1:archive-repair", migrationId: "migration:archive-repair", contentHash: hash(23) };
    repairFixture.setPrincipal(operator); await repairFixture.retainForOperatorRepair(repairInput);
    await reject(() => repairFixture.retryThenLoseReply(), "ordinary retry denied while repair is pending");
    expect(await repairFixture.reconcile(), "blocked", "ordinary reconciliation is closed while repair is pending");
    repairFixture.setPrincipal(outsider); await reject(() => repairFixture.repairThenLoseReply(), "outsider repair denied");
    await install(pic, installer, repairSinkId, sinkWasm, IDL.encode([IDL.Principal], [repairFixtureId]), { upgrade: [{ skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }] });
    await install(pic, installer, repairFixtureId, fixtureWasm, IDL.encode([IDL.Principal, IDL.Principal, IDL.Principal], [operator, repairOperator, repairSinkId]), { upgrade: [{ skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }] });
    repairFixture.setPrincipal(repairOperator); await reject(() => repairFixture.repairThenLoseReply(), "repair reply deliberately lost");
    expect(await repairFixture.reconcileRepair(), "acknowledge", "exact repaired archive receipt reconciles after EOP upgrades");
    repairFixture.setPrincipal(operator);
    if (!await repairFixture.isAcknowledged()) throw new Error("exact repaired receipt did not acknowledge retained archive binding");
    repairFixture.setPrincipal(repairOperator);
    await reject(() => repairFixture.repairThenLoseReply(), "consumed repair cannot replay");
  } finally { await pic.tearDown(); await server.stop(); }
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
