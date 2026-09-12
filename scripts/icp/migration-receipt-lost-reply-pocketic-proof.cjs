#!/usr/bin/env node
// Runs only synthetic importer/authority fixtures. It has no PostgreSQL
// client, source data, credential, DFX identity, wallet, or target importer.
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const picRoot = path.resolve(__dirname, "../../node_modules/ic-mops/node_modules/pic-js-mops");
const coreRoot = path.resolve(__dirname, "../../node_modules/ic-mops/node_modules/@icp-sdk/core");
const { PocketIc, PocketIcServer } = require(picRoot);
const { IDL } = require(path.join(coreRoot, "lib/cjs/candid/index.js"));
const { Principal } = require(path.join(coreRoot, "lib/cjs/principal/index.js"));
const [bin, authorityWasm, importerWasm] = process.argv.slice(2);
if (!bin || !authorityWasm || !importerWasm) throw new Error("Expected PocketIC binary, authority Wasm, and importer Wasm");

const Hash = IDL.Vec(IDL.Nat8);
const Config = IDL.Record({ core: IDL.Principal, workflow: IDL.Principal, treasury: IDL.Principal, archive: IDL.Principal, evidence: IDL.Principal, governance: IDL.Principal });
const Input = IDL.Record({ logicalId: IDL.Text, migrationId: IDL.Text, sourceTable: IDL.Text, chunk: IDL.Nat64, rowCount: IDL.Nat32, payloadHash: Hash, desiredVersion: IDL.Nat64, contentHash: Hash });
const Write = IDL.Variant({ acknowledged: IDL.Null, blocked: IDL.Null, conflict: IDL.Null, storageError: IDL.Null });
const Observation = IDL.Variant({ absent: IDL.Null, present: IDL.Record({ version: IDL.Nat64, contentHash: Hash }), conflict: IDL.Null, storageError: IDL.Null });
const Recovery = IDL.Variant({ acknowledge: IDL.Null, retryIdentical: IDL.Null, conflict: IDL.Null, blocked: IDL.Null });
const authorityIdl = ({ IDL: C }) => C.Service({ writeMigrationReceipt: C.Func([Input], [Write], []), lookupMigrationReceipt: C.Func([C.Text], [Observation], []) });
const importerIdl = ({ IDL: C }) => C.Service({ writeThenLoseReply: C.Func([Input], [], []), journalThenTrapBeforeAwait: C.Func([Input], [], []), reconcileLostReply: C.Func([], [Recovery], []), retryJournaledWriteThenLoseReply: C.Func([], [], []), repairJournaledReceipt: C.Func([], [Recovery], []) });
const Chunk = IDL.Record({ hash: Hash });
const Upload = IDL.Record({ canister_id: IDL.Principal, chunk: Hash });
const Install = IDL.Record({ arg: Hash, chunk_hashes_list: IDL.Vec(Chunk), mode: IDL.Variant({ install: IDL.Null, upgrade: IDL.Opt(IDL.Record({ skip_pre_upgrade: IDL.Opt(IDL.Bool), wasm_memory_persistence: IDL.Opt(IDL.Variant({ keep: IDL.Null, replace: IDL.Null })) })) }), sender_canister_version: IDL.Opt(IDL.Nat64), store_canister: IDL.Opt(IDL.Principal), canister_id: IDL.Principal, target_canister: IDL.Principal, wasm_module_hash: Hash });
const management = Principal.fromText("aaaaa-aa");
// Deliberately below CycleReserve.minimumReserve, while leaving enough room
// to install the disposable fixture. The proof replenishes only this
// synthetic importer with PocketIC's test-only API.
const importerInstallationCycles = 900_000_000_000n;
function expect(value, tag, label) { if (Object.keys(value).length !== 1 || !(tag in value)) throw new Error(`${label}: expected ${tag}`); }
async function reject(fn, label) { try { await fn(); } catch (_) { return; } throw new Error(`${label}: expected rejected ingress`); }
async function update(pic, sender, method, type, value) { return pic.client.updateCall({ canisterId: management, sender, method, payload: new Uint8Array(IDL.encode([type], [value])) }); }
async function install(pic, sender, id, wasmPath, arg, mode = { install: null }) {
  const wasm = fs.readFileSync(wasmPath), hashes = [];
  for (let offset = 0; offset < wasm.length; offset += 1_000_000) { const chunk = new Uint8Array(wasm.subarray(offset, Math.min(offset + 1_000_000, wasm.length))); await update(pic, sender, "upload_chunk", Upload, { canister_id: id, chunk }); hashes.push({ hash: new Uint8Array(crypto.createHash("sha256").update(chunk).digest()) }); }
  await update(pic, sender, "install_chunked_code", Install, { arg: new Uint8Array(arg), chunk_hashes_list: hashes, mode, sender_canister_version: [], store_canister: [], canister_id: id, target_canister: id, wasm_module_hash: new Uint8Array(crypto.createHash("sha256").update(wasm).digest()) });
}
async function main() {
  const server = await PocketIcServer.start({ binPath: bin, ttl: 60, showRuntimeLogs: false, showCanisterLogs: false });
  const pic = await PocketIc.create(server.getUrl());
  try {
    const installer = Principal.fromUint8Array(Uint8Array.of(4, 1)), operator = Principal.fromUint8Array(Uint8Array.of(4, 2)), outsider = Principal.fromUint8Array(Uint8Array.of(4, 3));
    const authorityId = await pic.createCanister({ sender: installer, controllers: [installer] });
    const importerId = await pic.createCanister({ sender: installer, controllers: [installer], cycles: importerInstallationCycles });
    const config = { core: Principal.fromUint8Array(Uint8Array.of(4, 4)), workflow: Principal.fromUint8Array(Uint8Array.of(4, 5)), treasury: Principal.fromUint8Array(Uint8Array.of(4, 6)), archive: importerId, evidence: Principal.fromUint8Array(Uint8Array.of(4, 7)), governance: Principal.fromUint8Array(Uint8Array.of(4, 8)) };
    await install(pic, installer, authorityId, authorityWasm, IDL.encode([Config], [config]));
    await install(pic, installer, importerId, importerWasm, IDL.encode([IDL.Principal, IDL.Principal], [operator, authorityId]));
    const authority = pic.createActor(authorityIdl, authorityId), importer = pic.createActor(importerIdl, importerId);
    const h = (n) => Uint8Array.from({ length: 32 }, () => n);
    const input = { logicalId: "migration-receipt:v1:synthetic:User:7", migrationId: "synthetic-migration", sourceTable: "User", chunk: 7n, rowCount: 500, payloadHash: h(4), desiredVersion: 1n, contentHash: h(9) };
    authority.setPrincipal(outsider); expect(await authority.writeMigrationReceipt(input), "blocked", "outsider receipt write denied"); expect(await authority.lookupMigrationReceipt(input.logicalId), "conflict", "outsider receipt lookup denied");
    importer.setPrincipal(outsider); await reject(() => importer.reconcileLostReply(), "outsider importer recovery denied"); await reject(() => importer.repairJournaledReceipt(), "outsider importer repair denied");
    // The durable receipt intent reaches only its fixed read-only checkpoint
    // while below the reserve. The authority record must remain absent, so
    // the only permissible next step is no-input replay of that same tuple.
    importer.setPrincipal(operator); await reject(() => importer.writeThenLoseReply(input), "low-cycle receipt journals but makes no authority write");
    expect(await importer.reconcileLostReply(), "retryIdentical", "low-cycle receipt observes absent authority record");
    const replenished = await pic.addCycles(importerId, 2_000_000_000_000);
    if (replenished < 1_000_000_000_000) throw new Error("low-cycle receipt proof failed to replenish disposable importer reserve");
    await reject(() => importer.retryJournaledWriteThenLoseReply(), "replenished receipt write loses reply");
    expect(await importer.reconcileLostReply(), "acknowledge", "replenished receipt reconciles exact tuple");
    const upgradeInput = { ...input, logicalId: "migration-receipt:v1:synthetic:User:9", chunk: 9n, contentHash: h(11) };
    await reject(() => importer.writeThenLoseReply(upgradeInput), "lost receipt write reply");
    await install(pic, installer, authorityId, authorityWasm, IDL.encode([Config], [config]), { upgrade: [{ skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }] });
    await install(pic, installer, importerId, importerWasm, IDL.encode([IDL.Principal, IDL.Principal], [operator, authorityId]), { upgrade: [{ skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }] });
    importer.setPrincipal(operator); expect(await importer.reconcileLostReply(), "acknowledge", "exact receipt recovery after upgrades");
    await reject(() => importer.writeThenLoseReply(upgradeInput), "duplicate receipt delivery loses reply"); expect(await importer.reconcileLostReply(), "acknowledge", "duplicate receipt recovery");
    const interrupted = { ...input, logicalId: "migration-receipt:v1:synthetic:User:8", chunk: 8n, contentHash: h(10) };
    await reject(() => importer.journalThenTrapBeforeAwait(interrupted), "receipt journal interruption");
    await install(pic, installer, importerId, importerWasm, IDL.encode([IDL.Principal, IDL.Principal], [operator, authorityId]), { upgrade: [{ skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }] });
    importer.setPrincipal(operator); expect(await importer.repairJournaledReceipt(), "retryIdentical", "repair resends only retained exact receipt tuple");
    expect(await importer.reconcileLostReply(), "acknowledge", "repair exact receipt recovery");
  } finally { await pic.tearDown(); await server.stop(); }
}
main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
