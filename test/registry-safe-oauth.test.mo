import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Nat8 "mo:base/Nat8";
import Principal "mo:base/Principal";
import Text "mo:base/Text";
import IC "mo:ic@3";
import { test } "mo:test";
import { test = asyncTest } "mo:test/async";
import SafeOAuth "../canisters/registry/SafeOAuth";
import Types "../canisters/registry/Types";

let session = Principal.fromText("aaaaa-aa");
let other = Principal.fromText("2vxsx-fae");
let entropy = Blob.fromArray(Array.tabulate<Nat8>(32, func(index) { Nat8.fromNat(index) }));
let verifier = Blob.fromArray(Array.tabulate<Nat8>(32, func(index) { Nat8.fromNat(index + 1) }));
let transformActor = actor "aaaaa-aa" : actor {
  transform : shared query IC.TransformArg -> async IC.HttpRequestResult;
};

func adapter() : SafeOAuth.Adapter {
  SafeOAuth.Adapter({
    site_url = "https://registry.example/";
    providers = [SafeOAuth.githubProvider("public-client"), SafeOAuth.googleProvider("google-client")];
    allowed_redirect_uris = ["https://app.example/oauth/complete"];
    attempt_ttl_ns = 60;
    max_token_response_bytes = 16_384;
    max_user_info_response_bytes = 16_384;
    http_cycles = 230_949_972_000;
  });
};

