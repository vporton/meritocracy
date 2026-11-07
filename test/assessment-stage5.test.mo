import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Debug "mo:base/Debug";
import Error "mo:base/Error";
import Principal "mo:base/Principal";
import { test } "mo:test";
import { test = asyncTest } "mo:test/async";
import Engine "../canisters/assessment/Engine";
import LlmClient "../canisters/assessment/LlmClient";
import Normalizer "../canisters/assessment/Normalizer";
import State "../canisters/assessment/State";
import Types "../canisters/assessment/Types";

let hash = Blob.fromArray(Array.tabulate<Nat8>(32, func(_) { 0x61 }));
let otherHash = Blob.fromArray(Array.tabulate<Nat8>(32, func(_) { 0x62 }));
let config : Types.Config = {
  submitters = [Principal.fromText("aaaaa-aa")];
  audit_canister = null;
  allowed_models = ["mock-model"];
  allowed_prompt_versions = [hash];
  allowed_source_hosts = ["example.org"];
  max_input_bytes = 1_024;
  max_sources = 4;
  max_weight_numerator = 100;
  rate_limit_count = 10;
  rate_limit_window_ns = 1_000;
  max_attempts = 2;
};
func request(key : Blob, text : Text) : State.Request = {
  idempotency_key = key;
  subject_user_id = 9;
  input_text = text;
  source_refs = [{
    ordinal = 0;
    uri_hash = hash;
    allowed_uri = ?"https://example.org/evidence";
  }];
  prompt_version = hash;
  model_version = "mock-model";
};
let rawAccepted : LlmClient.RawResponse = {
  tool_calls = [{
    name = LlmClient.expectedToolName;
    arguments = [
      { name = "decision"; value = "accepted" },
      { name = "weight_numerator"; value = "5" },
      { name = "weight_denominator"; value = "2" },
    ];
  }];
};

await asyncTest(
  "mocked normal result, exact duplicate, conflict, and immutable result",
  func() : async () {
    let store = State.Store(Types.emptyState);
    ignore store.configure(config);
    var providerCalls = 0;
    let sender : Engine.Sender = func(_request : LlmClient.Request) : async LlmClient.RawResponse {
      providerCalls += 1;
      rawAccepted;
    };
    let #ok(#started(first)) = store.begin(request(hash, "evidence"), 1) else Debug.trap("start");
    let #ok(raw) = await Engine.request(sender, { model = first.model_version; input_text = "evidence"; sources = [] }) else Debug.trap("provider");
    let #ok(outcome) = Normalizer.normalize(raw.tool_calls, { max_weight_numerator = 100 }) else Debug.trap("normalize");
    let #ok(done) = store.commit(first.id, first.attempt_token, outcome, 2) else Debug.trap("commit");
    switch (store.begin(request(hash, "evidence"), 3)) {
      case (#ok(#existing(_))) {};
      case _ Debug.trap("duplicate");
    };
    assert providerCalls == 1;
    assert store.begin(request(hash, "changed"), 3) == #err(#conflict("idempotency key identifies a different request"));
    assert store.commit(first.id, first.attempt_token, #rejected("policy"), 4) == #err(#conflict("evaluation already has a different result"));
    let #ok(proposal) = store.proposal(done.id) else Debug.trap("proposal");
    assert proposal.weight_numerator == 5 and proposal.weight_denominator == 2;
  },
);

test(
  "malformed and conflicting provider responses are closed",
  func() {
    assert Normalizer.normalize([], { max_weight_numerator = 100 }) == #err("exactly one record_assessment tool call is required");
    assert Normalizer.normalize([{ rawAccepted.tool_calls[0] with arguments = [{ name = "decision"; value = "accepted" }] }], { max_weight_numerator = 100 }) == #err("accepted result has unexpected arguments");
    assert Engine.classifyCode(#system_unknown) == #timeout;
    assert Engine.classifyCode(#system_transient) == #provider_unavailable;
  },
);

await asyncTest(
  "provider rejection is classified without retaining its message",
  func() : async () {
    let rejecting : Engine.Sender = func(_request : LlmClient.Request) : async LlmClient.RawResponse {
      throw Error.reject("secret provider detail");
    };
    switch (await Engine.request(rejecting, { model = "mock-model"; input_text = "x"; sources = [] })) {
      case (#err(#provider_unavailable)) {};
      case _ assert false;
    };
  },
);

test(
  "proposal evidence is pure and does not expose transfer authority",
  func() {
    let store = State.Store(Types.emptyState);
    ignore store.configure(config);
    let #ok(#started(first)) = store.begin(request(otherHash, "safe"), 1) else Debug.trap("start");
    let #ok(_) = store.commit(first.id, first.attempt_token, #accepted({ weight_numerator = 1; weight_denominator = 1 }), 2) else Debug.trap("commit");
    let #ok(proposal) = store.proposal(first.id) else Debug.trap("proposal");
    assert proposal.evidence_hash.size() == 32;
  },
);
