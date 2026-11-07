import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Debug "mo:base/Debug";
import Nat8 "mo:base/Nat8";
import Principal "mo:base/Principal";
import { test } "mo:test";
import State "../canisters/audit/State";
import Types "../canisters/audit/Types";

let eventActor = Principal.fromText("rrkah-fqaaa-aaaaa-aaaaq-cai");
func hash(seed : Nat) : Blob = Blob.fromArray(Array.tabulate<Nat8>(32, func(index) { Nat8.fromNat((seed + index) % 256) }));
func event(id : Nat, subject : Types.AuditSubject, kind : Types.AuditKind, at : Int) : Types.AuditEvent = {
  event_id = hash(id);
  occurred_at = at;
  actor_ = eventActor;
  subject;
  kind;
  payload_hash = hash(id + 64);
  public_payload = Blob.fromArray([Nat8.fromNat(id)]);
};

test(
  "authorities reject anonymous and duplicate principals",
  func() {
    let store = State.Store(Types.emptyState);
    assert store.configureAppenders([Principal.fromText("2vxsx-fae")]) == #err(#invalid("anonymous principal cannot append audit events"));
    assert store.configureAppenders([eventActor, eventActor]) == #err(#invalid("appenders must be unique"));
    assert store.configureAppenders([eventActor]) == #ok(());
    assert store.isAppender(eventActor);
  },
);

test(
  "append is idempotent only for identical content",
  func() {
    let store = State.Store(Types.emptyState);
    let original = event(1, #allocation(9), #dispute, 10);
    assert store.append(original) == #ok(original);
    assert store.append(original) == #ok(original);
    switch (store.append({ original with occurred_at = 11 })) {
      case (#err(#conflict(_))) {};
      case other Debug.trap(debug_show (other));
    };
    assert store.snapshot().events.size() == 1;
    assert store.stats() == { events = 1; public_payload_bytes = 1 };
  },
);

test(
  "duplicate and conflict lookup precede storage quota",
  func() {
    let original = event(1, #allocation(9), #dispute, 10);
    let saturated = State.Store({
      appenders = [];
      events = Array.tabulate<Types.AuditEvent>(State.maxEvents, func(_) { original });
    });
    assert saturated.append(original) == #ok(original);
    switch (saturated.append({ original with occurred_at = 11 })) {
      case (#err(#conflict(_))) {};
      case other Debug.trap(debug_show (other));
    };
    assert not State.withinStorageQuota(0, State.maxPublicPayloadBytes, 1);
    assert State.withinStorageQuota(0, State.maxPublicPayloadBytes - 1, 1);
  },
);

test(
  "event commitment has a stable versioned binary fixture",
  func() {
    let fixture = event(1, #allocation(9), #dispute, -10);
    assert State.eventCommitment(fixture) == Blob.fromArray([
      205,
      113,
      199,
      212,
      82,
      192,
      95,
      107,
      196,
      62,
      90,
      241,
      82,
      89,
      36,
      246,
      17,
      146,
      222,
      224,
      248,
      188,
      49,
      185,
      172,
      132,
      209,
      46,
      30,
      38,
      168,
      197,
    ]);
  },
);

test(
  "filtered pagination neither skips nor duplicates matches",
  func() {
    let store = State.Store(Types.emptyState);
    ignore store.append(event(1, #user(7), #profile, 1));
    ignore store.append(event(2, #round(4), #dispute, 2));
    ignore store.append(event(3, #round(4), #round, 3));
    ignore store.append(event(4, #round(4), #dispute, 4));
    let filter : Types.EventFilter = {
      subject = ?#round(4);
      kind = ?#dispute;
      from = ?2;
      to = ?4;
    };
    let #ok(first) = store.listEvents(filter, null, 1) else Debug.trap("first page failed");
    assert first.items == [event(2, #round(4), #dispute, 2)];
    let ?cursor = first.next_cursor else Debug.trap("missing cursor");
    let #ok(second) = store.listEvents(filter, ?cursor, 1) else Debug.trap("second page failed");
    assert second.items == [event(4, #round(4), #dispute, 4)];
    assert second.next_cursor == null;
  },
);

test(
  "round and user reports summarize matching events",
  func() {
    let store = State.Store(Types.emptyState);
    ignore store.append(event(1, #round(8), #round, 7));
    ignore store.append(event(2, #round(8), #dispute, 12));
    ignore store.append(event(3, #user(5), #profile, 9));
    let #ok(report) = store.reportRound(8) else Debug.trap("round report failed");
    assert report.event_count == 2;
    assert report.last_event_at == ?12;
    assert report.event_root.size() == 32;
    let changed = State.Store(Types.emptyState);
    ignore changed.append({
      event(1, #round(8), #round, 7) with payload_hash = hash(200)
    });
    ignore changed.append(event(2, #round(8), #dispute, 12));
    let #ok(changedReport) = changed.reportRound(8) else Debug.trap("changed report failed");
    assert changedReport.event_root != report.event_root;
    let #ok(user) = store.reportUser(5, null, 10) else Debug.trap("user report failed");
    assert user.events.items.size() == 1;
  },
);
