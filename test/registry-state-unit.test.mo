import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Debug "mo:base/Debug";
import Nat8 "mo:base/Nat8";
import Principal "mo:base/Principal";
import { test } "mo:test";
import State "../canisters/registry/State";
import Types "../canisters/registry/Types";

let ledger = Principal.fromText("aaaaa-aa");
let sessionPrincipal = Principal.fromText("aaaaa-aa");
let route : Types.Route = {
  network = #icp;
  asset = ?{ ledger; symbol = "ICP"; decimals = 8 };
};
let ethereumRoute : Types.Route = { network = #ethereum; asset = null };

func expectAccount(result : { #ok : Types.PayoutAccount; #err : Types.AppError }) : Types.PayoutAccount {
  switch (result) {
    case (#ok(account)) account;
    case (#err(error)) Debug.trap(debug_show (error));
  };
};

test(
  "sessions expire and revoke",
  func() {
    let store = State.Store(Types.emptyState);
    let user = store.createUser(?"Alice", 1);
    let session : Types.Session = {
      session_principal = sessionPrincipal;
      user_id = user.profile.user_id;
      issuer = #internet_identity;
      issued_at = 10;
      expires_at = 20;
      revoked_at = null;
    };
    assert store.putSession(session) == #ok(session);
    assert store.authorizeSession(sessionPrincipal, 19) == #ok({
      user_id = user.profile.user_id;
      expires_at = 20;
    });
    assert store.authorizeSession(sessionPrincipal, 20) == #err(#expired);
    assert store.revokeSession(sessionPrincipal, 15) == #ok(());
    assert store.authorizeSession(sessionPrincipal, 16) == #err(#unauthorized);
  },
);

test(
  "session renewal replaces the principal and revoke-all is user scoped",
  func() {
    let store = State.Store(Types.emptyState);
    let alice = store.createUser(null, 1);
    let bob = store.createUser(null, 2);
    let first : Types.Session = {
      session_principal = sessionPrincipal;
      user_id = alice.profile.user_id;
      issuer = #internet_identity;
      issued_at = 10;
      expires_at = 20;
      revoked_at = null;
    };
    let renewed = { first with issued_at = 11; expires_at = 30 };
    ignore store.putSession(first);
    ignore store.putSession(renewed);
    let bobPrincipal = Principal.fromText("rrkah-fqaaa-aaaaa-aaaaq-cai");
    ignore store.putSession({
      session_principal = bobPrincipal;
      user_id = bob.profile.user_id;
      issuer = #oauth("github");
      issued_at = 10;
      expires_at = 30;
      revoked_at = null;
    });
    assert store.snapshot().sessions.size() == 2;
    assert store.getSession(sessionPrincipal) == ?renewed;
    assert store.revokeAllSessions(alice.profile.user_id, 12) == 1;
    assert store.authorizeSession(sessionPrincipal, 13) == #err(#unauthorized);
    assert store.authorizeSession(bobPrincipal, 13) == #ok({
      user_id = bob.profile.user_id;
      expires_at = 30;
    });
  },
);

