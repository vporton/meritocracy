#!/usr/bin/env node
// Synthetic-only capacity boundary for the consolidated application's private
// workflow-completion receipt collection. It has no application Candid API.
const path = require("node:path"), fs = require("node:fs"), crypto = require("node:crypto");
const { PocketIc, PocketIcServer } = require(path.resolve(__dirname, "../../node_modules/ic-mops/node_modules/pic-js-mops"));
const { IDL } = require(path.resolve(__dirname, "../../node_modules/ic-mops/node_modules/@icp-sdk/core/lib/cjs/candid/index.js"));
const { Principal } = require(path.resolve(__dirname, "../../node_modules/ic-mops/node_modules/@icp-sdk/core/lib/cjs/principal/index.js"));

const [bin, wasm, reportPath] = process.argv.slice(2);
if (!bin || !wasm || !reportPath) throw new Error("Expected PocketIC binary, fixture Wasm, and report path");

const Hash = IDL.Vec(IDL.Nat8), P = IDL.Principal;
const Input = IDL.Record({ logicalId: IDL.Text, cycleId: IDL.Text, operationName: IDL.Text, desiredVersion: IDL.Nat64, contentHash: Hash });
const Result = IDL.Variant({ acknowledged: IDL.Null, blocked: IDL.Null, conflict: IDL.Null, storageError: IDL.Null });
const ChunkHash = IDL.Record({ hash: Hash }), Upload = IDL.Record({ canister_id: P, chunk: Hash });
const Install = IDL.Record({ arg: Hash, chunk_hashes_list: IDL.Vec(ChunkHash), mode: IDL.Variant({ install: IDL.Null }), sender_canister_version: IDL.Opt(IDL.Nat64), store_canister: IDL.Opt(P), canister_id: P, target_canister: P, wasm_module_hash: Hash });
const management = Principal.fromText("aaaaa-aa");
const idl = ({ IDL: C }) => C.Service({ writeReceipt: C.Func([Input], [Result], []) });
const hash = n => Uint8Array.from({ length: 32 }, (_, i) => (n + i) % 256);

function expect(value, tag, label) { if (Object.keys(value).length !== 1 || !(tag in value)) throw new Error(`${label}: expected ${tag}, got ${JSON.stringify(value)}`); }
async function mgmt(pic, sender, method, type, value) { return pic.client.updateCall({ canisterId: management, sender, method, payload: new Uint8Array(IDL.encode([type], [value])) }); }
async function install(pic, sender, id) {
  const bytes = fs.readFileSync(wasm), chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 1_000_000) {
    const chunk = new Uint8Array(bytes.subarray(offset, Math.min(offset + 1_000_000, bytes.length)));
    await mgmt(pic, sender, "upload_chunk", Upload, { canister_id: id, chunk });
    chunks.push({ hash: new Uint8Array(crypto.createHash("sha256").update(chunk).digest()) });
  }
  await mgmt(pic, sender, "install_chunked_code", Install, { arg: new Uint8Array(), chunk_hashes_list: chunks, mode: { install: null }, sender_canister_version: [], store_canister: [], canister_id: id, target_canister: id, wasm_module_hash: new Uint8Array(crypto.createHash("sha256").update(bytes).digest()) });
}
async function scenario(pic, installer, name, count) {
  const id = await pic.createCanister({ sender: installer, controllers: [installer] });
  await install(pic, installer, id);
  const actor = pic.createActor(idl, id);
  actor.setPrincipal(installer);
  const tooLong = { logicalId: "x".repeat(513), cycleId: "capacity-rejection", operationName: "publish", desiredVersion: 1n, contentHash: hash(250) };
  expect(await actor.writeReceipt(tooLong), "blocked", `${name} rejects over-limit logical ID`);
  let encodedInputBytes = 0;
  for (let n = 0; n < count; n += 1) {
    const receipt = { logicalId: `workflow-completion:v1:capacity:${name}:${n}`, cycleId: `capacity-cycle:${name}:${n}`, operationName: "publish-result", desiredVersion: 1n, contentHash: hash(n) };
    encodedInputBytes += IDL.encode([Input], [receipt]).byteLength;
    expect(await actor.writeReceipt(receipt), "acknowledged", `${name} receipt ${n}`);
    expect(await actor.writeReceipt(receipt), "acknowledged", `${name} exact retry ${n}`);
  }
  return { name, receiptWrites: count, exactRetries: count, encodedInputBytes };
}
async function main() {
  const server = await PocketIcServer.start({ binPath: bin, ttl: 60, showRuntimeLogs: false, showCanisterLogs: false });
  const pic = await PocketIc.create(server.getUrl());
  try {
    const installer = Principal.fromUint8Array(Uint8Array.of(4, 1));
    const scenarios = [await scenario(pic, installer, "expected", 16), await scenario(pic, installer, "two_x", 32)];
    const report = { schemaVersion: 1, component: "M1 consolidated application embedded workflow receipt capacity proof", emulator: "PocketIC synthetic-only", scenarios, rejection: { logicalIdBytes: 513, result: "rejected before a private collection insert" }, limitations: ["This measures bounded synthetic collection ingress only; it is not a production instruction or cycle budget.", "No workflow implementation, application public method, caller authorization policy, provider response, target data, or deployment is involved."] };
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    console.log(JSON.stringify(report));
  } finally { await pic.tearDown(); await server.stop(); }
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
