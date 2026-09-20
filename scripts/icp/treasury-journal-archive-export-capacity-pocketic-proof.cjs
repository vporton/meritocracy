#!/usr/bin/env node
// Bounded, synthetic M1 capacity proof for canonical treasury-journal archive
// exports. It uses disposable fixtures only; no target actor, data, wallet,
// signer, ledger, chain, identity, DFX configuration, or external network.
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const os = require("node:os");
const { spawn } = require("node:child_process");
const root = path.resolve(__dirname, "../../node_modules/ic-mops/node_modules");
const { PocketIc } = require(path.join(root, "pic-js-mops"));
const { IDL } = require(path.join(root, "@icp-sdk/core/lib/cjs/candid/index.js"));
const { Principal } = require(path.join(root, "@icp-sdk/core/lib/cjs/principal/index.js"));

const [bin, fixtureWasm, sinkWasm, reportPath] = process.argv.slice(2);
if (!bin || !fixtureWasm || !sinkWasm || !reportPath) throw new Error("Expected PocketIC binary, canonical archive fixture Wasm, sink Wasm, and report path");
const P = IDL.Principal, Hash = IDL.Vec(IDL.Nat8);
const Direction = IDL.Variant({ debit: IDL.Null, credit: IDL.Null });
const Entry = IDL.Record({ logicalId: IDL.Text, journalSequence: IDL.Nat64, operationId: IDL.Text, accountId: IDL.Text, assetId: IDL.Text, direction: Direction, amountBaseUnits: IDL.Nat, assetDecimals: IDL.Nat8, desiredVersion: IDL.Nat64, contentHash: Hash });
const BalancedSet = IDL.Record({ logicalId: IDL.Text, entries: IDL.Vec(Entry) });
const Tuple = IDL.Record({ logicalId: IDL.Text, version: IDL.Nat64, contentHash: Hash });
const Decision = IDL.Variant({ acknowledge: IDL.Null, remainPending: IDL.Null, blocked: IDL.Null });
const Phase = IDL.Variant({ prepared: IDL.Null, archiveStarted: IDL.Null, pending: IDL.Null, acknowledged: IDL.Null, blocked: IDL.Null });
const Chunk = IDL.Record({ hash: Hash });
const Upload = IDL.Record({ canister_id: P, chunk: Hash });
const Install = IDL.Record({ arg: Hash, chunk_hashes_list: IDL.Vec(Chunk), mode: IDL.Variant({ install: IDL.Null }), sender_canister_version: IDL.Opt(IDL.Nat64), store_canister: IDL.Opt(P), canister_id: P, target_canister: P, wasm_module_hash: Hash });
const fixtureIdl = ({ IDL: C }) => C.Service({ prepareArchiveExport: C.Func([], [], []), archiveThenLoseReply: C.Func([], [], []), reconcileArchiveExport: C.Func([], [Decision], []), archiveRetainsExactExport: C.Func([], [C.Bool], []), archivePhase: C.Func([], [Phase], []) });
const sinkIdl = ({ IDL: C }) => C.Service({ permit: C.Func([], [], []) });
const management = Principal.fromText("aaaaa-aa");
const startupTimeoutMs = Number.parseInt(process.env.M1_POCKET_IC_STARTUP_TIMEOUT_MS || "120000", 10);
if (!Number.isSafeInteger(startupTimeoutMs) || startupTimeoutMs < 30_000 || startupTimeoutMs > 120_000) throw new Error("M1_POCKET_IC_STARTUP_TIMEOUT_MS must be an integer between 30000 and 120000");
const hash = (ordinal) => Uint8Array.from({ length: 32 }, (_, index) => (ordinal + index) % 256);
function expect(value, tag, label) { if (Object.keys(value).length !== 1 || !(tag in value)) throw new Error(`${label}: expected ${tag}`); }
async function rejected(action, label) { try { await action(); } catch (_) { return; } throw new Error(`${label}: expected rejected ingress`); }
async function update(pic, sender, method, type, value) { return pic.client.updateCall({ canisterId: management, sender, method, payload: new Uint8Array(IDL.encode([type], [value])) }); }
async function startPocketIc(binPath) {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "m1-treasury-journal-archive-export-capacity-"));
  const portFile = path.join(runtimeDir, "port");
  const process = spawn(binPath, ["--port-file", portFile, "--ttl", "60"], { stdio: ["ignore", "ignore", "ignore"] });
  const stop = async () => { if (process.exitCode === null) { process.kill(); await new Promise(resolve => process.once("exit", resolve)); } fs.rmSync(runtimeDir, { recursive: true, force: true }); };
  try {
    const deadline = Date.now() + startupTimeoutMs;
    while (Date.now() < deadline) {
      try { const port = Number.parseInt(fs.readFileSync(portFile, "utf8"), 10); if (Number.isInteger(port) && port > 0 && port <= 65535) return { url: `http://127.0.0.1:${port}`, stop }; } catch (error) { if (error.code !== "ENOENT") throw error; }
      if (process.exitCode !== null) throw new Error(`PocketIC exited before startup with status ${process.exitCode}`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`PocketIC did not publish its port within ${startupTimeoutMs}ms`);
  } catch (error) { await stop(); throw error; }
}
async function install(pic, sender, canisterId, wasmPath, argument) {
  const wasm = fs.readFileSync(wasmPath), chunks = [];
  for (let offset = 0; offset < wasm.length; offset += 1_000_000) {
    const chunk = new Uint8Array(wasm.subarray(offset, Math.min(offset + 1_000_000, wasm.length)));
    await update(pic, sender, "upload_chunk", Upload, { canister_id: canisterId, chunk });
    chunks.push({ hash: new Uint8Array(crypto.createHash("sha256").update(chunk).digest()) });
  }
  await update(pic, sender, "install_chunked_code", Install, { arg: new Uint8Array(argument), chunk_hashes_list: chunks, mode: { install: null }, sender_canister_version: [], store_canister: [], canister_id: canisterId, target_canister: canisterId, wasm_module_hash: new Uint8Array(crypto.createHash("sha256").update(wasm).digest()) });
}
function set(name, ordinal, size = 16) {
  return {
    logicalId: `treasury-journal-set:v1:canonical-export-capacity:${name}:${ordinal}`,
    entries: Array.from({ length: size }, (_, index) => ({
      logicalId: `treasury-journal:v1:canonical-export-capacity:${name}:${ordinal}:${index}`,
      journalSequence: BigInt(index + 1), operationId: `operation:canonical-export-capacity:${name}:${ordinal}`,
      accountId: index < size / 2 ? "liability:synthetic" : "treasury:synthetic", assetId: "ICP",
      direction: index < size / 2 ? { debit: null } : { credit: null }, amountBaseUnits: 1n,
      assetDecimals: 8, desiredVersion: 1n, contentHash: hash(ordinal * 17 + index),
    })),
  };
}
async function exercise(pic, installer, operator, name, ordinal) {
  const fixtureId = await pic.createCanister({ sender: installer, controllers: [installer], cycles: 20_000_000_000_000n });
  const sinkId = await pic.createCanister({ sender: installer, controllers: [installer], cycles: 20_000_000_000_000n });
  const fixedSet = set(name, ordinal);
  await install(pic, installer, sinkId, sinkWasm, IDL.encode([P, P, IDL.Text], [fixtureId, operator, fixedSet.logicalId]));
  await install(pic, installer, fixtureId, fixtureWasm, IDL.encode([P, P, BalancedSet], [operator, sinkId, fixedSet]));
  const fixture = pic.createActor(fixtureIdl, fixtureId), sink = pic.createActor(sinkIdl, sinkId);
  fixture.setPrincipal(operator); sink.setPrincipal(operator);
  await fixture.prepareArchiveExport();
  await sink.permit();
  await rejected(() => fixture.archiveThenLoseReply(), `${name}/${ordinal} deliberately loses canonical archive reply`);
  expect(await fixture.archivePhase(), "archiveStarted", `${name}/${ordinal} retains dispatch state after lost reply`);
  expect(await fixture.reconcileArchiveExport(), "acknowledge", `${name}/${ordinal} reconciles only exact canonical receipt`);
  if (!(await fixture.archiveRetainsExactExport())) throw new Error(`${name}/${ordinal} sink did not retain byte-identical canonical export`);
  return IDL.encode([BalancedSet], [fixedSet]).byteLength;
}
async function scenario(pic, installer, operator, name, count) {
  const invalidFixtureId = await pic.createCanister({ sender: installer, controllers: [installer] });
  const invalidSet = set(name, 999, 18);
  await rejected(() => install(pic, installer, invalidFixtureId, fixtureWasm, IDL.encode([P, P, BalancedSet], [operator, Principal.fromUint8Array(Uint8Array.of(8, 8)), invalidSet])), `${name} 18-entry set is rejected before durable export binding`);
  let encodedInputBytes = 0;
  for (let ordinal = 0; ordinal < count; ordinal += 1) encodedInputBytes += await exercise(pic, installer, operator, name, ordinal);
  return { name, archives: count, entriesPerArchive: 16, receipts: count, encodedBalancedSetBytes: encodedInputBytes };
}
async function main() {
  const server = await startPocketIc(bin), pic = await PocketIc.create(server.url);
  try {
    const installer = Principal.fromUint8Array(Uint8Array.of(8, 31)), operator = Principal.fromUint8Array(Uint8Array.of(8, 32));
    const report = { schemaVersion: 1, component: "M1 canonical SHA-256-bound treasury-journal archive-export capacity proof", emulator: "PocketIC synthetic-only", scenarios: [await scenario(pic, installer, operator, "expected", 16), await scenario(pic, installer, operator, "two_x", 32)], rejection: { balancedSetEntries: 18, result: "rejected at fixture installation before durable binding or archive dispatch" }, limitations: ["Cycle use is not collected here and this is not a production instruction/cycle budget.", "Every archive has one fixed 16-entry balanced set, one derived bounded canonical byte sequence, a deliberately lost reply, exact tuple reconciliation, and a byte-identical sink-retention check.", "This proof has no target treasury/archive actor, public archive API, balance projection, account, asset transfer, destination, signer, transaction, chain, target data, deployment, or authority behavior.", "Low-cycle execution, immutable production archive policy, and independent accounting reconciliation remain M1/G2/G3 blockers."] };
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    console.log(JSON.stringify(report));
  } finally { await pic.tearDown(); await server.stop(); }
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