test(
  "imported accounts require proof and one route default",
  func() {
    let store = State.Store(Types.emptyState);
    let user = store.createUser(null, 1);
    let imported = expectAccount(store.addPayoutAccount(user.profile.user_id, route, "aaaaa-aa", "aaaaa-aa", #legacy_imported, 2));
    assert store.setPayoutAccountActive(user.profile.user_id, imported.id, true) == #err(#forbidden);
    ignore store.verifyPayoutAccount(user.profile.user_id, imported.id, 3);
    ignore store.setPayoutAccountActive(user.profile.user_id, imported.id, true);
    ignore store.setDefaultPayoutAccount(user.profile.user_id, imported.id);
    switch (store.snapshotRecipient(user.profile.user_id, route, 7, 4)) {
      case (#ok(snapshot)) {
        assert snapshot.payout_account_id == imported.id;
        switch (snapshot.icrc_account) {
          case null assert false;
          case (?account) {
            assert account.owner == ledger;
            assert account.subaccount == null;
          };
        };
      };
      case (#err(_)) assert false;
    };
  },
);

test(
  "payout conflicts defaults and address changes preserve route invariants",
  func() {
    let store = State.Store(Types.emptyState);
    let alice = store.createUser(null, 1);
    let bob = store.createUser(null, 2);
    let first = expectAccount(store.addPayoutAccount(alice.profile.user_id, ethereumRoute, "0xAbC", "0xabc", #pending, 3));
    switch (store.addPayoutAccount(bob.profile.user_id, ethereumRoute, "0xabc", "0xabc", #pending, 4)) {
      case (#err(#conflict(_))) {};
      case _ assert false;
    };
    let distinctAsset : Types.AssetId = {
      ledger;
      symbol = "ckETH";
      decimals = 18;
    };
    let distinctRoute : Types.Route = {
      ethereumRoute with asset = ?distinctAsset
    };
    switch (store.addPayoutAccount(bob.profile.user_id, distinctRoute, "0xabc", "0xabc", #pending, 4)) {
      case (#ok(_)) {};
      case (#err(_)) assert false;
    };

    let second = expectAccount(store.addPayoutAccount(alice.profile.user_id, ethereumRoute, "0xDef", "0xdef", #pending, 5));
    ignore store.verifyPayoutAccount(alice.profile.user_id, first.id, 6);
    ignore store.verifyPayoutAccount(alice.profile.user_id, second.id, 6);
    ignore store.setPayoutAccountActive(alice.profile.user_id, first.id, true);
    ignore store.setPayoutAccountActive(alice.profile.user_id, second.id, true);
    ignore store.setDefaultPayoutAccount(alice.profile.user_id, first.id);
    ignore store.setDefaultPayoutAccount(alice.profile.user_id, second.id);
    let accounts = store.listPayoutAccounts(alice.profile.user_id);
    assert Array.filter<Types.PayoutAccount>(accounts, func(account) { account.default_for_route }).size() == 1;
    switch (store.getPayoutAccount(second.id)) {
      case (?account) assert account.default_for_route;
      case null assert false;
    };

    let imported = expectAccount(store.addPayoutAccount(alice.profile.user_id, route, "old", "old", #legacy_imported, 7));
    assert store.updatePayoutAccountAddress(alice.profile.user_id, imported.id, "new", "new") == #err(#forbidden);
    ignore store.verifyPayoutAccount(alice.profile.user_id, imported.id, 8);
    ignore store.setPayoutAccountActive(alice.profile.user_id, imported.id, true);
    ignore store.setDefaultPayoutAccount(alice.profile.user_id, imported.id);
    let updated = expectAccount(store.updatePayoutAccountAddress(alice.profile.user_id, imported.id, "new", "new"));
    assert updated.verification == #pending;
    assert not updated.active;
    assert not updated.default_for_route;
    assert updated.verified_at == null;
  },
);

test(
  "identity bindings are unique and durable",
  func() {
    let store = State.Store(Types.emptyState);
    let alice = store.createUser(?"Alice", 1);
    let bob = store.createUser(?"Bob", 2);
    let subject = Blob.fromArray(Array.tabulate<Nat8>(32, func(index) { Nat8.fromNat(index) }));
    assert store.bindIdentity(#oauth("github"), subject, alice.profile.user_id) == #ok(());
    assert store.bindIdentity(#oauth("github"), subject, alice.profile.user_id) == #ok(());
    assert store.bindIdentity(#oauth("github"), subject, bob.profile.user_id) == #err(#conflict("identity is already bound"));
    assert store.resolveIdentity(#oauth("github"), subject) == ?alice.profile.user_id;
    assert State.Store(store.snapshot()).resolveIdentity(#oauth("github"), subject) == ?alice.profile.user_id;
  },
);

test(
  "ethereum challenges bind session expire and cannot replay",
  func() {
    let store = State.Store(Types.emptyState);
    let challengeId = Blob.fromArray(Array.tabulate<Nat8>(32, func(index) { Nat8.fromNat(index + 1) }));
    let challenge : Types.EthereumLoginChallenge = {
      challenge_id = challengeId;
      normalized_address = "0xabc";
      session_principal = sessionPrincipal;
      requested_action = "login";
      domain = "meritocracy.example";
      message = "bound message";
      issued_at = 10;
      expires_at = 20;
      consumed_at = null;
    };
    assert store.putEthereumLoginChallenge(challenge) == #ok(challenge);
    switch (store.consumeEthereumLoginChallenge(challengeId, Principal.fromText("2vxsx-fae"), 11)) {
      case (#err(#forbidden)) {};
      case _ assert false;
    };
    switch (store.consumeEthereumLoginChallenge(challengeId, sessionPrincipal, 20)) {
      case (#err(#expired)) {};
      case _ assert false;
    };
    switch (store.consumeEthereumLoginChallenge(challengeId, sessionPrincipal, 19)) {
      case (#ok(consumed)) assert consumed.consumed_at == ?19;
      case _ assert false;
    };
    switch (store.consumeEthereumLoginChallenge(challengeId, sessionPrincipal, 19)) {
      case (#err(#conflict(_))) {};
      case _ assert false;
    };
  },
);

test(
  "challenge issuance is bounded per session and prunes expired entries",
  func() {
    let store = State.Store(Types.emptyState);
    var index : Nat8 = 0;
    while (index < 5) {
      let challenge : Types.EthereumLoginChallenge = {
        challenge_id = Blob.fromArray(
          Array.tabulate<Nat8>(
            32,
            func(position) {
              if (position == 0) index else Nat8.fromNat(position);
            },
          )
        );
        normalized_address = "0xabc";
        session_principal = sessionPrincipal;
        requested_action = "login";
        domain = "meritocracy.example";
        message = "bound message";
        issued_at = 10;
        expires_at = 20;
        consumed_at = null;
      };
      assert store.putEthereumLoginChallenge(challenge) == #ok(challenge);
      index += 1;
    };
    let sixth : Types.EthereumLoginChallenge = {
      challenge_id = Blob.fromArray(
        Array.tabulate<Nat8>(
          32,
          func(position) {
            if (position == 0) 5 else Nat8.fromNat(position);
          },
        )
      );
      normalized_address = "0xabc";
      session_principal = sessionPrincipal;
      requested_action = "login";
      domain = "meritocracy.example";
      message = "bound message";
      issued_at = 10;
      expires_at = 20;
      consumed_at = null;
    };
    switch (store.putEthereumLoginChallenge(sixth)) {
      case (#err(#rate_limited(_))) {};
      case _ assert false;
    };
    let afterExpiry = { sixth with issued_at = 20; expires_at = 30 };
    assert store.putEthereumLoginChallenge(afterExpiry) == #ok(afterExpiry);
    assert store.snapshot().ethereum_login_challenges.size() == 1;
  },
);

test(
  "revoked payout accounts cannot be verified again and snapshots bind rounds",
  func() {
    let store = State.Store(Types.emptyState);
    let user = store.createUser(null, 1);
    let account = expectAccount(store.addPayoutAccount(user.profile.user_id, route, "first", "first", #pending, 2));
    ignore store.revokePayoutAccount(user.profile.user_id, account.id);
    assert store.verifyPayoutAccount(user.profile.user_id, account.id, 3) == #err(#forbidden);

    let active = expectAccount(store.addPayoutAccount(user.profile.user_id, route, "second", "second", #pending, 4));
    ignore store.verifyPayoutAccount(user.profile.user_id, active.id, 5);
    ignore store.setPayoutAccountActive(user.profile.user_id, active.id, true);
    ignore store.setDefaultPayoutAccount(user.profile.user_id, active.id);
    let first = store.snapshotRecipient(user.profile.user_id, route, 99, 6);
    let repeated = store.snapshotRecipient(user.profile.user_id, route, 99, 7);
    assert first == repeated;
    assert store.snapshot().recipient_snapshots.size() == 1;
  },
);

test(
  "carried balance credit is idempotent by allocation",
  func() {
    let store = State.Store(Types.emptyState);
    let user = store.createUser(null, 1);
    let balance : Types.CarriedBalance = {
      asset = { ledger; symbol = "ICP"; decimals = 8 };
      atoms = 9_007_199_254_740_993;
      source_round = 7;
      reason = "no_route";
    };
    assert store.creditCarriedBalance(99, user.profile.user_id, balance) == #ok(());
    assert store.creditCarriedBalance(99, user.profile.user_id, balance) == #ok(());
    assert store.getCarriedBalances(user.profile.user_id) == [balance];
    assert store.consumeCarriedBalance(99, 8) == #ok(balance);
    assert store.consumeCarriedBalance(99, 8) == #ok(balance);
    assert store.consumeCarriedBalance(99, 9) == #err(#conflict("carried balance was consumed by another round"));
    assert store.getCarriedBalances(user.profile.user_id) == [];
  },
);

test(
  "legacy profile import is idempotent, conflict-safe, and shares the user id sequence",
  func() {
    let store = State.Store(Types.emptyState);
    let first = store.importLegacyUser("postgres-v1", "42", ?"Legacy Alice", 123, #active);
    let #ok(mapping) = first else Debug.trap("legacy import failed");
    assert mapping.user_id == 1;
    assert store.importLegacyUser("postgres-v1", "42", ?"Legacy Alice", 123, #active) == first;
    assert store.importLegacyUser("postgres-v1", "42", ?"Changed", 123, #active) == #err(#conflict("legacy user mapping already exists with different profile data"));
    assert store.getLegacyUserMapping("postgres-v1", "42") == ?mapping;
    let normal = store.createUser(null, 124);
    assert normal.profile.user_id == 2;
    let #ok(page) = store.listLegacyUserMappings(null, 10) else Debug.trap("mapping list failed");
    assert page.items == [mapping] and page.next_cursor == null;
    let imported = store.getUser(mapping.user_id);
    assert switch (imported) {
      case (?user) user.profile.created_at == 123 and user.profile.status == #active and user.eligibility == Types.unknownEligibility;
      case null false;
    };
    assert store.snapshot().identity_bindings.size() == 0;
    assert store.snapshot().sessions.size() == 0;
  },
);
