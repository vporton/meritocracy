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

const [pocketIcBin, authorityWasm, coreWasm] = process.argv.slice(2);
if (!pocketIcBin || !authorityWasm || !coreWasm) throw new Error("Expected PocketIC binary, authority Wasm, and core Wasm");

const Hash = IDL.Vec(IDL.Nat8);
const Factor = IDL.Variant({ internetIdentity: IDL.Null, oauth: IDL.Null });
const Config = IDL.Record({ core: IDL.Principal, workflow: IDL.Principal, treasury: IDL.Principal, archive: IDL.Principal, evidence: IDL.Principal, governance: IDL.Principal });
const Binding = IDL.Record({ logicalId: IDL.Text, desiredVersion: IDL.Nat64, contentHash: Hash, userId: IDL.Nat64, principal: IDL.Principal, factor: Factor, provider: IDL.Opt(IDL.Text), subjectHash: IDL.Opt(Hash) });
const WriteResult = IDL.Variant({ acknowledged: IDL.Null, blocked: IDL.Null, conflict: IDL.Null, storageError: IDL.Null });
const Observation = IDL.Variant({ absent: IDL.Null, present: IDL.Record({ version: IDL.Nat64, contentHash: Hash }), conflict: IDL.Null, storageError: IDL.Null });
const Recovery = IDL.Variant({ acknowledge: IDL.Null, retryIdentical: IDL.Null, conflict: IDL.Null, blocked: IDL.Null });
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
const authorityIdl = ({ IDL: Candid }) => Candid.Service({
  writeCorePrincipalBinding: Candid.Func([Binding], [WriteResult], []),
  lookupCorePrincipalBinding: Candid.Func([Candid.Text], [Observation], []),
});
const coreIdl = ({ IDL: Candid }) => Candid.Service({
  writeThenLoseReply: Candid.Func([Binding], [], []),
  journalThenTrapBeforeAwait: Candid.Func([Binding], [], []),
  retryJournaledWriteThenLoseReply: Candid.Func([], [], []),
  reconcileLostReply: Candid.Func([], [Recovery], []),
});
const hash = (byte) => Uint8Array.from({ length: 32 }, () => byte);
function expect(actual, key, label) {
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
    const coreId = await pic.createCanister({ sender: installer, controllers: [installer] });
    const authorityConfig = { core: coreId, workflow, treasury, archive, evidence, governance };
    await install(pic, installer, authorityId, authorityWasm, IDL.encode([Config], [authorityConfig]));
    await install(pic, installer, coreId, coreWasm, IDL.encode([IDL.Principal, IDL.Principal], [operator, authorityId]));
    const authority = pic.createActor(authorityIdl, authorityId);
    authority.setPrincipal(outsider);
    const binding = { logicalId: "principal-binding:v1:synthetic-44", desiredVersion: 1n, contentHash: hash(7), userId: 44n, principal: subject, factor: { internetIdentity: null }, provider: [], subjectHash: [] };
    expect(await authority.writeCorePrincipalBinding(binding), "blocked", "direct authority write denied");
    expect(await authority.lookupCorePrincipalBinding(binding.logicalId), "conflict", "direct authority lookup denied");
    const core = pic.createActor(coreIdl, coreId);
    core.setPrincipal(outsider);
    await expectReject(() => core.reconcileLostReply(), "non-operator core ingress denied");
    core.setPrincipal(operator);
    await expectReject(() => core.writeThenLoseReply(binding), "deliberately lost authority reply");
    // Upgrade the authority after its successful write but before the core
    // can reconcile. The fixed collection must reopen its retained record;
    // recreating it or losing it turns the later exact lookup into a failure.
    await install(pic, installer, authorityId, authorityWasm, IDL.encode([Config], [authorityConfig]), { upgrade: [{ skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }] });
    authority.setPrincipal(outsider);
    expect(await authority.writeCorePrincipalBinding(binding), "blocked", "direct authority write denied after upgrade");
    expect(await authority.lookupCorePrincipalBinding(binding.logicalId), "conflict", "direct authority lookup denied after upgrade");
    // Upgrade the core before recovery: the durable pre-await intent must
    // also survive independently from the authority's retained collection.
    await install(pic, installer, coreId, coreWasm, IDL.encode([IDL.Principal, IDL.Principal], [operator, authorityId]), { upgrade: [{ skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }] });
    expect(await core.reconcileLostReply(), "acknowledge", "exact lost-reply reconciliation after upgrade");
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
    await install(pic, installer, coreId, coreWasm, IDL.encode([IDL.Principal, IDL.Principal], [operator, authorityId]), { upgrade: [{ skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }] });
    expect(await core.reconcileLostReply(), "retryIdentical", "absent interrupted write requires identical retry");
    await expectReject(() => core.retryJournaledWriteThenLoseReply(), "deliberately lost journaled retry reply");
    expect(await core.reconcileLostReply(), "acknowledge", "journaled retry reconciliation");
    // `acknowledge` is reachable only when the authority's fixed core-only
    // lookup returned the exact persisted version/hash, both after an EOP
    // upgrade and after duplicate delivery. The runner never impersonates a
    // canister principal through direct ingress.
  } finally { await pic.tearDown(); await server.stop(); }
}
main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
