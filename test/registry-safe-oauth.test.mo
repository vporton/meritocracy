import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Nat8 "mo:base/Nat8";
import Principal "mo:base/Principal";
import Text "mo:base/Text";
import { test } "mo:test";
import SafeOAuth "../canisters/registry/SafeOAuth";

let session = Principal.fromText("aaaaa-aa");
let other = Principal.fromText("2vxsx-fae");
let entropy = Blob.fromArray(Array.tabulate<Nat8>(32, func(index) { Nat8.fromNat(index) }));
let verifier = Blob.fromArray(Array.tabulate<Nat8>(32, func(index) { Nat8.fromNat(index + 1) }));

func adapter() : SafeOAuth.Adapter {
  SafeOAuth.Adapter({
    site_url = "https://registry.example/";
    providers = [SafeOAuth.githubProvider("public-client")];
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
