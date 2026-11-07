import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Int "mo:base/Int";
import Nat "mo:base/Nat";
import Nat32 "mo:base/Nat32";
import Nat64 "mo:base/Nat64";
import Nat8 "mo:base/Nat8";
import Principal "mo:base/Principal";
import Text "mo:base/Text";
import Time "mo:base/Time";
import Engine "Engine";
import LlmClient "LlmClient";
import Normalizer "Normalizer";
import Serialization "Serialization";
import State "State";
import Types "Types";

persistent actor Assessment {
  type Result<T> = { #ok : T; #err : Types.AppError };
  type UnitResult = { #ok; #err : Types.AppError };
  type Page = { cursor : ?Blob; limit : Nat32 };
  type SubmitInput = {
    idempotency_key : Blob;
    subject_user_id : Nat64;
    input_text : Text;
    source_refs : [Types.SourceRef];
    prompt_version : Blob;
    model_version : Text;
  };
  type AuditEvent = {
    event_id : Blob;
    occurred_at : Int;
    actor_ : Principal;
    subject : {
      #user : Nat64;
      #round : Nat64;
      #allocation : Nat64;
      #evaluation : Nat64;
      #system_ : Text;
    };
    kind : {
      #session;
      #profile;
      #attestation;
      #evaluation;
      #round;
      #dispute;
      #transfer;
      #reconciliation;
      #governance;
    };
    payload_hash : Blob;
    public_payload : Blob;
  };
  type Audit = actor { append : shared AuditEvent -> async Result<AuditEvent> };
  type Registry = actor {
    authorize_session : shared Principal -> async Result<{ user_id : Nat64; expires_at : Int }>;
  };

  var stableState : Types.StableState = Types.emptyState;
  var registryCanister : ?Principal = null;
  var spendingPaused : Bool = true;
  var globalBudgetLimit : Nat32 = 0;
  var callerBudgetLimit : Nat32 = 0;
  var budgetWindowNs : Nat64 = 3_600_000_000_000;
  var globalBudgetStartedAt : Int = 0;
  var globalBudgetCount : Nat32 = 0;
  var callerBudgets : [(Principal, Int, Nat32)] = [];

  public query func interface_version() : async {
    major : Nat16;
    minor : Nat16;
    patch : Nat16;
    schema_hash : Blob;
  } {
    {
      major = 1;
      minor = 3;
      patch = 0;
      schema_hash = Blob.fromArray([0x8b, 0xa8, 0x8d, 0x5c, 0x30, 0x56, 0x7f, 0xea, 0x25, 0x57, 0x88, 0xc8, 0xce, 0x18, 0xf0, 0x64, 0xbd, 0x4b, 0xf9, 0x3f, 0x40, 0x88, 0x1c, 0xc1, 0xe8, 0xab, 0x68, 0xd2, 0xf2, 0xc1, 0x17, 0x76]);
    };
  };

  public shared ({ caller }) func configure(config : Types.Config) : async UnitResult {
    if (not Principal.isController(caller)) return #err(#forbidden);
    let store = State.Store(stableState);
    switch (store.configure(config)) {
      case (#err(error)) #err(error);
      case (#ok(())) { stableState := store.snapshot(); #ok };
    };
  };

  public shared ({ caller }) func configure_registry(registry_canister : Principal) : async UnitResult {
    if (not Principal.isController(caller)) return #err(#forbidden);
    if (Principal.isAnonymous(registry_canister)) return #err(#invalid("registry canister cannot be anonymous"));
    registryCanister := ?registry_canister;
    #ok;
  };

  public shared ({ caller }) func configure_budget(config : { paused : Bool; global_limit : Nat32; per_caller_limit : Nat32; window_ns : Nat64 }) : async UnitResult {
    if (not Principal.isController(caller)) return #err(#forbidden);
    if (config.window_ns == 0 or (not config.paused and (config.global_limit == 0 or config.per_caller_limit == 0))) return #err(#invalid("active budget limits and window must be positive"));
    spendingPaused := config.paused;
    globalBudgetLimit := config.global_limit;
    callerBudgetLimit := config.per_caller_limit;
    budgetWindowNs := config.window_ns;
    globalBudgetStartedAt := Time.now();
    globalBudgetCount := 0;
    callerBudgets := [];
    #ok;
  };

  public query func budget_status() : async {
    paused : Bool;
    global_limit : Nat32;
    global_used : Nat32;
    per_caller_limit : Nat32;
    window_ns : Nat64;
  } {
    {
      paused = spendingPaused;
      global_limit = globalBudgetLimit;
      global_used = globalBudgetCount;
      per_caller_limit = callerBudgetLimit;
      window_ns = budgetWindowNs;
    };
  };

  public shared ({ caller }) func submit_evaluation(input : SubmitInput) : async Result<Types.Evaluation> {
    let trustedSubmitter = State.Store(stableState).isSubmitter(caller);
    if (not trustedSubmitter) {
      let authorization = await authorizeRegistrySession(caller);
      switch (authorization) {
        case (#err(error)) return #err(error);
        case (#ok(userId)) if (userId != input.subject_user_id) return #err(#forbidden) else {};
      };
    };
    // Re-read after Registry authorization so the await cannot make a stale
    // Store overwrite a concurrent evaluation reservation.
    let initial = State.Store(stableState);
    let request : State.Request = {
      idempotency_key = input.idempotency_key;
      subject_user_id = input.subject_user_id;
      input_text = input.input_text;
      source_refs = input.source_refs;
      prompt_version = input.prompt_version;
      model_version = input.model_version;
    };
    switch (initial.begin(request, Time.now())) {
      case (#err(error)) #err(error);
      case (#ok(#existing(value))) #ok(value);
      case (#ok(#started(value))) {
        switch (consumeBudget(caller, Time.now())) {
          case (#err(error)) return #err(error);
          case (#ok) {};
        };
        // Persist the reservation before the LLM await so a reentrant exact
        // duplicate cannot issue a second provider request.
        stableState := initial.snapshot();
        await evaluate(value, input.input_text);
      };
    };
  };

  public shared ({ caller }) func retry_evaluation(input : { evaluation_id : Nat64; input_text : Text }) : async Result<Types.Evaluation> {
    let preliminary = State.Store(stableState);
    let ?existing = preliminary.get(input.evaluation_id) else return #err(#not_found);
    if (not preliminary.isSubmitter(caller)) {
      let authorization = await authorizeRegistrySession(caller);
      switch (authorization) {
        case (#err(error)) return #err(error);
        case (#ok(userId)) if (userId != existing.subject_user_id) return #err(#forbidden) else {};
      };
    };
    let initial = State.Store(stableState);
    let ?current = initial.get(input.evaluation_id) else return #err(#not_found);
    if (Serialization.inputHash(input.input_text) != current.input_hash) return #err(#conflict("retry input does not match the original commitment"));
    switch (initial.retry(input.evaluation_id, Time.now())) {
      case (#err(error)) #err(error);
      case (#ok(value)) {
        switch (consumeBudget(caller, Time.now())) {
          case (#err(error)) return #err(error);
          case (#ok) {};
        };
        stableState := initial.snapshot();
        await evaluate(value, input.input_text);
      };
    };
  };

  public query func get_evaluation(id : Nat64) : async Result<Types.Evaluation> {
    switch (State.Store(stableState).get(id)) {
      case null #err(#not_found);
      case (?value) #ok(value);
    };
  };
  public query func get_evaluation_by_key(key : Blob) : async Result<Types.Evaluation> {
    switch (State.Store(stableState).getByKey(key)) {
      case null #err(#not_found);
      case (?value) #ok(value);
    };
  };
  public query func list_evaluations(input : { subject : ?Nat64; page : Page }) : async Result<{ items : [Types.Evaluation]; next_cursor : ?Blob }> {
    let values = switch (input.subject) {
      case null State.Store(stableState).all();
      case (?subject) Array.filter<Types.Evaluation>(State.Store(stableState).all(), func(value) { value.subject_user_id == subject });
    };
    let bounds = switch (pageBounds(values.size(), input.page)) {
      case (#err(error)) return #err(error);
      case (#ok(value)) value;
    };
    #ok({
      items = Array.tabulate<Types.Evaluation>(bounds.end - bounds.start, func(i) { values[bounds.start + i] });
      next_cursor = bounds.next;
    });
  };
  public query func propose_allocation(id : Nat64) : async Result<Types.AllocationProposal> {
    State.Store(stableState).proposal(id);
  };

  func evaluate(reserved : Types.Evaluation, inputText : Text) : async Result<Types.Evaluation> {
    let sources = Array.mapFilter<Types.SourceRef, LlmClient.Source>(reserved.source_refs, func(source) { switch (source.allowed_uri) { case null null; case (?uri) ?{ ordinal = source.ordinal; uri } } });
    let provider = await Engine.request(LlmClient.send, { model = reserved.model_version; input_text = inputText; sources });
    let store = State.Store(stableState);
    let result = switch (provider) {
      case (#err(#timeout)) store.fail(reserved.id, reserved.attempt_token, #timeout, Time.now());
      case (#err(#provider_unavailable)) store.fail(reserved.id, reserved.attempt_token, #provider_unavailable, Time.now());
      case (#ok(raw)) switch (Normalizer.normalize(raw.tool_calls, { max_weight_numerator = store.configuration().max_weight_numerator })) {
        case (#err(_)) store.fail(reserved.id, reserved.attempt_token, #malformed_response, Time.now());
        case (#ok(outcome)) store.commit(reserved.id, reserved.attempt_token, outcome, Time.now());
      };
    };
    switch (result) {
      case (#err(error)) #err(error);
      case (#ok(value)) {
        stableState := store.snapshot();
        await flushAudit();
        #ok(value);
      };
    };
  };

  func authorizeRegistrySession(sessionPrincipal : Principal) : async Result<Nat64> {
    let ?registryId = registryCanister else return #err(#forbidden);
    try {
      switch (await (actor (Principal.toText(registryId)) : Registry).authorize_session(sessionPrincipal)) {
        case (#ok(value)) #ok(value.user_id);
        case (#err(error)) #err(error);
      };
    } catch (_) {
      #err(#transient_("registry session authorization rejected"));
    };
  };

  func consumeBudget(caller : Principal, now : Int) : UnitResult {
    if (spendingPaused) return #err(#paused);
    let window = Nat64.toNat(budgetWindowNs);
    if (globalBudgetStartedAt == 0 or now - globalBudgetStartedAt >= window) {
      globalBudgetStartedAt := now;
      globalBudgetCount := 0;
      callerBudgets := [];
    };
    if (globalBudgetCount >= globalBudgetLimit) return #err(#rate_limited({ retry_after_ns = Nat64.fromNat(Int.abs(window - (now - globalBudgetStartedAt))) }));
    var found = false;
    var blocked = false;
    callerBudgets := Array.map<(Principal, Int, Nat32), (Principal, Int, Nat32)>(
      callerBudgets,
      func(entry) {
        if (entry.0 != caller) return entry;
        found := true;
        let current = if (now - entry.1 >= window) (caller, now, (0 : Nat32)) else entry;
        if (current.2 >= callerBudgetLimit) { blocked := true; current } else (caller, current.1, current.2 + 1);
      },
    );
    if (blocked) return #err(#rate_limited({ retry_after_ns = budgetWindowNs }));
    if (not found) callerBudgets := Array.append(callerBudgets, [(caller, now, (1 : Nat32))]);
    globalBudgetCount += 1;
    #ok;
  };

  func flushAudit() : async () {
    let ?auditId = State.Store(stableState).configuration().audit_canister else return;
    let audit = (actor (Principal.toText(auditId)) : Audit);
    for (event in State.Store(stableState).pendingAudit().vals()) {
      let response = try {
        await audit.append({
          event_id = Serialization.auditHash(event.evaluation_id, event.kind, event.payload_hash);
          occurred_at = event.created_at;
          actor_ = Principal.fromActor(Assessment);
          subject = #evaluation(event.evaluation_id);
          kind = #evaluation;
          payload_hash = event.payload_hash;
          public_payload = Blob.fromArray([]);
        });
      } catch (_) { #err(#transient_("audit append rejected")) };
      let store = State.Store(stableState);
      ignore store.markAudit(event.id, switch (response) { case (#ok(_)) true; case _ false });
      stableState := store.snapshot();
    };
  };

  func pageBounds(size : Nat, page : Page) : Result<{ start : Nat; end : Nat; next : ?Blob }> {
    if (page.limit == 0 or page.limit > 100) return #err(#invalid("page limit must be between 1 and 100"));
    let start = switch (page.cursor) {
      case null 0;
      case (?cursor) {
        let ?value = decodeCursor(cursor) else return #err(#invalid("invalid cursor"));
        value;
      };
    };
    if (start > size) return #err(#invalid("cursor is out of range"));
    let end = Nat.min(size, start + Nat32.toNat(page.limit));
    #ok({ start; end; next = if (end < size) ?encodeCursor(end) else null });
  };
  func encodeCursor(value : Nat) : Blob {
    Blob.fromArray(Array.tabulate<Nat8>(8, func(i) { Nat8.fromNat((value / [72_057_594_037_927_936, 281_474_976_710_656, 1_099_511_627_776, 4_294_967_296, 16_777_216, 65_536, 256, 1][i]) % 256) }));
  };
  func decodeCursor(value : Blob) : ?Nat {
    let bytes = Blob.toArray(value);
    if (bytes.size() != 8) return null;
    var out = 0;
    for (byte in bytes.vals()) out := out * 256 + Nat8.toNat(byte);
    ?out;
  };
};
