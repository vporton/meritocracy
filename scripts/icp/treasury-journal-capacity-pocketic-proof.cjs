#!/usr/bin/env node
// M1 synthetic capacity boundary for the real fixed treasury-journal adapter.
// It is valueless: no balance, address, signer, transaction, chain, wallet,
// identity, or target treasury canister is present.
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const os = require("node:os");
const { spawn } = require("node:child_process");
const root = path.resolve(__dirname, "../../node_modules/ic-mops/node_modules");
const { PocketIc } = require(path.join(root, "pic-js-mops"));
const { IDL } = require(path.join(root, "@icp-sdk/core/lib/cjs/candid/index.js"));
const { Principal } = require(path.join(root, "@icp-sdk/core/lib/cjs/principal/index.js"));

const [bin, authorityWasm, treasuryWasm, archiveWasm, reportPath] = process.argv.slice(2);
if (!bin || !authorityWasm || !treasuryWasm || !archiveWasm || !reportPath) throw new Error("Expected PocketIC binary, authority Wasm, treasury Wasm, archive Wasm, and report path");
const Hash = IDL.Vec(IDL.Nat8), P = IDL.Principal;
const Config = IDL.Record({ core: P, workflow: P, treasury: P, archive: P, evidence: P, governance: P });
const Input = IDL.Record({ logicalId: IDL.Text, journalSequence: IDL.Nat64, operationId: IDL.Text, accountId: IDL.Text, assetId: IDL.Text, direction: IDL.Variant({ debit: IDL.Null, credit: IDL.Null }), amountBaseUnits: IDL.Nat, assetDecimals: IDL.Nat8, desiredVersion: IDL.Nat64, contentHash: Hash });
const Recovery = IDL.Variant({ acknowledge: IDL.Null, retryIdentical: IDL.Null, conflict: IDL.Null, blocked: IDL.Null });
const BalancedSet = IDL.Record({ logicalId: IDL.Text, entries: IDL.Vec(Input) });
const Phase = IDL.Variant({ pending: IDL.Null, active: IDL.Null, conflict: IDL.Null, blocked: IDL.Null });
const treasuryIdl = ({ IDL: C }) => C.Service({
  writeThenLoseReply: C.Func([Input], [], []),
  reconcileLostReply: C.Func([], [Recovery], []),
  prepareBalancedSet: C.Func([BalancedSet], [], []),
  writeBalancedEntryThenLoseReply: C.Func([C.Nat], [], []),
  reconcileBalancedEntry: C.Func([C.Nat], [Recovery], []),
  balancedPhase: C.Func([], [Phase], []),
  prepareBalancedArchive: C.Func([IDL.Record({ logicalId: IDL.Text, version: IDL.Nat64, contentHash: Hash })], [], []),
  archiveBalancedSetThenLoseReply: C.Func([], [], []),
  reconcileBalancedArchive: C.Func([], [IDL.Variant({ acknowledge: IDL.Null, remainPending: IDL.Null, blocked: IDL.Null })], []),
});
const archiveIdl = ({ IDL: C }) => C.Service({ permit: C.Func([], [], []) });
const Chunk = IDL.Record({ hash: Hash }), Upload = IDL.Record({ canister_id: P, chunk: Hash });
const Install = IDL.Record({ arg: Hash, chunk_hashes_list: IDL.Vec(Chunk), mode: IDL.Variant({ install: IDL.Null }), sender_canister_version: IDL.Opt(IDL.Nat64), store_canister: IDL.Opt(P), canister_id: P, target_canister: P, wasm_module_hash: Hash });
const management = Principal.fromText("aaaaa-aa");
const startupTimeoutMs = Number.parseInt(process.env.M1_POCKET_IC_STARTUP_TIMEOUT_MS || "120000", 10);
if (!Number.isSafeInteger(startupTimeoutMs) || startupTimeoutMs < 30_000 || startupTimeoutMs > 120_000) throw new Error("M1_POCKET_IC_STARTUP_TIMEOUT_MS must be an integer between 30000 and 120000");
function expect(value, tag, label) { if (Object.keys(value).length !== 1 || !(tag in value)) throw new Error(`${label}: expected ${tag}`); }
async function reject(f, label) { try { await f(); } catch (_) { return; } throw new Error(`${label}: expected rejected ingress`); }
async function update(pic, sender, method, type, value) { return pic.client.updateCall({ canisterId: management, sender, method, payload: new Uint8Array(IDL.encode([type], [value])) }); }
async function startPocketIc(binPath) {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "m1-treasury-journal-capacity-pocketic-server-")), portFile = path.join(runtimeDir, "port");
  const process = spawn(binPath, ["--port-file", portFile, "--ttl", "60"], { stdio: ["ignore", "ignore", "ignore"] });
  const cleanup = async () => { if (process.exitCode === null) { if (!process.killed) process.kill(); await new Promise(resolve => process.once("exit", resolve)); } fs.rmSync(runtimeDir, { recursive: true, force: true }); };
  try { const deadline = Date.now() + startupTimeoutMs; while (Date.now() < deadline) { try { const port = Number.parseInt(fs.readFileSync(portFile, "utf8"), 10); if (Number.isInteger(port) && port > 0 && port <= 65535) return { url: `http://127.0.0.1:${port}`, stop: cleanup }; } catch (error) { if (error.code !== "ENOENT") throw error; } if (process.exitCode !== null) throw new Error(`PocketIC exited before startup with status ${process.exitCode}`); await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error(`PocketIC did not publish its port within ${startupTimeoutMs}ms`); } catch (error) { await cleanup(); throw error; }
}
async function install(pic, sender, id, file, arg) {
  const wasm = fs.readFileSync(file), hashes = [];
  for (let offset = 0; offset < wasm.length; offset += 1_000_000) { const chunk = new Uint8Array(wasm.subarray(offset, Math.min(offset + 1_000_000, wasm.length))); await update(pic, sender, "upload_chunk", Upload, { canister_id: id, chunk }); hashes.push({ hash: new Uint8Array(crypto.createHash("sha256").update(chunk).digest()) }); }
  await update(pic, sender, "install_chunked_code", Install, { arg: new Uint8Array(arg), chunk_hashes_list: hashes, mode: { install: null }, sender_canister_version: [], store_canister: [], canister_id: id, target_canister: id, wasm_module_hash: new Uint8Array(crypto.createHash("sha256").update(wasm).digest()) });
}
const hash = ordinal => Uint8Array.from({ length: 32 }, (_, index) => (ordinal + index) % 256);
function entry(name, ordinal) { return { logicalId: `treasury-journal:v1:capacity:${name}:${ordinal}`, journalSequence: BigInt(ordinal + 1), operationId: `operation:capacity:${name}:${ordinal}`, accountId: "treasury:synthetic", assetId: "ICP", direction: { debit: null }, amountBaseUnits: BigInt(ordinal + 1), assetDecimals: 8, desiredVersion: 1n, contentHash: hash(ordinal) }; }
function balancedEntry(name, ordinal) {
  const debit = ordinal < 8;
  return {
    logicalId: `treasury-journal:v1:capacity-balanced:${name}:${ordinal}`,
    journalSequence: BigInt(1_000_000 + ordinal),
    operationId: `operation:capacity-balanced:${name}`,
    accountId: debit ? "treasury:synthetic" : "liability:synthetic",
    assetId: "ICP",
    direction: debit ? { debit: null } : { credit: null },
    amountBaseUnits: 1n,
    assetDecimals: 8,
    desiredVersion: 1n,
    contentHash: hash(128 + ordinal),
  };
}
async function scenario(pic, installer, operator, name, count) {
  const authorityId = await pic.createCanister({ sender: installer, controllers: [installer], cycles: 20_000_000_000_000n });
  const treasuryId = await pic.createCanister({ sender: installer, controllers: [installer], cycles: 20_000_000_000_000n });
  const archiveId = await pic.createCanister({ sender: installer, controllers: [installer], cycles: 20_000_000_000_000n });
  const config = { core: Principal.fromUint8Array(Uint8Array.of(6, 1)), workflow: Principal.fromUint8Array(Uint8Array.of(6, 2)), treasury: treasuryId, archive: archiveId, evidence: Principal.fromUint8Array(Uint8Array.of(6, 4)), governance: Principal.fromUint8Array(Uint8Array.of(6, 5)) };
  await install(pic, installer, authorityId, authorityWasm, IDL.encode([Config], [config]));
  await install(pic, installer, treasuryId, treasuryWasm, IDL.encode([P, P, P], [operator, authorityId, config.archive]));
  await install(pic, installer, archiveId, archiveWasm, IDL.encode([P, P, P], [treasuryId, config.core, operator]));
  const before = { authority: await pic.getCyclesBalance(authorityId), treasury: await pic.getCyclesBalance(treasuryId) }, treasury = pic.createActor(treasuryIdl, treasuryId); treasury.setPrincipal(operator); let encodedInputBytes = 0;
  const invalid = { ...entry(name, 999), logicalId: "x".repeat(513) };
  await reject(() => treasury.writeThenLoseReply(invalid), `${name} over-limit input is rejected before storage`);
  expect(await treasury.reconcileLostReply(), "blocked", `${name} over-limit input creates no journal`);
  const tooLargeSet = { logicalId: `treasury-journal-set:v1:capacity:${name}:too-large`, entries: Array.from({ length: 17 }, (_, ordinal) => balancedEntry(name, ordinal)) };
  await reject(() => treasury.prepareBalancedSet(tooLargeSet), `${name} 17-entry balanced set is rejected before retention or storage`);
  expect(await treasury.balancedPhase(), "blocked", `${name} rejected balanced set creates no durable set`);
  for (let ordinal = 0; ordinal < count; ordinal += 1) { const input = entry(name, ordinal); encodedInputBytes += IDL.encode([Input], [input]).byteLength; await reject(() => treasury.writeThenLoseReply(input), `${name} write ${ordinal} deliberately loses reply`); expect(await treasury.reconcileLostReply(), "acknowledge", `${name} write ${ordinal} exact tuple reconciles`); }
  const set = { logicalId: `treasury-journal-set:v1:capacity:${name}:maximum`, entries: Array.from({ length: 16 }, (_, ordinal) => balancedEntry(name, ordinal)) };
  encodedInputBytes += IDL.encode([BalancedSet], [set]).byteLength;
  await treasury.prepareBalancedSet(set);
  for (let ordinal = 0; ordinal < set.entries.length; ordinal += 1) {
    await reject(() => treasury.writeBalancedEntryThenLoseReply(BigInt(ordinal)), `${name} retained balanced entry ${ordinal} deliberately loses reply`);
    expect(await treasury.reconcileBalancedEntry(BigInt(ordinal)), "acknowledge", `${name} retained balanced entry ${ordinal} exact tuple reconciles`);
  }
  expect(await treasury.balancedPhase(), "active", `${name} complete maximum balanced set alone becomes active`);
  const archiveTuple = { logicalId: set.logicalId, version: 1n, contentHash: hash(240) };
  encodedInputBytes += IDL.encode([IDL.Record({ logicalId: IDL.Text, version: IDL.Nat64, contentHash: Hash })], [archiveTuple]).byteLength;
  const archive = pic.createActor(archiveIdl, archiveId);
  archive.setPrincipal(operator);
  await archive.permit();
  await treasury.prepareBalancedArchive(archiveTuple);
  await reject(() => treasury.archiveBalancedSetThenLoseReply(), `${name} archive deliberately loses reply`);
  expect(await treasury.reconcileBalancedArchive(), "acknowledge", `${name} archive exact tuple reconciles`);
  const after = { authority: await pic.getCyclesBalance(authorityId), treasury: await pic.getCyclesBalance(treasuryId) };
  return { name, writes: count + 16, lookups: (count + 16) * 2, balancedSetEntries: 16, archiveTuples: 1, archiveLookups: 1, encodedInputBytes, authorityCycleDelta: (before.authority - after.authority).toString(), treasuryCycleDelta: (before.treasury - after.treasury).toString() };
}
async function main() {
  const server = await startPocketIc(bin), pic = await PocketIc.create(server.url);
  try { const installer = Principal.fromUint8Array(Uint8Array.of(6, 31)), operator = Principal.fromUint8Array(Uint8Array.of(6, 32)); const report = { schemaVersion: 1, component: "M1 fixed treasury-journal, bounded balanced-set, and tuple-only archive capacity proof", emulator: "PocketIC synthetic-only", scenarios: [await scenario(pic, installer, operator, "expected", 16), await scenario(pic, installer, operator, "two_x", 32)], rejection: { logicalIdBytes: 513, balancedSetEntries: 17, result: "rejected before journal, set retention, or storage in each scenario" }, limitations: ["Cycle deltas are emulator measurements, not a mainnet instruction or production-cycle budget.", "Each scenario also writes and exactly reconciles one maximum 16-entry immutable balanced set; the 17-entry failure limit is enforced before durable set retention.", "One fixed tuple-only archive acknowledgement follows each active maximum set; it contains no posting, balance, account, asset, amount, destination, signer, transaction, or chain data.", "This covers only the fixed treasury-journal adapter and its synthetic balanced-set/archive fixture; other collection-specific capacity proofs remain required before G2."] }; fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: "wx" }); console.log(JSON.stringify(report)); } finally { await pic.tearDown(); await server.stop(); }
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
