import Array "mo:base/Array";
import Principal "mo:base/Principal";
import Correlation "../canisters/application/KycCallbackCorrelation";

let alice = Principal.fromText("aaaaa-aa");
let bob = Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai");
let anonymous = Principal.fromText("2vxsx-fae");
let now : Int = 1_000;
let digest = "aBcdEf0123456789";

func opened(records : [Correlation.Record], principal : Principal, value : Text) : [Correlation.Record] {
  switch (Correlation.open(records, { digest = value; principal; nowNs = now })) {
    case (#opened(_), next) next;
    case (_) { assert false; records };
  };
};

let empty : [Correlation.Record] = [];
assert (Correlation.open(empty, { digest; principal = anonymous; nowNs = now }).0 == #anonymousPrincipal);
assert (Correlation.open(empty, { digest = " bad"; principal = alice; nowNs = now }).0 == #invalidDigest);

let first = opened(empty, alice, digest);
assert (first.size() == 1);
assert (first[0].expiresAtNs == now + Correlation.sevenDaysNs);
assert (Correlation.open(first, { digest; principal = alice; nowNs = now + 1 }).0 == #idempotent(first[0]));
assert (Correlation.open(first, { digest = "differentDigest012"; principal = alice; nowNs = now + 1 }).0 == #activeCorrelationExists);
assert (Correlation.open(first, { digest; principal = bob; nowNs = now + 1 }).0 == #activeCorrelationExists);

let mismatch = Correlation.consumeAfterAttestationCommit(first, digest, bob, now + 1);
assert (mismatch.0 == #principalMismatch);
assert (mismatch.1.size() == 1);
let consumed = Correlation.consumeAfterAttestationCommit(mismatch.1, digest, alice, now + 1);
assert (consumed.0 == #consumed);
assert (consumed.1.size() == 0);
// A duplicate must be handled by the durable attestation event journal, not
// by retaining a sensitive correlation after completion.
assert (Correlation.consumeAfterAttestationCommit(consumed.1, digest, alice, now + 2).0 == #notFound);

let expiredAt = now + Correlation.sevenDaysNs;
assert (Correlation.consumeAfterAttestationCommit(first, digest, alice, expiredAt).0 == #expired);
assert (Correlation.recover(first, expiredAt).size() == 0);
// Opening after recovery proves an upgrade/restore cannot reactivate expiry.
assert (Correlation.open(first, { digest = "freshDigest012345"; principal = alice; nowNs = expiredAt }).1.size() == 1);

var many : [Correlation.Record] = [];
var n = 0;
while (n < Correlation.maxCleanupBatch + 2) {
  let principal = Principal.fromText("aaaaa-aa");
  many := Array.append(many, [{ digest = "x" # debug_show(n); principal; createdAtNs = 0; expiresAtNs = 1; state = #active }]);
  n += 1;
};
let firstCleanup = Correlation.cleanup(many, 0, Correlation.maxCleanupBatch + 99, 1);
assert (firstCleanup.scanned == Correlation.maxCleanupBatch);
assert (firstCleanup.removed == Correlation.maxCleanupBatch);
assert (firstCleanup.records.size() == 2);
assert (firstCleanup.nextCursor == ?0);
let secondCleanup = Correlation.cleanup(firstCleanup.records, switch (firstCleanup.nextCursor) { case (?value) value; case null 0 }, Correlation.maxCleanupBatch, 1);
assert (secondCleanup.records.size() == 0);
