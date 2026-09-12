import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Principal "mo:base/Principal";
import Intent "../canisters/core/IdentityRoleIntent";
import RoleIntent "../canisters/core/RoleAssignmentIntent";
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

// An interruption before the remote call uses the same durable intent. An
// absent fixed lookup permits only an identical retry, never a new input.
let interrupted = Intent.startRemoteWrite(prepared);
let (retryOnly, retryDecision) = Intent.reconcile(interrupted, #absent);
assert retryDecision == #retryIdentical;
assert retryOnly.phase == #remoteWriteStarted;

let role : IdentityRole.RoleAssignmentInput = {
  logicalId = "role-assignment:v1:synthetic-44:auditor";
  desiredVersion = 1;
  contentHash = hash(8);
  principal = input.principal;
  role = "auditor";
};
let preparedRole = switch (RoleIntent.prepare(role)) {
  case (?value) value;
  case null { assert false; loop {} };
};
let (_, roleAcknowledgement) = RoleIntent.reconcile(
  RoleIntent.lostReply(RoleIntent.startRemoteWrite(preparedRole)),
  #present({ version = role.desiredVersion; contentHash = role.contentHash }),
);
assert roleAcknowledgement == #acknowledge;
let (_, roleConflict) = RoleIntent.reconcile(
  RoleIntent.lostReply(RoleIntent.startRemoteWrite(preparedRole)),
  #present({ version = role.desiredVersion + 1; contentHash = role.contentHash }),
);
assert roleConflict == #conflict;

// A role interruption before its authority call has the same narrow retry
// rule: absence permits redelivery only of the retained immutable tuple.
let interruptedRole = RoleIntent.startRemoteWrite(preparedRole);
let (roleRetryOnly, roleRetryDecision) = RoleIntent.reconcile(interruptedRole, #absent);
assert roleRetryDecision == #retryIdentical;
assert roleRetryOnly.phase == #remoteWriteStarted;
