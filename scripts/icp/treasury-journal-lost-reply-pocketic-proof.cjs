#!/usr/bin/env node
// Synthetic M1 recovery proof: no account balance, signer, destination,
// transfer, asset movement, DFX identity, wallet, or external network.
const path = require("node:path"),
  fs = require("node:fs"),
  crypto = require("node:crypto");
const { PocketIc, PocketIcServer } = require(
  path.resolve(
    __dirname,
    "../../node_modules/ic-mops/node_modules/pic-js-mops",
  ),
);
const { IDL } = require(
  path.resolve(
    __dirname,
    "../../node_modules/ic-mops/node_modules/@icp-sdk/core/lib/cjs/candid/index.js",
  ),
);
const { Principal } = require(
  path.resolve(
    __dirname,
    "../../node_modules/ic-mops/node_modules/@icp-sdk/core/lib/cjs/principal/index.js",
  ),
);
const [bin, authorityWasm, fixtureWasm, archiveWasm] = process.argv.slice(2);
if (!bin || !authorityWasm || !fixtureWasm || !archiveWasm)
  throw new Error("Expected PocketIC binary, authority Wasm, fixture Wasm, and archive Wasm");
const P = IDL.Principal,
  Hash = IDL.Vec(IDL.Nat8),
  Direction = IDL.Variant({ debit: IDL.Null, credit: IDL.Null });
const Config = IDL.Record({
  core: P,
  workflow: P,
  treasury: P,
  archive: P,
  evidence: P,
  governance: P,
});
const Input = IDL.Record({
  logicalId: IDL.Text,
  journalSequence: IDL.Nat64,
  operationId: IDL.Text,
  accountId: IDL.Text,
  assetId: IDL.Text,
  direction: Direction,
  amountBaseUnits: IDL.Nat,
  assetDecimals: IDL.Nat8,
  desiredVersion: IDL.Nat64,
  contentHash: Hash,
});
const Write = IDL.Variant({
  acknowledged: IDL.Null,
  blocked: IDL.Null,
  conflict: IDL.Null,
  storageError: IDL.Null,
});
const Observation = IDL.Variant({
  absent: IDL.Null,
  present: IDL.Record({ version: IDL.Nat64, contentHash: Hash }),
  conflict: IDL.Null,
  storageError: IDL.Null,
});
const Recovery = IDL.Variant({
  acknowledge: IDL.Null,
  retryIdentical: IDL.Null,
  conflict: IDL.Null,
  blocked: IDL.Null,
});
const authorityIdl = ({ IDL: C }) =>
  C.Service({
    writeTreasuryJournalEntry: C.Func([Input], [Write], []),
    lookupTreasuryJournalEntry: C.Func([C.Text], [Observation], []),
  });
const BalancedSet = IDL.Record({
    logicalId: IDL.Text,
    entries: IDL.Vec(Input),
  }),
  Phase = IDL.Variant({
    pending: IDL.Null,
    active: IDL.Null,
    conflict: IDL.Null,
    blocked: IDL.Null,
  });
const FixtureArgs = [P, P, P, IDL.Opt(BalancedSet)];
const ArchiveTuple = IDL.Record({ logicalId: IDL.Text, version: IDL.Nat64, contentHash: Hash }),
  ArchiveDecision = IDL.Variant({ acknowledge: IDL.Null, remainPending: IDL.Null, blocked: IDL.Null }),
  ArchivePhase = IDL.Variant({ prepared: IDL.Null, archiveStarted: IDL.Null, pending: IDL.Null, acknowledged: IDL.Null, blocked: IDL.Null });
