#!/usr/bin/env node
'use strict';
// Local M1 envelope only: no production sizing or live canister is involved.
const { chmodSync, copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const root = join(__dirname, '..', '..');
const requirePic = createRequire(join(root, 'tools/m1-pocketic/package.json'));
const { IDL } = requirePic('@icp-sdk/core/candid');
const { Principal } = requirePic('@icp-sdk/core/principal');
const { PocketIc, PocketIcServer, createIdentity } = requirePic('@dfinity/pic');
const wasm = join(root, '.mops/.build/private_store_recovery_fixture.wasm');
const owner = createIdentity('m1-private-store-benchmark-owner-synthetic-only');
const idlFactory = ({ IDL }) => {
  const result = IDL.Variant({ ok: IDL.Variant({ inserted: IDL.Null, duplicate: IDL.Null }), err: IDL.Text });
  return IDL.Service({ putBounded: IDL.Func([IDL.Text, IDL.Vec(IDL.Nat8)], [result], []), lookupHash: IDL.Func([IDL.Text], [IDL.Variant({ ok: IDL.Opt(IDL.Vec(IDL.Nat8)), err: IDL.Text })], ['query']), entryCount: IDL.Func([], [IDL.Variant({ ok: IDL.Nat, err: IDL.Text })], ['query']) });
};
const statusIdlFactory = ({ IDL }) => IDL.Service({ canister_status: IDL.Func([IDL.Record({ canister_id: IDL.Principal })], [IDL.Record({ cycles: IDL.Nat, memory_size: IDL.Nat, query_stats: IDL.Record({ num_calls_total: IDL.Nat, num_instructions_total: IDL.Nat, request_payload_bytes_total: IDL.Nat, response_payload_bytes_total: IDL.Nat }) })], []) });
function assert(value, message) { if (!value) throw new Error(message); }
async function main() {
  assert(existsSync(wasm), 'missing fixture Wasm; run mops build private_store_recovery_fixture first');
  const pinned = execFileSync('mops', ['toolchain', 'bin', 'pocket-ic'], { encoding: 'utf8' }).trim();
  const dir = mkdtempSync(join(tmpdir(), 'meritocracy-m1-benchmark-')); const binary = join(dir, 'pocket-ic');
  copyFileSync(pinned, binary); chmodSync(binary, 0o700);
  let server; let pic;
  try {
    server = await PocketIcServer.start({ binPath: binary, ttl: 60, showRuntimeLogs: false, showCanisterLogs: false }); pic = await PocketIc.create(server.getUrl());
    const canisterId = await pic.createCanister({ sender: owner.getPrincipal(), controllers: [owner.getPrincipal()], cycles: 2_000_000_000_000n });
    await pic.installCode({ canisterId, sender: owner.getPrincipal(), wasm, arg: IDL.encode([IDL.Principal], [owner.getPrincipal()]) });
    const actor = pic.createActor({ canisterId, idlFactory }); actor.setIdentity(owner);
    const management = pic.createActor({ canisterId: Principal.fromText('aaaaa-aa'), idlFactory: statusIdlFactory }); management.setIdentity(owner);
    const before = await management.canister_status({ canister_id: canisterId });
    const payload = Uint8Array.from({ length: 4096 }, (_, index) => index % 251); const started = process.hrtime.bigint();
    for (let index = 0; index < 128; index += 1) assert('inserted' in (await actor.putBounded(`benchmark:${String(index).padStart(3, '0')}`, payload)).ok, `insert ${index} failed`);
    const insertsNs = Number(process.hrtime.bigint() - started);
    const queryStarted = process.hrtime.bigint();
    for (let index = 0; index < 128; index += 1) assert('ok' in await actor.lookupHash(`benchmark:${String(index).padStart(3, '0')}`), `lookup ${index} failed`);
    const queriesNs = Number(process.hrtime.bigint() - queryStarted); const after = await management.canister_status({ canister_id: canisterId });
    assert('err' in await actor.putBounded('benchmark:capacity', payload), 'capacity limit was not enforced');
    assert('err' in await actor.putBounded('benchmark:oversize', Uint8Array.from({ length: 4097 }, () => 1)), 'payload limit was not enforced');
    const report = { format: 'meritocracy-m1-private-store-benchmark-v1', environment: 'PocketIC synthetic', entries: 128, bytesPerDocument: 4096, payloadBytes: 524288, indexMultiplier: 1, archiveCrossCanisterBytes: 0, insertWallMilliseconds: insertsNs / 1e6, queryWallMilliseconds: queriesNs / 1e6, memoryBytesBefore: before.memory_size.toString(), memoryBytesAfter: after.memory_size.toString(), cyclesBefore: before.cycles.toString(), cyclesAfter: after.cycles.toString(), queryInstructionsDelta: (after.query_stats.num_instructions_total - before.query_stats.num_instructions_total).toString(), capacityFailure: 'enforced', lowCycleMode: 'not a financial/production proof; optional work is absent from this fixture' };
    const output = join(tmpdir(), `meritocracy-m1-benchmark-${Date.now()}.json`); writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: 'wx' }); console.log(`M1 private-store benchmark passed; restricted report: ${output}`);
  } finally { if (pic) await pic.tearDown(); if (server) await server.stop(); rmSync(dir, { recursive: true, force: true }); }
}
main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
