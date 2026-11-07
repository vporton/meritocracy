import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Int "mo:base/Int";
import Nat64 "mo:base/Nat64";
import Principal "mo:base/Principal";
import Text "mo:base/Text";
import Normalizer "Normalizer";
import Serialization "Serialization";
import Types "Types";

module {
  public type Result<T> = { #ok : T; #err : Types.AppError };
  public type Request = {
    idempotency_key : Blob;
    subject_user_id : Nat64;
    input_text : Text;
    source_refs : [Types.SourceRef];
    prompt_version : Blob;
    model_version : Text;
  };
  public type Begin = {
    #existing : Types.Evaluation;
    #started : Types.Evaluation;
  };
  public class Store(initial : Types.StableState) {
    var config = initial.config;
    var nextEvaluationId = initial.next_evaluation_id;
    var nextAuditId = initial.next_audit_id;
    var evaluations = initial.evaluations;
    var rateWindows = initial.rate_windows;
    var auditOutbox = initial.audit_outbox;
    public func snapshot() : Types.StableState = {
      config;
      next_evaluation_id = nextEvaluationId;
      next_audit_id = nextAuditId;
      evaluations;
      rate_windows = rateWindows;
      audit_outbox = auditOutbox;
    };
    public func configuration() : Types.Config = config;
    public func configure(next : Types.Config) : Result<()> {
      if (next.submitters.size() == 0 or next.allowed_models.size() == 0 or next.allowed_prompt_versions.size() == 0) return #err(#invalid("submitters, models and prompts cannot be empty"));
      if (next.max_input_bytes == 0 or next.max_input_bytes > 65_536 or next.max_sources > 32 or next.rate_limit_count == 0 or next.rate_limit_window_ns == 0 or next.max_attempts == 0) return #err(#invalid("configuration limits are invalid"));
      for (p in next.submitters.vals()) if (Principal.isAnonymous(p)) return #err(#invalid("submitter cannot be anonymous"));
      for (host in next.allowed_source_hosts.vals()) if (Normalizer.allowedHttpsHost("https://" # host, [host]) == false) return #err(#invalid("allowed source host is invalid"));
      config := next;
      #ok(());
    };
    public func isSubmitter(value : Principal) : Bool = Array.find<Principal>(config.submitters, func(p) { p == value }) != null;
    public func get(id : Nat64) : ?Types.Evaluation = Array.find<Types.Evaluation>(evaluations, func(e) { e.id == id });
    public func getByKey(key : Blob) : ?Types.Evaluation = Array.find<Types.Evaluation>(evaluations, func(e) { e.idempotency_key == key });
    public func all() : [Types.Evaluation] = evaluations;
    public func begin(request : Request, now : Int) : Result<Begin> {
      if (request.idempotency_key.size() != 32 or request.prompt_version.size() != 32) return #err(#invalid("idempotency and prompt hashes must be 32 bytes"));
      if (Text.encodeUtf8(request.input_text).size() == 0 or Text.encodeUtf8(request.input_text).size() > config.max_input_bytes) return #err(#invalid("input text is empty or too large"));
      if (request.source_refs.size() > config.max_sources) return #err(#invalid("too many sources"));
      if (Array.find<Text>(config.allowed_models, func(value) { value == request.model_version }) == null) return #err(#invalid("model is not allowed"));
      if (Array.find<Blob>(config.allowed_prompt_versions, func(value) { value == request.prompt_version }) == null) return #err(#invalid("prompt version is not allowed"));
      let normalizedSources = Array.map<Types.SourceRef, Types.SourceRef>(
        request.source_refs,
        func(source) {
          switch (source.allowed_uri) {
            case null source;
            case (?uri) switch (Normalizer.publicHttpsUri(uri, config.allowed_source_hosts)) {
              case null source;
              case (?normalized) ({ ordinal = source.ordinal; uri_hash = source.uri_hash; allowed_uri = ?normalized } : Types.SourceRef);
            };
          };
        },
      );
      for (source in normalizedSources.vals()) {
        if (source.uri_hash.size() != 32) return #err(#invalid("source hash must be 32 bytes"));
        switch (source.allowed_uri) {
          case null {};
          case (?uri) {
            if (not Normalizer.allowedHttpsHost(uri, config.allowed_source_hosts)) return #err(#invalid("source URI host is not allowed"));
          };
        };
      };
      let inputHash = Serialization.inputHash(request.input_text);
      let ?fingerprint = Serialization.requestFingerprint(request.subject_user_id, inputHash, normalizedSources, request.prompt_version, request.model_version) else return #err(#invalid("request is not canonical"));
      switch (getByKey(request.idempotency_key)) {
        case (?existing) {
          if (existing.request_fingerprint == fingerprint) return #ok(#existing(existing));
          return #err(#conflict("idempotency key identifies a different request"));
        };
        case null {};
      };
      switch (consumeRate(request.subject_user_id, now)) {
        case (#err(error)) return #err(error);
        case (#ok(())) {};
      };
      let attempt : Nat32 = 1;
      let evaluation : Types.Evaluation = {
        id = nextEvaluationId;
        idempotency_key = request.idempotency_key;
        request_fingerprint = fingerprint;
        subject_user_id = request.subject_user_id;
        input_hash = inputHash;
        source_refs = normalizedSources;
        prompt_version = request.prompt_version;
        model_version = request.model_version;
        result_hash = null;
        outcome = null;
        status = #pending;
        attempt;
        attempt_token = Serialization.attemptToken(nextEvaluationId, attempt, fingerprint);
        created_at = now;
        updated_at = now;
      };
      nextEvaluationId += 1;
      evaluations := Array.append(evaluations, [evaluation]);
      ignore enqueue(evaluation.id, "submitted", fingerprint, now);
      #ok(#started(evaluation));
    };
    public func retry(id : Nat64, now : Int) : Result<Types.Evaluation> {
      let ?existing = get(id) else return #err(#not_found);
      switch (existing.status) {
        case (#failed(_)) {};
        case _ return #err(#conflict("only failed evaluations can be retried"));
      };
      if (existing.attempt >= config.max_attempts) return #err(#conflict("maximum attempts reached"));
      switch (consumeRate(existing.subject_user_id, now)) {
        case (#err(error)) return #err(error);
        case (#ok(())) {};
      };
      let attempt = existing.attempt + 1;
      let updated = {
        existing with status = #pending;
        result_hash = null;
        outcome = null;
        attempt;
        attempt_token = Serialization.attemptToken(id, attempt, existing.request_fingerprint);
        updated_at = now;
      };
      replace(updated);
      ignore enqueue(id, "retried", updated.attempt_token, now);
      #ok(updated);
    };
    public func commit(id : Nat64, token : Blob, outcome : Types.EvaluationOutcome, now : Int) : Result<Types.Evaluation> {
      let ?existing = get(id) else return #err(#not_found);
      let resultHash = Serialization.resultHash(outcome);
      switch (existing.status) {
        case (#complete) {
          if (existing.attempt_token == token and existing.result_hash == ?resultHash and existing.outcome == ?outcome) return #ok(existing);
          return #err(#conflict("evaluation already has a different result"));
        };
        case (#pending) {};
        case (#failed(_)) return #err(#conflict("failed evaluation must be retried first"));
      };
      if (existing.attempt_token != token) return #err(#conflict("stale evaluation attempt"));
      switch (outcome) {
        case (#accepted(value)) if (value.weight_denominator == 0 or value.weight_numerator > config.max_weight_numerator) return #err(#invalid("normalized weight is outside configured bounds"));
        case _ {};
      };
      let updated = {
        existing with result_hash = ?resultHash;
        outcome = ?outcome;
        status = #complete;
        updated_at = now;
      };
      replace(updated);
      ignore enqueue(id, "completed", resultHash, now);
      #ok(updated);
    };
    public func fail(id : Nat64, token : Blob, failure : Types.FailureClass, now : Int) : Result<Types.Evaluation> {
      let ?existing = get(id) else return #err(#not_found);
      if (existing.attempt_token != token) return #err(#conflict("stale evaluation attempt"));
      switch (existing.status) {
        case (#pending) {};
        case (#failed(same)) if (same == failure) return #ok(existing);
        case _ return #err(#conflict("evaluation attempt is already terminal"));
      };
      let updated = {
        existing with status = #failed(failure);
        updated_at = now;
      };
      replace(updated);
      ignore enqueue(id, "failed", existing.attempt_token, now);
      #ok(updated);
    };
    public func proposal(id : Nat64) : Result<Types.AllocationProposal> {
      let ?evaluation = get(id) else return #err(#not_found);
      let ?result = evaluation.result_hash else return #err(#conflict("evaluation is not complete"));
      switch (evaluation.outcome) {
        case (?#accepted(value)) #ok({
          evaluation_id = id;
          user_id = evaluation.subject_user_id;
          weight_numerator = value.weight_numerator;
          weight_denominator = value.weight_denominator;
          evidence_hash = Serialization.proposalHash(id, evaluation.subject_user_id, result);
        });
        case (?#rejected(_)) #err(#conflict("rejected evaluation has no allocation proposal"));
        case null #err(#conflict("evaluation is not complete"));
      };
    };
    public func pendingAudit() : [Types.AuditEvent] = Array.filter<Types.AuditEvent>(auditOutbox, func(e) { not e.delivered });
    public func markAudit(id : Nat64, delivered : Bool) : Result<Types.AuditEvent> {
      let ?event = Array.find<Types.AuditEvent>(auditOutbox, func(e) { e.id == id }) else return #err(#not_found);
      let updated = {
        event with attempts = event.attempts + 1;
        delivered = event.delivered or delivered;
      };
      auditOutbox := Array.map<Types.AuditEvent, Types.AuditEvent>(auditOutbox, func(e) { if (e.id == id) updated else e });
      #ok(updated);
    };
    func enqueue(id : Nat64, kind : Text, payload : Blob, now : Int) : Types.AuditEvent {
      let event : Types.AuditEvent = {
        id = nextAuditId;
        evaluation_id = id;
        kind;
        payload_hash = Serialization.auditHash(id, kind, payload);
        created_at = now;
        attempts = 0;
        delivered = false;
      };
      nextAuditId += 1;
      auditOutbox := Array.append(auditOutbox, [event]);
      event;
    };
    func replace(value : Types.Evaluation) {
      evaluations := Array.map<Types.Evaluation, Types.Evaluation>(evaluations, func(e) { if (e.id == value.id) value else e });
    };
    func consumeRate(user : Nat64, now : Int) : Result<()> {
      let existing = Array.find<Types.RateWindow>(rateWindows, func(w) { w.subject_user_id == user });
      switch (existing) {
        case null {
          let created : Types.RateWindow = {
            subject_user_id = user;
            started_at = now;
            count = 1;
          };
          rateWindows := Array.append(rateWindows, [created]);
          #ok(());
        };
        case (?window) {
          let elapsed = now - window.started_at;
          if (elapsed >= Nat64.toNat(config.rate_limit_window_ns)) {
            let reset : Types.RateWindow = {
              window with started_at = now;
              count = (1 : Nat32);
            };
            rateWindows := Array.map<Types.RateWindow, Types.RateWindow>(rateWindows, func(w) { if (w.subject_user_id == user) reset else w });
            return #ok(());
          };
          if (window.count >= config.rate_limit_count) return #err(#rate_limited({ retry_after_ns = Nat64.fromNat(Int.abs(Nat64.toNat(config.rate_limit_window_ns) - elapsed)) }));
          let advanced = { window with count = window.count + 1 };
          rateWindows := Array.map<Types.RateWindow, Types.RateWindow>(rateWindows, func(w) { if (w.subject_user_id == user) advanced else w });
          #ok(());
        };
      };
    };
  };
};
