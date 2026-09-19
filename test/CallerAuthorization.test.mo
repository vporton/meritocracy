import Principal "mo:base/Principal";
import Authorization "../canisters/application/CallerAuthorization";

let anonymous = Principal.fromText("2vxsx-fae");
let alice = Principal.fromText("rrkah-fqaaa-aaaaa-aaaaq-cai");
let bob = Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai");

// No public application method may turn an anonymous caller into a resource
// owner or an application/treasury service caller.
assert Authorization.authenticated(anonymous) == #anonymous;
assert Authorization.authenticated(alice) == #allowed;
assert Authorization.selfScoped(anonymous, alice) == #anonymous;
assert Authorization.selfScoped(alice, anonymous) == #anonymous;
assert Authorization.fixedServiceCaller(anonymous, alice) == #anonymous;
assert Authorization.fixedServiceCaller(alice, anonymous) == #anonymous;

// Matching is exact: a different non-anonymous principal does not gain access
// merely by naming the same resource or service in its request.
assert Authorization.selfScoped(alice, alice) == #allowed;
assert Authorization.selfScoped(alice, bob) == #forbidden;
assert Authorization.fixedServiceCaller(alice, alice) == #allowed;
assert Authorization.fixedServiceCaller(bob, alice) == #forbidden;
