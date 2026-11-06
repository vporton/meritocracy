import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Nat8 "mo:base/Nat8";
import Principal "mo:base/Principal";
import { test } "mo:test";
import OAuthAdapter "../canisters/registry/OAuthAdapter";

let session = Principal.fromText("aaaaa-aa");
let other = Principal.fromText("2vxsx-fae");
let attemptId = Blob.fromArray(Array.tabulate<Nat8>(32, func(index) { Nat8.fromNat(index) }));

func adapter() : OAuthAdapter.Adapter {
  OAuthAdapter.Adapter({
    site_url = "https://registry.example";
    providers = [{
      name = "GitHub";
      client_id = "public-client";
      authorization_endpoint = "https://github.com/login/oauth/authorize";
      token_endpoint = "https://github.com/login/oauth/access_token";
      user_info_endpoint = "https://api.github.com/user";
      scopes = ["read:user"];
    }];
    allowed_redirect_uris = ["https://app.example/oauth/complete"];
    attempt_ttl_ns = 60;
    context_ttl_ns = 60;
    max_user_info_response_bytes = 16_384;
  });
};

test(
  "OAuth is fail-closed while liminal token exchange is unbounded",
  func() {
    switch (adapter().readiness()) {
      case (#disabled(_)) {};
      case (#ready) assert false;
    };
  },
);

test(
  "OAuth begin binds caller provider redirect and opaque attempt",
  func() {
    let subject = adapter();
    assert subject.begin(other, "github", session, "https://app.example/oauth/complete", attemptId, 10) == #err(#unauthorized);
    switch (subject.begin(session, "unknown", session, "https://app.example/oauth/complete", attemptId, 10)) {
      case (#err(#invalid(_))) {};
      case _ assert false;
    };
    switch (subject.begin(session, "github", session, "https://evil.example", attemptId, 10)) {
      case (#err(#invalid(_))) {};
      case _ assert false;
    };
    switch (subject.begin(session, "github", session, "https://app.example/oauth/complete", attemptId, 10)) {
      case (#ok(start)) {
        assert start.attempt_id == attemptId;
        assert start.expires_at == 70;
      };
      case _ assert false;
    };
  },
);

test(
  "OAuth context and validated subject are single-use and token-free",
  func() {
    let subject = adapter();
    ignore subject.begin(session, "github", session, "https://app.example/oauth/complete", attemptId, 10);
    let store = subject.oauthStore();
    let marker = "meritocracy-attempt-000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
    store.saveContext({
      state = "state-1";
      codeVerifier = "secret-pkce-verifier";
      redirectAfterAuth = ?marker;
      createdAt = 11;
    });
    assert store.getContext("state-1") != null;
    store.removeContext("state-1");
    switch (store.getContext("state-1")) {
      case (?context) assert context.codeVerifier == "";
      case null assert false;
    };
    let completion = subject.consumeValidatedSubject({ provider = "GitHub"; subject = "immutable-42"; oauth_state = "state-1" }, 12);
    switch (completion) {
      case (#ok(value)) {
        assert value.provider == "github";
        assert value.subject == "immutable-42";
        assert value.session_principal == session;
      };
      case _ assert false;
    };
    switch (subject.consumeValidatedSubject({ provider = "github"; subject = "immutable-42"; oauth_state = "state-1" }, 13)) {
      case (#err(#unauthorized)) {};
      case _ assert false;
    };
  },
);

test(
  "OAuth callback rejects provider swap and expiry",
  func() {
    let subject = adapter();
    ignore subject.begin(session, "github", session, "https://app.example/oauth/complete", attemptId, 10);
    let store = subject.oauthStore();
    store.saveContext({
      state = "state-2";
      codeVerifier = "verifier";
      redirectAfterAuth = ?"meritocracy-attempt-000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
      createdAt = 11;
    });
    switch (subject.consumeValidatedSubject({ provider = "google"; subject = "subject"; oauth_state = "state-2" }, 12)) {
      case (#err(#unauthorized)) {};
      case _ assert false;
    };
    switch (subject.consumeValidatedSubject({ provider = "github"; subject = "subject"; oauth_state = "state-2" }, 70)) {
      case (#err(#expired)) {};
      case _ assert false;
    };
  },
);
