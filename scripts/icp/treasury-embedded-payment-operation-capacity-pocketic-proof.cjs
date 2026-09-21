#!/usr/bin/env node
// Capacity boundary for the disposable treasury private payment-operation
// adapter. This is synthetic-only: no target treasury API, signer, address,
// transaction, ledger, balance, wallet, or chain is involved.
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const os = require("node:os");
const { spawn } = require("node:child_process");
const root = path.resolve(__dirname, "../../node_modules/ic-mops/node_modules");
const { PocketIc } = require(path.join(root, "pic-js-mops"));
const { IDL } = require(path.join(root, "@icp-sdk/core/lib/cjs/candid/index.js"));
const { Principal } = require(path.join(root, "@icp-sdk/core/lib/cjs/principal/index.js"));

const [bin, wasm, reportPath] = process.argv.slice(2);
if (!bin || !wasm || !reportPath) throw new Error("Expected PocketIC binary, fixture Wasm, and report path");
const Hash = IDL.Vec(IDL.Nat8), P = IDL.Principal;
const Input = IDL.Record({ logicalId: IDL.Text, operationId: IDL.Text, obligationId: IDL.Text, assetId: IDL.Text, amountBaseUnits: IDL.Nat, assetDecimals: IDL.Nat8, destinationHash: Hash, desiredVersion: IDL.Nat64, contentHash: Hash });
const Result = IDL.Variant({ acknowledged: IDL.Null, blocked: IDL.Null, conflict: IDL.Null, storageError: IDL.Null });
const Chunk = IDL.Record({ hash: Hash }), Upload = IDL.Record({ canister_id: P, chunk: Hash });
const Install = IDL.Record({ arg: Hash, chunk_hashes_list: IDL.Vec(Chunk), mode: IDL.Variant({ install: IDL.Null }), sender_canister_version: IDL.Opt(IDL.Nat64), store_canister: IDL.Opt(P), canister_id: P, target_canister: P, wasm_module_hash: Hash });
const management = Principal.fromText("aaaaa-aa");
const idl = ({ IDL: C }) => C.Service({ writeOperation: C.Func([Input], [Result], []) });
const startupTimeoutMs = Number.parseInt(process.env.M1_POCKET_IC_STARTUP_TIMEOUT_MS || "120000", 10);
if (!Number.isSafeInteger(startupTimeoutMs) || startupTimeoutMs < 30000 || startupTimeoutMs > 120000) throw new Error("M1_POCKET_IC_STARTUP_TIMEOUT_MS must be an integer between 30000 and 120000");
const hash = n => Uint8Array.from({ length: 32 }, (_, i) => (n + i) % 256);
function expect(value, tag, label) { if (Object.keys(value).length !== 1 || !(tag in value)) throw new Error(`${label}: expected ${tag}`); }
async function update(pic, sender, method, type, value) { return pic.client.updateCall({ canisterId: management, sender, method, payload: new Uint8Array(IDL.encode([type], [value])) }); }
async function startPocketIc(binPath) {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "m1-treasury-embedded-capacity-pocketic-"));
  const portFile = path.join(runtimeDir, "port"), process = spawn(binPath, ["--port-file", portFile, "--ttl", "60"], { stdio: ["ignore", "ignore", "ignore"] });
  const stop = async () => { if (process.exitCode === null) { process.kill(); await new Promise(resolve => process.once("exit", resolve)); } fs.rmSync(runtimeDir, { recursive: true, force: true }); };
  try { const deadline = Date.now() + startupTimeoutMs; while (Date.now() < deadline) { try { const port = Number.parseInt(fs.readFileSync(portFile, "utf8"), 10); if (Number.isInteger(port) && port > 0 && port <= 65535) return { url: `http://127.0.0.1:${port}`, stop }; } catch (error) { if (error.code !== "ENOENT") throw error; } if (process.exitCode !== null) throw new Error(`PocketIC exited before startup with status ${process.exitCode}`); await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error(`PocketIC did not publish its port within ${startupTimeoutMs}ms`); } catch (error) { await stop(); throw error; }
}
async function install(pic, sender, canisterId) {
  const bytes = fs.readFileSync(wasm), hashes = [];
  for (let offset = 0; offset < bytes.length; offset += 1000000) { const chunk = new Uint8Array(bytes.subarray(offset, Math.min(offset + 1000000, bytes.length))); await update(pic, sender, "upload_chunk", Upload, { canister_id: canisterId, chunk }); hashes.push({ hash: new Uint8Array(crypto.createHash("sha256").update(chunk).digest()) }); }
  await update(pic, sender, "install_chunked_code", Install, { arg: new Uint8Array(), chunk_hashes_list: hashes, mode: { install: null }, sender_canister_version: [], store_canister: [], canister_id: canisterId, target_canister: canisterId, wasm_module_hash: new Uint8Array(crypto.createHash("sha256").update(bytes).digest()) });
}
async function scenario(pic, installer, name, count) {
  const id = await pic.createCanister({ sender: installer, controllers: [installer], cycles: 20000000000000n });
  await install(pic, installer, id);
  const actor = pic.createActor(idl, id); actor.setPrincipal(installer);
  const before = await pic.getCyclesBalance(id);
  const invalid = { logicalId: "x".repeat(513), operationId: "operation:capacity:invalid", obligationId: "obligation:capacity:invalid", assetId: "icrc1:fixture", amountBaseUnits: 1n, assetDecimals: 8, destinationHash: hash(252), desiredVersion: 1n, contentHash: hash(253) };
  expect(await actor.writeOperation(invalid), "blocked", `${name} oversized logical ID is blocked before storage`);
  let encodedInputBytes = 0;
  for (let ordinal = 0; ordinal < count; ordinal += 1) {
    const input = { logicalId: `payment-operation:v1:embedded-capacity:${name}:${ordinal}`, operationId: `operation:embedded-capacity:${name}:${ordinal}`, obligationId: `obligation:embedded-capacity:${name}:${ordinal}`, assetId: "icrc1:fixture", amountBaseUnits: BigInt(ordinal + 1), assetDecimals: 8, destinationHash: hash(ordinal + count), desiredVersion: 1n, contentHash: hash(ordinal) };
    encodedInputBytes += IDL.encode([Input], [input]).byteLength;
    expect(await actor.writeOperation(input), "acknowledged", `${name} write ${ordinal}`);
    expect(await actor.writeOperation(input), "acknowledged", `${name} exact retry ${ordinal}`);
  }
  const after = await pic.getCyclesBalance(id);
  return { name, writes: count, exactRetries: count, encodedInputBytes, fixtureCycleDelta: (before - after).toString() };
}
async function main() {
  const server = await startPocketIc(bin), pic = await PocketIc.create(server.url);
  try {
    const installer = Principal.fromUint8Array(Uint8Array.of(8, 41));
    const report = { schemaVersion: 1, component: "M1 treasury private payment-operation adapter capacity proof", emulator: "PocketIC synthetic-only", scenarios: [await scenario(pic, installer, "expected", 16), await scenario(pic, installer, "two_x", 32)], rejection: { logicalIdBytes: 513, result: "blocked before private collection insertion" }, limitations: ["Cycle deltas are emulator measurements, not a production instruction or cycle budget.", "This covers only the treasury private payment-operation adapter; remaining collection-specific capacity proofs remain required before G2."] };
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: "wx" }); console.log(JSON.stringify(report));
  } finally { await pic.tearDown(); await server.stop(); }
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
