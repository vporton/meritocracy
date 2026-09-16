#!/usr/bin/env node
// M1 synthetic capacity boundary for the real fixed workflow-receipt adapter.
// It uses only disposable PocketIC canisters and records cycle deltas as an
// emulator measurement. Those deltas are not a mainnet instruction budget.
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const os = require("node:os");
const { spawn } = require("node:child_process");
const root = path.resolve(__dirname, "../../node_modules/ic-mops/node_modules");
const { PocketIc } = require(path.join(root, "pic-js-mops"));
const { IDL } = require(path.join(root, "@icp-sdk/core/lib/cjs/candid/index.js"));
const { Principal } = require(path.join(root, "@icp-sdk/core/lib/cjs/principal/index.js"));

const [bin, authorityWasm, workflowWasm, reportPath] = process.argv.slice(2);
if (!bin || !authorityWasm || !workflowWasm || !reportPath) {
  throw new Error("Expected PocketIC binary, authority Wasm, workflow Wasm, and report path");
}

const Hash = IDL.Vec(IDL.Nat8), P = IDL.Principal;
const Config = IDL.Record({ core: P, workflow: P, treasury: P, archive: P, evidence: P, governance: P });
const Input = IDL.Record({ logicalId: IDL.Text, cycleId: IDL.Text, operationName: IDL.Text, desiredVersion: IDL.Nat64, contentHash: Hash });
const Recovery = IDL.Variant({ acknowledge: IDL.Null, retryIdentical: IDL.Null, conflict: IDL.Null, blocked: IDL.Null });
const workflowIdl = ({ IDL: C }) => C.Service({
  writeThenLoseReply: C.Func([Input], [], []),
  reconcileLostReply: C.Func([], [Recovery], []),
});
const Chunk = IDL.Record({ hash: Hash }), Upload = IDL.Record({ canister_id: P, chunk: Hash });
const Install = IDL.Record({ arg: Hash, chunk_hashes_list: IDL.Vec(Chunk), mode: IDL.Variant({ install: IDL.Null }), sender_canister_version: IDL.Opt(IDL.Nat64), store_canister: IDL.Opt(P), canister_id: P, target_canister: P, wasm_module_hash: Hash });
const management = Principal.fromText("aaaaa-aa");
const startupTimeoutMs = Number.parseInt(process.env.M1_POCKET_IC_STARTUP_TIMEOUT_MS || "120000", 10);
if (!Number.isSafeInteger(startupTimeoutMs) || startupTimeoutMs < 30_000 || startupTimeoutMs > 120_000) throw new Error("M1_POCKET_IC_STARTUP_TIMEOUT_MS must be an integer between 30000 and 120000");

