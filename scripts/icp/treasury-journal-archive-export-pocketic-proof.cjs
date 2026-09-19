#!/usr/bin/env node
// Synthetic M1 proof for durable canonical treasury-journal archive exports.
// It uses only disposable fixture Wasms and principals: no DFX state, wallet,
// signer, destination, balance, transfer, chain, target data, or network.
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { PocketIc, PocketIcServer } = require(path.resolve(__dirname, "../../node_modules/ic-mops/node_modules/pic-js-mops"));
const { IDL } = require(path.resolve(__dirname, "../../node_modules/ic-mops/node_modules/@icp-sdk/core/lib/cjs/candid/index.js"));
const { Principal } = require(path.resolve(__dirname, "../../node_modules/ic-mops/node_modules/@icp-sdk/core/lib/cjs/principal/index.js"));

const [pocketIcBin, fixtureWasm, sinkWasm] = process.argv.slice(2);
if (!pocketIcBin || !fixtureWasm || !sinkWasm) throw new Error("Expected PocketIC binary, canonical archive fixture Wasm, and sink Wasm");

const P = IDL.Principal;
const Hash = IDL.Vec(IDL.Nat8);
const Direction = IDL.Variant({ debit: IDL.Null, credit: IDL.Null });
const Entry = IDL.Record({
  logicalId: IDL.Text,
  journalSequence: IDL.Nat64,
  operationId: IDL.Text,
  accountId: IDL.Text,
  assetId: IDL.Text,
  direction: Direction,
  amountBaseUnits: IDL.Nat,
  assetDecimals: IDL.Nat8,
  desiredVersion: IDL.Nat64,
  contentHash: Hash,
});
const BalancedSet = IDL.Record({ logicalId: IDL.Text, entries: IDL.Vec(Entry) });
const Tuple = IDL.Record({ logicalId: IDL.Text, version: IDL.Nat64, contentHash: Hash });
const Binding = IDL.Record({ tuple: Tuple, bytes: Hash });
const Decision = IDL.Variant({ acknowledge: IDL.Null, remainPending: IDL.Null, blocked: IDL.Null });
const Phase = IDL.Variant({ prepared: IDL.Null, archiveStarted: IDL.Null, pending: IDL.Null, acknowledged: IDL.Null, blocked: IDL.Null });
const Chunk = IDL.Record({ hash: Hash });
const Upload = IDL.Record({ canister_id: P, chunk: Hash });
const Install = IDL.Record({
  arg: Hash,
  chunk_hashes_list: IDL.Vec(Chunk),
  mode: IDL.Variant({ install: IDL.Null, upgrade: IDL.Opt(IDL.Record({ skip_pre_upgrade: IDL.Opt(IDL.Bool), wasm_memory_persistence: IDL.Opt(IDL.Variant({ keep: IDL.Null, replace: IDL.Null })) })) }),
  sender_canister_version: IDL.Opt(IDL.Nat64),
  store_canister: IDL.Opt(P),
  canister_id: P,
  target_canister: P,
  wasm_module_hash: Hash,
});
const fixtureIdl = ({ IDL: C }) => C.Service({
  prepareArchiveExport: C.Func([], [], []),
  archiveThenTrapBeforeAwait: C.Func([], [], []),
  archiveThenLoseReply: C.Func([], [], []),
  reconcileArchiveExport: C.Func([], [Decision], []),
  repairArchiveExport: C.Func([], [Decision], []),
  archiveRetainsExactExport: C.Func([], [C.Bool], []),
  archivePhase: C.Func([], [Phase], []),
});
const sinkIdl = ({ IDL: C }) => C.Service({
  permit: C.Func([], [], []),
  revoke: C.Func([], [], []),
  archive: C.Func([Binding], [Tuple], []),
});
const management = Principal.fromText("aaaaa-aa");
const hash = (byte) => Uint8Array.from({ length: 32 }, () => byte);

