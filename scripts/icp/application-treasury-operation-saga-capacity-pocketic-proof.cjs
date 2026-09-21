#!/usr/bin/env node
// Synthetic-only application-outbox/inbox capacity proof: no target API,
// payment value, signer, address, wallet, ledger, chain, or deployment.
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
const [bin, appWasm, treasuryWasm, reportPath] = process.argv.slice(2);
if (!bin || !appWasm || !treasuryWasm || !reportPath)
  throw new Error("Expected PocketIC binary, capacity Wasms, and report path");
const Hash = IDL.Vec(IDL.Nat8),
  P = IDL.Principal,
  Input = IDL.Record({
    logicalId: IDL.Text,
    version: IDL.Nat64,
    contentHash: Hash,
  }),
  Receipt = IDL.Record({ version: IDL.Nat64, contentHash: Hash });
const Upload = IDL.Record({ canister_id: P, chunk: Hash }),
  Chunk = IDL.Record({ hash: Hash }),
  management = Principal.fromText("aaaaa-aa");
const Install = IDL.Record({
  arg: Hash,
  chunk_hashes_list: IDL.Vec(Chunk),
  mode: IDL.Variant({ install: IDL.Null }),
  sender_canister_version: IDL.Opt(IDL.Nat64),
  store_canister: IDL.Opt(P),
  canister_id: P,
  target_canister: P,
  wasm_module_hash: Hash,
});
const appIdl = ({ IDL: C }) =>
  C.Service({
    submitBatch: C.Func([C.Vec(Input)], [C.Vec(Receipt)], []),
    retainedCount: C.Func([], [C.Nat], []),
  });
const digest = (n) => Uint8Array.from({ length: 32 }, (_, i) => (n + i) % 256);
async function call(pic, sender, method, type, value) {
  return pic.client.updateCall({
    canisterId: management,
    sender,
    method,
    payload: new Uint8Array(IDL.encode([type], [value])),
  });
}
async function install(pic, sender, id, wasmPath, arg) {
  const wasm = fs.readFileSync(wasmPath),
    chunks = [];
  for (let offset = 0; offset < wasm.length; offset += 1_000_000) {
    const chunk = new Uint8Array(
      wasm.subarray(offset, Math.min(offset + 1_000_000, wasm.length)),
    );
    await call(pic, sender, "upload_chunk", Upload, { canister_id: id, chunk });
    chunks.push({
      hash: new Uint8Array(crypto.createHash("sha256").update(chunk).digest()),
    });
  }
  await call(pic, sender, "install_chunked_code", Install, {
    arg: new Uint8Array(arg),
    chunk_hashes_list: chunks,
    mode: { install: null },
    sender_canister_version: [],
    store_canister: [],
    canister_id: id,
    target_canister: id,
    wasm_module_hash: new Uint8Array(
      crypto.createHash("sha256").update(wasm).digest(),
    ),
  });
}
async function rejected(f, label) {
  try {
    await f();
  } catch (_) {
    return;
  }
  throw new Error(`${label}: expected rejection`);
}
function batch(name, count) {
  return Array.from({ length: count }, (_, ordinal) => ({
    logicalId: `application-outbox:v1:capacity:${name}:${ordinal}`,
    version: 1n,
    contentHash: digest(ordinal),
  }));
}
async function scenario(pic, installer, operator, name, count) {
  const appId = await pic.createCanister({
      sender: installer,
      controllers: [installer],
      cycles: 20_000_000_000_000n,
    }),
    treasuryId = await pic.createCanister({
      sender: installer,
      controllers: [installer],
      cycles: 20_000_000_000_000n,
    });
  await install(
    pic,
    installer,
    appId,
    appWasm,
    IDL.encode([P, P], [operator, treasuryId]),
  );
  await install(
    pic,
    installer,
    treasuryId,
    treasuryWasm,
    IDL.encode([P], [appId]),
  );
  const app = pic.createActor(appIdl, appId);
  app.setPrincipal(operator);
  const values = batch(name, count),
    before = await pic.getCyclesBalance(appId);
  await rejected(
    () => app.submitBatch(batch(`${name}:too-many`, 33)),
    `${name} rejects oversized batch before inbox insertion`,
  );
  if ((await app.retainedCount()) !== 0n)
    throw new Error(`${name}: oversized batch reached inbox`);
  await rejected(
    () => app.submitBatch([{ ...values[0], logicalId: "x".repeat(513) }]),
    `${name} rejects oversized logical ID before inbox insertion`,
  );
  const first = await app.submitBatch(values),
    second = await app.submitBatch(values);
  if (
    first.length !== count ||
    second.length !== count ||
    (await app.retainedCount()) !== BigInt(count)
  )
    throw new Error(`${name}: exact retry was not idempotent`);
  const after = await pic.getCyclesBalance(appId);
  return {
    name,
    intents: count,
    exactRetries: count,
    encodedInputBytes: IDL.encode([IDL.Vec(Input)], [values]).byteLength,
    applicationCycleDelta: (before - after).toString(),
  };
}
async function main() {
  const server = await PocketIcServer.start({
    binPath: bin,
    ttl: 60,
    showRuntimeLogs: false,
    showCanisterLogs: false,
  });
  const pic = await PocketIc.create(server.getUrl());
  try {
    const installer = Principal.fromUint8Array(Uint8Array.of(6, 31)),
      operator = Principal.fromUint8Array(Uint8Array.of(6, 32));
    const report = {
      schemaVersion: 1,
      component: "M1 synthetic application-to-treasury outbox/inbox capacity",
      emulator: "PocketIC synthetic-only",
      scenarios: [
        await scenario(pic, installer, operator, "expected", 16),
        await scenario(pic, installer, operator, "two_x", 32),
      ],
      rejection: {
        maxIntents: 32,
        oversizedBatch: 33,
        logicalIdBytes: 513,
        result: "blocked before synthetic treasury inbox insertion",
      },
      limitations: [
        "Cycle deltas are emulator measurements, not a production instruction or cycle budget.",
        "This does not prove treasury policy, archive, custody, or at-most-one-value-transfer.",
      ],
    };
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    console.log(JSON.stringify(report));
  } finally {
    await pic.tearDown();
    await server.stop();
  }
}
main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
