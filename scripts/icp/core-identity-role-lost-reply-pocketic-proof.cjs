#!/usr/bin/env node
// Isolated M1 synthetic proof: a core canister journals before its only
// authority await, loses the reply, survives an EOP upgrade, then reconciles
// using a fixed, bounded logical-ID/version/hash lookup.
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const picMopsRoot = path.resolve(__dirname, "../../node_modules/ic-mops/node_modules/pic-js-mops");
const coreRoot = path.resolve(__dirname, "../../node_modules/ic-mops/node_modules/@icp-sdk/core");
const { PocketIc, PocketIcServer } = require(picMopsRoot);
const { IDL } = require(path.join(coreRoot, "lib/cjs/candid/index.js"));
const { Principal } = require(path.join(coreRoot, "lib/cjs/principal/index.js"));

const [pocketIcBin, authorityWasm, coreWasm, archiveWasm] = process.argv.slice(2);
if (!pocketIcBin || !authorityWasm || !coreWasm || !archiveWasm) throw new Error("Expected PocketIC binary, authority Wasm, core Wasm, and archive Wasm");

const Hash = IDL.Vec(IDL.Nat8);
const Factor = IDL.Variant({ internetIdentity: IDL.Null, oauth: IDL.Null });
const Config = IDL.Record({ core: IDL.Principal, workflow: IDL.Principal, treasury: IDL.Principal, archive: IDL.Principal, evidence: IDL.Principal, governance: IDL.Principal });
const Binding = IDL.Record({ logicalId: IDL.Text, desiredVersion: IDL.Nat64, contentHash: Hash, userId: IDL.Nat64, principal: IDL.Principal, factor: Factor, provider: IDL.Opt(IDL.Text), subjectHash: IDL.Opt(Hash) });
const Role = IDL.Record({ logicalId: IDL.Text, desiredVersion: IDL.Nat64, contentHash: Hash, principal: IDL.Principal, role: IDL.Text });
const WriteResult = IDL.Variant({ acknowledged: IDL.Null, blocked: IDL.Null, conflict: IDL.Null, storageError: IDL.Null });
const Observation = IDL.Variant({ absent: IDL.Null, present: IDL.Record({ version: IDL.Nat64, contentHash: Hash }), conflict: IDL.Null, storageError: IDL.Null });
const Recovery = IDL.Variant({ acknowledge: IDL.Null, retryIdentical: IDL.Null, conflict: IDL.Null, blocked: IDL.Null });
const ArchiveTuple = IDL.Record({ logicalId: IDL.Text, version: IDL.Nat64, contentHash: Hash });
const ArchiveDecision = IDL.Variant({ acknowledge: IDL.Null, remainPending: IDL.Null, blocked: IDL.Null });
const ChunkHash = IDL.Record({ hash: IDL.Vec(IDL.Nat8) });
const ManagementUploadChunk = IDL.Record({ canister_id: IDL.Principal, chunk: IDL.Vec(IDL.Nat8) });
const ManagementInstallChunkedCode = IDL.Record({
  arg: IDL.Vec(IDL.Nat8), chunk_hashes_list: IDL.Vec(ChunkHash),
  mode: IDL.Variant({ install: IDL.Null, upgrade: IDL.Opt(IDL.Record({ skip_pre_upgrade: IDL.Opt(IDL.Bool), wasm_memory_persistence: IDL.Opt(IDL.Variant({ keep: IDL.Null, replace: IDL.Null })) })) }),
  sender_canister_version: IDL.Opt(IDL.Nat64), store_canister: IDL.Opt(IDL.Principal),
  // PocketIC 12 routes this ingress field alongside the standard target field.
  canister_id: IDL.Principal, target_canister: IDL.Principal, wasm_module_hash: IDL.Vec(IDL.Nat8),
});
const managementCanister = Principal.fromText("aaaaa-aa");
const maxChunkBytes = 1_000_000;
// Keep enough cycles for PocketIC to install the core fixture while still
// starting below CycleReserve.minimumBeforeAuthorityCall (one trillion).
// PocketIC validates this installation reserve before Wasm execution.
const coreInstallationCycles = 900_000_000_000n;
const authorityIdl = ({ IDL: Candid }) => Candid.Service({
  writeCorePrincipalBinding: Candid.Func([Binding], [WriteResult], []),
  lookupCorePrincipalBinding: Candid.Func([Candid.Text], [Observation], []),
  writeCoreRoleAssignment: Candid.Func([Role], [WriteResult], []),
  lookupCoreRoleAssignment: Candid.Func([Candid.Text], [Observation], []),
});
const coreIdl = ({ IDL: Candid }) => Candid.Service({
  writeThenLoseReply: Candid.Func([Binding], [], []),
  journalThenTrapBeforeAwait: Candid.Func([Binding], [], []),
  retryJournaledWriteThenLoseReply: Candid.Func([], [], []),
  reconcileLostReply: Candid.Func([], [Recovery], []),
  writeRoleThenLoseReply: Candid.Func([Role], [], []),
  reconcileLostRoleReply: Candid.Func([], [Recovery], []),
  journalRoleThenTrapBeforeAwait: Candid.Func([Role], [], []),
  retryJournaledRoleWriteThenLoseReply: Candid.Func([], [], []),
  archiveBindingThenLoseReply: Candid.Func([], [], []),
  reconcileBindingArchive: Candid.Func([], [ArchiveDecision], []),
  isBindingActive: Candid.Func([], [Candid.Bool], []),
  archiveRoleThenLoseReply: Candid.Func([], [], []),
  reconcileRoleArchive: Candid.Func([], [ArchiveDecision], []),
  isRoleActive: Candid.Func([], [Candid.Bool], []),
});
const archiveIdl = ({ IDL: Candid }) => Candid.Service({
  permit: Candid.Func([], [], []),
  revoke: Candid.Func([], [], []),
  archive: Candid.Func([ArchiveTuple], [ArchiveTuple], []),
  lookup: Candid.Func([Candid.Text], [Candid.Opt(ArchiveTuple)], []),
});
const hash = (byte) => Uint8Array.from({ length: 32 }, () => byte);
function expect(actual, key, label) {
  if (typeof key === "boolean") {
    if (actual !== key) throw new Error(`${label}: expected ${key}, got ${JSON.stringify(actual)}`);
    return;
  }
  if (Object.keys(actual).length !== 1 || !(key in actual)) throw new Error(`${label}: expected ${key}, got ${JSON.stringify(actual)}`);
}
async function expectReject(action, label) {
  try { await action(); } catch (_) { return; }
  throw new Error(`${label}: expected rejected ingress`);
}
async function managementUpdate(pic, sender, method, type, value) {
  const payload = IDL.encode([type], [value]);
  return pic.client.updateCall({ canisterId: managementCanister, sender, method, payload: new Uint8Array(payload) });
}
async function install(pic, sender, canisterId, wasmPath, arg, mode = { install: null }) {
  const wasm = fs.readFileSync(wasmPath);
  const hashes = [];
  for (let offset = 0; offset < wasm.length; offset += maxChunkBytes) {
    const chunk = new Uint8Array(wasm.subarray(offset, Math.min(offset + maxChunkBytes, wasm.length)));
    await managementUpdate(pic, sender, "upload_chunk", ManagementUploadChunk, { canister_id: canisterId, chunk });
    hashes.push({ hash: new Uint8Array(crypto.createHash("sha256").update(chunk).digest()) });
  }
  await managementUpdate(pic, sender, "install_chunked_code", ManagementInstallChunkedCode, {
    arg: new Uint8Array(arg), chunk_hashes_list: hashes, mode, sender_canister_version: [], store_canister: [], canister_id: canisterId, target_canister: canisterId,
    wasm_module_hash: new Uint8Array(crypto.createHash("sha256").update(wasm).digest()),
  });
}
async function main() {
  const server = await PocketIcServer.start({ binPath: pocketIcBin, ttl: 60, showRuntimeLogs: false, showCanisterLogs: false });
  const pic = await PocketIc.create(server.getUrl());
  try {
    const installer = Principal.fromUint8Array(Uint8Array.of(1, 1));
    const operator = Principal.fromUint8Array(Uint8Array.of(1, 2));
    const outsider = Principal.fromUint8Array(Uint8Array.of(1, 3));
    const subject = Principal.fromUint8Array(Uint8Array.of(1, 44));
    const workflow = Principal.fromUint8Array(Uint8Array.of(1, 4));
    const treasury = Principal.fromUint8Array(Uint8Array.of(1, 5));
    const archive = Principal.fromUint8Array(Uint8Array.of(1, 6));
    const evidence = Principal.fromUint8Array(Uint8Array.of(1, 7));
    const governance = Principal.fromUint8Array(Uint8Array.of(1, 8));
    const authorityId = await pic.createCanister({ sender: installer, controllers: [installer] });
    // Start below the fixed synthetic reserve, but above PocketIC's Wasm
    // installation floor. The first write must journal, fail before any
    // authority await, and later recover only by retrying its retained tuple
    // after the test replenishes this disposable canister.
    const coreId = await pic.createCanister({ sender: installer, controllers: [installer], cycles: coreInstallationCycles });
    const archiveId = await pic.createCanister({ sender: installer, controllers: [installer] });
    const authorityConfig = { core: coreId, workflow, treasury, archive, evidence, governance };
    await install(pic, installer, authorityId, authorityWasm, IDL.encode([Config], [authorityConfig]));
    await install(pic, installer, coreId, coreWasm, IDL.encode([IDL.Principal, IDL.Principal, IDL.Principal], [operator, authorityId, archiveId]));
    await install(pic, installer, archiveId, archiveWasm, IDL.encode([IDL.Principal, IDL.Principal], [coreId, operator]));
    const authority = pic.createActor(authorityIdl, authorityId);
    authority.setPrincipal(outsider);
    const binding = { logicalId: "principal-binding:v1:synthetic-44", desiredVersion: 1n, contentHash: hash(7), userId: 44n, principal: subject, factor: { internetIdentity: null }, provider: [], subjectHash: [] };
    expect(await authority.writeCorePrincipalBinding(binding), "blocked", "direct authority write denied");
    expect(await authority.lookupCorePrincipalBinding(binding.logicalId), "conflict", "direct authority lookup denied");
    const role = { logicalId: "role-assignment:v1:synthetic-44:auditor", desiredVersion: 1n, contentHash: hash(8), principal: subject, role: "auditor" };
    expect(await authority.writeCoreRoleAssignment(role), "blocked", "direct authority role write denied");
    expect(await authority.lookupCoreRoleAssignment(role.logicalId), "conflict", "direct authority role lookup denied");
    const core = pic.createActor(coreIdl, coreId);
    const archiveSink = pic.createActor(archiveIdl, archiveId);
    archiveSink.setPrincipal(outsider);
    await expectReject(() => archiveSink.permit(), "outsider archive permit denied");
    await expectReject(() => archiveSink.lookup(binding.logicalId), "outsider archive lookup denied");
    core.setPrincipal(outsider);
    await expectReject(() => core.reconcileLostReply(), "non-operator core ingress denied");
    core.setPrincipal(operator);
    const lowCycleBinding = { ...binding, logicalId: "principal-binding:v1:synthetic-low-cycles-44", contentHash: hash(6) };
    await expectReject(() => core.writeThenLoseReply(lowCycleBinding), "low-cycle write journals but makes no authority call");
    expect(await core.reconcileLostReply(), "retryIdentical", "low-cycle journal observes absent authority record");
    const replenished = await pic.addCycles(coreId, 2_000_000_000_000);
    if (replenished < 1_000_000_000_000) throw new Error("low-cycle proof failed to replenish disposable core reserve");
    await expectReject(() => core.retryJournaledWriteThenLoseReply(), "replenished low-cycle journal loses authority reply");
    expect(await core.reconcileLostReply(), "acknowledge", "replenished low-cycle journal reconciles exact tuple");
    await expectReject(() => core.writeThenLoseReply(binding), "deliberately lost authority reply");
    // Upgrade the authority after its successful write but before the core
    // can reconcile. The fixed collection must reopen its retained record;
    // recreating it or losing it turns the later exact lookup into a failure.
    await install(pic, installer, authorityId, authorityWasm, IDL.encode([Config], [authorityConfig]), { upgrade: [{ skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }] });
    authority.setPrincipal(outsider);
    expect(await authority.writeCorePrincipalBinding(binding), "blocked", "direct authority write denied after upgrade");
    expect(await authority.lookupCorePrincipalBinding(binding.logicalId), "conflict", "direct authority lookup denied after upgrade");
    expect(await authority.writeCoreRoleAssignment(role), "blocked", "direct authority role write denied after upgrade");
    expect(await authority.lookupCoreRoleAssignment(role.logicalId), "conflict", "direct authority role lookup denied after upgrade");
    // Upgrade the core before recovery: the durable pre-await intent must
    // also survive independently from the authority's retained collection.
    await install(pic, installer, coreId, coreWasm, IDL.encode([IDL.Principal, IDL.Principal, IDL.Principal], [operator, authorityId, archiveId]), { upgrade: [{ skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }] });
    expect(await core.reconcileLostReply(), "acknowledge", "exact lost-reply reconciliation after upgrade");
    // Archive unavailability cannot activate the core-owned binding. The
    // pending tuple survives a core upgrade; only an exact later receipt may
    // move it active, even when that receipt's original reply is lost.
    await expectReject(() => core.archiveBindingThenLoseReply(), "archive unavailable keeps binding pending");
    expect(await core.isBindingActive(), false, "binding inactive after archive failure");
    await install(pic, installer, coreId, coreWasm, IDL.encode([IDL.Principal, IDL.Principal, IDL.Principal], [operator, authorityId, archiveId]), { upgrade: [{ skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }] });
    expect(await core.reconcileBindingArchive(), "remainPending", "missing archive receipt remains pending after core upgrade");
    expect(await core.isBindingActive(), false, "binding still inactive without receipt");
    archiveSink.setPrincipal(operator);
    await archiveSink.permit();
    core.setPrincipal(operator);
    await expectReject(() => core.archiveBindingThenLoseReply(), "deliberately lost archive acknowledgement");
    await install(pic, installer, archiveId, archiveWasm, IDL.encode([IDL.Principal, IDL.Principal], [coreId, operator]), { upgrade: [{ skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }] });
    await install(pic, installer, coreId, coreWasm, IDL.encode([IDL.Principal, IDL.Principal, IDL.Principal], [operator, authorityId, archiveId]), { upgrade: [{ skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }] });
    expect(await core.reconcileBindingArchive(), "acknowledge", "exact archive receipt activates after upgrades");
    expect(await core.isBindingActive(), true, "binding active only after exact archive receipt");
    // Exercise the independent role journal with the exact fixed authority
    // write and tuple-only lookup after the authority EOP upgrade. No role or
    // principal data comes back through recovery.
    await expectReject(() => core.writeRoleThenLoseReply(role), "deliberately lost role authority reply");
    expect(await core.reconcileLostRoleReply(), "acknowledge", "exact role lost-reply reconciliation");
    // The independently journaled role cannot be active merely because its
    // authority write was acknowledged. Archive unavailability keeps it
    // pending through a core upgrade; a later lost archive reply can be
    // reconciled only by the fixed exact tuple after archive/core upgrades.
    archiveSink.setPrincipal(operator);
    await archiveSink.revoke();
    core.setPrincipal(operator);
    await expectReject(() => core.archiveRoleThenLoseReply(), "role archive unavailable keeps role pending");
    expect(await core.isRoleActive(), false, "role inactive after archive failure");
    await install(pic, installer, coreId, coreWasm, IDL.encode([IDL.Principal, IDL.Principal, IDL.Principal], [operator, authorityId, archiveId]), { upgrade: [{ skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }] });
    expect(await core.reconcileRoleArchive(), "remainPending", "missing role archive receipt remains pending after core upgrade");
    expect(await core.isRoleActive(), false, "role still inactive without receipt");
    // Re-permit the archive only after the unavailable-role negative branch.
    // Its fixed receipt store accepts a distinct role tuple, but no role data
    // crosses the archive boundary.
    archiveSink.setPrincipal(operator);
    await archiveSink.permit();
    core.setPrincipal(operator);
    await expectReject(() => core.archiveRoleThenLoseReply(), "deliberately lost role archive acknowledgement");
    await install(pic, installer, archiveId, archiveWasm, IDL.encode([IDL.Principal, IDL.Principal], [coreId, operator]), { upgrade: [{ skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }] });
    await install(pic, installer, coreId, coreWasm, IDL.encode([IDL.Principal, IDL.Principal, IDL.Principal], [operator, authorityId, archiveId]), { upgrade: [{ skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }] });
    expect(await core.reconcileRoleArchive(), "acknowledge", "exact role archive receipt activates after upgrades");
    expect(await core.isRoleActive(), true, "role active only after exact archive receipt");
    // Deliver the same immutable operation again. The authority must not
    // create a second record; its fixed insert-or-exact-lookup path accepts
    // only this version/hash tuple. Deliberately lose that second reply too,
    // then prove the core reconciles the retained tuple rather than creating
    // another logical ID or interpreting a duplicate as a new mutation.
    await expectReject(() => core.writeThenLoseReply(binding), "deliberately lost duplicate authority reply");
    expect(await core.reconcileLostReply(), "acknowledge", "exact duplicate-delivery reconciliation");
    // A separate interruption point is before any authority await. Its
    // recovery must observe absence, preserve the immutable journal through
    // a core EOP upgrade, and retry only the journaled tuple (no new input).
    const interrupted = { ...binding, logicalId: "principal-binding:v1:synthetic-interrupted-44", contentHash: hash(9) };
    await expectReject(() => core.journalThenTrapBeforeAwait(interrupted), "interruption after journal before authority await");
    await install(pic, installer, coreId, coreWasm, IDL.encode([IDL.Principal, IDL.Principal, IDL.Principal], [operator, authorityId, archiveId]), { upgrade: [{ skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }] });
    expect(await core.reconcileLostReply(), "retryIdentical", "absent interrupted write requires identical retry");
    await expectReject(() => core.retryJournaledWriteThenLoseReply(), "deliberately lost journaled retry reply");
    expect(await core.reconcileLostReply(), "acknowledge", "journaled retry reconciliation");
    // Exercise the same pre-await interruption boundary for roles. The
    // authority has no record before retry, so only the no-input retry may
    // send the persisted tuple; its lost reply still needs exact recovery.
    const interruptedRole = { ...role, logicalId: "role-assignment:v1:synthetic-interrupted-44:auditor", contentHash: hash(10) };
    await expectReject(() => core.journalRoleThenTrapBeforeAwait(interruptedRole), "role interruption after journal before authority await");
    await install(pic, installer, coreId, coreWasm, IDL.encode([IDL.Principal, IDL.Principal, IDL.Principal], [operator, authorityId, archiveId]), { upgrade: [{ skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }] });
    expect(await core.reconcileLostRoleReply(), "retryIdentical", "absent interrupted role write requires identical retry");
    await expectReject(() => core.retryJournaledRoleWriteThenLoseReply(), "deliberately lost journaled role retry reply");
    expect(await core.reconcileLostRoleReply(), "acknowledge", "journaled role retry reconciliation");
    // `acknowledge` is reachable only when the authority's fixed core-only
    // lookup returned the exact persisted version/hash, both after an EOP
    // upgrade and after duplicate delivery. The runner never impersonates a
    // canister principal through direct ingress.
  } finally { await pic.tearDown(); await server.stop(); }
}
main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