function expect(value, tag, label) {
  if (Object.keys(value).length !== 1 || !(tag in value)) throw new Error(`${label}: expected ${tag}`);
}
async function rejected(action, label) {
  try { await action(); } catch (_) { return; }
  throw new Error(`${label}: expected rejected ingress`);
}
async function managementUpdate(pic, sender, method, type, value) {
  return pic.client.updateCall({ canisterId: management, sender, method, payload: new Uint8Array(IDL.encode([type], [value])) });
}
async function install(pic, sender, canisterId, wasmPath, argument, mode = { install: null }) {
  const wasm = fs.readFileSync(wasmPath);
  const chunks = [];
  for (let offset = 0; offset < wasm.length; offset += 1_000_000) {
    const chunk = new Uint8Array(wasm.subarray(offset, Math.min(offset + 1_000_000, wasm.length)));
    await managementUpdate(pic, sender, "upload_chunk", Upload, { canister_id: canisterId, chunk });
    chunks.push({ hash: new Uint8Array(crypto.createHash("sha256").update(chunk).digest()) });
  }
  await managementUpdate(pic, sender, "install_chunked_code", Install, {
    arg: new Uint8Array(argument), chunk_hashes_list: chunks, mode, sender_canister_version: [], store_canister: [], canister_id: canisterId, target_canister: canisterId,
    wasm_module_hash: new Uint8Array(crypto.createHash("sha256").update(wasm).digest()),
  });
}
function set(logicalId, ordinal) {
  return {
    logicalId,
    entries: [
      { logicalId: `${logicalId}:debit`, journalSequence: 1n, operationId: `operation:${ordinal}`, accountId: "liability:synthetic", assetId: "ICP", direction: { debit: null }, amountBaseUnits: 5n, assetDecimals: 8, desiredVersion: 1n, contentHash: hash(ordinal) },
      { logicalId: `${logicalId}:credit`, journalSequence: 2n, operationId: `operation:${ordinal}`, accountId: "treasury:synthetic", assetId: "ICP", direction: { credit: null }, amountBaseUnits: 5n, assetDecimals: 8, desiredVersion: 1n, contentHash: hash(ordinal + 1) },
    ],
  };
}
async function installPair(pic, installer, operator, logicalId, ordinal) {
  const fixtureId = await pic.createCanister({ sender: installer, controllers: [installer] });
  const sinkId = await pic.createCanister({ sender: installer, controllers: [installer] });
  const fixedSet = set(logicalId, ordinal);
  await install(pic, installer, sinkId, sinkWasm, IDL.encode([P, P, IDL.Text], [fixtureId, operator, logicalId]));
  await install(pic, installer, fixtureId, fixtureWasm, IDL.encode([P, P, BalancedSet], [operator, sinkId, fixedSet]));
  const fixture = pic.createActor(fixtureIdl, fixtureId);
  const sink = pic.createActor(sinkIdl, sinkId);
  fixture.setPrincipal(operator);
  sink.setPrincipal(operator);
  return { fixtureId, sinkId, fixture, sink, fixedSet };
}
const upgradeKeep = { upgrade: [{ skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }] };

async function main() {
  const server = await PocketIcServer.start({ binPath: pocketIcBin, ttl: 60, showRuntimeLogs: false, showCanisterLogs: false });
  const pic = await PocketIc.create(server.getUrl());
  try {
    const installer = Principal.fromUint8Array(Uint8Array.of(9, 1));
    const operator = Principal.fromUint8Array(Uint8Array.of(9, 2));
    const outsider = Principal.fromUint8Array(Uint8Array.of(9, 3));

    const lostReply = await installPair(pic, installer, operator, "treasury-journal-set:v1:canonical-export:lost-reply", 11);
    lostReply.fixture.setPrincipal(outsider);
    await rejected(() => lostReply.fixture.prepareArchiveExport(), "outsider cannot retain canonical export binding");
    lostReply.fixture.setPrincipal(operator);
    await lostReply.fixture.prepareArchiveExport();
    await rejected(() => lostReply.fixture.prepareArchiveExport(), "binding cannot be replaced after retention");
    lostReply.sink.setPrincipal(outsider);
    await rejected(() => lostReply.sink.permit(), "outsider cannot enable archive sink");
    lostReply.sink.setPrincipal(operator);
    await lostReply.sink.permit();
    await rejected(() => lostReply.fixture.archiveThenLoseReply(), "archive response is deliberately lost");
    expect(await lostReply.fixture.archivePhase(), "archiveStarted", "lost reply leaves durable dispatch state");
    await install(pic, installer, lostReply.sinkId, sinkWasm, IDL.encode([P, P, IDL.Text], [lostReply.fixtureId, operator, lostReply.fixedSet.logicalId]), upgradeKeep);
    await install(pic, installer, lostReply.fixtureId, fixtureWasm, IDL.encode([P, P, BalancedSet], [operator, lostReply.sinkId, lostReply.fixedSet]), upgradeKeep);
    lostReply.fixture.setPrincipal(operator);
    expect(await lostReply.fixture.reconcileArchiveExport(), "acknowledge", "exact receipt reconciles after EOP upgrades");
    expect(await lostReply.fixture.archivePhase(), "acknowledged", "exact receipt is terminal only for archive delivery");
    if (!(await lostReply.fixture.archiveRetainsExactExport())) throw new Error("sink did not retain byte-identical canonical binding after upgrade");

    const interrupted = await installPair(pic, installer, operator, "treasury-journal-set:v1:canonical-export:interrupted", 21);
    await interrupted.fixture.prepareArchiveExport();
    await rejected(() => interrupted.fixture.archiveThenTrapBeforeAwait(), "interruption occurs after binding retention before sink call");
    expect(await interrupted.fixture.reconcileArchiveExport(), "remainPending", "interrupted archive has no receipt before repair");
    await install(pic, installer, interrupted.fixtureId, fixtureWasm, IDL.encode([P, P, BalancedSet], [operator, interrupted.sinkId, interrupted.fixedSet]), upgradeKeep);
    interrupted.fixture.setPrincipal(outsider);
    await rejected(() => interrupted.fixture.repairArchiveExport(), "outsider cannot repair retained canonical binding");
    interrupted.fixture.setPrincipal(operator);
    interrupted.sink.setPrincipal(operator);
    await interrupted.sink.permit();
    expect(await interrupted.fixture.repairArchiveExport(), "remainPending", "repair sends retained binding without replacement input");
    expect(await interrupted.fixture.reconcileArchiveExport(), "acknowledge", "repaired exact receipt acknowledges only retained binding");
    if (!(await interrupted.fixture.archiveRetainsExactExport())) throw new Error("repair path did not retain byte-identical canonical binding");
  } finally {
    await pic.tearDown();
    await server.stop();
  }
}
main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
