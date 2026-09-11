#!/usr/bin/env node
// Synthetic-only PocketIC execution proof for the two fixed M1 adapter
// collections. This process accepts just a pinned binary and fixture Wasm.
const path = require("node:path");
const picMopsRoot = path.resolve(__dirname, "../../node_modules/ic-mops/node_modules/pic-js-mops");
const coreRoot = path.resolve(__dirname, "../../node_modules/ic-mops/node_modules/@icp-sdk/core");
const { PocketIc, PocketIcServer } = require(picMopsRoot);
const { IDL } = require(path.join(coreRoot, "lib/cjs/candid/index.js"));
const { Principal } = require(path.join(coreRoot, "lib/cjs/principal/index.js"));

const [pocketIcBin, wasm] = process.argv.slice(2);
if (!pocketIcBin || !wasm) throw new Error("Expected PocketIC binary and embedded identity/role fixture Wasm");

const Hash = IDL.Vec(IDL.Nat8);
const Factor = IDL.Variant({ internetIdentity: IDL.Null, oauth: IDL.Null });
const Binding = IDL.Record({ logicalId: IDL.Text, contentHash: Hash, userId: IDL.Nat64, principal: IDL.Principal, factor: Factor, provider: IDL.Opt(IDL.Text), subjectHash: IDL.Opt(Hash) });
const Role = IDL.Record({ logicalId: IDL.Text, contentHash: Hash, principal: IDL.Principal, role: IDL.Text });
const Result = IDL.Variant({ acknowledged: IDL.Null, blocked: IDL.Null, conflict: IDL.Null, storageError: IDL.Null });
const idl = ({ IDL: Candid }) => Candid.Service({
  writeBinding: Candid.Func([Binding], [Result], []),
  writeRole: Candid.Func([Role], [Result], []),
});
const hash = (byte) => Uint8Array.from({ length: 32 }, () => byte);
function expect(actual, key, label) {
  if (Object.keys(actual).length !== 1 || !(key in actual)) throw new Error(`${label}: expected ${key}, got ${JSON.stringify(actual)}`);
}

async function main() {
  const server = await PocketIcServer.start({ binPath: pocketIcBin, ttl: 60, showRuntimeLogs: false, showCanisterLogs: false });
  const pic = await PocketIc.create(server.getUrl());
  try {
    const bootstrap = Principal.fromUint8Array(Uint8Array.of(1, 1));
    const subject = Principal.fromUint8Array(Uint8Array.of(1, 42));
    const canisterId = await pic.createCanister({ sender: bootstrap, controllers: [bootstrap] });
    await pic.installCode({ canisterId, sender: bootstrap, wasm, arg: new Uint8Array() });
    const actor = pic.createActor(idl, canisterId);
    actor.setPrincipal(bootstrap);
    const binding = { logicalId: "principal-binding:v1:synthetic-42", contentHash: hash(1), userId: 42n, principal: subject, factor: { internetIdentity: null }, provider: [], subjectHash: [] };
    const role = { logicalId: "role-assignment:v1:synthetic-42:auditor", contentHash: hash(2), principal: subject, role: "auditor" };
    expect(await actor.writeBinding(binding), "acknowledged", "initial binding write");
    expect(await actor.writeBinding(binding), "acknowledged", "exact binding retry");
    expect(await actor.writeBinding({ ...binding, contentHash: hash(3) }), "conflict", "binding hash conflict");
    expect(await actor.writeRole(role), "acknowledged", "initial role write");
    expect(await actor.writeRole(role), "acknowledged", "exact role retry");
    expect(await actor.writeRole({ ...role, contentHash: hash(4) }), "conflict", "role hash conflict");
    expect(await actor.writeRole({ ...role, logicalId: "bad\nlogical-id" }), "blocked", "malformed role rejected");
    expect(await actor.writeBinding({ ...binding, principal: Principal.anonymous() }), "blocked", "anonymous identity rejected");
  } finally {
    await pic.tearDown();
    await server.stop();
  }
}
main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
