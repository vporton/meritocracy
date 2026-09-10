import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Principal "mo:base/Principal";
import IdentityRole "../canisters/shared/IdentityRoleRecovery";

func hash(byte : Nat8) : Blob {
  Blob.fromArray(Array.tabulate<Nat8>(32, func(_ : Nat) : Nat8 { byte }));
};

let userPrincipal = Principal.fromText("2vxsx-fae");
let nonAnonymous = Principal.fromText("rrkah-fqaaa-aaaaa-aaaaq-cai");
let identity : IdentityRole.PrincipalBindingInput = {
  logicalId = "principal-binding:v1:42";
  contentHash = hash(1);
  userId = 42;
  principal = nonAnonymous;
  factor = #internetIdentity;
  provider = null;
  subjectHash = null;
};
let oauth : IdentityRole.PrincipalBindingInput = {
  logicalId = "principal-binding:v1:43";
  contentHash = hash(2);
  userId = 43;
  principal = nonAnonymous;
  factor = #oauth;
  provider = ?"github";
  subjectHash = ?hash(3);
};
let role : IdentityRole.RoleAssignmentInput = {
  logicalId = "role-assignment:v1:42:auditor";
  contentHash = hash(4);
  principal = nonAnonymous;
  role = "auditor";
};

assert IdentityRole.validPrincipalBinding(identity);
assert IdentityRole.validPrincipalBinding(oauth);
assert IdentityRole.validRoleAssignment(role);

// Identity evidence is typed: an II record cannot carry OAuth evidence, and
// OAuth cannot omit either its provider or immutable subject hash.
assert not IdentityRole.validPrincipalBinding({ identity with provider = ?"github" });
assert not IdentityRole.validPrincipalBinding({ oauth with subjectHash = null });
assert not IdentityRole.validPrincipalBinding({ identity with principal = userPrincipal });
assert not IdentityRole.validRoleAssignment({ role with role = "bad\nrole" });

// Exact duplicate delivery is acknowledged; a different value under the same
// immutable logical ID is a conflict, never an implicit role replacement.
assert IdentityRole.decideIdempotentWrite(true, role.contentHash, null) == #accept;
assert IdentityRole.decideIdempotentWrite(true, role.contentHash, ?role.contentHash) == #accept;
assert IdentityRole.decideIdempotentWrite(true, role.contentHash, ?hash(5)) == #conflict;
assert IdentityRole.decideIdempotentWrite(false, role.contentHash, null) == #blocked;
