// Disposable archive receiver for the M1 bounded ZenDB benchmark.  It accepts
// only a bounded synthetic blob and exposes the retained byte count so the
// caller can prove the exact cross-canister payload it measured.

import Blob "mo:base/Blob";

persistent actor class ArchiveBenchmarkSink() = this {
  var retained : ?Blob = null;

  public func archive(bytes : Blob) : async Nat {
    assert (bytes.size() <= 8_192);
    switch (retained) {
      case null { retained := ?bytes };
      case (?existing) { assert (existing == bytes) };
    };
    bytes.size();
  };

  public query func retainedBytes() : async Nat {
    switch (retained) {
      case null { 0 };
      case (?bytes) { bytes.size() };
    };
  };
};
