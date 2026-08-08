import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Recovery "../canisters/shared/MutationRecovery";
import StorageTypes "../canisters/shared/StorageTypes";

func hash(byte : Nat8) : Blob {
  Blob.fromArray(Array.tabulate<Nat8>(32, func(_ : Nat) : Nat8 { byte }));
};

let desired = hash(1);
let prior = hash(2);
let concurrent = hash(3);
let expectedAbsent : StorageTypes.ExpectedRemote = {
  version = null;
  contentHash = null;
};
let expectedPrior : StorageTypes.ExpectedRemote = {
  version = ?4;
  contentHash = ?prior;
};
let partialExpected : StorageTypes.ExpectedRemote = {
  version = ?4;
  contentHash = null;
};

// A lost reply is successful only when the bounded lookup observes exactly
// the intended version and hash.
assert (
  Recovery.resolve(5, desired, expectedAbsent, #present({ version = 5; contentHash = desired })) == #acknowledge
);

// An absent insert and an unchanged CAS target may retry, but only with the
// original immutable operation material.
assert (Recovery.resolve(1, desired, expectedAbsent, #absent) == #retryIdentical);
assert (
  Recovery.resolve(5, desired, expectedPrior, #present({ version = 4; contentHash = prior })) == #retryIdentical
);

// Any concurrent version/hash, partial expectation, malformed hash, or
// malformed desired data fails closed rather than allocating a new key or
// overwriting data.
assert (
  Recovery.resolve(5, desired, expectedPrior, #present({ version = 4; contentHash = concurrent })) == #conflict
);
assert (
  Recovery.resolve(5, desired, expectedPrior, #present({ version = 6; contentHash = desired })) == #conflict
);
assert (Recovery.resolve(5, desired, partialExpected, #absent) == #conflict);
assert (Recovery.resolve(1, Blob.fromArray([]), expectedAbsent, #absent) == #blocked);

assert (Recovery.phaseAfterRecovery(#acknowledge) == #acknowledged);
assert (Recovery.phaseAfterRecovery(#retryIdentical) == #remoteWriteStarted);
assert (Recovery.phaseAfterRecovery(#conflict) == #conflict);
assert (Recovery.phaseAfterRecovery(#blocked) == #blocked);

// A manifest is never exposed while an archive/member reply is unknown or
// failed, and its member list is bounded.
assert (Recovery.decideManifestActivation([#acknowledged], true) == #activate);
assert (Recovery.decideManifestActivation([#acknowledged], false) == #remainPending);
assert (Recovery.decideManifestActivation([#acknowledged, #reconciling], true) == #remainPending);
assert (Recovery.decideManifestActivation([], true) == #blocked);
assert (
  Recovery.decideManifestActivation(
    Array.tabulate<StorageTypes.MutationPhase>(
      Recovery.maxManifestMembers + 1,
      func(_ : Nat) : StorageTypes.MutationPhase { #acknowledged },
    ),
    true,
  ) == #blocked
);
