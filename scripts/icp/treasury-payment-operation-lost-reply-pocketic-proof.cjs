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
const [bin, authorityWasm, treasuryWasm, archiveWasm, transferWasm] = process.argv.slice(2);
if (!bin || !authorityWasm || !treasuryWasm || !archiveWasm || !transferWasm) throw new Error("Expected PocketIC binary, authority Wasm, treasury Wasm, archive Wasm, and transfer Wasm");

const Hash = IDL.Vec(IDL.Nat8);
const Config = IDL.Record({ core: IDL.Principal, workflow: IDL.Principal, treasury: IDL.Principal, archive: IDL.Principal, evidence: IDL.Principal, governance: IDL.Principal });
const Input = IDL.Record({ logicalId: IDL.Text, desiredVersion: IDL.Nat64, contentHash: Hash, operationId: IDL.Text, obligationId: IDL.Text, assetId: IDL.Text, amountBaseUnits: IDL.Nat, assetDecimals: IDL.Nat8, destinationHash: Hash });
const Write = IDL.Variant({ acknowledged: IDL.Null, blocked: IDL.Null, conflict: IDL.Null, storageError: IDL.Null });
const Observation = IDL.Variant({ absent: IDL.Null, present: IDL.Record({ version: IDL.Nat64, contentHash: Hash }), conflict: IDL.Null, storageError: IDL.Null });
const Recovery = IDL.Variant({ acknowledge: IDL.Null, retryIdentical: IDL.Null, conflict: IDL.Null, blocked: IDL.Null });
const ArchiveTuple = IDL.Record({ logicalId: IDL.Text, version: IDL.Nat64, contentHash: Hash });
const ArchiveDecision = IDL.Variant({ acknowledge: IDL.Null, remainPending: IDL.Null, blocked: IDL.Null });
const authorityIdl = ({ IDL: C }) => C.Service({ writeTreasuryPaymentOperation: C.Func([Input], [Write], []), lookupTreasuryPaymentOperation: C.Func([C.Text], [Observation], []) });
const treasuryIdl = ({ IDL: C }) => C.Service({ writeThenLoseReply: C.Func([Input], [], []), journalThenTrapBeforeAwait: C.Func([Input], [], []), reconcileLostReply: C.Func([], [Recovery], []), retryJournaledWriteThenLoseReply: C.Func([], [], []), repairJournaledOperation: C.Func([], [Recovery], []), archiveThenLoseReply: C.Func([], [], []), reconcileArchive: C.Func([], [ArchiveDecision], []), repairArchiveResume: C.Func([], [ArchiveDecision], []), isActive: C.Func([], [C.Bool], []), dispatchThenLoseReply: C.Func([], [], []), reconcileTransfer: C.Func([], [ArchiveDecision], []), retryDispatchThenLoseReply: C.Func([], [], []), syntheticDispatchCount: C.Func([], [C.Nat], []) });
const archiveIdl = ({ IDL: C }) => C.Service({ permit: C.Func([], [], []), revoke: C.Func([], [], []), archive: C.Func([ArchiveTuple], [ArchiveTuple], []), lookup: C.Func([C.Text], [C.Opt(ArchiveTuple)], []) });
const Chunk = IDL.Record({ hash: IDL.Vec(IDL.Nat8) });
const Upload = IDL.Record({ canister_id: IDL.Principal, chunk: IDL.Vec(IDL.Nat8) });
const Install = IDL.Record({ arg: IDL.Vec(IDL.Nat8), chunk_hashes_list: IDL.Vec(Chunk), mode: IDL.Variant({ install: IDL.Null, upgrade: IDL.Opt(IDL.Record({ skip_pre_upgrade: IDL.Opt(IDL.Bool), wasm_memory_persistence: IDL.Opt(IDL.Variant({ keep: IDL.Null, replace: IDL.Null })) })) }), sender_canister_version: IDL.Opt(IDL.Nat64), store_canister: IDL.Opt(IDL.Principal), canister_id: IDL.Principal, target_canister: IDL.Principal, wasm_module_hash: IDL.Vec(IDL.Nat8) });
const management = Principal.fromText("aaaaa-aa");
// This is deliberately below CycleReserve.minimumReserve (one trillion) but
// high enough for PocketIC to install the disposable fixture. It proves a
// retained journal cannot start an authority mutation while depleted.
const treasuryInstallationCycles = 900_000_000_000n;
function expect(value, tag, label) { if (Object.keys(value).length !== 1 || !(tag in value)) throw new Error(`${label}: expected ${tag}`); }
function expectBool(value, expected, label) { if (value !== expected) throw new Error(`${label}: expected ${expected}, got ${value}`); }
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
    const authorityId = await pic.createCanister({ sender: installer, controllers: [installer] }), treasuryId = await pic.createCanister({ sender: installer, controllers: [installer], cycles: treasuryInstallationCycles }), archiveId = await pic.createCanister({ sender: installer, controllers: [installer] }), transferId = await pic.createCanister({ sender: installer, controllers: [installer] });
    const config = { core: Principal.fromUint8Array(Uint8Array.of(2, 4)), workflow: Principal.fromUint8Array(Uint8Array.of(2, 5)), treasury: treasuryId, archive: Principal.fromUint8Array(Uint8Array.of(2, 6)), evidence: Principal.fromUint8Array(Uint8Array.of(2, 7)), governance: Principal.fromUint8Array(Uint8Array.of(2, 8)) };
    await install(pic, installer, authorityId, authorityWasm, IDL.encode([Config], [config]));
    await install(pic, installer, treasuryId, treasuryWasm, IDL.encode([IDL.Principal, IDL.Principal, IDL.Principal, IDL.Principal], [operator, authorityId, archiveId, transferId]));
    await install(pic, installer, archiveId, archiveWasm, IDL.encode([IDL.Principal, IDL.Principal], [treasuryId, operator]));
    await install(pic, installer, transferId, transferWasm, IDL.encode([IDL.Principal], [treasuryId]));
    const authority = pic.createActor(authorityIdl, authorityId), treasury = pic.createActor(treasuryIdl, treasuryId), archive = pic.createActor(archiveIdl, archiveId);
    const h = (n) => Uint8Array.from({ length: 32 }, () => n);
    const input = { logicalId: "payment-operation:v1:synthetic-1", desiredVersion: 1n, contentHash: h(11), operationId: "operation:synthetic-1", obligationId: "obligation:synthetic-1", assetId: "ICP", amountBaseUnits: 1n, assetDecimals: 8, destinationHash: h(12) };
    authority.setPrincipal(outsider); expect(await authority.writeTreasuryPaymentOperation(input), "blocked", "direct write denied"); expect(await authority.lookupTreasuryPaymentOperation(input.logicalId), "conflict", "direct lookup denied");
    treasury.setPrincipal(outsider); await reject(() => treasury.reconcileLostReply(), "outsider recovery denied");
    // The first payment operation journals, reaches only its fixed read-only
    // checkpoint, then fails below the reserve before its authority write.
    // Thus the lookup must be absent and can authorize only no-input retry.
    treasury.setPrincipal(operator);
    const lowCycle = { ...input, logicalId: "payment-operation:v1:synthetic-low-cycles-44", contentHash: h(10) };
    await reject(() => treasury.writeThenLoseReply(lowCycle), "low-cycle payment operation journals but makes no authority write");
    expect(await treasury.reconcileLostReply(), "retryIdentical", "low-cycle payment operation observes absent authority record");
    const replenished = await pic.addCycles(treasuryId, 2_000_000_000_000);
    if (replenished < 1_000_000_000_000) throw new Error("low-cycle proof failed to replenish disposable treasury reserve");
    await reject(() => treasury.retryJournaledWriteThenLoseReply(), "replenished low-cycle payment operation loses authority reply");
    expect(await treasury.reconcileLostReply(), "acknowledge", "replenished low-cycle payment operation reconciles exact tuple");
    await reject(() => treasury.writeThenLoseReply(input), "deliberately lost first reply");
    await install(pic, installer, authorityId, authorityWasm, IDL.encode([Config], [config]), { upgrade: [{ skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }] });
    await install(pic, installer, treasuryId, treasuryWasm, IDL.encode([IDL.Principal, IDL.Principal, IDL.Principal, IDL.Principal], [operator, authorityId, archiveId, transferId]), { upgrade: [{ skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }] });
    treasury.setPrincipal(operator); expect(await treasury.reconcileLostReply(), "acknowledge", "exact recovery after EOP upgrades");
    await reject(() => treasury.writeThenLoseReply(input), "duplicate delivery loses reply"); expect(await treasury.reconcileLostReply(), "acknowledge", "duplicate reconciles exact tuple");
    // The archive starts unavailable. A storage-acknowledged operation stays
    // inactive through an EOP treasury upgrade until its exact tuple receipt
    // exists; archive availability alone is never an activation signal.
    archive.setPrincipal(operator); await archive.revoke();
    await reject(() => treasury.archiveThenLoseReply(), "unavailable archive keeps payment operation pending");
    expectBool(await treasury.isActive(), false, "payment operation inactive after archive failure");
    await install(pic, installer, treasuryId, treasuryWasm, IDL.encode([IDL.Principal, IDL.Principal, IDL.Principal, IDL.Principal], [operator, authorityId, archiveId, transferId]), { upgrade: [{ skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }] });
    treasury.setPrincipal(operator); expect(await treasury.reconcileArchive(), "remainPending", "missing archive receipt remains pending after upgrade");
    archive.setPrincipal(operator); await archive.permit();
    await reject(() => treasury.archiveThenLoseReply(), "deliberately lost payment-operation archive acknowledgement");
    await install(pic, installer, archiveId, archiveWasm, IDL.encode([IDL.Principal, IDL.Principal], [treasuryId, operator]), { upgrade: [{ skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }] });
    await install(pic, installer, treasuryId, treasuryWasm, IDL.encode([IDL.Principal, IDL.Principal, IDL.Principal, IDL.Principal], [operator, authorityId, archiveId, transferId]), { upgrade: [{ skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }] });
    treasury.setPrincipal(operator); expect(await treasury.reconcileArchive(), "acknowledge", "exact archive receipt activates after upgrades");
    expectBool(await treasury.isActive(), true, "payment operation active only after exact archive receipt");
    // The valueless downstream sink retains exactly one immutable operation
    // tuple. Both a lost reply and an explicit duplicate delivery can only
    // reconcile that same record; neither path creates a second dispatch.
    await reject(() => treasury.dispatchThenLoseReply(), "deliberately lost synthetic transfer reply");
    expect(await treasury.reconcileTransfer(), "acknowledge", "exact synthetic transfer reconciles after lost reply");
    expect(await treasury.syntheticDispatchCount(), 1n, "initial synthetic transfer is recorded once");
    await reject(() => treasury.retryDispatchThenLoseReply(), "duplicate synthetic transfer loses reply");
    expect(await treasury.reconcileTransfer(), "acknowledge", "duplicate synthetic transfer reconciles exact receipt");
    expect(await treasury.syntheticDispatchCount(), 1n, "duplicate delivery cannot create a second synthetic transfer");
    // A separate durable boundary is before any authority await. The absent
    // lookup after the treasury EOP upgrade may authorize only the no-input
    // retry of this retained immutable tuple.
    const interrupted = { ...input, logicalId: "payment-operation:v1:synthetic-interrupted-44", contentHash: h(13) };
    await reject(() => treasury.journalThenTrapBeforeAwait(interrupted), "interruption after treasury journal before authority await");
    await install(pic, installer, treasuryId, treasuryWasm, IDL.encode([IDL.Principal, IDL.Principal, IDL.Principal, IDL.Principal], [operator, authorityId, archiveId, transferId]), { upgrade: [{ skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }] });
    treasury.setPrincipal(operator); expect(await treasury.reconcileLostReply(), "retryIdentical", "absent interrupted payment operation requires identical retry");
    await reject(() => treasury.retryJournaledWriteThenLoseReply(), "journaled payment-operation retry loses reply");
    expect(await treasury.reconcileLostReply(), "acknowledge", "journaled payment-operation retry reconciles exact tuple");
    // A separate interrupted record exercises the operator-only no-input
    // repair path through both authority recovery and archive activation.
    const repair = { ...input, logicalId: "payment-operation:v1:synthetic-repair-48", contentHash: h(14) };
    await reject(() => treasury.journalThenTrapBeforeAwait(repair), "repair record interrupted before authority await");
    await install(pic, installer, treasuryId, treasuryWasm, IDL.encode([IDL.Principal, IDL.Principal, IDL.Principal, IDL.Principal], [operator, authorityId, archiveId, transferId]), { upgrade: [{ skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }] });
    treasury.setPrincipal(outsider); await reject(() => treasury.repairJournaledOperation(), "outsider repair denied");
    treasury.setPrincipal(operator); expect(await treasury.repairJournaledOperation(), "retryIdentical", "repair resends only the retained exact tuple");
    expect(await treasury.reconcileLostReply(), "acknowledge", "repair reconciles retained authority tuple");
    archive.setPrincipal(operator); await archive.revoke();
    await reject(() => treasury.archiveThenLoseReply(), "repair archive remains unavailable");
    expectBool(await treasury.isActive(), false, "repair record remains inactive without archive receipt");
    await install(pic, installer, treasuryId, treasuryWasm, IDL.encode([IDL.Principal, IDL.Principal, IDL.Principal, IDL.Principal], [operator, authorityId, archiveId, transferId]), { upgrade: [{ skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }] });
    treasury.setPrincipal(operator); expect(await treasury.repairArchiveResume(), "remainPending", "repair archive remains pending after upgrade");
    archive.setPrincipal(operator); await archive.permit();
    await reject(() => treasury.archiveThenLoseReply(), "repair archive acknowledgement is deliberately lost");
    await install(pic, installer, archiveId, archiveWasm, IDL.encode([IDL.Principal, IDL.Principal], [treasuryId, operator]), { upgrade: [{ skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }] });
    await install(pic, installer, treasuryId, treasuryWasm, IDL.encode([IDL.Principal, IDL.Principal, IDL.Principal, IDL.Principal], [operator, authorityId, archiveId, transferId]), { upgrade: [{ skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }] });
    treasury.setPrincipal(operator); expect(await treasury.repairArchiveResume(), "acknowledge", "exact repair archive receipt activates after upgrades");
    expectBool(await treasury.isActive(), true, "repair record activates only after exact archive receipt");
  } finally { await pic.tearDown(); await server.stop(); }
}
main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
