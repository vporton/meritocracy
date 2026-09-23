import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Principal "mo:base/Principal";
import Store "../canisters/application/EmbeddedIdentityRoleStore";
import IdentityRole "../canisters/shared/IdentityRoleRecovery";

func hash(byte : Nat8) : Blob { Blob.fromArray(Array.tabulate<Nat8>(32, func(_ : Nat) : Nat8 { byte })) };

let principal = Principal.fromText("rrkah-fqaaa-aaaaa-aaaaq-cai");
let otherPrincipal = Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai");
let binding : IdentityRole.PrincipalBindingInput = {
  logicalId = "principal-binding:v1:42"; desiredVersion = 1; contentHash = hash(1);
  userId = 42; principal; factor = #oauth; provider = ?"github"; subjectHash = ?hash(2);
};
let bindingObserved : Store.ImmutableBindingObservation = {
  version = binding.desiredVersion; contentHash = binding.contentHash; userId = binding.userId;
  principal = binding.principal; factor = binding.factor; provider = binding.provider; subjectHash = binding.subjectHash;
};

assert Store.decideBindingIdempotentWrite(binding, ?bindingObserved) == #acknowledged;
assert Store.decideBindingIdempotentWrite(binding, ?{ bindingObserved with version = 2 }) == #conflict;
assert Store.decideBindingIdempotentWrite(binding, ?{ bindingObserved with contentHash = hash(3) }) == #conflict;
assert Store.decideBindingIdempotentWrite(binding, ?{ bindingObserved with userId = 43 }) == #conflict;
assert Store.decideBindingIdempotentWrite(binding, ?{ bindingObserved with principal = otherPrincipal }) == #conflict;
assert Store.decideBindingIdempotentWrite(binding, ?{ bindingObserved with factor = #internetIdentity }) == #conflict;
assert Store.decideBindingIdempotentWrite(binding, ?{ bindingObserved with provider = ?"gitlab" }) == #conflict;
assert Store.decideBindingIdempotentWrite(binding, ?{ bindingObserved with subjectHash = ?hash(4) }) == #conflict;
assert Store.decideBindingIdempotentWrite(binding, null) == #conflict;

let role : IdentityRole.RoleAssignmentInput = {
  logicalId = "role-assignment:v1:42:auditor"; desiredVersion = 1; contentHash = hash(5);
  principal; role = "auditor";
};
let roleObserved : Store.ImmutableRoleObservation = {
  version = role.desiredVersion; contentHash = role.contentHash; principal = role.principal; role = role.role;
};

assert Store.decideRoleIdempotentWrite(role, ?roleObserved) == #acknowledged;
assert Store.decideRoleIdempotentWrite(role, ?{ roleObserved with version = 2 }) == #conflict;
assert Store.decideRoleIdempotentWrite(role, ?{ roleObserved with contentHash = hash(6) }) == #conflict;
assert Store.decideRoleIdempotentWrite(role, ?{ roleObserved with principal = otherPrincipal }) == #conflict;
assert Store.decideRoleIdempotentWrite(role, ?{ roleObserved with role = "operator" }) == #conflict;
assert Store.decideRoleIdempotentWrite(role, null) == #conflict;
assert Store.decideBindingIdempotentWrite({ binding with subjectHash = null }, ?bindingObserved) == #blocked;
assert Store.decideRoleIdempotentWrite({ role with role = "bad\nrole" }, ?roleObserved) == #blocked;
