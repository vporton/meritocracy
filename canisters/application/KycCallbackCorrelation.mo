import Array "mo:base/Array";
import Principal "mo:base/Principal";
import Text "mo:base/Text";

/// Private, short-lived state for matching a KYC provider callback to the
/// authenticated principal that started it.  This deliberately does *not*
/// model a provider session, report, token, callback body, or attestation.
///
/// The owning actor must generate the opaque digest from high-entropy material
/// and retain only that digest.  It must call `consumeAfterAttestationCommit`
/// only after its independently idempotent minimum-attestation/audit-event
/// transaction has committed.  This module has no Candid surface.
module {
  public let maxActiveRecords : Nat = 1_024;
  public let maxDigestChars : Nat = 128;
  public let maxCleanupBatch : Nat = 64;
  public let sevenDaysNs : Int = 604_800_000_000_000;

  public type State = { #active };

  public type Record = {
    /// Opaque, high-entropy digest; never a provider session/report/token ID.
    digest : Text;
    principal : Principal;
    createdAtNs : Int;
    expiresAtNs : Int;
    state : State;
  };

  public type OpenInput = {
    digest : Text;
    principal : Principal;
    nowNs : Int;
  };

  public type OpenResult = {
    #opened : Record;
    #idempotent : Record;
    #anonymousPrincipal;
    #invalidDigest;
    #capacity;
    #activeCorrelationExists;
  };

  public type ConsumeResult = {
    #consumed;
    #notFound;
    #expired;
    #principalMismatch;
  };

  public type CleanupResult = {
    records : [Record];
    /// A process-local opaque position, valid only for the returned state.
    nextCursor : ?Nat;
    removed : Nat;
    scanned : Nat;
  };

  func validDigest(digest : Text) : Bool {
    // The value is opaque, but reject empty/control-containing/unbounded input
    // before it reaches persistent state or a lookup.
    if (Text.size(digest) == 0 or Text.size(digest) > maxDigestChars) {
      return false;
    };
    for (character in digest.chars()) {
      if (character < '!' or character > '~') {
        return false;
      };
    };
    true;
  };

  func indexForPrincipal(records : [Record], principal : Principal) : ?Nat {
    var index = 0;
    for (record in records.vals()) {
      if (Principal.equal(record.principal, principal)) return ?index;
      index += 1;
    };
    null;
  };

  func indexForDigest(records : [Record], digest : Text) : ?Nat {
    var index = 0;
    for (record in records.vals()) {
      if (record.digest == digest) return ?index;
      index += 1;
    };
    null;
  };

  func removeAt(records : [Record], index : Nat) : [Record] {
    Array.tabulate<Record>(
      records.size() - 1,
      func (destination : Nat) : Record {
        if (destination < index) records[destination] else records[destination + 1];
      },
    );
  };

  /// Removes every expired record.  Call at startup/upgrade recovery before
  /// accepting a callback, so a restored snapshot never revives expired state.
  public func recover(records : [Record], nowNs : Int) : [Record] {
    Array.filter<Record>(records, func(record : Record) : Bool { record.expiresAtNs > nowNs });
  };

  /// Opens exactly one live correlation per principal.  Retrying the same
  /// digest is idempotent; a different active digest fails closed.
  public func open(records : [Record], input : OpenInput) : (OpenResult, [Record]) {
    let recovered = recover(records, input.nowNs);
    if (Principal.isAnonymous(input.principal)) return (#anonymousPrincipal, recovered);
    if (not validDigest(input.digest)) return (#invalidDigest, recovered);

    switch (indexForPrincipal(recovered, input.principal)) {
      case (?index) {
        let existing = recovered[index];
        if (existing.digest == input.digest) {
          return (#idempotent(existing), recovered);
        };
        return (#activeCorrelationExists, recovered);
      };
      case null {};
    };

    // A digest cannot be rebound to a different principal.
    switch (indexForDigest(recovered, input.digest)) {
      case (?_) { return (#activeCorrelationExists, recovered) };
      case null {};
    };

    if (recovered.size() >= maxActiveRecords) return (#capacity, recovered);
    let record : Record = {
      digest = input.digest;
      principal = input.principal;
      createdAtNs = input.nowNs;
      expiresAtNs = input.nowNs + sevenDaysNs;
      state = #active;
    };
    (#opened(record), Array.append<Record>(recovered, [record]));
  };

  /// The callback handler binds both digest and authenticated internal target
  /// principal.  On success, the transient record is removed immediately.
  /// Exact provider-event retries belong to the durable attestation event
  /// journal; this intentionally retains no consumed correlation receipt.
  public func consumeAfterAttestationCommit(
    records : [Record],
    digest : Text,
    principal : Principal,
    nowNs : Int,
  ) : (ConsumeResult, [Record]) {
    let recovered = recover(records, nowNs);
    if (not validDigest(digest)) return (#notFound, recovered);
    switch (indexForDigest(records, digest)) {
      case null { (#notFound, recovered) };
      case (?originalIndex) {
        let original = records[originalIndex];
        if (original.expiresAtNs <= nowNs) return (#expired, recovered);
        // `recover` preserves unexpired records and their order.
        switch (indexForDigest(recovered, digest)) {
          case null { (#notFound, recovered) };
          case (?index) {
            if (not Principal.equal(original.principal, principal)) {
              (#principalMismatch, recovered);
            } else {
              (#consumed, removeAt(recovered, index));
            };
          };
        };
      };
    };
  };

  /// Removes expired entries while inspecting at most `limit` entries.  The
  /// next cursor is stable only against the returned array and is therefore
  /// private actor state, never a caller-supplied pagination token.
  public func cleanup(
    records : [Record],
    cursor : Nat,
    limit : Nat,
    nowNs : Int,
  ) : CleanupResult {
    let boundedLimit = if (limit > maxCleanupBatch) maxCleanupBatch else limit;
    var result = records;
    var position = if (cursor > result.size()) result.size() else cursor;
    var scanned = 0;
    var removed = 0;
    while (position < result.size() and scanned < boundedLimit) {
      scanned += 1;
      if (result[position].expiresAtNs <= nowNs) {
        result := removeAt(result, position);
        removed += 1;
      } else {
        position += 1;
      };
    };
    {
      records = result;
      nextCursor = if (position < result.size()) ?position else null;
      removed;
      scanned;
    };
  };
};
