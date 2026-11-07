import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Buffer "mo:base/Buffer";
import Int "mo:base/Int";
import Nat8 "mo:base/Nat8";
import Nat32 "mo:base/Nat32";
import Nat64 "mo:base/Nat64";
import Principal "mo:base/Principal";
import Text "mo:base/Text";
import Sha256 "mo:sha2@0/Sha256";
import Types "Types";

module {
  public let maxEvents : Nat = 100_000;
  public let maxPublicPayloadBytes : Nat = 67_108_864;

  public func withinStorageQuota(eventCount : Nat, payloadBytes : Nat, incomingBytes : Nat) : Bool {
    eventCount < maxEvents and payloadBytes + incomingBytes <= maxPublicPayloadBytes;
  };

  public class Store(initial : Types.StableState) {
    var appenders = initial.appenders;
    var events = initial.events;
    public func snapshot() : Types.StableState = { appenders; events };
    public func configureAppenders(next : [Principal]) : {
      #ok : ();
      #err : Types.AppError;
    } {
      for (candidate in next.vals()) if (Principal.isAnonymous(candidate)) return #err(#invalid("anonymous principal cannot append audit events"));
      var index = 0;
      while (index < next.size()) {
        var other = index + 1;
        while (other < next.size()) {
          if (next[index] == next[other]) return #err(#invalid("appenders must be unique"));
          other += 1;
        };
        index += 1;
      };
      appenders := next;
      #ok(());
    };
    public func isAppender(principal : Principal) : Bool = Array.find<Principal>(appenders, func(candidate) { candidate == principal }) != null;
    public func append(event : Types.AuditEvent) : {
      #ok : Types.AuditEvent;
      #err : Types.AppError;
    } {
      if (event.event_id.size() != 32) return #err(#invalid("event id must be exactly 32 bytes"));
      if (event.payload_hash.size() != 32) return #err(#invalid("payload hash must be exactly 32 bytes"));
      if (event.public_payload.size() > 4_096) return #err(#invalid("public payload exceeds 4096 bytes"));
      switch (getEvent(event.event_id)) {
        case (?existing) if (eventEqual(existing, event)) #ok(existing) else #err(#conflict("event id already identifies different content"));
        case null {
          var payloadBytes = 0;
          for (existing in events.vals()) payloadBytes += existing.public_payload.size();
          if (not withinStorageQuota(events.size(), payloadBytes, event.public_payload.size())) {
            return #err(#rate_limited({ retry_after_ns = 86_400_000_000_000 }));
          };
          events := Array.append(events, [event]);
          #ok(event);
        };
      };
    };
    public func getEvent(eventId : Blob) : ?Types.AuditEvent = Array.find<Types.AuditEvent>(events, func(event) { event.event_id == eventId });
    public func listEvents(filter : Types.EventFilter, cursor : ?Blob, limit : Nat32) : {
      #ok : Types.AuditPage;
      #err : Types.AppError;
    } {
      if (limit == 0 or limit > 100) return #err(#invalid("limit must be between 1 and 100"));
      switch (filter.from, filter.to) {
        case (?from, ?to) if (from > to) return #err(#invalid("from must not follow to"));
        case _ {};
      };
      let start = switch (cursor) {
        case null 0;
        case (?value) switch (decodeIndex(value)) {
          case null return #err(#invalid("cursor must be an 8-byte event index"));
          case (?decoded) decoded;
        };
      };
      if (start > events.size()) return #err(#invalid("cursor is outside the event log"));
      let items = Buffer.Buffer<Types.AuditEvent>(Nat32.toNat(limit));
      var index = start;
      while (index < events.size() and items.size() < Nat32.toNat(limit)) {
        if (matches(events[index], filter)) items.add(events[index]);
        index += 1;
      };
      var nextCursor : ?Blob = null;
      var probe = index;
      while (probe < events.size() and nextCursor == null) {
        if (matches(events[probe], filter)) nextCursor := ?encodeIndex(index);
        probe += 1;
      };
      #ok({ items = Buffer.toArray(items); next_cursor = nextCursor });
    };
    public func reportRound(roundId : Types.RoundId) : {
      #ok : Types.RoundReport;
      #err : Types.AppError;
    } {
      let selected = Array.filter<Types.AuditEvent>(events, func(event) { switch (event.subject) { case (#round(id)) id == roundId; case _ false } });
      if (selected.size() == 0) return #err(#not_found);
      var last : ?Types.TimestampNs = null;
      var root = Blob.fromArrayMut(Array.init<Nat8>(32, 0));
      for (event in selected.vals()) {
        switch (last) {
          case null last := ?event.occurred_at;
          case (?value) if (event.occurred_at > value) last := ?event.occurred_at;
        };
        root := Sha256.fromBlob(#sha256, Blob.fromArray(Array.append(Blob.toArray(root), Blob.toArray(eventCommitment(event)))));
      };
      #ok({
        round_id = roundId;
        event_count = Nat64.fromNat(selected.size());
        last_event_at = last;
        event_root = root;
      });
    };
    public func reportUser(userId : Types.UserId, cursor : ?Blob, limit : Nat32) : {
      #ok : Types.UserReport;
      #err : Types.AppError;
    } {
      switch (listEvents({ subject = ?#user(userId); kind = null; from = null; to = null }, cursor, limit)) {
        case (#err(error)) #err(error);
        case (#ok(page)) #ok({ user_id = userId; events = page });
      };
    };
    public func stats() : { events : Nat64; public_payload_bytes : Nat64 } {
      var bytes : Nat = 0;
      for (event in events.vals()) bytes += event.public_payload.size();
      {
        events = Nat64.fromNat(events.size());
        public_payload_bytes = Nat64.fromNat(bytes);
      };
    };
  };
  func matches(event : Types.AuditEvent, filter : Types.EventFilter) : Bool {
    (switch (filter.subject) { case null true; case (?subject) subjectEqual(event.subject, subject) }) and (switch (filter.kind) { case null true; case (?kind) kindEqual(event.kind, kind) }) and (switch (filter.from) { case null true; case (?from) event.occurred_at >= from }) and (switch (filter.to) { case null true; case (?to) event.occurred_at <= to });
  };
  func eventEqual(left : Types.AuditEvent, right : Types.AuditEvent) : Bool = left.event_id == right.event_id and left.occurred_at == right.occurred_at and left.actor_ == right.actor_ and subjectEqual(left.subject, right.subject) and kindEqual(left.kind, right.kind) and left.payload_hash == right.payload_hash and left.public_payload == right.public_payload;
  public func eventCommitment(event : Types.AuditEvent) : Blob {
    let output = Buffer.Buffer<Nat8>(160 + event.public_payload.size());
    appendBlob(output, Text.encodeUtf8("meritocracy:audit-event:v1\00"));
    appendBlob(output, event.event_id);
    appendSignedInt(output, event.occurred_at);
    appendLengthPrefixed(output, Principal.toBlob(event.actor_));
    appendSubject(output, event.subject);
    output.add(kindTag(event.kind));
    appendBlob(output, event.payload_hash);
    appendLengthPrefixed(output, event.public_payload);
    Sha256.fromBlob(#sha256, Blob.fromArray(Buffer.toArray(output)));
  };
  func appendSubject(output : Buffer.Buffer<Nat8>, subject : Types.AuditSubject) {
    switch (subject) {
      case (#user(value)) { output.add(0); appendNat64(output, value) };
      case (#round(value)) { output.add(1); appendNat64(output, value) };
      case (#allocation(value)) { output.add(2); appendNat64(output, value) };
      case (#evaluation(value)) { output.add(3); appendNat64(output, value) };
      case (#system_(value)) {
        output.add(4);
        appendLengthPrefixed(output, Text.encodeUtf8(value));
      };
    };
  };
  func kindTag(kind : Types.AuditKind) : Nat8 {
    switch (kind) {
      case (#session) 0;
      case (#profile) 1;
      case (#attestation) 2;
      case (#evaluation) 3;
      case (#round) 4;
      case (#dispute) 5;
      case (#transfer) 6;
      case (#reconciliation) 7;
      case (#governance) 8;
    };
  };
  func appendSignedInt(output : Buffer.Buffer<Nat8>, value : Int) {
    output.add(if (value < 0) 1 else 0);
    var magnitude = Int.abs(value);
    let reverse = Buffer.Buffer<Nat8>(8);
    if (magnitude == 0) reverse.add(0);
    while (magnitude > 0) {
      reverse.add(Nat8.fromNat(magnitude % 256));
      magnitude /= 256;
    };
    appendNat64(output, Nat64.fromNat(reverse.size()));
    var index = reverse.size();
    while (index > 0) {
      index -= 1;
      output.add(reverse.get(index));
    };
  };
  func appendLengthPrefixed(output : Buffer.Buffer<Nat8>, value : Blob) {
    appendNat64(output, Nat64.fromNat(value.size()));
    appendBlob(output, value);
  };
  func appendNat64(output : Buffer.Buffer<Nat8>, value : Nat64) {
    var divisor : Nat64 = 72_057_594_037_927_936;
    var remaining = value;
    var index = 0;
    while (index < 8) {
      output.add(Nat8.fromNat(Nat64.toNat(remaining / divisor)));
      remaining %= divisor;
      divisor /= 256;
      index += 1;
    };
  };
  func appendBlob(output : Buffer.Buffer<Nat8>, value : Blob) {
    for (byte in value.vals()) output.add(byte);
  };
  func subjectEqual(left : Types.AuditSubject, right : Types.AuditSubject) : Bool {
    switch (left, right) {
      case (#user(a), #user(b)) a == b;
      case (#round(a), #round(b)) a == b;
      case (#allocation(a), #allocation(b)) a == b;
      case (#evaluation(a), #evaluation(b)) a == b;
      case (#system_(a), #system_(b)) a == b;
      case _ false;
    };
  };
  func kindEqual(left : Types.AuditKind, right : Types.AuditKind) : Bool {
    switch (left, right) {
      case (#session, #session) true;
      case (#profile, #profile) true;
      case (#attestation, #attestation) true;
      case (#evaluation, #evaluation) true;
      case (#round, #round) true;
      case (#dispute, #dispute) true;
      case (#transfer, #transfer) true;
      case (#reconciliation, #reconciliation) true;
      case (#governance, #governance) true;
      case _ false;
    };
  };
  func encodeIndex(value : Nat) : Blob {
    var remaining = Nat64.fromNat(value);
    let bytes = Array.init<Nat8>(8, 0);
    var index = 8;
    while (index > 0) {
      index -= 1;
      bytes[index] := Nat8.fromNat(Nat64.toNat(remaining % 256));
      remaining /= 256;
    };
    Blob.fromArrayMut(bytes);
  };
  func decodeIndex(value : Blob) : ?Nat {
    let bytes = Blob.toArray(value);
    if (bytes.size() != 8) return null;
    var result : Nat64 = 0;
    for (byte in bytes.vals()) result := result * 256 + Nat64.fromNat(Nat8.toNat(byte));
    ?Nat64.toNat(result);
  };
};
