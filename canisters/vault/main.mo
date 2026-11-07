import Blob "mo:base/Blob";
import Error "mo:base/Error";
import Int "mo:base/Int";
import Nat32 "mo:base/Nat32";
import Nat64 "mo:base/Nat64";
import Nat8 "mo:base/Nat8";
import Principal "mo:base/Principal";
import Time "mo:base/Time";
import Icrc1 "Icrc1";
import Serialization "Serialization";
import State "State";
import Types "Types";

persistent actor Vault {
  type Result<T> = { #ok : T; #err : Types.AppError };
  type UnitResult = { #ok; #err : Types.AppError };
  type Reconciliation = {
    round_id : Types.RoundId;
    ledger_atoms : Nat;
    reserved_atoms : Nat;
    excess_atoms : Nat;
    deficit_atoms : Nat;
    reconciled : Bool;
    checked_at : Types.TimestampNs;
  };

  var stableState : Types.StableState = Types.emptyState;

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
      schema_hash = Blob.fromArray([
        0x32,
        0x6d,
        0xa0,
        0x70,
        0x99,
        0xfe,
        0x00,
        0x13,
        0x4c,
        0x57,
        0x9e,
        0x90,
        0x72,
        0xac,
        0x3c,
        0x2b,
        0x7b,
        0x9b,
        0x39,
        0xac,
        0x26,
        0xdf,
        0x57,
        0xf4,
        0xa2,
        0x2b,
        0xff,
        0x20,
        0xca,
        0xcd,
        0x0f,
        0x81,
      ]);
    };
  };

  public shared ({ caller }) func configure_authorities(config : { rounds_canister : Principal; supported_ledgers : [Principal] }) : async UnitResult {
    if (not Principal.isController(caller)) return #err(#forbidden);
    let store = State.Store(stableState);
    switch (store.configureAuthorities(config.rounds_canister, config.supported_ledgers)) {
      case (#err(error)) #err(error);
      case (#ok(())) { stableState := store.snapshot(); #ok };
    };
  };

  public query func derive_round_account(input : { asset : Types.AssetId; fund : Types.Hash32; round_id : Types.RoundId }) : async Types.Account {
    switch (Serialization.deriveSubaccount(input.asset, input.fund, input.round_id)) {
      case (#ok(subaccount)) (
        {
          owner = Principal.fromActor(Vault);
          subaccount = ?subaccount;
        } : Types.Account
      );
      case (#err(_)) ({ owner = Principal.fromActor(Vault); subaccount = null } : Types.Account);
    };
  };

  public shared ({ caller }) func reserve_round(input : { round_id : Types.RoundId; asset : Types.AssetId; fund : Types.Hash32; required_atoms : Nat; allocation_version : Types.Hash32; transfer_count : Nat32 }) : async Result<Types.Reservation> {
    let initial = State.Store(stableState);
    if (not isRoundsCaller(initial, caller)) return #err(#forbidden);
    if (input.required_atoms == 0) return #err(#invalid("required atoms must be positive"));
    if (input.transfer_count == 0) return #err(#invalid("transfer count must be positive"));
    if (input.allocation_version.size() != 32) return #err(#invalid("allocation version must be 32 bytes"));
    if (not initial.supportsLedger(input.asset.ledger)) return #err(#invalid("asset ledger is not supported"));
    let #ok(subaccount) = Serialization.deriveSubaccount(input.asset, input.fund, input.round_id) else return #err(#invalid("fund must be exactly 32 bytes and asset must be canonical"));
    let account : Types.Account = {
      owner = Principal.fromActor(Vault);
      subaccount = ?subaccount;
    };
    switch (initial.getReservation(input.round_id)) {
      case (?existing) {
        if (existing.asset == input.asset and existing.fund == input.fund and existing.required_atoms == input.required_atoms and existing.allocation_version == input.allocation_version and existing.transfer_count == input.transfer_count and existing.account == account) return #ok(existing);
        return #err(#conflict("round reservation already exists"));
      };
      case null {};
    };
    let fee = try {
      await Icrc1.ledger(input.asset.ledger).icrc1_fee();
    } catch (error) {
      return #err(#transient_("ledger fee call rejected: " # boundedMessage(Error.message(error))));
    };
    let requiredWithFees = input.required_atoms + fee * Nat32.toNat(input.transfer_count);
    let balance = try {
      await Icrc1.ledger(input.asset.ledger).icrc1_balance_of(account);
    } catch (error) {
      return #err(#transient_("ledger balance call rejected: " # boundedMessage(Error.message(error))));
    };
    if (balance < requiredWithFees) return #err(#invalid("round account cannot cover allocation principal and current fees"));
    let store = State.Store(stableState);
    if (not isRoundsCaller(store, caller)) return #err(#forbidden);
    if (not store.supportsLedger(input.asset.ledger)) return #err(#invalid("asset ledger is not supported"));
    switch (store.getReservation(input.round_id)) {
      case (?existing) {
        if (existing.asset == input.asset and existing.fund == input.fund and existing.required_atoms == input.required_atoms and existing.allocation_version == input.allocation_version and existing.transfer_count == input.transfer_count and existing.account == account) return #ok(existing);
        return #err(#conflict("round reservation already exists"));
      };
      case null {};
    };
    switch (store.putReservation({ round_id = input.round_id; asset = input.asset; fund = input.fund; required_atoms = input.required_atoms; reserved_atoms = requiredWithFees; fee_budget_atoms = fee; accounting_deficit_atoms = 0; finalized_outstanding_atoms = null; finalized_outstanding_count = null; allocation_version = input.allocation_version; transfer_count = input.transfer_count; account })) {
      case (#err(error)) #err(error);
      case (#ok(reservation)) {
        stableState := store.snapshot();
        #ok(reservation);
      };
    };
  };

  public shared ({ caller }) func execute_batch(input : { round_id : Types.RoundId; allocation_version : Types.Hash32; transfers : [Types.PreparedTransfer] }) : async Result<Types.BatchExecution> {
    let initial = State.Store(stableState);
    if (not isRoundsCaller(initial, caller)) return #err(#forbidden);
    switch (initial.prepareBatch(input.round_id, input.allocation_version, input.transfers)) {
      case (#err(error)) return #err(error);
      case (#ok(_)) stableState := initial.snapshot();
    };
    for (prepared in input.transfers.vals()) {
      let current = State.Store(stableState);
      let ?transfer = current.getTransfer(prepared.allocation_id) else return #err(#internal("prepared transfer disappeared"));
      switch (transfer.state) {
        case (#sent(_) or #permanent_failure(_)) {};
        case (#executing(_)) {
          await executeTransfer(input.round_id, prepared.allocation_id, transfer.fee_atoms, 0);
        };
        case (#prepared or #retryable_failure(_)) {
          await executeTransfer(input.round_id, prepared.allocation_id, null, 0);
        };
      };
    };
    let finalStore = State.Store(stableState);
    switch (finalStore.getBatch(input.round_id, input.allocation_version)) {
      case null #err(#internal("batch execution disappeared"));
      case (?batch) #ok(batch);
    };
  };

  public shared ({ caller }) func get_round_balance(roundId : Types.RoundId) : async Result<{ atoms : Nat; checked_at : Types.TimestampNs }> {
    let store = State.Store(stableState);
    if (not isRoundsCaller(store, caller) and not Principal.isController(caller)) return #err(#forbidden);
    let ?reservation = store.getReservation(roundId) else return #err(#not_found);
    let atoms = try {
      await Icrc1.ledger(reservation.asset.ledger).icrc1_balance_of(reservation.account);
    } catch (error) {
      return #err(#transient_("ledger balance call rejected: " # boundedMessage(Error.message(error))));
    };
    #ok({ atoms; checked_at = Time.now() });
  };

  public query func get_reservation(roundId : Types.RoundId) : async Result<Types.Reservation> {
    switch (State.Store(stableState).getReservation(roundId)) {
      case null #err(#not_found);
      case (?value) #ok(value);
    };
  };

  public query func get_transfer(allocationId : Types.AllocationId) : async Result<Types.Transfer> {
    switch (State.Store(stableState).getTransfer(allocationId)) {
      case null #err(#not_found);
      case (?value) #ok(value);
    };
  };

  public query func get_rollover(allocationId : Types.AllocationId) : async Result<Types.Rollover> {
    switch (State.Store(stableState).getRollover(allocationId)) {
      case null #err(#not_found);
      case (?value) #ok(value);
    };
  };

  public shared ({ caller }) func rollover_carried(input : { allocation_id : Types.AllocationId; source_round : Types.RoundId; target_round : Types.RoundId; target_fund : Blob; amount_atoms : Nat; memo : Blob }) : async Result<Types.Rollover> {
    let before = State.Store(stableState);
    if (not isRoundsCaller(before, caller)) return #err(#forbidden);
    if (before.isEmergencyPaused()) return #err(#paused);
    if (input.memo.size() != 32 or input.target_fund.size() != 32 or input.amount_atoms == 0) return #err(#invalid("rollover requires amount, 32-byte fund and memo"));
    let ?source = before.getReservation(input.source_round) else return #err(#not_found);
    if (not before.supportsLedger(source.asset.ledger)) return #err(#invalid("asset ledger is not supported"));
    let #ok(targetSubaccount) = Serialization.deriveSubaccount(source.asset, input.target_fund, input.target_round) else return #err(#invalid("target round account is invalid"));
    let target : Types.Account = {
      owner = Principal.fromActor(Vault);
      subaccount = ?targetSubaccount;
    };
    let existing = before.getRollover(input.allocation_id);
    let fee = switch (existing) {
      case (?value) value.fee_atoms;
      case null try { await Icrc1.ledger(source.asset.ledger).icrc1_fee() } catch (error) {
        return #err(#transient_("ledger fee call rejected: " # boundedMessage(Error.message(error))));
      };
    };
    let store = State.Store(stableState);
    if (not isRoundsCaller(store, caller)) return #err(#forbidden);
    let createdAt = switch (store.getRollover(input.allocation_id)) {
      case (?value) value.created_at_time;
      case null Nat64.fromNat(Int.abs(Time.now()));
    };
    let prepared : Types.Rollover = {
      allocation_id = input.allocation_id;
      source_round = input.source_round;
      target_round = input.target_round;
      to = target;
      amount_atoms = input.amount_atoms;
      fee_atoms = fee;
      memo = input.memo;
      created_at_time = createdAt;
      state = #prepared;
    };
    let rollover = switch (store.prepareRollover(prepared)) {
      case (#err(error)) return #err(error);
      case (#ok(value)) value;
    };
    stableState := store.snapshot();
    switch (rollover.state) {
      case (#sent(_)) return #ok(rollover);
      case (#permanent_failure(_)) {
        let retrying = State.Store(stableState);
        ignore retrying.retryRollover(input.allocation_id);
        stableState := retrying.snapshot();
      };
      case _ {};
    };
    let active = switch (State.Store(stableState).getRollover(input.allocation_id)) {
      case (?value) value;
      case null return #err(#internal("rollover disappeared"));
    };
    let args : Icrc1.TransferArgs = {
      from_subaccount = source.account.subaccount;
      to = target;
      amount = active.amount_atoms;
      fee = ?active.fee_atoms;
      memo = ?active.memo;
      created_at_time = ?active.created_at_time;
    };
    let result = try {
      await Icrc1.ledger(source.asset.ledger).icrc1_transfer(args);
    } catch (error) {
      let failed = State.Store(stableState);
      ignore failed.markRolloverRetryable(input.allocation_id, "ledger transfer call rejected: " # boundedMessage(Error.message(error)));
      stableState := failed.snapshot();
      return switch (State.Store(stableState).getRollover(input.allocation_id)) {
        case (?value) #ok(value);
        case null #err(#internal("rollover disappeared"));
      };
    };
    let final = State.Store(stableState);
    switch (result) {
      case (#Ok(block)) switch (final.markRolloverSent(input.allocation_id, block)) {
        case (#err(error)) return #err(error);
        case (#ok(_)) {};
      };
      case (#Err(#Duplicate({ duplicate_of }))) switch (final.markRolloverSent(input.allocation_id, duplicate_of)) {
        case (#err(error)) return #err(error);
        case (#ok(_)) {};
      };
      case (#Err(#TooOld)) {
        ignore final.refreshRolloverTimestamp(input.allocation_id, Nat64.fromNat(Int.abs(Time.now())));
        ignore final.markRolloverRetryable(input.allocation_id, "ledger rejected the expired timestamp; retry is safe");
      };
      case (#Err(error)) switch (Icrc1.classify(error)) {
        case (#bad_fee(expected)) {
          ignore final.setRolloverFee(input.allocation_id, expected);
          ignore final.markRolloverRetryable(input.allocation_id, "ledger fee changed; retry required");
        };
        case (#retryable(message)) ignore final.markRolloverRetryable(input.allocation_id, boundedMessage(message));
        case (#permanent(message)) ignore final.markRolloverPermanent(input.allocation_id, boundedMessage(message));
        case (#duplicate(block)) switch (final.markRolloverSent(input.allocation_id, block)) {
          case (#err(markError)) return #err(markError);
          case (#ok(_)) {};
        };
      };
    };
    stableState := final.snapshot();
    switch (final.getRollover(input.allocation_id)) {
      case (?value) #ok(value);
      case null #err(#internal("rollover disappeared"));
    };
  };

  public shared ({ caller }) func reconcile_round(roundId : Types.RoundId) : async Result<Reconciliation> {
    let store = State.Store(stableState);
    if (not isRoundsCaller(store, caller) and not Principal.isController(caller)) return #err(#forbidden);
    let ?reservation = store.getReservation(roundId) else return #err(#not_found);
    let ledgerAtoms = try {
      await Icrc1.ledger(reservation.asset.ledger).icrc1_balance_of(reservation.account);
    } catch (error) {
      return #err(#transient_("ledger balance call rejected: " # boundedMessage(Error.message(error))));
    };
    #ok({
      round_id = roundId;
      ledger_atoms = ledgerAtoms;
      reserved_atoms = reservation.reserved_atoms;
      excess_atoms = if (ledgerAtoms > reservation.reserved_atoms) ledgerAtoms - reservation.reserved_atoms else 0;
      deficit_atoms = reservation.accounting_deficit_atoms + (if (ledgerAtoms < reservation.reserved_atoms) reservation.reserved_atoms - ledgerAtoms else 0);
      reconciled = ledgerAtoms >= reservation.reserved_atoms and reservation.accounting_deficit_atoms == 0;
      checked_at = Time.now();
    });
  };

  public shared ({ caller }) func close_round(input : { round_id : Types.RoundId; outstanding_atoms : Nat; outstanding_count : Nat32 }) : async Result<Types.Reservation> {
    let before = State.Store(stableState);
    if (not isRoundsCaller(before, caller)) return #err(#forbidden);
    let ?reservation = before.getReservation(input.round_id) else return #err(#not_found);
    switch (reservation.finalized_outstanding_atoms, reservation.finalized_outstanding_count) {
      case (?atoms, ?count) {
        if (atoms == input.outstanding_atoms and count == input.outstanding_count) return #ok(reservation);
        return #err(#conflict("round reservation was finalized with different obligations"));
      };
      case (null, null) {};
      case _ return #err(#internal("round reservation finalization is inconsistent"));
    };
    let fee = try {
      await Icrc1.ledger(reservation.asset.ledger).icrc1_fee();
    } catch (error) {
      return #err(#transient_("ledger fee call rejected: " # boundedMessage(Error.message(error))));
    };
    let required = input.outstanding_atoms + fee * Nat32.toNat(input.outstanding_count);
    let balance = try {
      await Icrc1.ledger(reservation.asset.ledger).icrc1_balance_of(reservation.account);
    } catch (error) {
      return #err(#transient_("ledger balance call rejected: " # boundedMessage(Error.message(error))));
    };
    if (balance < required) return #err(#conflict("round account cannot cover finalized obligations"));
    let final = State.Store(stableState);
    if (not isRoundsCaller(final, caller)) return #err(#forbidden);
    switch (final.finalizeReservation(input.round_id, input.outstanding_atoms, input.outstanding_count, fee)) {
      case (#err(error)) #err(error);
      case (#ok(value)) { stableState := final.snapshot(); #ok(value) };
    };
  };

  public shared ({ caller }) func set_emergency_pause(value : Bool) : async UnitResult {
    if (not Principal.isController(caller)) return #err(#forbidden);
    let store = State.Store(stableState);
    store.setEmergencyPause(value);
    stableState := store.snapshot();
    #ok;
  };

  public query func emergency_pause_status() : async Bool {
    State.Store(stableState).isEmergencyPaused();
  };

  func isRoundsCaller(store : State.Store, caller : Principal) : Bool {
    switch (store.roundsAuthority()) {
      case null false;
      case (?authority) caller == authority;
    };
  };

  func executeTransfer(roundId : Types.RoundId, allocationId : Types.AllocationId, priorFee : ?Nat, badFeeRetries : Nat8) : async () {
    let before = State.Store(stableState);
    let ?reservation = before.getReservation(roundId) else return;
    let ?current = before.getTransfer(allocationId) else return;
    let fee = switch (priorFee) {
      case (?known) known;
      case null {
        try { await Icrc1.ledger(reservation.asset.ledger).icrc1_fee() } catch (error) {
          let failed = State.Store(stableState);
          ignore failed.markExecuting(allocationId);
          ignore failed.markRetryable(allocationId, "ledger fee call rejected: " # boundedMessage(Error.message(error)), 0);
          stableState := failed.snapshot();
          return;
        };
      };
    };
    let executing = State.Store(stableState);
    switch (executing.markExecuting(allocationId)) {
      case (#err(_)) return;
      case (#ok(_)) stableState := executing.snapshot();
    };
    let args : Icrc1.TransferArgs = {
      from_subaccount = reservation.account.subaccount;
      to = current.to;
      amount = current.amount_atoms;
      fee = ?fee;
      memo = ?current.memo;
      created_at_time = ?current.created_at_time;
    };
    let result = try {
      await Icrc1.ledger(reservation.asset.ledger).icrc1_transfer(args);
    } catch (error) {
      let failed = State.Store(stableState);
      ignore failed.markRetryable(allocationId, "ledger transfer call rejected: " # boundedMessage(Error.message(error)), fee);
      stableState := failed.snapshot();
      return;
    };
    switch (result) {
      case (#Ok(blockIndex)) markSent(allocationId, blockIndex, fee);
      case (#Err(#Duplicate({ duplicate_of }))) markSent(allocationId, duplicate_of, fee);
      case (#Err(error)) switch (Icrc1.classify(error)) {
        case (#bad_fee(expectedFee)) {
          let retry = State.Store(stableState);
          ignore retry.markRetryable(allocationId, if (badFeeRetries < 1) "ledger fee changed" else "ledger fee changed repeatedly", fee);
          stableState := retry.snapshot();
          if (badFeeRetries < 1) await executeTransfer(roundId, allocationId, ?expectedFee, badFeeRetries + 1);
        };
        case (#retryable(message)) {
          let failed = State.Store(stableState);
          ignore failed.markRetryable(allocationId, boundedMessage(message), fee);
          stableState := failed.snapshot();
        };
        case (#permanent(message)) {
          let failed = State.Store(stableState);
          ignore failed.markPermanent(allocationId, boundedMessage(message), fee);
          stableState := failed.snapshot();
        };
        case (#duplicate(blockIndex)) markSent(allocationId, blockIndex, fee);
      };
    };
  };

  func markSent(allocationId : Types.AllocationId, blockIndex : Nat, fee : Nat) {
    let sent = State.Store(stableState);
    switch (sent.markSent(allocationId, blockIndex, fee)) {
      case (#ok(_)) stableState := sent.snapshot();
      case (#err(_)) {};
    };
  };

  func boundedMessage(value : Text) : Text {
    if (value.size() <= 512) value else "ledger error (details truncated)";
  };
};