const fixtureIdl = ({ IDL: C }) =>
  C.Service({
    writeThenLoseReply: C.Func([Input], [], []),
    journalThenTrapBeforeAwait: C.Func([Input], [], []),
    reconcileLostReply: C.Func([], [Recovery], []),
    retryJournaledWriteThenLoseReply: C.Func([], [], []),
    repairJournaledEntry: C.Func([], [Recovery], []),
    prepareBalancedSet: C.Func([BalancedSet], [], []),
    journalBalancedEntryThenTrapBeforeAwait: C.Func([IDL.Nat], [], []),
    writeBalancedEntryThenLoseReply: C.Func([IDL.Nat], [], []),
    reconcileBalancedEntry: C.Func([IDL.Nat], [Recovery], []),
    retryBalancedEntryThenLoseReply: C.Func([IDL.Nat], [], []),
    repairBalancedEntry: C.Func([IDL.Nat], [Recovery], []),
    balancedPhase: C.Func([], [Phase], []),
    prepareBalancedArchive: C.Func([ArchiveTuple], [], []),
    balancedArchiveThenTrapBeforeAwait: C.Func([], [], []),
    archiveBalancedSetThenLoseReply: C.Func([], [], []),
    reconcileBalancedArchive: C.Func([], [ArchiveDecision], []),
    repairBalancedArchiveResume: C.Func([], [ArchiveDecision], []),
    balancedArchivePhase: C.Func([], [ArchivePhase], []),
  });
const archiveIdl = ({ IDL: C }) => C.Service({ permit: C.Func([], [], []), revoke: C.Func([], [], []) });
const Chunk = IDL.Record({ hash: Hash }),
  Upload = IDL.Record({ canister_id: P, chunk: Hash }),
  Install = IDL.Record({
    arg: Hash,
    chunk_hashes_list: IDL.Vec(Chunk),
    mode: IDL.Variant({
      install: IDL.Null,
      upgrade: IDL.Opt(
        IDL.Record({
          skip_pre_upgrade: IDL.Opt(IDL.Bool),
          wasm_memory_persistence: IDL.Opt(
            IDL.Variant({ keep: IDL.Null, replace: IDL.Null }),
          ),
        }),
      ),
    }),
    sender_canister_version: IDL.Opt(IDL.Nat64),
    store_canister: IDL.Opt(P),
    canister_id: P,
    target_canister: P,
    wasm_module_hash: Hash,
  }),
  management = Principal.fromText("aaaaa-aa");
