#!/usr/bin/env node
// Isolated synthetic archive-binding proof: no signer, address, wallet,
// transaction, chain endpoint, target identity, or production data is used.
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const picRoot = path.resolve(__dirname, "../../node_modules/ic-mops/node_modules/pic-js-mops");
const coreRoot = path.resolve(__dirname, "../../node_modules/ic-mops/node_modules/@icp-sdk/core");
const { PocketIc, PocketIcServer } = require(picRoot);
const { IDL } = require(path.join(coreRoot, "lib/cjs/candid/index.js"));
const { Principal } = require(path.join(coreRoot, "lib/cjs/principal/index.js"));
const [bin, treasuryWasm, sinkWasm] = process.argv.slice(2);
if (!bin || !treasuryWasm || !sinkWasm) throw new Error("Expected PocketIC binary, treasury Wasm, and archive-sink Wasm");
const Hash = IDL.Vec(IDL.Nat8);
const Tuple = IDL.Record({ logicalId: IDL.Text, version: IDL.Nat64, contentHash: Hash });
const Binding = IDL.Record({ tuple: Tuple, bytes: IDL.Vec(IDL.Nat8) });
const Input = IDL.Record({ logicalId: IDL.Text, desiredVersion: IDL.Nat64, contentHash: Hash, operationId: IDL.Text, obligationId: IDL.Text, assetId: IDL.Text, amountBaseUnits: IDL.Nat, assetDecimals: IDL.Nat8, destinationHash: Hash });
const Decision = IDL.Variant({ acknowledge: IDL.Null, remainPending: IDL.Null, blocked: IDL.Null });
const treasuryIdl = ({ IDL: C }) => C.Service({ retainThenLoseReply: C.Func([Input], [], []), reconcile: C.Func([], [Decision], []), retryThenLoseReply: C.Func([], [], []), retainThenTrapBeforeArchiveAwait: C.Func([Input], [], []), repairArchiveResume: C.Func([], [Decision], []), isAcknowledged: C.Func([], [C.Bool], []), retainedCount: C.Func([], [C.Nat], []) });
const sinkIdl = ({ IDL: C }) => C.Service({ retain: C.Func([Binding], [Tuple], []), lookup: C.Func([C.Text], [C.Opt(Tuple)], []), count: C.Func([], [C.Nat], []) });
const management = Principal.fromText("aaaaa-aa");
// Below the fixed proof-only CycleReserve minimum. Only this disposable
// fixture is replenished in the low-cycle path.
const lowCycleTreasuryInstallationCycles = 900_000_000_000n;
const Upload = IDL.Record({ canister_id: IDL.Principal, chunk: IDL.Vec(IDL.Nat8) });
const Chunk = IDL.Record({ hash: Hash });
const Install = IDL.Record({ arg: IDL.Vec(IDL.Nat8), chunk_hashes_list: IDL.Vec(Chunk), mode: IDL.Variant({ install: IDL.Null, upgrade: IDL.Opt(IDL.Record({ skip_pre_upgrade: IDL.Opt(IDL.Bool), wasm_memory_persistence: IDL.Opt(IDL.Variant({ keep: IDL.Null, replace: IDL.Null })) })) }), sender_canister_version: IDL.Opt(IDL.Nat64), store_canister: IDL.Opt(IDL.Principal), canister_id: IDL.Principal, target_canister: IDL.Principal, wasm_module_hash: Hash });
function expect(v, tag, label) { if (Object.keys(v).length !== 1 || !(tag in v)) throw new Error(`${label}: expected ${tag}`); }
async function reject(f, label) { try { await f(); } catch (_) { return; } throw new Error(`${label}: expected rejected ingress`); }
async function managementCall(pic, sender, method, type, value) { return pic.client.updateCall({ canisterId: management, sender, method, payload: new Uint8Array(IDL.encode([type], [value])) }); }
async function install(pic, sender, id, wasmPath, arg, mode = { install: null }) {
  const wasm = fs.readFileSync(wasmPath), chunks = [];
  for (let offset = 0; offset < wasm.length; offset += 1_000_000) { const chunk = new Uint8Array(wasm.subarray(offset, Math.min(offset + 1_000_000, wasm.length))); await managementCall(pic, sender, "upload_chunk", Upload, { canister_id: id, chunk }); chunks.push({ hash: new Uint8Array(crypto.createHash("sha256").update(chunk).digest()) }); }
  await managementCall(pic, sender, "install_chunked_code", Install, { arg: new Uint8Array(arg), chunk_hashes_list: chunks, mode, sender_canister_version: [], store_canister: [], canister_id: id, target_canister: id, wasm_module_hash: new Uint8Array(crypto.createHash("sha256").update(wasm).digest()) });
}
async function main() {
  const server = await PocketIcServer.start({ binPath: bin, ttl: 60, showRuntimeLogs: false, showCanisterLogs: false }); const pic = await PocketIc.create(server.getUrl());
  try {
    const installer = Principal.fromUint8Array(Uint8Array.of(9, 1)), operator = Principal.fromUint8Array(Uint8Array.of(9, 2)), outsider = Principal.fromUint8Array(Uint8Array.of(9, 3));
    const treasuryId = await pic.createCanister({ sender: installer, controllers: [installer] }), sinkId = await pic.createCanister({ sender: installer, controllers: [installer] });
    await install(pic, installer, treasuryId, treasuryWasm, IDL.encode([IDL.Principal, IDL.Principal], [operator, sinkId]));
    await install(pic, installer, sinkId, sinkWasm, IDL.encode([IDL.Principal], [treasuryId]));
    const treasury = pic.createActor(treasuryIdl, treasuryId), sink = pic.createActor(sinkIdl, sinkId);
    const hash = n => Uint8Array.from({ length: 32 }, () => n);
    const input = { logicalId: "payment-operation:v1:archive-export-123", desiredVersion: 1n, contentHash: hash(31), operationId: "operation:archive-export-123", obligationId: "obligation:archive-export-123", assetId: "ICP", amountBaseUnits: 1n, assetDecimals: 8, destinationHash: hash(32) };
    treasury.setPrincipal(outsider); await reject(() => treasury.reconcile(), "outsider reconciliation denied");
    sink.setPrincipal(outsider); await reject(() => sink.lookup(input.logicalId), "outsider archive lookup denied");
    treasury.setPrincipal(operator); await reject(() => treasury.retainThenLoseReply({ ...input, amountBaseUnits: 0n }), "invalid archive input rejected before sink");
    if (await treasury.retainedCount() !== 0n) throw new Error("invalid input reached synthetic archive sink");
    await reject(() => treasury.retainThenLoseReply(input), "archive acknowledgement deliberately lost");
    if (await treasury.isAcknowledged()) throw new Error("lost archive reply activated operation");
    await install(pic, installer, sinkId, sinkWasm, IDL.encode([IDL.Principal], [treasuryId]), { upgrade: [{ skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }] });
    await install(pic, installer, treasuryId, treasuryWasm, IDL.encode([IDL.Principal, IDL.Principal], [operator, sinkId]), { upgrade: [{ skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }] });
    treasury.setPrincipal(operator); expect(await treasury.reconcile(), "acknowledge", "exact canonical receipt reconciles after EOP upgrades");
    if (!await treasury.isAcknowledged()) throw new Error("exact receipt did not activate retained archive binding");
    await reject(() => treasury.retryThenLoseReply(), "duplicate archive delivery loses reply");
    expect(await treasury.reconcile(), "acknowledge", "duplicate archive delivery reconciles exact receipt");
    if (await treasury.retainedCount() !== 1n) throw new Error("duplicate archive delivery retained a second binding");

    // An interrupted retained binding survives EOP. Only the fixed operator's
    // no-input repair can redeliver it, and its lost/unknown reply cannot
    // activate anything until the exact sink receipt is looked up after both
    // disposable actors have been upgraded.
    const repairTreasuryId = await pic.createCanister({ sender: installer, controllers: [installer] });
    const repairSinkId = await pic.createCanister({ sender: installer, controllers: [installer] });
    await install(pic, installer, repairTreasuryId, treasuryWasm, IDL.encode([IDL.Principal, IDL.Principal], [operator, repairSinkId]));
    await install(pic, installer, repairSinkId, sinkWasm, IDL.encode([IDL.Principal], [repairTreasuryId]));
    const repairTreasury = pic.createActor(treasuryIdl, repairTreasuryId);
    const repairInput = { ...input, logicalId: "payment-operation:v1:archive-export-repair", operationId: "operation:archive-export-repair", obligationId: "obligation:archive-export-repair", contentHash: hash(51), destinationHash: hash(52) };
    repairTreasury.setPrincipal(operator);
    await reject(() => repairTreasury.retainThenTrapBeforeArchiveAwait(repairInput), "repair binding is interrupted before archive await");
    await reject(() => repairTreasury.retainThenLoseReply({ ...repairInput, amountBaseUnits: 2n }), "interrupted repair binding rejects replacement input");
    await install(pic, installer, repairTreasuryId, treasuryWasm, IDL.encode([IDL.Principal, IDL.Principal], [operator, repairSinkId]), { upgrade: [{ skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }] });
    repairTreasury.setPrincipal(outsider); await reject(() => repairTreasury.repairArchiveResume(), "outsider archive repair denied after EOP upgrade");
    repairTreasury.setPrincipal(operator);
    expect(await repairTreasury.repairArchiveResume(), "remainPending", "operator repair redelivers only retained canonical binding");
    if (await repairTreasury.isAcknowledged()) throw new Error("operator repair activated archive without receipt reconciliation");
    await install(pic, installer, repairSinkId, sinkWasm, IDL.encode([IDL.Principal], [repairTreasuryId]), { upgrade: [{ skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }] });
    await install(pic, installer, repairTreasuryId, treasuryWasm, IDL.encode([IDL.Principal, IDL.Principal], [operator, repairSinkId]), { upgrade: [{ skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }] });
    repairTreasury.setPrincipal(operator);
    expect(await repairTreasury.reconcile(), "acknowledge", "exact repaired archive receipt acknowledges after EOP upgrades");
    if (!await repairTreasury.isAcknowledged()) throw new Error("exact repaired archive receipt did not activate binding");
    if (await repairTreasury.retainedCount() !== 1n) throw new Error("repair route retained more than one immutable binding");

    // The canonical bytes and SHA-256-bound tuple must be retained before the
    // reserve blocks the await. Same-Wasm EOP cannot turn that pending state
    // into a send; after test-only replenishment retry has no replacement
    // input and can dispatch only that retained binding.
    const lowTreasuryId = await pic.createCanister({ sender: installer, controllers: [installer], cycles: lowCycleTreasuryInstallationCycles });
    const lowSinkId = await pic.createCanister({ sender: installer, controllers: [installer] });
    await install(pic, installer, lowTreasuryId, treasuryWasm, IDL.encode([IDL.Principal, IDL.Principal], [operator, lowSinkId]));
    await install(pic, installer, lowSinkId, sinkWasm, IDL.encode([IDL.Principal], [lowTreasuryId]));
    const lowTreasury = pic.createActor(treasuryIdl, lowTreasuryId);
    lowTreasury.setPrincipal(operator);
    const lowInput = { ...input, logicalId: "payment-operation:v1:archive-export-low-cycles", operationId: "operation:archive-export-low-cycles", obligationId: "obligation:archive-export-low-cycles", contentHash: hash(41), destinationHash: hash(42) };
    await reject(() => lowTreasury.retainThenLoseReply(lowInput), "low-cycle archive dispatch is blocked after binding retention");
    if (await lowTreasury.retainedCount() !== 0n) throw new Error("low-cycle archive dispatch reached synthetic sink");
    await install(pic, installer, lowTreasuryId, treasuryWasm, IDL.encode([IDL.Principal, IDL.Principal], [operator, lowSinkId]), { upgrade: [{ skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }] });
    lowTreasury.setPrincipal(operator);
    if ((await pic.addCycles(lowTreasuryId, 2_000_000_000_000n)) < 1_000_000_000_000n) throw new Error("low-cycle archive proof failed to replenish disposable treasury fixture");
    await reject(() => lowTreasury.retryThenLoseReply(), "replenished retry deliberately loses only retained archive binding reply");
    expect(await lowTreasury.reconcile(), "acknowledge", "replenished retry reconciles exact retained archive binding");
    if (await lowTreasury.retainedCount() !== 1n) throw new Error("replenished low-cycle retry retained an unexpected binding");
  } finally { await pic.tearDown(); await server.stop(); }
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
