/// Local-only caller that proves an unrelated canister cannot use the fixture.
import Principal "mo:base/Principal";

actor {
  type PutResult = { #inserted; #duplicate };
  type Result = { #ok : PutResult; #err : Text };
  type Target = actor { putBounded : (Text, Blob) -> async Result };

  public func attempt(target : Principal) : async Result {
    let fixture : Target = actor (Principal.toText(target));
    await fixture.putBounded("migration-receipt:v1:attacker", "x");
  };
};