// Below CycleReserve.minimumReserve (one trillion), but sufficient to install
// this disposable fixture. The proof replenishes only this synthetic canister.
const fixtureInstallationCycles = 900_000_000_000n;
const h = (n) => Uint8Array.from({ length: 32 }, () => n);
const entry = (id, sequence, hash, direction = { debit: null }) => ({
  logicalId: id,
  journalSequence: BigInt(sequence),
  operationId: "operation:synthetic",
  accountId: "treasury:synthetic",
  assetId: "ICP",
  direction,
  amountBaseUnits: 1n,
  assetDecimals: 8,
  desiredVersion: 1n,
  contentHash: h(hash),
});
function expect(value, tag, label) {
  if (Object.keys(value).length !== 1 || !(tag in value))
    throw new Error(`${label}: expected ${tag}`);
}
async function rejected(f, label) {
  try {
    await f();
  } catch (_) {
    return;
  }
  throw new Error(`${label}: expected rejected ingress`);
}
async function update(pic, sender, method, type, value) {
  return pic.client.updateCall({
    canisterId: management,
    sender,
    method,
    payload: new Uint8Array(IDL.encode([type], [value])),
  });
}
async function install(
  pic,
  sender,
  id,
  wasmPath,
  arg,
  mode = { install: null },
) {
  const wasm = fs.readFileSync(wasmPath),
    hashes = [];
  for (let offset = 0; offset < wasm.length; offset += 1_000_000) {
    const chunk = new Uint8Array(
      wasm.subarray(offset, Math.min(offset + 1_000_000, wasm.length)),
    );
    await update(pic, sender, "upload_chunk", Upload, {
      canister_id: id,
      chunk,
    });
    hashes.push({
      hash: new Uint8Array(crypto.createHash("sha256").update(chunk).digest()),
    });
  }
  await update(pic, sender, "install_chunked_code", Install, {
    arg: new Uint8Array(arg),
    chunk_hashes_list: hashes,
    mode,
    sender_canister_version: [],
    store_canister: [],
    canister_id: id,
    target_canister: id,
    wasm_module_hash: new Uint8Array(
      crypto.createHash("sha256").update(wasm).digest(),
    ),
  });
}
async function main() {
  const server = await PocketIcServer.start({
      binPath: bin,
      ttl: 60,
      showRuntimeLogs: false,
      showCanisterLogs: false,
    }),
    pic = await PocketIc.create(server.getUrl());
  try {
    const installer = Principal.fromUint8Array(Uint8Array.of(8, 1)),
      operator = Principal.fromUint8Array(Uint8Array.of(8, 2)),
      outsider = Principal.fromUint8Array(Uint8Array.of(8, 3));
    const authorityId = await pic.createCanister({
        sender: installer,
        controllers: [installer],
      }),
      fixtureId = await pic.createCanister({
        sender: installer,
        controllers: [installer],
        cycles: fixtureInstallationCycles,
      }),
      lowCycleAuthorityId = await pic.createCanister({
        sender: installer,
        controllers: [installer],
      }),
      lowCycleFixtureId = await pic.createCanister({
        sender: installer,
        controllers: [installer],
        cycles: fixtureInstallationCycles,
      }),
      archiveLowCycleFixtureId = await pic.createCanister({
        sender: installer,
        controllers: [installer],
        cycles: fixtureInstallationCycles,
      }),
      archiveId = await pic.createCanister({
        sender: installer,
        controllers: [installer],
      }),
      archiveLowCycleSinkId = await pic.createCanister({
        sender: installer,
        controllers: [installer],
      });
    const config = {
      core: Principal.fromUint8Array(Uint8Array.of(8, 4)),
      workflow: Principal.fromUint8Array(Uint8Array.of(8, 5)),
      treasury: fixtureId,
      archive: Principal.fromUint8Array(Uint8Array.of(8, 6)),
      evidence: Principal.fromUint8Array(Uint8Array.of(8, 7)),
      governance: Principal.fromUint8Array(Uint8Array.of(8, 8)),
    };
    const lowCycleConfig = { ...config, treasury: lowCycleFixtureId };
    await install(
      pic,
      installer,
      authorityId,
      authorityWasm,
      IDL.encode([Config], [config]),
    );
    await install(
      pic,
      installer,
      fixtureId,
      fixtureWasm,
      IDL.encode(FixtureArgs, [operator, authorityId, archiveId, []]),
    );
    await install(
      pic,
      installer,
      lowCycleAuthorityId,
      authorityWasm,
      IDL.encode([Config], [lowCycleConfig]),
    );
    await install(
      pic,
      installer,
      lowCycleFixtureId,
      fixtureWasm,
      IDL.encode(FixtureArgs, [operator, lowCycleAuthorityId, archiveId, []]),
    );
    const archiveLowCycleSet = {
      logicalId: "treasury-journal-set:v1:archive-low-cycle",
      entries: [
        entry("treasury-journal:v1:archive-low-cycle-debit", 1, 70),
        entry("treasury-journal:v1:archive-low-cycle-credit", 2, 71, { credit: null }),
      ],
    };
    await install(
      pic,
      installer,
      archiveLowCycleFixtureId,
      fixtureWasm,
      IDL.encode(FixtureArgs, [operator, lowCycleAuthorityId, archiveLowCycleSinkId, [archiveLowCycleSet]]),
    );
    await install(
      pic,
      installer,
      archiveId,
      archiveWasm,
      IDL.encode([P, P, P], [fixtureId, lowCycleFixtureId, operator]),
    );
    await install(
      pic,
      installer,
      archiveLowCycleSinkId,
      archiveWasm,
      IDL.encode([P, P, P], [archiveLowCycleFixtureId, fixtureId, operator]),
    );
    const authority = pic.createActor(authorityIdl, authorityId),
      fixture = pic.createActor(fixtureIdl, fixtureId),
      lowCycleAuthority = pic.createActor(authorityIdl, lowCycleAuthorityId),
      lowCycleFixture = pic.createActor(fixtureIdl, lowCycleFixtureId),
      archiveLowCycleFixture = pic.createActor(fixtureIdl, archiveLowCycleFixtureId),
      archive = pic.createActor(archiveIdl, archiveId),
      archiveLowCycleSink = pic.createActor(archiveIdl, archiveLowCycleSinkId);
    // This archive-only fixture begins with a constructor-fixed valid active
    // set, so it can prove archive dispatch below reserve without providing a
    // bypass for journal creation. The archive tuple is retained first.
    archiveLowCycleFixture.setPrincipal(operator);
    await archiveLowCycleFixture.prepareBalancedArchive({
      logicalId: "treasury-journal-set:v1:archive-low-cycle",
      version: 1n,
      contentHash: h(72),
    });
    await rejected(
      () => archiveLowCycleFixture.archiveBalancedSetThenLoseReply(),
      "low-cycle archive makes no archive dispatch",
    );
    expect(
      await archiveLowCycleFixture.reconcileBalancedArchive(),
      "remainPending",
      "low-cycle archive retains only a pending tuple",
    );
    expect(
      await archiveLowCycleFixture.balancedArchivePhase(),
      "pending",
      "low-cycle archive cannot acknowledge",
    );
    if ((await pic.addCycles(archiveLowCycleFixtureId, 2_000_000_000_000)) < 1_000_000_000_000)
      throw new Error("archive low-cycle proof failed to replenish disposable fixture");
    archiveLowCycleSink.setPrincipal(operator);
    await archiveLowCycleSink.permit();
    expect(
      await archiveLowCycleFixture.repairBalancedArchiveResume(),
      "remainPending",
      "replenished archive repair resends only retained tuple",
    );
    expect(
      await archiveLowCycleFixture.reconcileBalancedArchive(),
      "acknowledge",
      "replenished archive exact receipt reconciles",
    );
    expect(
      await archiveLowCycleFixture.balancedArchivePhase(),
      "acknowledged",
      "only replenished exact archive receipt acknowledges",
    );
    const input = entry("treasury-journal:v1:synthetic", 1, 11);
    authority.setPrincipal(outsider);
    expect(
      await authority.writeTreasuryJournalEntry(input),
      "blocked",
      "direct write denied",
    );
    expect(
      await authority.lookupTreasuryJournalEntry(input.logicalId),
      "conflict",
      "direct lookup denied",
    );
    lowCycleAuthority.setPrincipal(outsider);
    expect(
      await lowCycleAuthority.writeTreasuryJournalEntry(input),
      "blocked",
      "low-cycle authority direct write denied",
    );
    expect(
      await lowCycleAuthority.lookupTreasuryJournalEntry(input.logicalId),
      "conflict",
      "low-cycle authority direct lookup denied",
    );
    fixture.setPrincipal(outsider);
    await rejected(
      () => fixture.reconcileLostReply(),
      "outsider recovery denied",
    );
    await rejected(
      () => fixture.prepareBalancedSet({ logicalId: "set", entries: [] }),
      "outsider balanced preparation denied",
    );
    // This separate fixture remains below the synthetic reserve for the
    // balanced-set branch. Its authority admits only this fixture, so neither
    // the later ordinary-journal proof nor a caller can cross its boundary.
    lowCycleFixture.setPrincipal(operator);
    const lowCycleDebit = entry(
        "treasury-journal:v1:balanced-low-cycle-debit",
        1,
        20,
      ),
      lowCycleCredit = entry(
        "treasury-journal:v1:balanced-low-cycle-credit",
        2,
        21,
        { credit: null },
      );
    await lowCycleFixture.prepareBalancedSet({
      logicalId: "treasury-journal-set:v1:balanced-low-cycle",
      entries: [lowCycleDebit, lowCycleCredit],
    });
    await rejected(
      () => lowCycleFixture.writeBalancedEntryThenLoseReply(0),
      "low-cycle balanced debit makes no authority write",
    );
    expect(
      await lowCycleFixture.reconcileBalancedEntry(0),
      "retryIdentical",
      "low-cycle balanced debit observes absent tuple",
    );
    expect(
      await lowCycleFixture.balancedPhase(),
      "pending",
      "low-cycle balanced set cannot activate",
    );
    if (
      (await pic.addCycles(lowCycleFixtureId, 2_000_000_000_000)) <
      1_000_000_000_000
    )
      throw new Error(
        "low-cycle proof failed to replenish disposable balanced-set fixture",
      );
    await rejected(
      () => lowCycleFixture.retryBalancedEntryThenLoseReply(0),
      "replenished balanced debit loses reply",
    );
    expect(
      await lowCycleFixture.reconcileBalancedEntry(0),
      "acknowledge",
      "replenished balanced debit reconciles exact tuple",
    );
    expect(
      await lowCycleFixture.balancedPhase(),
      "pending",
      "one replenished balanced debit remains pending",
    );
    await rejected(
      () => lowCycleFixture.writeBalancedEntryThenLoseReply(1),
      "replenished balanced credit loses reply",
    );
    expect(
      await lowCycleFixture.reconcileBalancedEntry(1),
      "acknowledge",
      "replenished balanced credit reconciles exact tuple",
    );
    expect(
      await lowCycleFixture.balancedPhase(),
      "active",
      "only the replenished complete balanced set activates",
    );
    await lowCycleFixture.prepareBalancedArchive({
      logicalId: "treasury-journal-set:v1:balanced-low-cycle",
      version: 1n,
      contentHash: h(22),
    });
    await rejected(
      () => lowCycleFixture.balancedArchiveThenTrapBeforeAwait(),
      "balanced archive interrupted after durable tuple",
    );
    await install(
      pic,
      installer,
      lowCycleFixtureId,
      fixtureWasm,
      IDL.encode([P, P, P], [operator, lowCycleAuthorityId, archiveId]),
      { upgrade: [{ skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }] },
    );
    lowCycleFixture.setPrincipal(operator);
    await rejected(
      () => lowCycleFixture.repairBalancedArchiveResume(),
      "interrupted balanced archive repair remains unavailable",
    );
    archive.setPrincipal(operator);
    await archive.permit();
    expect(
      await lowCycleFixture.repairBalancedArchiveResume(),
      "remainPending",
      "operator archive repair resends only retained tuple",
    );
    expect(
      await lowCycleFixture.reconcileBalancedArchive(),
      "acknowledge",
      "interrupted balanced archive exact receipt reconciles",
    );
    expect(
      await lowCycleFixture.balancedArchivePhase(),
      "acknowledged",
      "only an exact archive receipt acknowledges the retained tuple",
    );
    fixture.setPrincipal(operator);
    const lowCycle = entry("treasury-journal:v1:synthetic-low-cycles", 1, 10);
    await rejected(
      () => fixture.writeThenLoseReply(lowCycle),
      "low-cycle journal makes no authority write",
    );
    expect(
      await fixture.reconcileLostReply(),
      "retryIdentical",
      "low-cycle journal observes absent authority record",
    );
    if ((await pic.addCycles(fixtureId, 2_000_000_000_000)) < 1_000_000_000_000)
      throw new Error(
        "low-cycle proof failed to replenish disposable treasury fixture",
      );
    await rejected(
      () => fixture.retryJournaledWriteThenLoseReply(),
      "replenished journal loses reply",
    );
    expect(
      await fixture.reconcileLostReply(),
      "acknowledge",
      "replenished journal reconciles exact tuple",
    );
    await rejected(() => fixture.writeThenLoseReply(input), "first reply lost");
    await install(
      pic,
      installer,
      authorityId,
      authorityWasm,
      IDL.encode([Config], [config]),
      {
        upgrade: [
          { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] },
        ],
      },
    );
    await install(
      pic,
      installer,
      fixtureId,
      fixtureWasm,
      IDL.encode([P, P, P], [operator, authorityId, archiveId]),
      {
        upgrade: [
          { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] },
        ],
      },
    );
    fixture.setPrincipal(operator);
    expect(
      await fixture.reconcileLostReply(),
      "acknowledge",
      "exact recovery after upgrades",
    );
    await rejected(
      () => fixture.writeThenLoseReply(input),
      "duplicate delivery loses reply",
    );
    expect(
      await fixture.reconcileLostReply(),
      "acknowledge",
      "duplicate uses exact tuple",
    );
    const interrupted = entry("treasury-journal:v1:interrupted", 2, 12);
    await rejected(
      () => fixture.journalThenTrapBeforeAwait(interrupted),
      "interrupted after durable journal",
    );
    await install(
      pic,
      installer,
      fixtureId,
      fixtureWasm,
      IDL.encode([P, P, P], [operator, authorityId, archiveId]),
      {
        upgrade: [
          { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] },
        ],
      },
    );
    fixture.setPrincipal(operator);
    expect(
      await fixture.reconcileLostReply(),
      "retryIdentical",
      "absent record permits only identical retry",
    );
    await rejected(
      () => fixture.retryJournaledWriteThenLoseReply(),
      "identical retry loses reply",
    );
    expect(
      await fixture.reconcileLostReply(),
      "acknowledge",
      "identical retry reconciles",
    );
    const repair = entry("treasury-journal:v1:repair", 3, 13);
    await rejected(
      () => fixture.journalThenTrapBeforeAwait(repair),
      "repair interrupted",
    );
    fixture.setPrincipal(outsider);
    await rejected(
      () => fixture.repairJournaledEntry(),
      "outsider repair denied",
    );
    fixture.setPrincipal(operator);
    expect(
      await fixture.repairJournaledEntry(),
      "retryIdentical",
      "operator repair uses retained tuple",
    );
    expect(
      await fixture.reconcileLostReply(),
      "acknowledge",
      "repair reconciles retained tuple",
    );
    const debit = entry("treasury-journal:v1:balanced-debit", 4, 14),
      credit = entry("treasury-journal:v1:balanced-credit", 5, 15, {
        credit: null,
      });
    await fixture.prepareBalancedSet({
      logicalId: "treasury-journal-set:v1:synthetic",
      entries: [debit, credit],
    });
    await rejected(
      () => fixture.journalBalancedEntryThenTrapBeforeAwait(0),
      "balanced debit interrupted after durable set journal",
    );
    await install(
      pic,
      installer,
      fixtureId,
      fixtureWasm,
      IDL.encode([P, P, P], [operator, authorityId, archiveId]),
      {
        upgrade: [
          { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] },
        ],
      },
    );
    fixture.setPrincipal(operator);
    expect(
      await fixture.reconcileBalancedEntry(0),
      "retryIdentical",
      "interrupted balanced debit observes absent tuple",
    );
    fixture.setPrincipal(outsider);
    await rejected(
      () => fixture.repairBalancedEntry(0),
      "outsider balanced repair denied",
    );
    fixture.setPrincipal(operator);
    expect(
      await fixture.repairBalancedEntry(0),
      "retryIdentical",
      "operator balanced repair resends retained debit only",
    );
    expect(
      await fixture.reconcileBalancedEntry(0),
      "acknowledge",
      "repaired balanced debit exact tuple acknowledged",
    );
    expect(
      await fixture.balancedPhase(),
      "pending",
      "partial repaired set stays pending",
    );
    await rejected(
      () => fixture.writeBalancedEntryThenLoseReply(1),
      "balanced credit reply lost",
    );
    expect(
      await fixture.reconcileBalancedEntry(1),
      "acknowledge",
      "balanced credit exact tuple acknowledged",
    );
    expect(
      await fixture.balancedPhase(),
      "active",
      "only full balanced set activates",
    );
    fixture.setPrincipal(outsider);
    await rejected(
      () => fixture.prepareBalancedArchive({ logicalId: "treasury-journal-set:v1:synthetic-archive", version: 1n, contentHash: h(16) }),
      "outsider balanced archive preparation denied",
    );
    fixture.setPrincipal(operator);
    await fixture.prepareBalancedArchive({
      logicalId: "treasury-journal-set:v1:synthetic-archive",
      version: 1n,
      contentHash: h(16),
    });
    archive.setPrincipal(operator);
    await archive.revoke();
    await rejected(
      () => fixture.archiveBalancedSetThenLoseReply(),
      "unavailable balanced archive keeps tuple pending",
    );
    expect(
      await fixture.reconcileBalancedArchive(),
      "remainPending",
      "missing balanced archive receipt remains pending",
    );
    await archive.permit();
    await rejected(
      () => fixture.archiveBalancedSetThenLoseReply(),
      "balanced archive acknowledgement deliberately lost",
    );
    await install(
      pic,
      installer,
      archiveId,
      archiveWasm,
      IDL.encode([P, P, P], [fixtureId, lowCycleFixtureId, operator]),
      { upgrade: [{ skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }] },
    );
    await install(
      pic,
      installer,
      fixtureId,
      fixtureWasm,
      IDL.encode([P, P, P], [operator, authorityId, archiveId]),
      { upgrade: [{ skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }] },
    );
    fixture.setPrincipal(operator);
    expect(
      await fixture.reconcileBalancedArchive(),
      "acknowledge",
      "exact balanced archive receipt reconciles after upgrades",
    );
    expect(
      await fixture.balancedArchivePhase(),
      "acknowledged",
      "archive acknowledgement cannot alter the active balanced set",
    );
  } finally {
    await pic.tearDown();
    await server.stop();
  }
}
main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
