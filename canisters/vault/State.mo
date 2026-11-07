import Array "mo:base/Array";
import Nat "mo:base/Nat";
import Nat32 "mo:base/Nat32";
import Principal "mo:base/Principal";
import Types "Types";

module {
  public type Result<T> = { #ok : T; #err : Types.AppError };

  public class Store(initial : Types.StableState) {
    var roundsCanister = initial.rounds_canister;
    var supportedLedgers = initial.supported_ledgers;
    var emergencyPaused = initial.emergency_paused;
    var reservations = initial.reservations;
    var transfers = initial.transfers;
    var batches = initial.batches;
    var rollovers = initial.rollovers;

    public func snapshot() : Types.StableState {
      {
        rounds_canister = roundsCanister;
        supported_ledgers = supportedLedgers;
        emergency_paused = emergencyPaused;
        reservations;
        transfers;
        batches;
        rollovers;
      };
    };

    public func configureAuthorities(value : Principal, ledgers : [Principal]) : Result<()> {
      if (Principal.isAnonymous(value)) return #err(#invalid("rounds canister cannot be anonymous"));
      if (ledgers.size() == 0) return #err(#invalid("supported ledgers cannot be empty"));
      for (ledger in ledgers.vals()) if (Principal.isAnonymous(ledger)) return #err(#invalid("supported ledger cannot be anonymous"));
      roundsCanister := ?value;
      supportedLedgers := ledgers;
      #ok(());
    };

    public func roundsAuthority() : ?Principal { roundsCanister };
    public func supportsLedger(value : Principal) : Bool {
      Array.find<Principal>(supportedLedgers, func(ledger) { ledger == value }) != null;
    };

    public func setEmergencyPause(value : Bool) { emergencyPaused := value };
    public func isEmergencyPaused() : Bool { emergencyPaused };

    public func putReservation(reservation : Types.Reservation) : Result<Types.Reservation> {
      if (reservation.fund.size() != 32) return #err(#invalid("fund must be 32 bytes"));
      switch (reservation.account.subaccount) {
        case null return #err(#invalid("round account requires a subaccount"));
        case (?subaccount) {
          if (subaccount.size() != 32) return #err(#invalid("round subaccount must be 32 bytes"));
        };
      };
      if (reservation.required_atoms == 0) return #err(#invalid("required atoms must be positive"));
      switch (getReservation(reservation.round_id)) {
        case null {
          reservations := Array.append(reservations, [reservation]);
          #ok(reservation);
        };
        case (?existing) {
          if (reservationEqual(existing, reservation)) #ok(existing) else #err(#conflict("round reservation already exists"));
        };
      };
    };

    public func getReservation(roundId : Types.RoundId) : ?Types.Reservation {
      Array.find<Types.Reservation>(reservations, func(candidate) { candidate.round_id == roundId });
    };

    public func setReservedAtoms(roundId : Types.RoundId, atoms : Nat) : Result<Types.Reservation> {
      updateReservation(roundId, func(candidate) { { candidate with reserved_atoms = atoms } });
    };

    public func finalizeReservation(roundId : Types.RoundId, outstandingAtoms : Nat, outstandingCount : Nat32, feeBudget : Nat) : Result<Types.Reservation> {
      let ?existing = getReservation(roundId) else return #err(#not_found);
      switch (existing.finalized_outstanding_atoms, existing.finalized_outstanding_count) {
        case (?atoms, ?count) {
          if (atoms == outstandingAtoms and count == outstandingCount) return #ok(existing);
          return #err(#conflict("round reservation was finalized with different obligations"));
        };
        case (null, null) {};
        case _ return #err(#internal("round reservation finalization is inconsistent"));
      };
      updateReservation(
        roundId,
        func(candidate) {
          {
            candidate with
            required_atoms = outstandingAtoms;
            reserved_atoms = outstandingAtoms + feeBudget * Nat32.toNat(outstandingCount);
            fee_budget_atoms = feeBudget;
            transfer_count = outstandingCount;
            finalized_outstanding_atoms = ?outstandingAtoms;
            finalized_outstanding_count = ?outstandingCount;
          };
        },
      );
    };

    func updateReservation(roundId : Types.RoundId, change : Types.Reservation -> Types.Reservation) : Result<Types.Reservation> {
      var updated : ?Types.Reservation = null;
      reservations := Array.map<Types.Reservation, Types.Reservation>(
        reservations,
        func(candidate) {
          if (candidate.round_id == roundId) {
            let next = change(candidate);
            updated := ?next;
            next;
          } else candidate;
        },
      );
      switch (updated) { case null #err(#not_found); case (?value) #ok(value) };
    };

    public func prepareBatch(roundId : Types.RoundId, allocationVersion : Types.Hash32, prepared : [Types.PreparedTransfer]) : Result<Types.BatchExecution> {
      if (emergencyPaused) return #err(#paused);
      if (allocationVersion.size() != 32) return #err(#invalid("allocation version must be 32 bytes"));
      if (prepared.size() == 0) return #err(#invalid("batch must contain transfers"));
      switch (getReservation(roundId)) {
        case null return #err(#not_found);
        case (?_) {};
      };

      switch (findBatch(roundId, allocationVersion)) {
        case (?batch) {
          if (batchMatches(batch, prepared)) #ok(batchExecution(batch)) else #err(#conflict("batch payload differs from existing execution"));
        };
        case null {
          for (candidate in prepared.vals()) {
            if (candidate.memo.size() != 32) return #err(#invalid("transfer memo must be 32 bytes"));
            if (candidate.amount_atoms == 0) return #err(#invalid("transfer amount must be positive"));
            if (hasDuplicateAllocation(prepared, candidate.allocation_id)) return #err(#conflict("allocation id is duplicated in batch"));
            switch (getStoredTransfer(candidate.allocation_id)) {
              case (?_) return #err(#conflict("allocation id already belongs to another batch"));
              case null {};
            };
          };
          let allocationIds = Array.map<Types.PreparedTransfer, Types.AllocationId>(prepared, func(value) { value.allocation_id });
          let batch : Types.BatchRecord = {
            round_id = roundId;
            allocation_version = allocationVersion;
            allocation_ids = allocationIds;
          };
          let entries = Array.map<Types.PreparedTransfer, Types.StoredTransfer>(
            prepared,
            func(value) {
              {
                round_id = roundId;
                allocation_version = allocationVersion;
                attempts = 0;
                transfer = {
                  allocation_id = value.allocation_id;
                  to = value.to;
                  amount_atoms = value.amount_atoms;
                  fee_atoms = null;
                  memo = value.memo;
                  created_at_time = value.created_at_time;
                  state = #prepared;
                };
              };
            },
          );
          transfers := Array.append(transfers, entries);
          batches := Array.append(batches, [batch]);
          #ok(batchExecution(batch));
        };
      };
    };

    public func getTransfer(allocationId : Types.AllocationId) : ?Types.Transfer {
      switch (getStoredTransfer(allocationId)) {
        case null null;
        case (?entry) ?entry.transfer;
      };
    };

    public func getBatch(roundId : Types.RoundId, allocationVersion : Types.Hash32) : ?Types.BatchExecution {
      switch (findBatch(roundId, allocationVersion)) {
        case null null;
        case (?batch) ?batchExecution(batch);
      };
    };

    public func prepareRollover(value : Types.Rollover) : Result<Types.Rollover> {
      if (value.amount_atoms == 0 or value.memo.size() != 32 or value.created_at_time == 0) return #err(#invalid("rollover amount, memo and timestamp are required"));
      if (value.source_round == value.target_round) return #err(#invalid("rollover target must be a different round"));
      switch (Array.find<Types.Rollover>(rollovers, func(item) { item.allocation_id == value.allocation_id })) {
        case (?existing) {
          if (existing.source_round == value.source_round and existing.target_round == value.target_round and existing.to == value.to and existing.amount_atoms == value.amount_atoms and existing.memo == value.memo and existing.created_at_time == value.created_at_time) #ok(existing) else #err(#conflict("carried allocation already has a different rollover"));
        };
        case null {
          let ?source = getReservation(value.source_round) else return #err(#not_found);
          switch (source.finalized_outstanding_atoms, source.finalized_outstanding_count) {
            case (?_, ?_) {};
            case _ return #err(#conflict("source reservation must be finalized before rollover"));
          };
          if (source.reserved_atoms < value.amount_atoms + source.fee_budget_atoms) return #err(#conflict("source reservation cannot cover rollover obligation"));
          rollovers := Array.append(rollovers, [value]);
          #ok(value);
        };
      };
    };

    public func getRollover(allocationId : Types.AllocationId) : ?Types.Rollover {
      Array.find<Types.Rollover>(rollovers, func(item) { item.allocation_id == allocationId });
    };

    public func markRolloverRetryable(allocationId : Types.AllocationId, message : Text) : Result<Types.Rollover> {
      updateRollover(allocationId, func(value) { switch (value.state) { case (#prepared or #retryable_failure(_)) #ok({ value with state = #retryable_failure(message) }); case _ #err(#conflict("rollover is terminal")) } });
    };

    public func setRolloverFee(allocationId : Types.AllocationId, fee : Nat) : Result<Types.Rollover> {
      updateRollover(
        allocationId,
        func(value) {
          switch (value.state) {
            case (#prepared or #retryable_failure(_)) {
              let ?_source = getReservation(value.source_round) else return #err(#not_found);
              #ok({ value with fee_atoms = fee; state = #prepared });
            };
            case _ #err(#conflict("rollover is terminal"));
          };
        },
      );
    };

    public func markRolloverPermanent(allocationId : Types.AllocationId, message : Text) : Result<Types.Rollover> {
      updateRollover(allocationId, func(value) { switch (value.state) { case (#prepared or #retryable_failure(_)) #ok({ value with state = #permanent_failure(message) }); case _ #err(#conflict("rollover is terminal")) } });
    };

    public func retryRollover(allocationId : Types.AllocationId) : Result<Types.Rollover> {
      updateRollover(allocationId, func(value) { switch (value.state) { case (#sent(_)) #err(#conflict("rollover is already sent")); case _ #ok({ value with state = #prepared }) } });
    };

    // A ledger #TooOld response proves that invocation was rejected. Only in
    // that case may the deduplication timestamp safely move forward.
    public func refreshRolloverTimestamp(allocationId : Types.AllocationId, createdAtTime : Nat64) : Result<Types.Rollover> {
      if (createdAtTime == 0) return #err(#invalid("rollover timestamp must be positive"));
      updateRollover(allocationId, func(value) { switch (value.state) { case (#sent(_)) #err(#conflict("rollover is already sent")); case _ #ok({ value with created_at_time = createdAtTime; state = #prepared }) } });
    };

    public func markRolloverSent(allocationId : Types.AllocationId, blockIndex : Nat) : Result<Types.Rollover> {
      let ?existing = getRollover(allocationId) else return #err(#not_found);
      switch (existing.state) {
        case (#sent(prior)) if (prior == blockIndex) return #ok(existing) else return #err(#conflict("rollover has a different receipt"));
        case (#prepared or #retryable_failure(_)) {};
        case _ return #err(#conflict("rollover is terminal"));
      };
      let ?source = getReservation(existing.source_round) else return #err(#not_found);
      let debit = existing.amount_atoms + source.fee_budget_atoms;
      let remaining = if (source.reserved_atoms >= debit) Nat.sub(source.reserved_atoms, debit) else 0;
      let deficit = if (source.reserved_atoms >= debit) source.accounting_deficit_atoms else source.accounting_deficit_atoms + Nat.sub(debit, source.reserved_atoms);
      ignore updateReservation(existing.source_round, func(value) { { value with reserved_atoms = remaining; accounting_deficit_atoms = deficit } });
      updateRollover(allocationId, func(value) { #ok({ value with state = #sent(blockIndex) }) });
    };

    public func markExecuting(allocationId : Types.AllocationId) : Result<Types.Transfer> {
      let ?entry = getStoredTransfer(allocationId) else return #err(#not_found);
      switch (entry.transfer.state) {
        case (#sent(_)) #err(#conflict("transfer is already sent"));
        case (#permanent_failure(_)) #err(#conflict("transfer failed permanently"));
        case (#executing(_)) #ok(entry.transfer);
        case (#prepared or #retryable_failure(_)) {
          let attempts = entry.attempts + 1;
          let next = { entry.transfer with state = #executing(attempts) };
          transfers := Array.map<Types.StoredTransfer, Types.StoredTransfer>(
            transfers,
            func(candidate) {
              if (candidate.transfer.allocation_id == allocationId) (
                {
                  round_id = entry.round_id;
                  allocation_version = entry.allocation_version;
                  attempts;
                  transfer = next;
                } : Types.StoredTransfer
              ) else candidate;
            },
          );
          #ok(next);
        };
      };
    };

    public func markRetryable(allocationId : Types.AllocationId, message : Text, fee : Nat) : Result<Types.Transfer> {
      updateTransfer(
        allocationId,
        func(current) {
          switch (current.state) {
            case (#executing(_)) #ok({
              current with fee_atoms = ?fee;
              state = #retryable_failure(message);
            });
            case _ #err(#conflict("only an executing transfer can fail"));
          };
        },
      );
    };

    public func markPermanent(allocationId : Types.AllocationId, message : Text, fee : Nat) : Result<Types.Transfer> {
      updateTransfer(
        allocationId,
        func(current) {
          switch (current.state) {
            case (#executing(_)) #ok({
              current with fee_atoms = ?fee;
              state = #permanent_failure(message);
            });
            case _ #err(#conflict("only an executing transfer can fail"));
          };
        },
      );
    };

    public func markSent(allocationId : Types.AllocationId, blockIndex : Nat, actualFee : Nat) : Result<Types.Transfer> {
      let ?entry = getStoredTransfer(allocationId) else return #err(#not_found);
      switch (entry.transfer.state) {
        case (#sent(existing)) {
          if (existing == blockIndex and entry.transfer.fee_atoms == ?actualFee) #ok(entry.transfer) else #err(#conflict("transfer already has a different receipt"));
        };
        case (#executing(_)) {
          let ?reservation = getReservation(entry.round_id) else return #err(#internal("transfer reservation is missing"));
          let debit = entry.transfer.amount_atoms + reservation.fee_budget_atoms;
          let sent = {
            entry.transfer with fee_atoms = ?actualFee;
            state = #sent(blockIndex);
          };
          updateStored(entry, sent);
          let remaining = if (reservation.reserved_atoms >= debit) Nat.sub(reservation.reserved_atoms, debit) else 0;
          let deficit = if (reservation.reserved_atoms >= debit) reservation.accounting_deficit_atoms else reservation.accounting_deficit_atoms + Nat.sub(debit, reservation.reserved_atoms);
          ignore updateReservation(entry.round_id, func(value) { { value with reserved_atoms = remaining; accounting_deficit_atoms = deficit } });
          #ok(sent);
        };
        case _ #err(#conflict("only an executing transfer can be sent"));
      };
    };

    func updateTransfer(allocationId : Types.AllocationId, change : Types.Transfer -> Result<Types.Transfer>) : Result<Types.Transfer> {
      let ?entry = getStoredTransfer(allocationId) else return #err(#not_found);
      switch (change(entry.transfer)) {
        case (#err(error)) #err(error);
        case (#ok(next)) { updateStored(entry, next); #ok(next) };
      };
    };

    func updateStored(entry : Types.StoredTransfer, transfer : Types.Transfer) : () {
      transfers := Array.map<Types.StoredTransfer, Types.StoredTransfer>(
        transfers,
        func(candidate) {
          if (candidate.transfer.allocation_id == entry.transfer.allocation_id) ({
            entry with transfer;
          }) else candidate;
        },
      );
    };

    func updateRollover(allocationId : Types.AllocationId, change : Types.Rollover -> Result<Types.Rollover>) : Result<Types.Rollover> {
      let ?existing = getRollover(allocationId) else return #err(#not_found);
      switch (change(existing)) {
        case (#err(error)) #err(error);
        case (#ok(updated)) {
          rollovers := Array.map<Types.Rollover, Types.Rollover>(rollovers, func(value) { if (value.allocation_id == allocationId) updated else value });
          #ok(updated);
        };
      };
    };

    func getStoredTransfer(allocationId : Types.AllocationId) : ?Types.StoredTransfer {
      Array.find<Types.StoredTransfer>(transfers, func(candidate) { candidate.transfer.allocation_id == allocationId });
    };

    func findBatch(roundId : Types.RoundId, allocationVersion : Types.Hash32) : ?Types.BatchRecord {
      Array.find<Types.BatchRecord>(
        batches,
        func(candidate) {
          candidate.round_id == roundId and candidate.allocation_version == allocationVersion;
        },
      );
    };

    func batchExecution(batch : Types.BatchRecord) : Types.BatchExecution {
      {
        round_id = batch.round_id;
        transfers = Array.mapFilter<Types.AllocationId, Types.Transfer>(batch.allocation_ids, func(allocationId) { getTransfer(allocationId) });
      };
    };

    func batchMatches(batch : Types.BatchRecord, prepared : [Types.PreparedTransfer]) : Bool {
      if (batch.allocation_ids.size() != prepared.size()) return false;
      var index = 0;
      while (index < prepared.size()) {
        if (batch.allocation_ids[index] != prepared[index].allocation_id) return false;
        let ?existing = getTransfer(prepared[index].allocation_id) else return false;
        if (not preparedMatches(existing, prepared[index])) return false;
        index += 1;
      };
      true;
    };

    func hasDuplicateAllocation(prepared : [Types.PreparedTransfer], allocationId : Types.AllocationId) : Bool {
      var count = 0;
      for (candidate in prepared.vals()) if (candidate.allocation_id == allocationId) count += 1;
      count > 1;
    };
  };

  func preparedMatches(existing : Types.Transfer, candidate : Types.PreparedTransfer) : Bool {
    existing.allocation_id == candidate.allocation_id and existing.to == candidate.to and existing.amount_atoms == candidate.amount_atoms and existing.memo == candidate.memo and existing.created_at_time == candidate.created_at_time;
  };

  func reservationEqual(left : Types.Reservation, right : Types.Reservation) : Bool {
    left == right;
  };
};
