/*
 * Local-only M1 proof of the precise inter-canister interruption boundary.
 * No provider, asset, database, or non-synthetic principal is used.
 */
const { chmodSync, copyFileSync, existsSync, mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { createRequire } = require("node:module");
const { execFileSync } = require("node:child_process");

const root = join(__dirname, "..", "..");
const pocketIcPackage = join(root, "tools", "m1-pocketic", "package.json");
if (!existsSync(pocketIcPackage)) throw new Error("missing local PocketIC tooling manifest");
const requirePocketIc = createRequire(pocketIcPackage);
let IDL; let PocketIc; let PocketIcServer; let createIdentity;
try {
  ({ IDL } = requirePocketIc("@icp-sdk/core/candid"));
  ({ PocketIc, PocketIcServer, createIdentity } = requirePocketIc("@dfinity/pic"));
} catch (error) {
  throw new Error("M1 PocketIC tooling is not installed; run npm run install:m1-pocketic-tooling", { cause: error });
}

const remoteWasm = join(root, ".mops", ".build", "durable_journal_remote_fixture.wasm");
const recoveryWasm = join(root, ".mops", ".build", "durable_journal_recovery_fixture.wasm");
function assert(condition, message) { if (!condition) throw new Error(message); }
function pinnedPocketIcPath() {
  if (process.env.M1_POCKETIC_BIN) return process.env.M1_POCKETIC_BIN;
  return execFileSync("mops", ["toolchain", "bin", "pocket-ic"], { encoding: "utf8" }).trim();
}

const remoteIdl = ({ IDL: I }) => {
  const result = I.Variant({ ok: I.Null, err: I.Text });
  return I.Service({ write: I.Func([I.Text, I.Vec(I.Nat8)], [result], []) });
};
const recoveryIdl = ({ IDL: I }) => {
  const emptyResult = I.Variant({ ok: I.Null, err: I.Text });
  const reconcileResult = I.Variant({ retryIdentical: I.Null, acknowledged: I.Null });
  const result = I.Variant({ ok: reconcileResult, err: I.Text });
  const boolResult = I.Variant({ ok: I.Bool, err: I.Text });
  return I.Service({
    commitThenCrash: I.Func([I.Text, I.Text, I.Vec(I.Nat8)], [emptyResult], []),
    reconcile: I.Func([I.Text], [result], []),
    isAcknowledged: I.Func([I.Text], [boolResult], ["query"]),
  });
};

async function main() {
  assert(existsSync(remoteWasm) && existsSync(recoveryWasm), "missing fixture Wasm; run mops build durable_journal_remote_fixture durable_journal_recovery_fixture first");
  const pinned = pinnedPocketIcPath();
  assert(existsSync(pinned), "missing Mops-pinned PocketIC binary");
  assert(execFileSync(pinned, ["--version"], { encoding: "utf8" }).trim() === "pocket-ic-server 12.0.0", "PocketIC version mismatch");
  const owner = createIdentity("m1-durable-journal-owner-synthetic-only");
  const attacker = createIdentity("m1-durable-journal-attacker-synthetic-only");
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "meritocracy-pocketic-"));
  const binary = join(temporaryDirectory, "pocket-ic");
  copyFileSync(pinned, binary); chmodSync(binary, 0o700);
  let server; let pic;
  try {
    server = await PocketIcServer.start({ binPath: binary, ttl: 60, showRuntimeLogs: false, showCanisterLogs: false });
    pic = await PocketIc.create(server.getUrl());
    const ownerPrincipal = owner.getPrincipal();
    // The remote trusts only the recovery actor. No user principal can mutate
    // or inspect it directly, ensuring reconciliation is the only test path.
    const recoveryId = await pic.createCanister({ sender: ownerPrincipal, controllers: [ownerPrincipal], cycles: 2_000_000_000_000n });
    const remoteId = await pic.createCanister({ sender: ownerPrincipal, controllers: [ownerPrincipal], cycles: 2_000_000_000_000n });
    await pic.installCode({ canisterId: remoteId, sender: ownerPrincipal, wasm: remoteWasm, arg: IDL.encode([IDL.Principal], [recoveryId]) });
    await pic.installCode({ canisterId: recoveryId, sender: ownerPrincipal, wasm: recoveryWasm, arg: IDL.encode([IDL.Principal, IDL.Principal], [ownerPrincipal, remoteId]) });
    const recovery = pic.createActor({ canisterId: recoveryId, idlFactory: recoveryIdl });
    const remote = pic.createActor({ canisterId: remoteId, idlFactory: remoteIdl });
    recovery.setIdentity(attacker);
    assert("err" in await recovery.commitThenCrash("payment:v1:op", "payment:v1:logical", Uint8Array.from({ length: 32 }, () => 7)), "unrelated principal could mutate recovery fixture");
    remote.setIdentity(owner);
    assert("err" in await remote.write("payment:v1:op", Uint8Array.from({ length: 32 }, () => 7)), "direct user could mutate remote fixture");
    recovery.setIdentity(owner);
    const operationId = "payment:v1:crash-after-remote-commit";
    const hash = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    let crashed = false;
    try { await recovery.commitThenCrash(operationId, "payment:v1:logical", hash); } catch { crashed = true; }
    assert(crashed, "fixture did not trap after remote acknowledgement");
    const pending = await recovery.isAcknowledged(operationId);
    assert("ok" in pending && pending.ok === false, "trapped call made intent authoritative");
    const reconciled = await recovery.reconcile(operationId);
    assert("ok" in reconciled && "acknowledged" in reconciled.ok, "recovery did not reconcile exact remote operation/hash");
    const acknowledged = await recovery.isAcknowledged(operationId);
    assert("ok" in acknowledged && acknowledged.ok === true, "matching remote result did not durably acknowledge intent");
    const repeated = await recovery.reconcile(operationId);
    assert("ok" in repeated && "acknowledged" in repeated.ok, "duplicate reconciliation was not idempotent");
    console.log("durable-journal crash/recovery PocketIC proof passed");
  } finally {
    if (pic) await pic.tearDown();
    if (server) await server.stop();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
