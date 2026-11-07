import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Nat64 "mo:base/Nat64";
import Principal "mo:base/Principal";
import Text "mo:base/Text";
import Serialization "Serialization";
import Types "Types";

module {
  public type Result<T> = { #ok : T; #err : Types.AppError };
  public type FinalRecipient = {
    allocation_id : Types.AllocationId;
    disposition : {
      #pay : {
        account : Types.Account;
        recipient_hash : Types.Hash32;
      };
      #carry : Text;
    };
  };

  public class Store(initial : Types.StableState) {
    var authorities = initial.authorities;
    var nextRoundId = initial.next_round_id;
    var nextDisputeId = initial.next_dispute_id;
    var nextAuditId = initial.next_audit_id;
    var rounds = initial.rounds;
    var versions = initial.versions;
    var allocations = initial.allocations;
    var disputes = initial.disputes;
    var auditOutbox = initial.audit_outbox;
    var rolloverBindings = initial.rollover_bindings;

    public func snapshot() : Types.StableState {
      {
        authorities;
        next_round_id = nextRoundId;
        next_dispute_id = nextDisputeId;
        next_audit_id = nextAuditId;
        rounds;
        versions;
        allocations;
        disputes;
        audit_outbox = auditOutbox;
        rollover_bindings = rolloverBindings;
      };
    };
    public func authorityConfig() : Types.AuthorityConfig { authorities };
    public func configureAuthorities(config : Types.AuthorityConfig) : Result<()> {
      if (config.managers.size() == 0 or config.dispute_resolvers.size() == 0) return #err(#invalid("authority lists cannot be empty"));
      for (value in config.managers.vals()) if (Principal.isAnonymous(value)) return #err(#invalid("manager cannot be anonymous"));
      for (value in config.dispute_resolvers.vals()) if (Principal.isAnonymous(value)) return #err(#invalid("resolver cannot be anonymous"));
      authorities := config;
      #ok(());
    };
    public func isManager(value : Principal) : Bool {
      Array.find<Principal>(authorities.managers, func(p) { p == value }) != null;
    };
    public func isResolver(value : Principal) : Bool {
      Array.find<Principal>(authorities.dispute_resolvers, func(p) { p == value }) != null;
    };

    public func createDraft(asset : Types.AssetId, sourceFund : Blob, requiredAtoms : Nat, vaultSubaccount : Blob) : Result<Types.Round> {
      if (sourceFund.size() != 32) return #err(#invalid("source fund must be 32 bytes"));
      if (vaultSubaccount.size() != 32) return #err(#invalid("vault subaccount must be 32 bytes"));
      if (requiredAtoms == 0) return #err(#invalid("required atoms must be positive"));
      switch (Serialization.encodeAsset(asset)) {
        case (#err(message)) return #err(#invalid(message));
        case _ {};
      };
      let round : Types.Round = {
        id = nextRoundId;
        asset;
        source_fund = sourceFund;
        status = #draft;
        dispute_ends_at = null;
        required_atoms = requiredAtoms;
        reserved_atoms = 0;
        vault_subaccount = vaultSubaccount;
        allocation_version = null;
      };
      nextRoundId += 1;
      rounds := Array.append(rounds, [round]);
      #ok(round);
    };
    public func getRound(id : Types.RoundId) : ?Types.Round {
      Array.find<Types.Round>(rounds, func(r) { r.id == id });
    };
    public func allRounds() : [Types.Round] { rounds };
    public func getVersion(hash : Blob) : ?Types.AllocationVersion {
      Array.find<Types.AllocationVersion>(versions, func(v) { v.hash == hash });
    };
    public func versionHistory(roundId : Types.RoundId) : [Types.AllocationVersion] {
      Array.filter<Types.AllocationVersion>(versions, func(v) { v.round_id == roundId });
    };
    public func roundAllocations(roundId : Types.RoundId) : [Types.OperationalAllocation] {
      Array.filter<Types.OperationalAllocation>(allocations, func(a) { a.round_id == roundId });
    };
    public func allAllocations() : [Types.OperationalAllocation] { allocations };
    public func getDispute(id : Nat64) : ?Types.Dispute {
      Array.find<Types.Dispute>(disputes, func(d) { d.id == id });
    };
    public func allDisputes() : [Types.Dispute] { disputes };

    public func getRolloverBinding(sourceAllocationId : Types.AllocationId) : ?Types.RolloverBinding {
      Array.find<Types.RolloverBinding>(rolloverBindings, func(value) { value.source_allocation_id == sourceAllocationId });
    };

    public func bindRollover(binding : Types.RolloverBinding) : Result<Types.RolloverBinding> {
      if (binding.target_allocation_version.size() != 32) return #err(#invalid("target allocation version must be 32 bytes"));
      switch (Array.find<Types.RolloverBinding>(rolloverBindings, func(value) { value.source_allocation_id == binding.source_allocation_id })) {
        case (?existing) if (existing == binding) #ok(existing) else #err(#conflict("source allocation is already bound to a rollover target"));
        case null {
          rolloverBindings := Array.append(rolloverBindings, [binding]);
          #ok(binding);
        };
      };
    };

    public func putAllocationVersion(roundId : Types.RoundId, expected : ?Blob, drafts : [Types.AllocationDraft], now : Types.TimestampNs) : Result<Blob> {
      let ?round = getRound(roundId) else return #err(#not_found);
      if (round.status != #draft) return #err(#conflict("allocations are immutable after funding"));
      if (Array.find<Types.RolloverBinding>(rolloverBindings, func(value) { value.target_round == roundId }) != null) return #err(#conflict("allocations are immutable after a rollover target is bound"));
      if (round.allocation_version != expected) return #err(#conflict("allocation version compare-and-swap failed"));
      if (drafts.size() == 0) return #err(#invalid("allocation version cannot be empty"));
      var total = 0;
      for (draft in drafts.vals()) {
        if (draft.amount_atoms == 0) return #err(#invalid("allocation amount must be positive"));
        if (draft.evidence_hash.size() != 32) return #err(#invalid("evidence hash must be 32 bytes"));
        var count = 0;
        for (other in drafts.vals()) if (draft.id == other.id) count += 1;
        if (count > 1) return #err(#conflict("allocation id is duplicated"));
        if (Array.find<Types.OperationalAllocation>(allocations, func(existing) { existing.round_id != roundId and existing.allocation.draft.id == draft.id }) != null) return #err(#conflict("allocation id is already used by another round"));
        total += draft.amount_atoms;
      };
      if (total != round.required_atoms) return #err(#invalid("allocation total must equal required atoms"));
      let entries = Array.map<Types.AllocationDraft, Serialization.VersionEntry>(drafts, func(draft) { { draft; recipient_hash = null } });
      let #ok(hash) = Serialization.allocationVersion(roundId, round.asset, entries) else return #err(#invalid("allocation serialization failed"));
      if (getVersion(hash) == null) versions := Array.append(versions, [{ round_id = roundId; hash; previous = expected; allocations = drafts; created_at = now }]);
      replaceRound({ round with allocation_version = ?hash });
      allocations := Array.append(Array.filter<Types.OperationalAllocation>(allocations, func(a) { a.round_id != roundId }), Array.map<Types.AllocationDraft, Types.OperationalAllocation>(drafts, func(draft) { { round_id = roundId; allocation = { draft; recipient_hash = null; state = #pending }; recipient = null; attempts = 0; execution = #prepared } }));
      #ok(hash);
    };

    public func markFunded(roundId : Types.RoundId, reservedAtoms : Nat) : Result<Types.Round> {
      let ?round = getRound(roundId) else return #err(#not_found);
      if (round.status == #funded and round.reserved_atoms == reservedAtoms) return #ok(round);
      if (round.status != #draft) return #err(#conflict("round is not a draft"));
      if (round.allocation_version == null) return #err(#conflict("allocation version is missing"));
      if (reservedAtoms < round.required_atoms) return #err(#invalid("reserved atoms are below required atoms"));
      let updated = {
        round with status = #funded;
        reserved_atoms = reservedAtoms;
      };
      replaceRound(updated);
      #ok(updated);
    };

    public func finalize(roundId : Types.RoundId, recipients : [FinalRecipient], disputeEndsAt : Types.TimestampNs, now : Types.TimestampNs) : Result<Types.Round> {
      let ?round = getRound(roundId) else return #err(#not_found);
      if (round.status != #funded) return #err(#conflict("round is not funded"));
      if (disputeEndsAt <= now) return #err(#invalid("dispute deadline must be in the future"));
      let current = roundAllocations(roundId);
      if (recipients.size() != current.size()) return #err(#invalid("every allocation needs one disposition"));
      var finalized : [Types.OperationalAllocation] = [];
      for (entry in current.vals()) {
        let matches = Array.filter<FinalRecipient>(recipients, func(r) { r.allocation_id == entry.allocation.draft.id });
        if (matches.size() != 1) return #err(#invalid("allocation dispositions must be unique and complete"));
        let next = switch (matches[0].disposition) {
          case (#carry(reason)) {
            if (reason == "" or reason.size() > 512) return #err(#invalid("carried reason must be between 1 and 512 characters"));
            {
              entry with allocation = {
                entry.allocation with state = #carried(reason)
              };
              execution = #carried(reason);
            };
          };
          case (#pay(payee)) {
            if (payee.recipient_hash.size() != 32) return #err(#invalid("recipient hash must be 32 bytes"));
            switch (payee.account.subaccount) {
              case (?sub) if (sub.size() != 32) return #err(#invalid("recipient subaccount must be 32 bytes"));
              case _ {};
            };
            {
              entry with allocation = {
                entry.allocation with recipient_hash = ?payee.recipient_hash
              };
              recipient = ?{
                account = payee.account;
                recipient_hash = payee.recipient_hash;
                memo = Blob.fromArray([]);
                // ICRC transaction windows are much shorter than the dispute
                // period. The timestamp is persisted when execution first
                // becomes due, not when the recipient is finalized.
                created_at_time = (0 : Nat64);
              };
            };
          };
        };
        finalized := Array.append(finalized, [next]);
      };
      let versionEntries = Array.map<Types.OperationalAllocation, Serialization.VersionEntry>(finalized, func(a) { { draft = a.allocation.draft; recipient_hash = a.allocation.recipient_hash } });
      let #ok(finalHash) = Serialization.allocationVersion(roundId, round.asset, versionEntries) else return #err(#internal("final allocation serialization failed"));
      let prior = round.allocation_version;
      let withMemos = Array.map<Types.OperationalAllocation, Types.OperationalAllocation>(finalized, func(a) { switch (a.recipient) { case null a; case (?recipient) { let #ok(memo) = Serialization.allocationMemo(roundId, a.allocation.draft.id, finalHash) else return a; { a with recipient = ?{ recipient with memo } } } } });
      let drafts = Array.map<Types.OperationalAllocation, Types.AllocationDraft>(finalized, func(a) { a.allocation.draft });
      versions := Array.append(versions, [{ round_id = roundId; hash = finalHash; previous = prior; allocations = drafts; created_at = now }]);
      allocations := Array.append(Array.filter<Types.OperationalAllocation>(allocations, func(a) { a.round_id != roundId }), withMemos);
      let updated = {
        round with status = #disputing;
        dispute_ends_at = ?disputeEndsAt;
        allocation_version = ?finalHash;
      };
      replaceRound(updated);
      #ok(updated);
    };

    public func fileDispute(roundId : Types.RoundId, allocationId : Types.AllocationId, evidenceHash : Blob, reason : Text, now : Types.TimestampNs) : Result<Types.Dispute> {
      let ?round = getRound(roundId) else return #err(#not_found);
      if (round.status != #disputing) return #err(#conflict("round is not accepting disputes"));
      let ?deadline = round.dispute_ends_at else return #err(#internal("dispute deadline is missing"));
      if (now >= deadline) return #err(#expired);
      if (evidenceHash.size() != 32 or reason == "" or reason.size() > 128) return #err(#invalid("32-byte evidence hash and a reason of at most 128 characters are required"));
      let ?allocation = findAllocation(roundId, allocationId) else return #err(#not_found);
      switch (allocation.execution) {
        case (#prepared) {};
        case _ return #err(#conflict("allocation cannot be disputed"));
      };
      if (Array.find<Types.Dispute>(disputes, func(d) { d.round_id == roundId and d.allocation_id == allocationId and d.state == #open }) != null) return #err(#conflict("allocation already has an open dispute"));
      let dispute = {
        id = nextDisputeId;
        round_id = roundId;
        allocation_id = allocationId;
        evidence_hash = evidenceHash;
        reason_code = reason;
        state = #open;
        created_at = now;
      };
      nextDisputeId += 1;
      disputes := Array.append(disputes, [dispute]);
      replaceAllocation({
        allocation with allocation = {
          allocation.allocation with state = #frozen
        };
        execution = #frozen;
      });
      #ok(dispute);
    };

    public func resolveDispute(id : Nat64, resolution : Types.DisputeResolution) : Result<Types.Dispute> {
      let ?dispute = Array.find<Types.Dispute>(disputes, func(d) { d.id == id }) else return #err(#not_found);
      if (dispute.state != #open) return #err(#conflict("dispute is already resolved"));
      let ?allocation = findAllocation(dispute.round_id, dispute.allocation_id) else return #err(#internal("disputed allocation is missing"));
      let updated = switch (resolution) {
        case (#uphold) {
          replaceAllocation({
            allocation with allocation = {
              allocation.allocation with state = #frozen
            };
            execution = #frozen;
          });
          { dispute with state = #upheld };
        };
        case (#reject) {
          replaceAllocation({
            allocation with allocation = {
              allocation.allocation with state = #pending
            };
            execution = #prepared;
          });
          { dispute with state = #rejected };
        };
      };
      disputes := Array.map<Types.Dispute, Types.Dispute>(disputes, func(d) { if (d.id == id) updated else d });
      #ok(updated);
    };

    public func settleUpheldFrozen(disputeId : Nat64, reason : Text) : Result<Types.OperationalAllocation> {
      if (reason == "" or reason.size() > 512) return #err(#invalid("settlement reason must be between 1 and 512 characters"));
      let ?dispute = getDispute(disputeId) else return #err(#not_found);
      if (dispute.state != #upheld) return #err(#conflict("only an upheld dispute can be settled as carried"));
      let ?allocation = findAllocation(dispute.round_id, dispute.allocation_id) else return #err(#not_found);
      switch (allocation.execution) {
        case (#carried(existing)) if (existing == reason) #ok(allocation) else #err(#conflict("allocation already has a different carried settlement"));
        case (#frozen) {
          let updated = {
            allocation with allocation = {
              allocation.allocation with state = #carried(reason)
            };
            execution = #carried(reason);
          };
          replaceAllocation(updated);
          #ok(updated);
        };
        case _ #err(#conflict("disputed allocation is not frozen"));
      };
    };

    public func startExecution(roundId : Types.RoundId, now : Types.TimestampNs) : Result<Types.Round> {
      let ?round = getRound(roundId) else return #err(#not_found);
      if (round.status != #disputing) return #err(#conflict("round is not disputing"));
      let ?deadline = round.dispute_ends_at else return #err(#internal("dispute deadline is missing"));
      if (now < deadline) return #err(#conflict("dispute window is still open"));
      if (Array.find<Types.Dispute>(disputes, func(d) { d.round_id == roundId and d.state == #open }) != null) return #err(#conflict("open disputes remain"));
      let updated = { round with status = #executing };
      replaceRound(updated);
      #ok(updated);
    };

    public func prepareExecutionTimestamp(roundId : Types.RoundId, createdAtTime : Nat64) : Result<()> {
      let ?round = getRound(roundId) else return #err(#not_found);
      if (round.status != #executing) return #err(#conflict("round is not executing"));
      if (createdAtTime == 0) return #err(#invalid("execution timestamp must be positive"));
      allocations := Array.map<Types.OperationalAllocation, Types.OperationalAllocation>(
        allocations,
        func(entry) {
          if (entry.round_id != roundId) return entry;
          switch (entry.recipient) {
            case null entry;
            case (?recipient) {
              if (recipient.created_at_time != 0) entry else {
                let updatedRecipient : Types.Recipient = {
                  recipient with created_at_time = createdAtTime
                };
                { entry with recipient = ?updatedRecipient };
              };
            };
          };
        },
      );
      #ok(());
    };

    public func markExecuting(roundId : Types.RoundId, allocationId : Types.AllocationId) : Result<Types.OperationalAllocation> {
      let ?round = getRound(roundId) else return #err(#not_found);
      if (round.status != #executing) return #err(#conflict("round is not executing"));
      let ?allocation = findAllocation(roundId, allocationId) else return #err(#not_found);
      switch (allocation.execution) {
        case (#prepared or #retryable(_)) {
          let next = {
            allocation with attempts = allocation.attempts + 1;
            execution = #executing(allocation.attempts + 1);
          };
          replaceAllocation(next);
          #ok(next);
        };
        case (#executing(_)) #ok(allocation);
        case _ #err(#conflict("allocation is terminal"));
      };
    };
    public func markRetryable(roundId : Types.RoundId, allocationId : Types.AllocationId, message : Text) : Result<Types.OperationalAllocation> {
      transitionExecution(roundId, allocationId, func(a) { switch (a.execution) { case (#executing(_)) #ok({ a with execution = #retryable(message) }); case _ #err(#conflict("allocation is not executing")) } });
    };
    public func markPaid(roundId : Types.RoundId, allocationId : Types.AllocationId, blockIndex : Nat) : Result<Types.OperationalAllocation> {
      transitionExecution(roundId, allocationId, func(a) { switch (a.execution) { case (#paid(existing)) if (existing == blockIndex) #ok(a) else #err(#conflict("different payment receipt")); case (#executing(_)) #ok({ a with allocation = { a.allocation with state = #paid(blockIndex) }; execution = #paid(blockIndex) }); case _ #err(#conflict("allocation is not executing")) } });
    };
    public func markCarried(roundId : Types.RoundId, allocationId : Types.AllocationId, reason : Text) : Result<Types.OperationalAllocation> {
      if (reason == "" or reason.size() > 512) return #err(#invalid("carried reason must be between 1 and 512 characters"));
      transitionExecution(
        roundId,
        allocationId,
        func(a) {
          switch (a.execution) {
            case (#carried(existing)) if (existing == reason) #ok(a) else #err(#conflict("different carried reason"));
            case (#executing(_)) #ok({
              a with allocation = { a.allocation with state = #carried(reason) };
              execution = #carried(reason);
            });
            case _ #err(#conflict("allocation is not executing"));
          };
        },
      );
    };
    public func markRolledTo(roundId : Types.RoundId, allocationId : Types.AllocationId, targetRound : Types.RoundId) : Result<Types.OperationalAllocation> {
      let reason = "rolled-to:" # Nat64.toText(targetRound);
      transitionExecution(
        roundId,
        allocationId,
        func(a) {
          switch (a.execution) {
            case (#carried(existing)) {
              if (Text.startsWith(existing, #text("rolled-to:")) and existing != reason) return #err(#conflict("allocation was rolled to a different target"));
              #ok({
                a with allocation = {
                  a.allocation with state = #carried(reason)
                };
                execution = #carried(reason);
              });
            };
            case _ #err(#conflict("only a carried allocation can be marked rolled"));
          };
        },
      );
    };
    public func complete(roundId : Types.RoundId, reconciled : Bool) : Result<Types.Round> {
      let ?round = getRound(roundId) else return #err(#not_found);
      if (round.status != #executing) return #err(#conflict("round is not executing"));
      if (not reconciled) return #err(#conflict("vault reconciliation failed"));
      for (a in roundAllocations(roundId).vals()) switch (a.execution) {
        case (#paid(_) or #carried(_) or #frozen) {};
        case _ return #err(#conflict("nonterminal allocations remain"));
      };
      let updated = { round with status = #complete };
      replaceRound(updated);
      #ok(updated);
    };

    public func enqueueAudit(roundId : Types.RoundId, kind : Text, payloadHash : Blob, now : Types.TimestampNs) : Result<Types.AuditEvent> {
      if (getRound(roundId) == null) return #err(#not_found);
      if (kind == "" or payloadHash.size() != 32) return #err(#invalid("audit kind and 32-byte payload hash are required"));
      let event : Types.AuditEvent = {
        id = nextAuditId;
        round_id = roundId;
        kind;
        payload_hash = payloadHash;
        created_at = now;
        attempts = 0;
        delivered = false;
      };
      nextAuditId += 1;
      auditOutbox := Array.append(auditOutbox, [event]);
      #ok(event);
    };
    public func pendingAudit() : [Types.AuditEvent] {
      Array.filter<Types.AuditEvent>(auditOutbox, func(e) { not e.delivered });
    };
    public func markAuditAttempt(id : Nat64, delivered : Bool) : Result<Types.AuditEvent> {
      let ?event = Array.find<Types.AuditEvent>(auditOutbox, func(e) { e.id == id }) else return #err(#not_found);
      let next = {
        event with attempts = event.attempts + 1;
        delivered = event.delivered or delivered;
      };
      auditOutbox := Array.map<Types.AuditEvent, Types.AuditEvent>(auditOutbox, func(e) { if (e.id == id) next else e });
      #ok(next);
    };

    func transitionExecution(roundId : Types.RoundId, allocationId : Types.AllocationId, f : Types.OperationalAllocation -> Result<Types.OperationalAllocation>) : Result<Types.OperationalAllocation> {
      let ?a = findAllocation(roundId, allocationId) else return #err(#not_found);
      switch (f(a)) {
        case (#err(e)) #err(e);
        case (#ok(next)) { replaceAllocation(next); #ok(next) };
      };
    };
    func findAllocation(roundId : Types.RoundId, id : Types.AllocationId) : ?Types.OperationalAllocation {
      Array.find<Types.OperationalAllocation>(allocations, func(a) { a.round_id == roundId and a.allocation.draft.id == id });
    };
    func replaceRound(value : Types.Round) {
      rounds := Array.map<Types.Round, Types.Round>(rounds, func(r) { if (r.id == value.id) value else r });
    };
    func replaceAllocation(value : Types.OperationalAllocation) {
      allocations := Array.map<Types.OperationalAllocation, Types.OperationalAllocation>(allocations, func(a) { if (a.round_id == value.round_id and a.allocation.draft.id == value.allocation.draft.id) value else a });
    };
  };
};
