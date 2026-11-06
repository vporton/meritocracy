/*
 * Local-only M1 proof. No wallet, production identity, data, network, or
 * funded account is used. PocketIC receives deterministic synthetic principals
 * and the exact Wasm built from the lock-pinned Motoko toolchain.
 */
const { chmodSync, copyFileSync, existsSync, mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { createRequire } = require("node:module");
const { execFileSync } = require("node:child_process");

const root = join(__dirname, "..", "..");
const pocketIcPackage = join(root, "tools", "m1-pocketic", "package.json");
if (!existsSync(pocketIcPackage)) {
  throw new Error("missing local PocketIC tooling manifest; restore tools/m1-pocketic/package.json");
}
const pocketIcRequire = createRequire(pocketIcPackage);
let IDL;
let AnonymousIdentity;
let PocketIc;
let PocketIcServer;
let createIdentity;
try {
  ({ IDL } = pocketIcRequire("@icp-sdk/core/candid"));
  ({ AnonymousIdentity } = pocketIcRequire("@icp-sdk/core/agent"));
  ({ PocketIc, PocketIcServer, createIdentity } = pocketIcRequire("@dfinity/pic"));
} catch (error) {
  throw new Error("M1 PocketIC tooling is not installed; run npm run install:m1-pocketic-tooling", { cause: error });
}
const wasm = join(root, ".mops", ".build", "private_store_recovery_fixture.wasm");
const oldWasm = join(root, ".mops", ".build", "private_store_recovery_v1_fixture.wasm");
const attackerWasm = join(root, ".mops", ".build", "private_store_attacker_fixture.wasm");
function pinnedPocketIcPath() {
  if (process.env.M1_POCKETIC_BIN) return process.env.M1_POCKETIC_BIN;
  return execFileSync("mops", ["toolchain", "bin", "pocket-ic"], { encoding: "utf8" }).trim();
}

const idlFactory = ({ IDL: FactoryIDL }) => {
  const putResult = FactoryIDL.Variant({ inserted: FactoryIDL.Null, duplicate: FactoryIDL.Null });
  const result = FactoryIDL.Variant({ ok: putResult, err: FactoryIDL.Text });
  const hashResult = FactoryIDL.Variant({ ok: FactoryIDL.Opt(FactoryIDL.Vec(FactoryIDL.Nat8)), err: FactoryIDL.Text });
  const countResult = FactoryIDL.Variant({ ok: FactoryIDL.Nat, err: FactoryIDL.Text });
  return FactoryIDL.Service({
    putBounded: FactoryIDL.Func([FactoryIDL.Text, FactoryIDL.Vec(FactoryIDL.Nat8)], [result], []),
    lookupHash: FactoryIDL.Func([FactoryIDL.Text], [hashResult], ["query"]),
    entryCount: FactoryIDL.Func([], [countResult], ["query"]),
  });
};
const attackerIdlFactory = ({ IDL: FactoryIDL }) => {
  const putResult = FactoryIDL.Variant({ inserted: FactoryIDL.Null, duplicate: FactoryIDL.Null });
  const result = FactoryIDL.Variant({ ok: putResult, err: FactoryIDL.Text });
  return FactoryIDL.Service({ attempt: FactoryIDL.Func([FactoryIDL.Principal], [result], []) });
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  assert(existsSync(wasm) && existsSync(oldWasm) && existsSync(attackerWasm), "missing fixture Wasm; run mops build private_store_recovery_fixture private_store_recovery_v1_fixture private_store_attacker_fixture first");
  const pinnedPocketIc = pinnedPocketIcPath();
  assert(existsSync(pinnedPocketIc), "missing Mops-pinned PocketIC binary");
  assert(execFileSync(pinnedPocketIc, ["--version"], { encoding: "utf8" }).trim() === "pocket-ic-server 12.0.0", "PocketIC version does not match mops.toml");

  const owner = createIdentity("m1-private-store-owner-synthetic-only");
  // These principals model the callers that must never gain a storage path:
  // a browser/user, a migration-import operator, and an unrelated service.
  // They are distinct deterministic synthetic identities, never real keys.
  const browserUser = createIdentity("m1-private-store-browser-user-synthetic-only");
  const importOperator = createIdentity("m1-private-store-import-operator-synthetic-only");
  const unrelatedService = createIdentity("m1-private-store-unrelated-service-synthetic-only");
  const ownerPrincipal = owner.getPrincipal();
  // pic-ic validates its binary with chmod. The Mops cache is intentionally
  // read-only, so use a byte-identical disposable copy and remove it on exit.
  const binDir = mkdtempSync(join(tmpdir(), "meritocracy-pocketic-"));
  const pocketIc = join(binDir, "pocket-ic");
  copyFileSync(pinnedPocketIc, pocketIc);
  chmodSync(pocketIc, 0o700);
  let server;
  let pic;
  try {
    server = await PocketIcServer.start({ binPath: pocketIc, ttl: 60, showRuntimeLogs: false, showCanisterLogs: false });
    pic = await PocketIc.create(server.getUrl());
    const canisterId = await pic.createCanister({ sender: ownerPrincipal, controllers: [ownerPrincipal], cycles: 2_000_000_000_000n });
    const init = IDL.encode([IDL.Principal], [ownerPrincipal]);
    await pic.installCode({ canisterId, sender: ownerPrincipal, wasm: oldWasm, arg: init });
    const actor = pic.createActor({ idlFactory, canisterId });
    const attackerId = await pic.createCanister({ sender: ownerPrincipal, controllers: [ownerPrincipal], cycles: 2_000_000_000_000n });
    await pic.installCode({ canisterId: attackerId, sender: ownerPrincipal, wasm: attackerWasm, arg: IDL.encode([], []) });
    const attacker = pic.createActor({ canisterId: attackerId, idlFactory: attackerIdlFactory });
    const assertDenied = async (identity, label) => {
      actor.setIdentity(identity);
      assert("err" in await actor.putBounded("migration-receipt:v1:unauthorized", Uint8Array.of(1)), `${label} mutation was accepted`);
      assert("err" in await actor.lookupHash("migration-receipt:v1:unauthorized"), `${label} hash lookup was accepted`);
      assert("err" in await actor.entryCount(), `${label} count lookup was accepted`);
    };
    // The fixture has a fixed internal collection and exposes no collection,
    // role, or raw-payload API. Every direct ingress class is denied before
    // it can cause a mutation or observe private-store metadata.
    await assertDenied(new AnonymousIdentity(), "anonymous ingress");
    await assertDenied(browserUser, "browser/user ingress");
    await assertDenied(importOperator, "import-operator ingress");
    await assertDenied(unrelatedService, "unrelated-service ingress");
    attacker.setIdentity(owner);
    assert("err" in await attacker.attempt(canisterId), "unrelated canister mutation was accepted");

    actor.setIdentity(owner);
    const logicalId = "migration-receipt:v1:exact-upgrade";
    const payload = Uint8Array.from([3, 1, 4, 1, 5, 9]);
    assert("inserted" in (await actor.putBounded(logicalId, payload)).ok, "initial insert was not acknowledged");
    const before = await actor.lookupHash(logicalId);
    assert("ok" in before && before.ok.length === 1, "pre-upgrade hash is absent");
    await pic.upgradeCanister({
      canisterId,
      sender: ownerPrincipal,
      wasm,
      arg: init,
      upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] },
    });
    // The new actor refuses an unmigrated v1 layout until this owner-only
    // mutation performs the explicit checkpoint. The same logical record
    // must become a duplicate, never a second entry or a conflict.
    assert("duplicate" in (await actor.putBounded(logicalId, payload)).ok, "v1-to-v2 migration did not preserve duplicate semantics");
    const after = await actor.lookupHash(logicalId);
    assert("ok" in after && after.ok.length === 1, "post-upgrade hash is absent");
    assert(Buffer.from(before.ok[0]).equals(Buffer.from(after.ok[0])), "exact upgrade changed the durable hash");
    const count = await actor.entryCount();
    assert("ok" in count && count.ok === 1n, "upgrade or retry changed entry count");
    await assertDenied(new AnonymousIdentity(), "anonymous ingress after upgrade");
    await assertDenied(browserUser, "browser/user ingress after upgrade");
    await assertDenied(importOperator, "import-operator ingress after upgrade");
    await assertDenied(unrelatedService, "unrelated-service ingress after upgrade");
    console.log("private-store v1-to-v2 upgrade PocketIC proof passed");
  } finally {
    if (pic) await pic.tearDown();
    if (server) await server.stop();
    rmSync(binDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
