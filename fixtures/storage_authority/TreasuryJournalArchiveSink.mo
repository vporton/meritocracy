// Disposable archive half of the M1 treasury-journal proof. It retains only
// fixed acknowledgement tuples, never a journal entry, balance, account,
// asset, destination, signer, transaction, or chain material.
import Array "mo:base/Array";
import Error "mo:base/Error";
import Principal "mo:base/Principal";
import Archive "../../canisters/treasury/TreasuryJournalArchiveRecovery";

shared ({ caller = installer }) persistent actor class (treasury : Principal, secondaryTreasury : Principal, operator : Principal) = this {
  assert not Principal.isAnonymous(treasury);
  assert not Principal.isAnonymous(secondaryTreasury);
  assert not Principal.isAnonymous(operator);
  assert treasury != operator;
  assert secondaryTreasury != operator;
  assert treasury != secondaryTreasury;

  var permitted = false;
  var receipts : [Archive.ArchiveTuple] = [];

  func onlyTreasury(caller : Principal) { assert caller == treasury or caller == secondaryTreasury };
  func onlyOperator(caller : Principal) { assert caller == operator };
  func allowed(logicalId : Text) : Bool {
    logicalId == "treasury-journal-set:v1:synthetic-archive" or
    logicalId == "treasury-journal-set:v1:balanced-low-cycle" or
    logicalId == "treasury-journal-set:v1:capacity:expected:maximum" or
    logicalId == "treasury-journal-set:v1:capacity:two_x:maximum";
  };

  public shared ({ caller }) func permit() : async () { onlyOperator(caller); permitted := true };
  public shared ({ caller }) func revoke() : async () { onlyOperator(caller); permitted := false };

  public shared ({ caller }) func archive(tuple : Archive.ArchiveTuple) : async Archive.ArchiveTuple {
    onlyTreasury(caller);
    if (not permitted or not Archive.validTuple(tuple) or not allowed(tuple.logicalId)) {
      throw Error.reject("synthetic treasury-journal archive unavailable");
    };
    for (stored in receipts.vals()) {
      if (stored.logicalId == tuple.logicalId) {
        if (stored == tuple) return stored else throw Error.reject("synthetic treasury-journal archive conflict");
      };
    };
    if (receipts.size() >= 2) throw Error.reject("synthetic treasury-journal archive receipt limit");
    receipts := Array.append(receipts, [tuple]);
    tuple;
  };

  public shared ({ caller }) func lookup(logicalId : Text) : async ?Archive.ArchiveTuple {
    onlyTreasury(caller);
    for (stored in receipts.vals()) { if (stored.logicalId == logicalId) return ?stored };
    null;
  };
};