test(
  "safe OAuth begin binds caller provider redirect state and PKCE",
  func() {
    let subject = adapter();
    assert subject.begin(other, "github", session, "https://app.example/oauth/complete", entropy, verifier, 10) == #err(#unauthorized);
    switch (subject.begin(session, "github", session, "https://evil.example", entropy, verifier, 10)) {
      case (#err(#invalid(_))) {};
      case _ assert false;
    };
    switch (subject.begin(session, "unknown", session, "https://app.example/oauth/complete", entropy, verifier, 10)) {
      case (#err(#invalid(_))) {};
      case _ assert false;
    };
    switch (subject.begin(session, "github", session, "https://app.example/oauth/complete", entropy, verifier, 10)) {
      case (#ok(start)) {
        assert start.attempt_id == entropy;
        assert start.expires_at == 70;
        assert Text.contains(start.login_url, #text("code_challenge_method=S256"));
        assert Text.contains(start.login_url, #text("state="));
      };
      case _ assert false;
    };
    assert subject.attemptCount() == 1;
    switch (subject.begin(session, "github", session, "https://app.example/oauth/complete", entropy, verifier, 11)) {
      case (#err(#conflict(_))) {};
      case _ assert false;
    };
  },
);

test(
  "safe OAuth capacity is bounded per session",
  func() {
    let subject = adapter();
    assert subject.checkCapacity(session, 10) == #ok;
    for (seed in [3, 4, 5].vals()) {
      let e = Blob.fromArray(Array.tabulate<Nat8>(32, func(index) { Nat8.fromNat(index + seed) }));
      let v = Blob.fromArray(Array.tabulate<Nat8>(32, func(index) { Nat8.fromNat(index + seed + 20) }));
      ignore subject.begin(session, "github", session, "https://app.example/oauth/complete", e, v, 10);
    };
    assert subject.checkCapacity(session, 11) == #err(#rate_limited({ retry_after_ns = 60_000_000_000 }));
    let extra = Blob.fromArray(Array.tabulate<Nat8>(32, func(index) { Nat8.fromNat(index + 90) }));
    assert subject.begin(session, "github", session, "https://app.example/oauth/complete", extra, verifier, 11) == #err(#rate_limited({ retry_after_ns = 60_000_000_000 }));
  },
);

await asyncTest(
  "authoritative begin check closes concurrent preflight race",
  func() : async () {
    let subject = adapter();
    func contender(seed : Nat) : async {
      #ok : SafeOAuth.Start;
      #err : Types.AppError;
    } {
      assert subject.checkCapacity(session, 10) == #ok;
      await async {};
      let e = Blob.fromArray(Array.tabulate<Nat8>(32, func(index) { Nat8.fromNat(index + seed) }));
      let v = Blob.fromArray(Array.tabulate<Nat8>(32, func(index) { Nat8.fromNat(index + seed + 40) }));
      subject.begin(session, "github", session, "https://app.example/oauth/complete", e, v, 10);
    };
    let pending = [contender(10), contender(20), contender(30), contender(40)];
    var accepted = 0;
    for (result in pending.vals()) {
      switch (await result) {
        case (#ok(_)) accepted += 1;
        case (#err(#rate_limited(_))) {};
        case _ assert false;
      };
    };
    assert accepted == 3;
    assert subject.attemptCount() == 3;
  },
);

test(
  "HTTPS validation rejects ambiguous authorities and controls",
  func() {
    assert SafeOAuth.safeHttps("https://app.example/oauth/complete");
    assert not SafeOAuth.safeHttps("https://user@app.example/path");
    assert not SafeOAuth.safeHttps("https:///path");
    assert not SafeOAuth.safeHttps("https://app.example:443/path");
    assert not SafeOAuth.safeHttps("https://app.example\\@evil.example/path");
    assert not SafeOAuth.safeHttps("https://app.example\n.evil/path");
    assert not SafeOAuth.safeHttps("https://app..example/path");
  },
);

await asyncTest(
  "safe OAuth completion rejects provider swap expiry and replay",
  func() : async () {
    let subject = adapter();
    let #ok(start) = subject.begin(session, "github", session, "https://app.example/oauth/complete", entropy, verifier, 10) else return assert false;
    let state = Text.stripStart(start.login_url, #text("https://github.com/login/oauth/authorize?"));
    let ?queryText = state else return assert false;
    let stateParts = Text.split(queryText, #char('&'));
    var oauthState = "";
    for (part in stateParts) {
      switch (Text.stripStart(part, #text("state="))) {
        case (?value) oauthState := value;
        case null {};
      };
    };
    assert oauthState != "";
    var calls : Nat = 0;
    let outcall : SafeOAuth.Outcall = func(_request : IC.HttpRequestArgs) : async IC.HttpRequestResult {
      calls += 1;
      if (calls == 1) {
        {
          status = 200;
          headers = [{
            name = "content-type";
            value = "application/json; charset=utf-8";
          }];
          body = Text.encodeUtf8("{\"access_token\":\"transient\",\"token_type\":\"bearer\"}");
        };
      } else {
        {
          status = 200;
          headers = [{ name = "content-type"; value = "application/json" }];
          body = Text.encodeUtf8("{\"id\":42}");
        };
      };
    };
    assert (await subject.completeWith("google", oauthState, "code", 11, transformActor.transform, outcall)) == #err(#unauthorized);
    let completed = await subject.completeWith("github", oauthState, "code", 11, transformActor.transform, outcall);
    switch (completed) {
      case (#ok(value)) {
        assert value.attempt_id == entropy;
        assert value.provider == "github";
        assert value.subject == "42";
      };
      case _ assert false;
    };
    assert calls == 2;
    assert (await subject.completeWith("github", oauthState, "code", 12, transformActor.transform, outcall)) == #err(#unauthorized);

    let expired = adapter();
    let #ok(expiredStart) = expired.begin(session, "github", session, "https://app.example/oauth/complete", entropy, verifier, 10) else return assert false;
    let ?expiredQuery = Text.stripStart(expiredStart.login_url, #text("https://github.com/login/oauth/authorize?")) else return assert false;
    var expiredState = "";
    for (part in Text.split(expiredQuery, #char('&'))) {
      switch (Text.stripStart(part, #text("state="))) {
        case (?value) expiredState := value;
        case null {};
      };
    };
    assert (await expired.completeWith("github", expiredState, "code", 70, transformActor.transform, outcall)) == #err(#expired);
  },
);

await asyncTest(
  "failed token responses consume transient verifier and require JSON",
  func() : async () {
    let subject = adapter();
    let #ok(start) = subject.begin(session, "github", session, "https://app.example/oauth/complete", entropy, verifier, 10) else return assert false;
    let ?queryText = Text.stripStart(start.login_url, #text("https://github.com/login/oauth/authorize?")) else return assert false;
    var oauthState = "";
    for (part in Text.split(queryText, #char('&'))) {
      switch (Text.stripStart(part, #text("state="))) {
        case (?value) oauthState := value;
        case null {};
      };
    };
    var calls : Nat = 0;
    let badOutcall : SafeOAuth.Outcall = func(_request : IC.HttpRequestArgs) : async IC.HttpRequestResult {
      calls += 1;
      {
        status = 200;
        headers = [{ name = "content-type"; value = "text/plain" }];
        body = Text.encodeUtf8("{\"access_token\":\"secret\",\"token_type\":\"bearer\"}");
      };
    };
    assert (await subject.completeWith("github", oauthState, "code", 11, transformActor.transform, badOutcall)) == #err(#unauthorized);
    assert calls == 1;
    assert (await subject.completeWith("github", oauthState, "code", 12, transformActor.transform, badOutcall)) == #err(#unauthorized);
    assert calls == 1;
  },
);

test(
  "safe OAuth prunes expired attempts and keeps providers separated",
  func() {
    let subject = adapter();
    ignore subject.begin(session, "github", session, "https://app.example/oauth/complete", entropy, verifier, 10);
    let nextEntropy = Blob.fromArray(Array.tabulate<Nat8>(32, func(index) { Nat8.fromNat(index + 7) }));
    let nextVerifier = Blob.fromArray(Array.tabulate<Nat8>(32, func(index) { Nat8.fromNat(index + 9) }));
    switch (subject.begin(session, "google", session, "https://app.example/oauth/complete", nextEntropy, nextVerifier, 70)) {
      case (#ok(start)) {
        assert Text.contains(start.login_url, #text("accounts.google.com"));
        assert Text.contains(start.login_url, #text("client_id=google-client"));
      };
      case _ assert false;
    };
    assert subject.attemptCount() == 1;
  },
);

test(
  "provider subjects accept only immutable GitHub id or Google sub",
  func() {
    assert SafeOAuth.parseSubject(#github, Text.encodeUtf8("{\"id\":42,\"login\":\"mutable\"}")) == #ok("42");
    assert SafeOAuth.parseSubject(#google, Text.encodeUtf8("{\"sub\":\"immutable-google-sub\"}")) == #ok("immutable-google-sub");
    assert SafeOAuth.parseSubject(#github, Text.encodeUtf8("{\"id\":\"42\"}")) == #err;
    assert SafeOAuth.parseSubject(#google, Text.encodeUtf8("{\"email\":\"person@example.com\"}")) == #err;
  },
);
