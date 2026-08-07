#!/usr/bin/env node
// Identity-free M1 boundary harness. It is intentionally a separate process
// from the shell compiler runner so it receives only exact Wasm paths and the
// pinned PocketIC binary. It never loads DFX configuration or any wallet.
const path = require("node:path");
const fs = require("node:fs");
const picMopsRoot = path.resolve(__dirname, "../../node_modules/ic-mops/node_modules/pic-js-mops");
const coreRoot = path.resolve(__dirname, "../../node_modules/ic-mops/node_modules/@icp-sdk/core");
const { PocketIc, PocketIcServer } = require(picMopsRoot);
const { IDL } = require(path.join(coreRoot, "lib/cjs/candid/index.js"));
const { Principal } = require(path.join(coreRoot, "lib/cjs/principal/index.js"));

const [pocketIcBin, authorityWasm, callerWasm] = process.argv.slice(2);
if (!pocketIcBin || !authorityWasm || !callerWasm) {
  throw new Error("Expected PocketIC binary, storage-authority Wasm, and caller Wasm paths");
}

const principal = (value) => Principal.fromUint8Array(Uint8Array.of(1, value));
const bootstrap = principal(1);
const externalUnrelated = principal(2);
const replacement = {
  core: principal(10),
  workflow: principal(11),
  treasury: principal(12),
  archive: principal(13),
  evidence: principal(14),
  governance: principal(15),
};
const logicalId = "meritocracy-legacy-logical-id-v1:users:sha256:0123456789abcdef";

const ProbeResult = IDL.Variant({
  allowed: IDL.Null,
  anonymousCaller: IDL.Null,
  callerNotAllowed: IDL.Null,
  invalidConfiguration: IDL.Null,
  malformedLogicalId: IDL.Null,
});
const PolicyAudit = IDL.Record({
  archive: IDL.Principal,
  core: IDL.Principal,
  evidence: IDL.Principal,
  governance: IDL.Principal,
  treasury: IDL.Principal,
  workflow: IDL.Principal,
});
const Config = PolicyAudit;
const collections = [
  ["coreUser", "core"], ["corePrincipalBinding", "core"], ["coreProfile", "core"],
  ["coreEmailEvidence", "core"], ["corePayoutDestination", "core"], ["coreHold", "core"],
  ["coreRoleAssignment", "core"], ["coreBanVote", "core"],
  ["workflowResult", "workflow"], ["workflowResultSource", "workflow"],
  ["workflowSchedule", "workflow"], ["workflowCompletionReceipt", "workflow"],
  ["treasuryObligation", "treasury"], ["treasuryPaymentOperation", "treasury"],
  ["treasuryJournal", "treasury"], ["treasuryChainReceipt", "treasury"],
  ["migrationReceipt", "archive"], ["migrationEvidence", "archive"], ["aiArtifact", "archive"],
  ["evidenceKyc", "evidence"],
];
const operationNames = Object.fromEntries(
  collections.flatMap(([collection]) => [[`${collection}Read`, IDL.Null], [`${collection}Write`, IDL.Null]]),
);
const DataOperation = IDL.Variant(operationNames);
const authorityIdl = ({ IDL: Candid }) => {
  const methods = { policyAudit: Candid.Func([], [Candid.Opt(PolicyAudit)], []) };
  for (const [collection] of collections) {
    methods[`${collection}ReadProbe`] = Candid.Func([Candid.Text], [ProbeResult], []);
    methods[`${collection}WriteProbe`] = Candid.Func([Candid.Text], [ProbeResult], []);
  }
  return Candid.Service(methods);
};
const callerIdl = ({ IDL: Candid }) => Candid.Service({
  audit: Candid.Func([], [Candid.Opt(PolicyAudit)], []),
  data: Candid.Func([DataOperation, Candid.Text], [ProbeResult], []),
});
// PocketIC 12 requires this EOP upgrade option. The Mops-pinned Pic client
// predates that optional management field, so encode this one management call
// locally rather than downgrading the persistent actor or using DFX.
const ManagementInstallCode = IDL.Record({
  arg: IDL.Vec(IDL.Nat8),
  canister_id: IDL.Principal,
  mode: IDL.Variant({
    install: IDL.Null,
    reinstall: IDL.Null,
    upgrade: IDL.Opt(IDL.Record({
      skip_pre_upgrade: IDL.Opt(IDL.Bool),
      wasm_memory_persistence: IDL.Opt(IDL.Variant({ keep: IDL.Null, replace: IDL.Null })),
    })),
  }),
  sender_canister_version: IDL.Opt(IDL.Nat64),
  wasm_module: IDL.Vec(IDL.Nat8),
});

