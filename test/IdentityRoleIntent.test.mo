import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Principal "mo:base/Principal";
import Intent "../canisters/core/IdentityRoleIntent";
import IdentityRole "../canisters/shared/IdentityRoleRecovery";
import MutationRecovery "../canisters/shared/MutationRecovery";

func hash(byte : Nat8) : Blob {
  Blob.fromArray(Array.tabulate<Nat8>(32, func(_ : Nat) : Nat8 { byte }));
};

let input : IdentityRole.PrincipalBindingInput = {
  logicalId = "principal-binding:v1:synthetic-44";
  desiredVersion = 1;
  contentHash = hash(7);
  userId = 44;
  principal = Principal.fromText("rrkah-fqaaa-aaaaa-aaaaq-cai");
  factor = #internetIdentity;
  provider = null;
  subjectHash = null;
};

let prepared = switch (Intent.prepare(input)) {
  case (?value) value;
  case null { assert false; loop {} };
};
assert prepared.phase == #prepared;
let started = Intent.startRemoteWrite(prepared);
assert started.phase == #remoteWriteStarted;
let reconciling = Intent.lostReply(started);
assert reconciling.phase == #reconciling;

// The deliberately discarded reply is acknowledged only by the exact
// journaled tuple. A changed version/hash is a fail-closed conflict.
let (acknowledged, ack) = Intent.reconcile(reconciling, #present({ version = 1; contentHash = hash(7) }));
assert ack == #acknowledge;
assert acknowledged.phase == #acknowledged;
let (versionConflict, versionDecision) = Intent.reconcile(reconciling, #present({ version = 2; contentHash = hash(7) }));
assert versionDecision == #conflict;
assert versionConflict.phase == #conflict;
let (absent, absentDecision) = Intent.reconcile(reconciling, #absent);
assert absentDecision == #retryIdentical;
assert absent.phase == #remoteWriteStarted;
