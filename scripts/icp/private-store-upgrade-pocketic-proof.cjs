/*
 * Local-only M1 proof. No wallet, production identity, data, network, or
 * funded account is used. PocketIC receives deterministic synthetic principals
 * and the exact Wasm built from the lock-pinned Motoko toolchain.
 */
const { chmodSync, copyFileSync, existsSync, mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { IDL } = require("@icp-sdk/core/candid");
const { PocketIc, PocketIcServer, createIdentity } = require("@dfinity/pic");

const root = join(__dirname, "..", "..");
const wasm = join(root, ".mops", ".build", "private_store_recovery_fixture.wasm");
const pinnedPocketIc = "/home/porton/.cache/mops/pocket-ic/12.0.0/pocket-ic";

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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  assert(existsSync(wasm), "missing fixture Wasm; run mops build private_store_recovery_fixture first");
  assert(existsSync(pinnedPocketIc), "missing pinned PocketIC 12.0.0 binary");

  const owner = createIdentity("m1-private-store-owner-synthetic-only");
  const outsider = createIdentity("m1-private-store-outsider-synthetic-only");
  const ownerPrincipal = owner.getPrincipal();
  // pic-ic validates its binary with chmod. The Mops cache is intentionally
  // read-only, so use a byte-identical disposable copy and remove it on exit.
  const binDir = mkdtempSync(join(tmpdir(), "meritocracy-pocketic-"));
  const pocketIc = join(binDir, "pocket-ic");
  copyFileSync(pinnedPocketIc, pocketIc);
  chmodSync(pocketIc, 0o700);
  const server = await PocketIcServer.start({ binPath: pocketIc, ttl: 60, showRuntimeLogs: false, showCanisterLogs: false });
  const pic = await PocketIc.create(server.getUrl());
  try {
    const canisterId = await pic.createCanister({ sender: ownerPrincipal, controllers: [ownerPrincipal], cycles: 2_000_000_000_000n });
    const init = IDL.encode([IDL.Principal], [ownerPrincipal]);
    await pic.installCode({ canisterId, sender: ownerPrincipal, wasm, arg: init });
    const actor = pic.createActor({ idlFactory, canisterId });
    actor.setIdentity(outsider);
    assert("err" in await actor.putBounded("migration-receipt:v1:unauthorized", Uint8Array.of(1)), "outsider mutation was accepted");
    assert("err" in await actor.lookupHash("migration-receipt:v1:unauthorized"), "outsider hash lookup was accepted");

    actor.setIdentity(owner);
    const logicalId = "migration-receipt:v1:exact-upgrade";
    const payload = Uint8Array.from([3, 1, 4, 1, 5, 9]);
    assert("inserted" in (await actor.putBounded(logicalId, payload)).ok, "initial insert was not acknowledged");
    const before = await actor.lookupHash(logicalId);
    assert("ok" in before && before.ok.length === 1, "pre-upgrade hash is absent");
    await pic.upgradeCanister({ canisterId, sender: ownerPrincipal, wasm, arg: init });
    const after = await actor.lookupHash(logicalId);
    assert("ok" in after && after.ok.length === 1, "post-upgrade hash is absent");
    assert(Buffer.from(before.ok[0]).equals(Buffer.from(after.ok[0])), "exact upgrade changed the durable hash");
    assert("duplicate" in (await actor.putBounded(logicalId, payload)).ok, "identical retry after upgrade was not a no-op");
    const count = await actor.entryCount();
    assert("ok" in count && count.ok === 1n, "upgrade or retry changed entry count");
    actor.setIdentity(outsider);
    assert("err" in await actor.entryCount(), "outsider observed private-store count after upgrade");
    console.log("private-store exact-upgrade PocketIC proof passed");
  } finally {
    await pic.tearDown();
    await server.stop();
    rmSync(binDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