function expect(value, tag, label) {
  if (Object.keys(value).length !== 1 || !(tag in value)) throw new Error(`${label}: expected ${tag}`);
}
async function reject(f, label) {
  try { await f(); } catch (_) { return; }
  throw new Error(`${label}: expected rejected ingress`);
}
async function update(pic, sender, method, type, value) {
  return pic.client.updateCall({ canisterId: management, sender, method, payload: new Uint8Array(IDL.encode([type], [value])) });
}
async function startPocketIc(binPath) {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "m1-workflow-capacity-pocketic-server-"));
  const portFile = path.join(runtimeDir, "port");
  const process = spawn(binPath, ["--port-file", portFile, "--ttl", "60"], { stdio: ["ignore", "ignore", "ignore"] });
  const deadline = Date.now() + startupTimeoutMs;
  try {
    while (Date.now() < deadline) {
      try {
        const port = Number.parseInt(fs.readFileSync(portFile, "utf8"), 10);
        if (Number.isInteger(port) && port > 0 && port <= 65535) return {
          url: `http://127.0.0.1:${port}`,
          async stop() {
            if (process.exitCode === null) {
              if (!process.killed) process.kill();
              await new Promise(resolve => process.once("exit", resolve));
            }
            fs.rmSync(runtimeDir, { recursive: true, force: true });
          },
        };
      } catch (error) { if (error.code !== "ENOENT") throw error; }
      if (process.exitCode !== null) throw new Error(`PocketIC exited before startup with status ${process.exitCode}`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`PocketIC did not publish its port within ${startupTimeoutMs}ms`);
  } catch (error) {
    if (process.exitCode === null) {
      if (!process.killed) process.kill();
      await new Promise(resolve => process.once("exit", resolve));
    }
    fs.rmSync(runtimeDir, { recursive: true, force: true });
    throw error;
  }
}
async function install(pic, sender, id, file, arg) {
  const wasm = fs.readFileSync(file), hashes = [];
  for (let offset = 0; offset < wasm.length; offset += 1_000_000) {
    const chunk = new Uint8Array(wasm.subarray(offset, Math.min(offset + 1_000_000, wasm.length)));
    await update(pic, sender, "upload_chunk", Upload, { canister_id: id, chunk });
    hashes.push({ hash: new Uint8Array(crypto.createHash("sha256").update(chunk).digest()) });
  }
  await update(pic, sender, "install_chunked_code", Install, { arg: new Uint8Array(arg), chunk_hashes_list: hashes, mode: { install: null }, sender_canister_version: [], store_canister: [], canister_id: id, target_canister: id, wasm_module_hash: new Uint8Array(crypto.createHash("sha256").update(wasm).digest()) });
}
function hash(ordinal) { return Uint8Array.from({ length: 32 }, (_, index) => (ordinal + index) % 256); }
async function scenario(pic, installer, operator, name, count) {
  const authorityId = await pic.createCanister({ sender: installer, controllers: [installer], cycles: 20_000_000_000_000n });
  const workflowId = await pic.createCanister({ sender: installer, controllers: [installer], cycles: 20_000_000_000_000n });
  const config = { core: Principal.fromUint8Array(Uint8Array.of(7, 1)), workflow: workflowId, treasury: Principal.fromUint8Array(Uint8Array.of(7, 2)), archive: Principal.fromUint8Array(Uint8Array.of(7, 3)), evidence: Principal.fromUint8Array(Uint8Array.of(7, 4)), governance: Principal.fromUint8Array(Uint8Array.of(7, 5)) };
  await install(pic, installer, authorityId, authorityWasm, IDL.encode([Config], [config]));
  await install(pic, installer, workflowId, workflowWasm, IDL.encode([P, P], [operator, authorityId]));
  const before = { authority: await pic.getCyclesBalance(authorityId), workflow: await pic.getCyclesBalance(workflowId) };
  const workflow = pic.createActor(workflowIdl, workflowId);
  workflow.setPrincipal(operator);
  let encodedInputBytes = 0;
  for (let ordinal = 0; ordinal < count; ordinal += 1) {
    const input = { logicalId: `workflow-completion:v1:capacity:${name}:${ordinal}`, cycleId: `capacity-${name}-${ordinal}`, operationName: "publish-result", desiredVersion: 1n, contentHash: hash(ordinal) };
    encodedInputBytes += IDL.encode([Input], [input]).byteLength;
    await reject(() => workflow.writeThenLoseReply(input), `${name} write ${ordinal} deliberately loses reply`);
    expect(await workflow.reconcileLostReply(), "acknowledge", `${name} write ${ordinal} exact tuple reconciles`);
  }
  const after = { authority: await pic.getCyclesBalance(authorityId), workflow: await pic.getCyclesBalance(workflowId) };
  return { name, writes: count, lookups: count * 2, encodedInputBytes, authorityCycleDelta: (before.authority - after.authority).toString(), workflowCycleDelta: (before.workflow - after.workflow).toString() };
}
async function main() {
  const server = await startPocketIc(bin), pic = await PocketIc.create(server.url);
  try {
    const installer = Principal.fromUint8Array(Uint8Array.of(6, 31)), operator = Principal.fromUint8Array(Uint8Array.of(6, 32));
    const expected = await scenario(pic, installer, operator, "expected", 16);
    const twoX = await scenario(pic, installer, operator, "two_x", 32);
    // The fixed contract must reject before it makes a storage call; the
    // fixture has no journal after this malformed input.
    const authorityId = await pic.createCanister({ sender: installer, controllers: [installer] });
    const workflowId = await pic.createCanister({ sender: installer, controllers: [installer], cycles: 20_000_000_000_000n });
    const config = { core: Principal.fromUint8Array(Uint8Array.of(7, 11)), workflow: workflowId, treasury: Principal.fromUint8Array(Uint8Array.of(7, 12)), archive: Principal.fromUint8Array(Uint8Array.of(7, 13)), evidence: Principal.fromUint8Array(Uint8Array.of(7, 14)), governance: Principal.fromUint8Array(Uint8Array.of(7, 15)) };
    await install(pic, installer, authorityId, authorityWasm, IDL.encode([Config], [config]));
    await install(pic, installer, workflowId, workflowWasm, IDL.encode([P, P], [operator, authorityId]));
    const workflow = pic.createActor(workflowIdl, workflowId); workflow.setPrincipal(operator);
    const invalid = { logicalId: "x".repeat(513), cycleId: "capacity-over-limit", operationName: "publish-result", desiredVersion: 1n, contentHash: hash(255) };
    await reject(() => workflow.writeThenLoseReply(invalid), "over-limit input is rejected before storage");
    expect(await workflow.reconcileLostReply(), "blocked", "over-limit input creates no journal or storage retry");
    const report = { schemaVersion: 1, component: "M1 fixed workflow completion-receipt adapter capacity proof", emulator: "PocketIC synthetic-only", scenarios: [expected, twoX], rejection: { logicalIdBytes: 513, result: "rejected before storage; no journal" }, limitations: ["Cycle deltas are emulator measurements, not a mainnet instruction or production-cycle budget.", "This covers only the fixed workflow receipt adapter; other collection-specific capacity proofs remain required before G2."] };
    // Capacity evidence is append-only per CI artifact: a retry must use a
    // new artifact directory rather than silently replacing prior results.
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    console.log(JSON.stringify(report));
  } finally { await pic.tearDown(); await server.stop(); }
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
