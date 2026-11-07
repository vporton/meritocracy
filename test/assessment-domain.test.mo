import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Debug "mo:base/Debug";
import Principal "mo:base/Principal";
import Test "mo:test";
import Normalizer "../canisters/assessment/Normalizer";
import Serialization "../canisters/assessment/Serialization";
import State "../canisters/assessment/State";
import Types "../canisters/assessment/Types";

let hash = Blob.fromArray(Array.tabulate<Nat8>(32, func(_) { 0x44 }));
let otherHash = Blob.fromArray(Array.tabulate<Nat8>(32, func(_) { 0x55 }));
let submitter = Principal.fromText("aaaaa-aa");
let config : Types.Config = {
  submitters = [submitter];
  audit_canister = null;
  allowed_models = ["model-v1"];
  allowed_prompt_versions = [hash];
  allowed_source_hosts = ["example.org"];
  max_input_bytes = 128;
  max_sources = 2;
  max_weight_numerator = 100;
  rate_limit_count = 1;
  rate_limit_window_ns = 100;
  max_attempts = 2;
};
func request(key : Blob, text : Text) : State.Request = {
  idempotency_key = key;
  subject_user_id = 7;
  input_text = text;
  source_refs = [{
    ordinal = 0;
    uri_hash = hash;
    allowed_uri = ?"https://example.org/evidence?q=1";
  }];
  prompt_version = hash;
  model_version = "model-v1";
};

Test.suite(
  "assessment domain",
  func() {
    Test.test(
      "normalizer accepts one bounded canonical result",
      func() {
        let call : Normalizer.ToolCall = {
          name = "record_assessment";
          arguments = [
            { name = "decision"; value = "accepted" },
            { name = "weight_numerator"; value = "12" },
            { name = "weight_denominator"; value = "5" },
          ];
        };
        assert Normalizer.normalize([call], { max_weight_numerator = 100 }) == #ok(#accepted({ weight_numerator = 12; weight_denominator = 5 }));
        assert Normalizer.normalize([call, call], { max_weight_numerator = 100 }) == #err("exactly one record_assessment tool call is required");
        assert Normalizer.normalize([{ call with arguments = Array.append(call.arguments, [{ name = "extra"; value = "x" }]) }], { max_weight_numerator = 100 }) == #err("accepted result has unexpected arguments");
      },
    );
    Test.test(
      "HTTPS policy compares exact parsed host",
      func() {
        assert Normalizer.allowedHttpsHost("https://example.org/path", ["example.org"]);
        assert not Normalizer.allowedHttpsHost("https://example.org.evil.test/path", ["example.org"]);
        assert not Normalizer.allowedHttpsHost("https://example.org@evil.test/path", ["example.org"]);
        assert not Normalizer.allowedHttpsHost("http://example.org/path", ["example.org"]);
        assert Normalizer.publicHttpsUri("https://example.org/path?token=secret#person", ["example.org"]) == ?"https://example.org/path";
      },
    );
    Test.test(
      "reservation is idempotent, conflicting and rate limited",
      func() {
        assert Serialization.inputHash("untrusted evidence") != Serialization.inputHash("changed");
        assert Serialization.requestFingerprint(7, Serialization.inputHash("untrusted evidence"), request(hash, "x").source_refs, hash, "model-v1") != Serialization.requestFingerprint(7, Serialization.inputHash("changed"), request(hash, "x").source_refs, hash, "model-v1");
        let store = State.Store(Types.emptyState);
        assert store.configure(config) == #ok(());
        let #ok(#started(first)) = store.begin(request(hash, "untrusted evidence"), 1) else Debug.trap("start");
        let #ok(#existing(duplicate)) = store.begin(request(hash, "untrusted evidence"), 2) else Debug.trap("duplicate");
        assert duplicate.id == first.id;
        assert store.begin(request(hash, "changed"), 2) == #err(#conflict("idempotency key identifies a different request"));
        assert store.begin(request(otherHash, "other"), 2) == #err(#rate_limited({ retry_after_ns = 99 }));
        assert first.input_hash.size() == 32 and first.source_refs.size() == 1;
      },
    );
    Test.test(
      "terminal result cannot be overwritten and proposal is deterministic",
      func() {
        let store = State.Store(Types.emptyState);
        ignore store.configure(config);
        let #ok(#started(first)) = store.begin(request(hash, "evidence"), 1) else Debug.trap("start");
        let outcome : Types.EvaluationOutcome = #accepted({
          weight_numerator = 3;
          weight_denominator = 2;
        });
        let #ok(done) = store.commit(first.id, first.attempt_token, outcome, 2) else Debug.trap("commit");
        assert store.commit(first.id, first.attempt_token, outcome, 3) == #ok(done);
        assert store.commit(first.id, first.attempt_token, #rejected("policy"), 3) == #err(#conflict("evaluation already has a different result"));
        let #ok(proposal) = store.proposal(first.id) else Debug.trap("proposal");
        assert proposal.weight_numerator == 3 and proposal.evidence_hash.size() == 32;
        assert store.pendingAudit().size() == 2;
      },
    );
    Test.test(
      "failure retry uses a new token and stale response is rejected",
      func() {
        let store = State.Store(Types.emptyState);
        ignore store.configure({ config with rate_limit_count = (3 : Nat32) });
        let #ok(#started(first)) = store.begin(request(hash, "evidence"), 1) else Debug.trap("start");
        ignore store.fail(first.id, first.attempt_token, #provider_unavailable, 2);
        let #ok(retry) = store.retry(first.id, 3) else Debug.trap("retry");
        assert retry.attempt_token != first.attempt_token;
        assert store.commit(first.id, first.attempt_token, #rejected("policy"), 4) == #err(#conflict("stale evaluation attempt"));
        assert switch (store.commit(first.id, retry.attempt_token, #rejected("policy"), 4)) {
          case (#ok(value)) value.status == #complete;
          case _ false;
        };
      },
    );
  },
);