function expectDecision(actual, expected, label) {
  const keys = Object.keys(actual);
  if (keys.length !== 1 || keys[0] !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${JSON.stringify(actual)}`);
  }
}

function expectAudit(actual, expected, label) {
  if (actual.length !== 1) throw new Error(`${label}: expected a governance audit record`);
  for (const [field, value] of Object.entries(expected)) {
    if (actual[0][field].toText() !== value.toText()) {
      throw new Error(`${label}: ${field} did not match the persisted caller matrix`);
    }
  }
}

async function createCanister(pic) {
  return pic.createCanister({ sender: bootstrap, controllers: [bootstrap] });
}

async function upgradeEopCanister(pic, canisterId, arg) {
  const payload = IDL.encode([ManagementInstallCode], [{
    arg: new Uint8Array(arg),
    canister_id: canisterId,
    mode: {
      upgrade: [{
        skip_pre_upgrade: [],
        wasm_memory_persistence: [{ keep: null }],
      }],
    },
    sender_canister_version: [],
    wasm_module: new Uint8Array(fs.readFileSync(authorityWasm)),
  }]);
  await pic.client.updateCall({
    canisterId: Principal.fromText("aaaaa-aa"),
    sender: bootstrap,
    method: "install_code",
    payload: new Uint8Array(payload),
  });
}

async function main() {
  const server = await PocketIcServer.start({
    binPath: pocketIcBin,
    ttl: 60,
    showRuntimeLogs: false,
    showCanisterLogs: false,
  });
  const pic = await PocketIc.create(server.getUrl());
  try {
    const authorityId = await createCanister(pic);
    const ownerIds = {};
    for (const owner of ["core", "workflow", "treasury", "archive", "evidence", "governance", "unrelated"]) {
      ownerIds[owner] = await createCanister(pic);
      await pic.installCode({
        canisterId: ownerIds[owner],
        sender: bootstrap,
        wasm: callerWasm,
        arg: IDL.encode([IDL.Principal], [authorityId]),
      });
    }
    const initial = {
      core: ownerIds.core,
      workflow: ownerIds.workflow,
      treasury: ownerIds.treasury,
      archive: ownerIds.archive,
      evidence: ownerIds.evidence,
      governance: ownerIds.governance,
    };
    await pic.installCode({
      canisterId: authorityId,
      sender: bootstrap,
      wasm: authorityWasm,
      arg: IDL.encode([Config], [initial]),
    });

    const authority = pic.createActor(authorityIdl, authorityId);
    authority.setPrincipal(Principal.anonymous());
    expectDecision(await authority.coreUserReadProbe(logicalId), "anonymousCaller", "anonymous direct ingress");
    authority.setPrincipal(bootstrap);
    expectDecision(await authority.coreUserReadProbe(logicalId), "callerNotAllowed", "bootstrap direct ingress");
    authority.setPrincipal(externalUnrelated);
    expectDecision(await authority.coreUserReadProbe(logicalId), "callerNotAllowed", "unrelated direct ingress");

    const callers = {};
    for (const owner of Object.keys(ownerIds)) callers[owner] = pic.createActor(callerIdl, ownerIds[owner]);
    for (const actor of Object.values(callers)) actor.setPrincipal(bootstrap);
    for (const [collection, owner] of collections) {
      expectDecision(await callers[owner].data({ [`${collection}Read`]: null }, logicalId), "allowed", `${collection} inter-canister read`);
      expectDecision(await callers[owner].data({ [`${collection}Write`]: null }, logicalId), "allowed", `${collection} inter-canister write`);
    }
    expectDecision(await callers.core.data({ coreUserRead: null }, "bad\nlogical-id"), "malformedLogicalId", "malformed logical ID");
    expectDecision(await callers.workflow.data({ coreUserRead: null }, logicalId), "callerNotAllowed", "cross-owner collection");
    expectDecision(await callers.unrelated.data({ coreUserRead: null }, logicalId), "callerNotAllowed", "unrelated canister");
    expectDecision(await callers.governance.data({ coreUserRead: null }, logicalId), "callerNotAllowed", "governance as data caller");
    if ((await callers.core.audit()).length !== 0) throw new Error("core caller received a governance audit");
    expectAudit(await callers.governance.audit(), initial, "governance audit before upgrade");

    await upgradeEopCanister(pic, authorityId, IDL.encode([Config], [replacement]));
    expectDecision(await callers.core.data({ coreUserRead: null }, logicalId), "allowed", "core after upgrade");
    expectDecision(await callers.treasury.data({ treasuryJournalWrite: null }, logicalId), "allowed", "treasury after upgrade");
    expectDecision(await callers.governance.data({ coreUserRead: null }, logicalId), "callerNotAllowed", "governance after upgrade");
    expectAudit(await callers.governance.audit(), initial, "governance audit after upgrade");
    authority.setPrincipal(replacement.core);
    expectDecision(await authority.coreUserReadProbe(logicalId), "callerNotAllowed", "replacement matrix rejected after upgrade");
  } finally {
    await pic.tearDown();
    await server.stop();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
