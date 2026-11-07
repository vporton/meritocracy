import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Error "mo:base/Error";
import Int "mo:base/Int";
import Nat "mo:base/Nat";
import Nat32 "mo:base/Nat32";
import Nat64 "mo:base/Nat64";
import Nat8 "mo:base/Nat8";
import Principal "mo:base/Principal";
import Text "mo:base/Text";
import Time "mo:base/Time";
import Timer "mo:base/Timer";
import Sha256 "mo:sha2@0/Sha256";
import Serialization "Serialization";
import State "State";
import Types "Types";

persistent actor Rounds {
  type Result<T> = { #ok : T; #err : Types.AppError };
  type UnitResult = { #ok; #err : Types.AppError };
  type Page = { cursor : ?Blob; limit : Nat32 };
  type ExecutionSummary = {
    prepared : Nat32;
    sent : Nat32;
    retryable : Nat32;
    carried : Nat32;
  };
  type Reconciliation = {
    round_id : Types.RoundId;
    ledger_atoms : Nat;
    reserved_atoms : Nat;
    excess_atoms : Nat;
    deficit_atoms : Nat;
    reconciled : Bool;
    checked_at : Types.TimestampNs;
  };
  type PreparedTransfer = {
    allocation_id : Types.AllocationId;
    to : Types.Account;
    amount_atoms : Nat;
    memo : Blob;
    created_at_time : Nat64;
  };
  type RemoteTransfer = {
    allocation_id : Types.AllocationId;
    to : Types.Account;
    amount_atoms : Nat;
    fee_atoms : ?Nat;
    memo : Blob;
    created_at_time : Nat64;
    state : {
      #prepared;
      #executing : Nat32;
      #sent : Nat;
      #retryable_failure : Text;
      #permanent_failure : Text;
    };
  };
  type NetworkId = {
    #icp;
    #bitcoin;
    #ethereum;
    #solana;
    #polkadot;
    #stellar;
    #cosmos;
    #bitcoin_cash;
    #other : Text;
  };
  type Route = { network : NetworkId; asset : ?Types.AssetId };
  type RecipientSnapshot = {
    user_id : Types.UserId;
    payout_account_id : Nat64;
    route : Route;
    normalized_address : Text;
    icrc_account : ?Types.Account;
    captured_at : Types.TimestampNs;
  };
  type Registry = actor {
    authorize_session : shared Principal -> async Result<{ user_id : Types.UserId; expires_at : Types.TimestampNs }>;
    snapshot_recipient : shared {
      user_id : Types.UserId;
      route : Route;
      round_id : Types.RoundId;
    } -> async Result<RecipientSnapshot>;
    credit_carried_balance : shared {
      user_id : Types.UserId;
      balance : {
        asset : Types.AssetId;
        atoms : Nat;
        source_round : Types.RoundId;
        reason : Text;
      };
      allocation_id : Nat64;
    } -> async UnitResult;
    consume_carried_balance : shared {
      allocation_id : Types.AllocationId;
      target_round : Types.RoundId;
    } -> async Result<{ asset : Types.AssetId; atoms : Nat; source_round : Types.RoundId; reason : Text }>;
  };
  type Rollover = {
    allocation_id : Types.AllocationId;
    source_round : Types.RoundId;
    target_round : Types.RoundId;
    to : Types.Account;
    amount_atoms : Nat;
    fee_atoms : Nat;
    memo : Blob;
    created_at_time : Nat64;
    state : {
      #prepared;
      #sent : Nat;
      #retryable_failure : Text;
      #permanent_failure : Text;
    };
  };
  type Vault = actor {
    derive_round_account : shared query {
      asset : Types.AssetId;
      fund : Blob;
      round_id : Types.RoundId;
    } -> async Types.Account;
    reserve_round : shared {
      round_id : Types.RoundId;
      asset : Types.AssetId;
      fund : Blob;
      required_atoms : Nat;
      allocation_version : Blob;
      transfer_count : Nat32;
    } -> async Result<{ round_id : Types.RoundId; asset : Types.AssetId; fund : Blob; required_atoms : Nat; reserved_atoms : Nat; fee_budget_atoms : Nat; accounting_deficit_atoms : Nat; finalized_outstanding_atoms : ?Nat; finalized_outstanding_count : ?Nat32; allocation_version : Blob; transfer_count : Nat32; account : Types.Account }>;
    execute_batch : shared {
      round_id : Types.RoundId;
      allocation_version : Blob;
      transfers : [PreparedTransfer];
    } -> async Result<{ round_id : Types.RoundId; transfers : [RemoteTransfer] }>;
    reconcile_round : shared Types.RoundId -> async Result<Reconciliation>;
    close_round : shared {
      round_id : Types.RoundId;
      outstanding_atoms : Nat;
      outstanding_count : Nat32;
    } -> async Result<{ round_id : Types.RoundId; asset : Types.AssetId; fund : Blob; required_atoms : Nat; reserved_atoms : Nat; fee_budget_atoms : Nat; accounting_deficit_atoms : Nat; finalized_outstanding_atoms : ?Nat; finalized_outstanding_count : ?Nat32; allocation_version : Blob; transfer_count : Nat32; account : Types.Account }>;
    rollover_carried : shared {
      allocation_id : Types.AllocationId;
      source_round : Types.RoundId;
      target_round : Types.RoundId;
      target_fund : Blob;
      amount_atoms : Nat;
      memo : Blob;
    } -> async Result<Rollover>;
  };
  type AuditEvent = {
    event_id : Blob;
    occurred_at : Types.TimestampNs;
    actor_ : Principal;
    subject : {
      #user : Types.UserId;
      #round : Types.RoundId;
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

  let disputeWindowNs : Int = 604_800_000_000_000;
  var stableState : Types.StableState = Types.emptyState;
  var registryCanister : ?Principal = null;
  var vaultCanister : ?Principal = null;
  var auditCanister : ?Principal = null;

  public query func interface_version() : async {
    major : Nat16;
    minor : Nat16;
    patch : Nat16;
    schema_hash : Blob;
  } {
    {
      major = 1;
      minor = 4;
      patch = 0;
      schema_hash = Blob.fromArray([0xd0, 0xe5, 0x6b, 0x25, 0x29, 0x04, 0xc7, 0x09, 0x79, 0xae, 0x81, 0xf2, 0xe2, 0x48, 0x1f, 0x6c, 0xca, 0x10, 0x0b, 0x54, 0x3d, 0x9f, 0x15, 0x47, 0x58, 0xa4, 0xbc, 0xb5, 0x6e, 0x20, 0xdb, 0x2b]);
    };
  };

  public shared ({ caller }) func configure_authorities(config : { registry_canister : Principal; vault_canister : Principal; audit_canister : Principal; managers : [Principal]; dispute_resolvers : [Principal] }) : async UnitResult {
    if (not Principal.isController(caller)) return #err(#forbidden);
    if (Principal.isAnonymous(config.registry_canister) or Principal.isAnonymous(config.vault_canister) or Principal.isAnonymous(config.audit_canister)) return #err(#invalid("dependency canisters cannot be anonymous"));
    let store = State.Store(stableState);
    switch (store.configureAuthorities({ managers = config.managers; dispute_resolvers = config.dispute_resolvers })) {
      case (#err(error)) #err(error);
      case (#ok(())) {
        stableState := store.snapshot();
        registryCanister := ?config.registry_canister;
        vaultCanister := ?config.vault_canister;
        auditCanister := ?config.audit_canister;
        #ok;
      };
    };
  };

  public shared ({ caller }) func create_draft(input : { asset : Types.AssetId; source_fund : Blob; required_atoms : Nat }) : async Result<Types.Round> {
    let initial = State.Store(stableState);
    if (not initial.isManager(caller)) return #err(#forbidden);
    let ?vaultId = vaultCanister else return #err(#internal("vault is not configured"));
    let nextRoundId = initial.snapshot().next_round_id;
    let account = try {
      await (actor (Principal.toText(vaultId)) : Vault).derive_round_account({
        asset = input.asset;
        fund = input.source_fund;
        round_id = nextRoundId;
      });
    } catch (error) {
      return #err(#transient_("vault account derivation rejected: " # Error.message(error)));
    };
    let ?subaccount = account.subaccount else return #err(#internal("vault returned a default account"));
    let store = State.Store(stableState);
    if (not store.isManager(caller)) return #err(#forbidden);
    if (store.snapshot().next_round_id != nextRoundId) return #err(#conflict("round id changed while deriving the vault account"));
    switch (store.createDraft(input.asset, input.source_fund, input.required_atoms, subaccount)) {
      case (#err(error)) #err(error);
      case (#ok(round)) { stableState := store.snapshot(); #ok(round) };
    };
  };

  public shared ({ caller }) func put_allocation_version(input : { round_id : Types.RoundId; expected_previous_version : ?Blob; allocations : [Types.AllocationDraft] }) : async Result<Blob> {
    let store = State.Store(stableState);
    if (not store.isManager(caller)) return #err(#forbidden);
    switch (store.putAllocationVersion(input.round_id, input.expected_previous_version, input.allocations, Time.now())) {
      case (#err(error)) #err(error);
      case (#ok(hash)) { stableState := store.snapshot(); #ok(hash) };
    };
  };
  public query func get_round(roundId : Types.RoundId) : async Result<Types.Round> {
    switch (State.Store(stableState).getRound(roundId)) {
      case null #err(#not_found);
      case (?round) #ok(round);
    };
  };
  public query func list_rounds(input : { status : ?Types.RoundStatus; page : Page }) : async Result<{ items : [Types.Round]; next_cursor : ?Blob }> {
    let store = State.Store(stableState);
    let values = switch (input.status) {
      case null store.allRounds();
      case (?status) Array.filter<Types.Round>(store.allRounds(), func(round) { round.status == status });
    };
    let bounds = switch (pageBounds(values.size(), input.page)) {
      case (#ok(value)) value;
      case (#err(error)) return #err(error);
    };
    #ok({
      items = Array.tabulate<Types.Round>(bounds.end - bounds.start, func(i) { values[bounds.start + i] });
      next_cursor = bounds.next;
    });
  };
  public query func list_allocations(roundId : Types.RoundId, page : Page) : async Result<{ items : [Types.Allocation]; next_cursor : ?Blob }> {
    let store = State.Store(stableState);
    if (store.getRound(roundId) == null) return #err(#not_found);
    let values = Array.map<Types.OperationalAllocation, Types.Allocation>(store.roundAllocations(roundId), func(value) { value.allocation });
    let bounds = switch (pageBounds(values.size(), page)) {
      case (#ok(value)) value;
      case (#err(error)) return #err(error);
    };
    #ok({
      items = Array.tabulate<Types.Allocation>(bounds.end - bounds.start, func(i) { values[bounds.start + i] });
      next_cursor = bounds.next;
    });
  };
  public query func get_dispute(disputeId : Nat64) : async Result<Types.Dispute> {
    switch (State.Store(stableState).getDispute(disputeId)) {
      case null #err(#not_found);
      case (?value) #ok(value);
    };
  };
  public query func list_disputes(input : { round_id : ?Types.RoundId; state : ?Types.DisputeState; page : Page }) : async Result<{ items : [Types.Dispute]; next_cursor : ?Blob }> {
    let values = Array.filter<Types.Dispute>(
      State.Store(stableState).allDisputes(),
      func(value) {
        let roundMatches = switch (input.round_id) {
          case null true;
          case (?roundId) value.round_id == roundId;
        };
        let stateMatches = switch (input.state) {
          case null true;
          case (?state) value.state == state;
        };
        roundMatches and stateMatches;
      },
    );
    let bounds = switch (pageBounds(values.size(), input.page)) {
      case (#ok(value)) value;
      case (#err(error)) return #err(error);
    };
    #ok({
      items = Array.tabulate<Types.Dispute>(bounds.end - bounds.start, func(i) { values[bounds.start + i] });
      next_cursor = bounds.next;
    });
  };

  public shared ({ caller }) func verify_funding(roundId : Types.RoundId) : async Result<Types.Round> {
    let before = State.Store(stableState);
    if (not before.isManager(caller)) return #err(#forbidden);
    let ?round = before.getRound(roundId) else return #err(#not_found);
    let ?allocationVersion = round.allocation_version else return #err(#conflict("allocation version is missing"));
    let transferCount = Nat32.fromNat(before.roundAllocations(roundId).size());
    let ?vaultId = vaultCanister else return #err(#internal("vault is not configured"));
    let reservation = try {
      await (actor (Principal.toText(vaultId)) : Vault).reserve_round({
        round_id = round.id;
        asset = round.asset;
        fund = round.source_fund;
        required_atoms = round.required_atoms;
        allocation_version = allocationVersion;
        transfer_count = transferCount;
      });
    } catch (error) {
      return #err(#transient_("vault reservation rejected: " # Error.message(error)));
    };
    let value = switch (reservation) {
      case (#ok(value)) value;
      case (#err(error)) return #err(error);
    };
    let store = State.Store(stableState);
    if (not store.isManager(caller)) return #err(#forbidden);
    let ?currentRound = store.getRound(roundId) else return #err(#not_found);
    if (currentRound.status != #draft or currentRound.allocation_version != ?allocationVersion or store.roundAllocations(roundId).size() != Nat32.toNat(transferCount)) return #err(#conflict("round allocation changed while funding was verified"));
    if (value.allocation_version != allocationVersion or value.transfer_count != transferCount) return #err(#conflict("vault reservation is bound to a different allocation"));
    switch (store.markFunded(roundId, value.reserved_atoms)) {
      case (#err(error)) #err(error);
      case (#ok(updated)) { stableState := store.snapshot(); #ok(updated) };
    };
  };

  public shared ({ caller }) func finalize(roundId : Types.RoundId) : async Result<Types.Round> {
    let before = State.Store(stableState);
    if (not before.isManager(caller)) return #err(#forbidden);
    let ?round = before.getRound(roundId) else return #err(#not_found);
    if (round.status != #funded) return #err(#conflict("round is not funded"));
    let ?registryId = registryCanister else return #err(#internal("registry is not configured"));
    let registry = (actor (Principal.toText(registryId)) : Registry);
    var recipients : [State.FinalRecipient] = [];
    for (entry in before.roundAllocations(roundId).vals()) {
      let snapshot = try {
        await registry.snapshot_recipient({
          user_id = entry.allocation.draft.user_id;
          route = { network = #icp; asset = ?round.asset };
          round_id = roundId;
        });
      } catch (error) {
        return #err(#transient_("registry snapshot rejected: " # Error.message(error)));
      };
      switch (snapshot) {
        case (#ok(value)) {
          let ?account = value.icrc_account else return #err(#internal("ICP recipient snapshot has no ICRC account"));
          let routeHash = Sha256.fromBlob(#sha256, Text.encodeUtf8(Principal.toText(round.asset.ledger) # ":" # round.asset.symbol));
          let #ok(recipientHash) = Serialization.recipientSnapshotHash(value.user_id, value.payout_account_id, routeHash, Text.encodeUtf8(value.normalized_address)) else return #err(#internal("recipient snapshot hash failed"));
          recipients := Array.append(recipients, [{ allocation_id = entry.allocation.draft.id; disposition = #pay({ account; recipient_hash = recipientHash }) }]);
        };
        case (#err(#not_found)) {
          let reason = "no verified ICP payout route";
          let credited = try {
            await registry.credit_carried_balance({
              user_id = entry.allocation.draft.user_id;
              balance = {
                asset = round.asset;
                atoms = entry.allocation.draft.amount_atoms;
                source_round = roundId;
                reason;
              };
              allocation_id = entry.allocation.draft.id;
            });
          } catch (error) {
            return #err(#transient_("carried balance credit rejected: " # Error.message(error)));
          };
          switch (credited) {
            case (#err(error)) return #err(error);
            case (#ok) {};
          };
          recipients := Array.append(recipients, [{ allocation_id = entry.allocation.draft.id; disposition = #carry(reason) }]);
        };
        case (#err(error)) return #err(error);
      };
    };
    let now = Time.now();
    let store = State.Store(stableState);
    if (not store.isManager(caller)) return #err(#forbidden);
    switch (store.finalize(roundId, recipients, now + disputeWindowNs, now)) {
      case (#err(error)) #err(error);
      case (#ok(updated)) {
        stableState := store.snapshot();
        schedule<system>(updated);
        #ok(updated);
      };
    };
  };

  public shared ({ caller }) func file_dispute(input : { round_id : Types.RoundId; allocation_id : Types.AllocationId; evidence_hash : Blob; reason_code : Text }) : async Result<Types.Dispute> {
    let ?registryId = registryCanister else return #err(#internal("registry is not configured"));
    let authorization = try {
      await (actor (Principal.toText(registryId)) : Registry).authorize_session(caller);
    } catch (error) {
      return #err(#transient_("session authorization rejected: " # Error.message(error)));
    };
    let auth = switch (authorization) {
      case (#ok(value)) value;
      case (#err(error)) return #err(error);
    };
    let store = State.Store(stableState);
    let ?entry = Array.find<Types.OperationalAllocation>(store.roundAllocations(input.round_id), func(value) { value.allocation.draft.id == input.allocation_id }) else return #err(#not_found);
    if (entry.allocation.draft.user_id != auth.user_id) return #err(#forbidden);
    switch (store.fileDispute(input.round_id, input.allocation_id, input.evidence_hash, input.reason_code, Time.now())) {
      case (#err(error)) #err(error);
      case (#ok(dispute)) {
        ignore store.enqueueAudit(input.round_id, "dispute-filed", input.evidence_hash, Time.now());
        stableState := store.snapshot();
        await flushAudit();
        #ok(dispute);
      };
    };
  };

  public shared ({ caller }) func resolve_dispute(input : { dispute_id : Nat64; resolution : Types.DisputeResolution }) : async Result<Types.Dispute> {
    let store = State.Store(stableState);
    if (not store.isResolver(caller)) return #err(#forbidden);
    switch (store.resolveDispute(input.dispute_id, input.resolution)) {
      case (#err(error)) #err(error);
      case (#ok(dispute)) {
        let payload = Sha256.fromBlob(#sha256, Text.encodeUtf8("dispute-resolved:" # Nat64.toText(dispute.id)));
        ignore store.enqueueAudit(dispute.round_id, "dispute-resolved", payload, Time.now());
        stableState := store.snapshot();
        switch (store.getRound(dispute.round_id)) {
          case (?round) switch (round.dispute_ends_at) {
            case (?deadline) if (Time.now() >= deadline) schedule<system>(round);
            case _ {};
          };
          case null {};
        };
        await flushAudit();
        #ok(dispute);
      };
    };
  };

  public shared ({ caller }) func settle_frozen_to_carried(input : { dispute_id : Nat64; reason : Text }) : async Result<Types.Allocation> {
    let before = State.Store(stableState);
    if (not before.isResolver(caller)) return #err(#forbidden);
    if (input.reason == "" or input.reason.size() > 512) return #err(#invalid("settlement reason must be between 1 and 512 characters"));
    let ?dispute = before.getDispute(input.dispute_id) else return #err(#not_found);
    let ?round = before.getRound(dispute.round_id) else return #err(#not_found);
    let ?allocation = Array.find<Types.OperationalAllocation>(before.roundAllocations(dispute.round_id), func(value) { value.allocation.draft.id == dispute.allocation_id }) else return #err(#not_found);
    if (dispute.state != #upheld) return #err(#conflict("dispute is not upheld"));
    let ?registryId = registryCanister else return #err(#internal("registry is not configured"));
    let credited = try {
      await (actor (Principal.toText(registryId)) : Registry).credit_carried_balance({
        user_id = allocation.allocation.draft.user_id;
        balance = {
          asset = round.asset;
          atoms = allocation.allocation.draft.amount_atoms;
          source_round = round.id;
          reason = input.reason;
        };
        allocation_id = allocation.allocation.draft.id;
      });
    } catch (error) {
      return #err(#transient_("carried balance credit rejected: " # Error.message(error)));
    };
    switch (credited) { case (#err(error)) return #err(error); case (#ok) {} };
    let store = State.Store(stableState);
    if (not store.isResolver(caller)) return #err(#forbidden);
    switch (store.settleUpheldFrozen(input.dispute_id, input.reason)) {
      case (#err(error)) #err(error);
      case (#ok(updated)) {
        let payload = Sha256.fromBlob(#sha256, Text.encodeUtf8("frozen-carried:" # Nat64.toText(updated.allocation.draft.id)));
        ignore store.enqueueAudit(updated.round_id, "frozen-settled-carried", payload, Time.now());
        stableState := store.snapshot();
        await flushAudit();
        #ok(updated.allocation);
      };
    };
  };

  public shared ({ caller }) func rollover_carried(input : { source_allocation_id : Types.AllocationId; target_round : Types.RoundId; target_allocation_id : Types.AllocationId }) : async UnitResult {
    let before = State.Store(stableState);
    if (not before.isManager(caller)) return #err(#forbidden);
    let ?source = Array.find<Types.OperationalAllocation>(before.allAllocations(), func(value) { value.allocation.draft.id == input.source_allocation_id }) else return #err(#not_found);
    let ?targetRound = before.getRound(input.target_round) else return #err(#not_found);
    let ?target = Array.find<Types.OperationalAllocation>(before.roundAllocations(input.target_round), func(value) { value.allocation.draft.id == input.target_allocation_id }) else return #err(#not_found);
    let ?targetVersion = targetRound.allocation_version else return #err(#conflict("rollover target allocation version is missing"));
    switch (source.execution) {
      case (#carried(_)) {};
      case _ return #err(#conflict("source allocation is not carried"));
    };
    let ?sourceRound = before.getRound(source.round_id) else return #err(#not_found);
    if (sourceRound.status != #complete) return #err(#conflict("rollover source round must be complete"));
    if (sourceRound.asset != targetRound.asset or source.allocation.draft.user_id != target.allocation.draft.user_id or source.allocation.draft.amount_atoms != target.allocation.draft.amount_atoms) return #err(#conflict("rollover target must preserve asset, user and amount"));
    let binding : Types.RolloverBinding = {
      source_allocation_id = input.source_allocation_id;
      source_round = source.round_id;
      target_round = input.target_round;
      target_allocation_id = input.target_allocation_id;
      target_allocation_version = targetVersion;
    };
    switch (before.getRolloverBinding(input.source_allocation_id)) {
      case null {
        if (targetRound.status != #draft) return #err(#conflict("rollover target must be a draft round"));
      };
      case (?existing) {
        if (existing != binding) return #err(#conflict("source allocation is already bound to a rollover target"));
      };
    };
    switch (before.bindRollover(binding)) {
      case (#err(error)) return #err(error);
      case (#ok(_)) stableState := before.snapshot();
    };
    let ?vaultId = vaultCanister else return #err(#internal("vault is not configured"));
    let memo = Sha256.fromBlob(#sha256, Text.encodeUtf8("meritocracy/rollover/v1:" # Nat64.toText(input.source_allocation_id) # ":" # Nat64.toText(input.target_round)));
    let moved = try {
      await (actor (Principal.toText(vaultId)) : Vault).rollover_carried({
        allocation_id = input.source_allocation_id;
        source_round = source.round_id;
        target_round = input.target_round;
        target_fund = targetRound.source_fund;
        amount_atoms = source.allocation.draft.amount_atoms;
        memo;
      });
    } catch (error) {
      return #err(#transient_("vault rollover rejected: " # Error.message(error)));
    };
    switch (moved) {
      case (#err(error)) return #err(error);
      case (#ok(value)) switch (value.state) {
        case (#sent(_)) {};
        case (#retryable_failure(message)) return #err(#transient_(message));
        case (#permanent_failure(message)) return #err(#conflict(message));
        case _ return #err(#transient_("rollover is pending"));
      };
    };
    let ?registryId = registryCanister else return #err(#internal("registry is not configured"));
    let consumed = try {
      await (actor (Principal.toText(registryId)) : Registry).consume_carried_balance({
        allocation_id = input.source_allocation_id;
        target_round = input.target_round;
      });
    } catch (error) {
      return #err(#transient_("carried claim consumption rejected: " # Error.message(error)));
    };
    switch (consumed) {
      case (#err(error)) #err(error);
      case (#ok(_)) {
        let completed = State.Store(stableState);
        switch (completed.markRolledTo(source.round_id, input.source_allocation_id, input.target_round)) {
          case (#err(error)) #err(error);
          case (#ok(_)) { stableState := completed.snapshot(); #ok };
        };
      };
    };
  };

  public shared ({ caller }) func execute_due(roundId : Types.RoundId) : async Result<ExecutionSummary> {
    if (not State.Store(stableState).isManager(caller)) return #err(#forbidden);
    await executeRound(roundId);
  };
  public shared ({ caller }) func retry_execution(roundId : Types.RoundId) : async Result<ExecutionSummary> {
    if (not State.Store(stableState).isManager(caller)) return #err(#forbidden);
    await executeRound(roundId);
  };
  public shared ({ caller }) func reconcile(roundId : Types.RoundId) : async Result<Reconciliation> {
    if (not State.Store(stableState).isManager(caller)) return #err(#forbidden);
    let ?vaultId = vaultCanister else return #err(#internal("vault is not configured"));
    try {
      await (actor (Principal.toText(vaultId)) : Vault).reconcile_round(roundId);
    } catch (error) {
      #err(#transient_("vault reconciliation rejected: " # Error.message(error)));
    };
  };
  system func postupgrade() {
    for (round in State.Store(stableState).allRounds().vals()) schedule<system>(round);
  };

  func executeRound(roundId : Types.RoundId) : async Result<ExecutionSummary> {
    let first = State.Store(stableState);
    let ?existing = first.getRound(roundId) else return #err(#not_found);
    if (existing.status == #complete) return #ok(summarize(first.roundAllocations(roundId)));
    if (existing.status == #disputing) switch (first.startExecution(roundId, Time.now())) {
      case (#err(error)) return #err(error);
      case (#ok(_)) stableState := first.snapshot();
    };
    let timestamping = State.Store(stableState);
    switch (timestamping.prepareExecutionTimestamp(roundId, Nat64.fromNat(Int.abs(Time.now())))) {
      case (#err(error)) return #err(error);
      case (#ok(())) stableState := timestamping.snapshot();
    };
    let current = State.Store(stableState);
    let ?round = current.getRound(roundId) else return #err(#not_found);
    if (round.status != #executing) return #err(#conflict("round is not executable"));
    let ?version = round.allocation_version else return #err(#internal("allocation version is missing"));
    let allocations = current.roundAllocations(roundId);
    var prepared : [PreparedTransfer] = [];
    for (entry in allocations.vals()) switch (entry.execution) {
      case (#frozen) {};
      case _ switch (entry.recipient) {
        case null {};
        case (?recipient) prepared := Array.append(prepared, [{ allocation_id = entry.allocation.draft.id; to = recipient.account; amount_atoms = entry.allocation.draft.amount_atoms; memo = recipient.memo; created_at_time = recipient.created_at_time }]);
      };
    };
    if (prepared.size() > 0) {
      for (entry in allocations.vals()) switch (entry.execution) {
        case (#prepared or #retryable(_)) {
          let changing = State.Store(stableState);
          ignore changing.markExecuting(roundId, entry.allocation.draft.id);
          stableState := changing.snapshot();
        };
        case _ {};
      };
      let ?vaultId = vaultCanister else return #err(#internal("vault is not configured"));
      let batch = try {
        await (actor (Principal.toText(vaultId)) : Vault).execute_batch({
          round_id = roundId;
          allocation_version = version;
          transfers = prepared;
        });
      } catch (error) {
        return #err(#transient_("vault execution rejected: " # Error.message(error)));
      };
      let value = switch (batch) {
        case (#ok(value)) value;
        case (#err(error)) return #err(error);
      };
      for (transfer in value.transfers.vals()) {
        switch (transfer.state) {
          case (#sent(block)) {
            let changing = State.Store(stableState);
            switch (changing.markPaid(roundId, transfer.allocation_id, block)) {
              case (#err(error)) return #err(error);
              case (#ok(_)) stableState := changing.snapshot();
            };
          };
          case (#retryable_failure(message)) {
            let changing = State.Store(stableState);
            switch (changing.markRetryable(roundId, transfer.allocation_id, message)) {
              case (#err(error)) return #err(error);
              case (#ok(_)) stableState := changing.snapshot();
            };
          };
          case (#permanent_failure(message)) {
            let beforeCredit = State.Store(stableState);
            let ?allocation = Array.find<Types.OperationalAllocation>(beforeCredit.roundAllocations(roundId), func(a) { a.allocation.draft.id == transfer.allocation_id }) else return #err(#internal("vault returned an unknown allocation"));
            let ?registryId = registryCanister else return #err(#internal("registry is not configured"));
            let credited = try {
              await (actor (Principal.toText(registryId)) : Registry).credit_carried_balance({
                user_id = allocation.allocation.draft.user_id;
                balance = {
                  asset = round.asset;
                  atoms = allocation.allocation.draft.amount_atoms;
                  source_round = roundId;
                  reason = message;
                };
                allocation_id = transfer.allocation_id;
              });
            } catch (error) {
              return #err(#transient_("carried balance credit rejected: " # Error.message(error)));
            };
            switch (credited) {
              case (#err(error)) return #err(error);
              case (#ok) {
                let afterCredit = State.Store(stableState);
                switch (afterCredit.markCarried(roundId, transfer.allocation_id, message)) {
                  case (#err(error)) return #err(error);
                  case (#ok(_)) stableState := afterCredit.snapshot();
                };
              };
            };
          };
          case _ {};
        };
      };
    };
    let ?vaultId = vaultCanister else return #err(#internal("vault is not configured"));
    var outstandingAtoms = 0;
    var outstandingCount : Nat32 = 0;
    for (entry in State.Store(stableState).roundAllocations(roundId).vals()) switch (entry.execution) {
      case (#paid(_)) {};
      case (#carried(reason)) {
        if (not Text.startsWith(reason, #text("rolled-to:"))) {
          outstandingAtoms += entry.allocation.draft.amount_atoms;
          outstandingCount += 1;
        };
      };
      case (#frozen) {
        outstandingAtoms += entry.allocation.draft.amount_atoms;
        outstandingCount += 1;
      };
      case _ return #err(#conflict("nonterminal allocations remain"));
    };
    let closed = try {
      await (actor (Principal.toText(vaultId)) : Vault).close_round({
        round_id = roundId;
        outstanding_atoms = outstandingAtoms;
        outstanding_count = outstandingCount;
      });
    } catch (error) {
      return #err(#transient_("vault close rejected: " # Error.message(error)));
    };
    switch (closed) { case (#err(error)) return #err(error); case (#ok(_)) {} };
    let reconciled = try {
      await (actor (Principal.toText(vaultId)) : Vault).reconcile_round(roundId);
    } catch (error) {
      return #err(#transient_("vault reconciliation rejected: " # Error.message(error)));
    };
    switch (reconciled) {
      case (#err(error)) return #err(error);
      case (#ok(value)) {
        let completing = State.Store(stableState);
        switch (completing.complete(roundId, value.reconciled)) {
          case (#ok(_)) stableState := completing.snapshot();
          case (#err(#conflict(_))) {};
          case (#err(error)) return #err(error);
        };
      };
    };
    #ok(summarize(State.Store(stableState).roundAllocations(roundId)));
  };

  func schedule<system>(round : Types.Round) {
    if (round.status != #disputing) return;
    let ?deadline = round.dispute_ends_at else return;
    let delay = Int.abs(Int.max(0, deadline - Time.now()));
    ignore Timer.setTimer<system>(#nanoseconds(delay), func() : async () { ignore await executeRound(round.id) });
  };
  func flushAudit() : async () {
    let ?auditId = auditCanister else return;
    let audit = (actor (Principal.toText(auditId)) : Audit);
    for (event in State.Store(stableState).pendingAudit().vals()) {
      let eventId = Sha256.fromBlob(#sha256, Text.encodeUtf8("rounds-audit:" # Nat64.toText(event.id) # ":" # Nat64.toText(event.round_id)));
      let result = try {
        await audit.append({
          event_id = eventId;
          occurred_at = event.created_at;
          actor_ = Principal.fromActor(Rounds);
          subject = #round(event.round_id);
          kind = #dispute;
          payload_hash = event.payload_hash;
          public_payload = Blob.fromArray([]);
        });
      } catch (_) { #err(#transient_("audit append rejected")) };
      let store = State.Store(stableState);
      ignore store.markAuditAttempt(event.id, switch (result) { case (#ok(_)) true; case _ false });
      stableState := store.snapshot();
    };
  };
  func summarize(values : [Types.OperationalAllocation]) : ExecutionSummary {
    var prepared : Nat32 = 0;
    var sent : Nat32 = 0;
    var retryable : Nat32 = 0;
    var carried : Nat32 = 0;
    for (value in values.vals()) switch (value.execution) {
      case (#prepared or #executing(_)) prepared += 1;
      case (#paid(_)) sent += 1;
      case (#retryable(_)) retryable += 1;
      case (#carried(_)) carried += 1;
      case (#frozen) {};
    };
    { prepared; sent; retryable; carried };
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
