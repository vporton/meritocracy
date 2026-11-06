import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Nat8 "mo:base/Nat8";
import Nat32 "mo:base/Nat32";
import Nat64 "mo:base/Nat64";
import Principal "mo:base/Principal";
import Types "Types";

module {
  public class Store(initial : Types.StableState) {
    var nextUserId = initial.next_user_id;
    var nextPayoutAccountId = initial.next_payout_account_id;
    var users = initial.users;
    var sessions = initial.sessions;
    var identityBindings = initial.identity_bindings;
    var ethereumLoginChallenges = initial.ethereum_login_challenges;
    var oauthAttempts = initial.oauth_attempts;
    var payoutAccounts = initial.payout_accounts;
    var payoutProofChallenges = initial.payout_proof_challenges;
    var recipientSnapshots = initial.recipient_snapshots;
    var carriedCredits = initial.carried_credits;

    public func snapshot() : Types.StableState {
      {
        next_user_id = nextUserId;
        next_payout_account_id = nextPayoutAccountId;
        users;
        sessions;
        identity_bindings = identityBindings;
        ethereum_login_challenges = ethereumLoginChallenges;
        oauth_attempts = oauthAttempts;
        payout_accounts = payoutAccounts;
        payout_proof_challenges = payoutProofChallenges;
        recipient_snapshots = recipientSnapshots;
        carried_credits = carriedCredits;
      };
    };

    public func createUser(name : ?Text, now : Types.TimestampNs) : Types.User {
      let user : Types.User = {
        profile = {
          user_id = nextUserId;
          name;
          created_at = now;
          status = #active;
        };
        eligibility = Types.unknownEligibility;
      };
      nextUserId += 1;
      users := Array.append(users, [user]);
      user;
    };

    public func getUser(userId : Types.UserId) : ?Types.User {
      Array.find<Types.User>(users, func(user) { user.profile.user_id == userId });
    };

    public func updateProfile(userId : Types.UserId, name : ?Text) : {
      #ok : Types.User;
      #err : Types.AppError;
    } {
      var updated : ?Types.User = null;
      users := Array.map<Types.User, Types.User>(
        users,
        func(user) {
          if (user.profile.user_id == userId) {
            let next = { user with profile = { user.profile with name } };
            updated := ?next;
            next;
          } else user;
        },
      );
      switch (updated) { case null #err(#not_found); case (?user) #ok(user) };
    };

    public func listPublicProfiles(cursor : ?Blob, limit : Nat32) : {
      #ok : { items : [Types.PublicProfile]; next_cursor : ?Blob };
      #err : Types.AppError;
    } {
      if (limit == 0 or limit > 100) return #err(#invalid("limit must be between 1 and 100"));
      let after : Types.UserId = switch (cursor) {
        case null 0;
        case (?value) {
          switch (decodeUserId(value)) {
            case null return #err(#invalid("cursor must be an 8-byte user id"));
            case (?id) id;
          };
        };
      };
      let remaining = Array.filter<Types.User>(users, func(user) { user.profile.user_id > after });
      let count = Nat32.toNat(limit);
      let take = if (remaining.size() < count) remaining.size() else count;
      let pageUsers = Array.tabulate<Types.User>(take, func(index) { remaining[index] });
      let items = Array.map<Types.User, Types.PublicProfile>(pageUsers, func(user) { user.profile });
      let nextCursor = if (remaining.size() > take and take > 0) {
        ?encodeUserId(pageUsers[take - 1].profile.user_id);
      } else null;
      #ok({ items; next_cursor = nextCursor });
    };

    public func bindIdentity(issuer : Types.SessionIssuer, subjectHash : Types.Hash32, userId : Types.UserId) : {
      #ok : ();
      #err : Types.AppError;
    } {
      if (subjectHash.size() != 32) return #err(#invalid("identity subject hash must be 32 bytes"));
      switch (getUser(userId)) {
        case null return #err(#not_found);
        case (?_) {};
      };
      switch (resolveIdentity(issuer, subjectHash)) {
        case (?existing) {
          if (existing == userId) #ok(()) else #err(#conflict("identity is already bound"));
        };
        case null {
          identityBindings := Array.append(identityBindings, [{ issuer; subject_hash = subjectHash; user_id = userId }]);
          #ok(());
        };
      };
    };

    public func resolveIdentity(issuer : Types.SessionIssuer, subjectHash : Types.Hash32) : ?Types.UserId {
      switch (
        Array.find<Types.IdentityBinding>(
          identityBindings,
          func(binding) {
            issuerEqual(binding.issuer, issuer) and binding.subject_hash == subjectHash;
          },
        )
      ) {
        case null null;
        case (?binding) ?binding.user_id;
      };
    };

    public func putEthereumLoginChallenge(challenge : Types.EthereumLoginChallenge) : {
      #ok : Types.EthereumLoginChallenge;
      #err : Types.AppError;
    } {
      if (challenge.challenge_id.size() != 32) return #err(#invalid("challenge id must be 32 bytes"));
      if (Principal.isAnonymous(challenge.session_principal)) return #err(#invalid("anonymous principal cannot own a challenge"));
      if (challenge.expires_at <= challenge.issued_at) return #err(#invalid("challenge expiry must follow issuance"));
      if (challenge.normalized_address == "" or challenge.message == "") return #err(#invalid("challenge address and message are required"));
      ethereumLoginChallenges := Array.filter<Types.EthereumLoginChallenge>(
        ethereumLoginChallenges,
        func(existing) {
          existing.consumed_at == null and existing.expires_at > challenge.issued_at;
        },
      );
      let activeForSession = Array.filter<Types.EthereumLoginChallenge>(
        ethereumLoginChallenges,
        func(existing) {
          existing.session_principal == challenge.session_principal;
        },
      ).size();
      if (activeForSession >= 5) {
        return #err(#rate_limited({ retry_after_ns = 60_000_000_000 }));
      };
      if (findEthereumLoginChallenge(challenge.challenge_id) != null) return #err(#conflict("challenge id already exists"));
      ethereumLoginChallenges := Array.append(ethereumLoginChallenges, [challenge]);
      #ok(challenge);
    };

    public func consumeEthereumLoginChallenge(challengeId : Blob, sessionPrincipal : Principal, now : Types.TimestampNs) : {
      #ok : Types.EthereumLoginChallenge;
      #err : Types.AppError;
    } {
      switch (findEthereumLoginChallenge(challengeId)) {
        case null #err(#not_found);
        case (?challenge) {
          if (challenge.session_principal != sessionPrincipal) return #err(#forbidden);
          if (challenge.consumed_at != null) return #err(#conflict("challenge already consumed"));
          if (now >= challenge.expires_at) return #err(#expired);
          let consumed = { challenge with consumed_at = ?now };
          ethereumLoginChallenges := Array.map<Types.EthereumLoginChallenge, Types.EthereumLoginChallenge>(
            ethereumLoginChallenges,
            func(candidate) {
              if (candidate.challenge_id == challengeId) consumed else candidate;
            },
          );
          #ok(consumed);
        };
      };
    };

    public func putOAuthAttempt(attempt : Types.OAuthAttempt) : {
      #ok : Types.OAuthAttempt;
      #err : Types.AppError;
    } {
      if (attempt.attempt_id.size() != 32) return #err(#invalid("OAuth attempt id must be 32 bytes"));
      if (Principal.isAnonymous(attempt.session_principal)) return #err(#invalid("anonymous principal cannot own an OAuth attempt"));
      if (attempt.provider == "" or attempt.redirect_uri == "") return #err(#invalid("OAuth provider and redirect URI are required"));
      if (attempt.expires_at <= attempt.issued_at) return #err(#invalid("OAuth attempt expiry must follow issuance"));
      oauthAttempts := Array.filter<Types.OAuthAttempt>(
        oauthAttempts,
        func(existing) {
          existing.consumed_at == null and existing.expires_at > attempt.issued_at;
        },
      );
      let activeForSession = Array.filter<Types.OAuthAttempt>(
        oauthAttempts,
        func(existing) {
          existing.session_principal == attempt.session_principal;
        },
      ).size();
      if (activeForSession >= 5) return #err(#rate_limited({ retry_after_ns = 60_000_000_000 }));
      if (findOAuthAttempt(attempt.attempt_id) != null) return #err(#conflict("OAuth attempt id already exists"));
      oauthAttempts := Array.append(oauthAttempts, [attempt]);
      #ok(attempt);
    };

    public func getOAuthAttempt(attemptId : Blob) : ?Types.OAuthAttempt {
      findOAuthAttempt(attemptId);
    };

    public func consumeOAuthAttempt(
      attemptId : Blob,
      provider : Text,
      sessionPrincipal : Principal,
      now : Types.TimestampNs,
    ) : { #ok : Types.OAuthAttempt; #err : Types.AppError } {
      switch (findOAuthAttempt(attemptId)) {
        case null #err(#not_found);
        case (?attempt) {
          if (attempt.provider != provider or attempt.session_principal != sessionPrincipal) return #err(#forbidden);
          if (attempt.consumed_at != null) return #err(#conflict("OAuth attempt already consumed"));
          if (now >= attempt.expires_at) return #err(#expired);
          let consumed = { attempt with consumed_at = ?now };
          oauthAttempts := Array.map<Types.OAuthAttempt, Types.OAuthAttempt>(
            oauthAttempts,
            func(candidate) {
              if (candidate.attempt_id == attemptId) consumed else candidate;
            },
          );
          #ok(consumed);
        };
      };
    };

    public func putEligibility(
      userId : Types.UserId,
      eligibility : Types.EligibilityState,
    ) : { #ok : Types.EligibilityState; #err : Types.AppError } {
      switch (eligibility.reference_hash) {
        case (?hash) {
          if (hash.size() != 32) return #err(#invalid("reference_hash must be 32 bytes"));
        };
        case null {};
      };
      var found = false;
      users := Array.map<Types.User, Types.User>(
        users,
        func(user) {
          if (user.profile.user_id == userId) {
            found := true;
            { profile = user.profile; eligibility };
          } else user;
        },
      );
      if (found) #ok(eligibility) else #err(#not_found);
    };

    public func putSession(session : Types.Session) : {
      #ok : Types.Session;
      #err : Types.AppError;
    } {
      if (Principal.isAnonymous(session.session_principal)) {
        return #err(#invalid("anonymous principal cannot be a session"));
      };
      if (session.expires_at <= session.issued_at) {
        return #err(#invalid("session expiry must follow issuance"));
      };
      switch (getUser(session.user_id)) {
        case null return #err(#not_found);
        case (?_) {};
      };
      sessions := Array.filter<Types.Session>(
        sessions,
        func(existing) {
          existing.session_principal != session.session_principal;
        },
      );
      sessions := Array.append(sessions, [session]);
      #ok(session);
    };

    public func authorizeSession(
      sessionPrincipal : Principal,
      now : Types.TimestampNs,
    ) : {
      #ok : { user_id : Types.UserId; expires_at : Types.TimestampNs };
      #err : Types.AppError;
    } {
      switch (findSession(sessionPrincipal)) {
        case null #err(#unauthorized);
        case (?session) {
          switch (session.revoked_at) {
            case (?_) #err(#unauthorized);
            case null {
              if (now >= session.expires_at) #err(#expired) else {
                switch (getUser(session.user_id)) {
                  case null #err(#unauthorized);
                  case (?user) {
                    switch (user.profile.status) {
                      case (#active) #ok({
                        user_id = session.user_id;
                        expires_at = session.expires_at;
                      });
                      case (#banned(until)) {
                        if (now >= until) #ok({
                          user_id = session.user_id;
                          expires_at = session.expires_at;
                        }) else #err(#forbidden);
                      };
                      case (#deleted) #err(#forbidden);
                    };
                  };
                };
              };
            };
          };
        };
      };
    };

    public func revokeSession(
      sessionPrincipal : Principal,
      now : Types.TimestampNs,
    ) : { #ok : (); #err : Types.AppError } {
      var found = false;
      sessions := Array.map<Types.Session, Types.Session>(
        sessions,
        func(session) {
          if (session.session_principal == sessionPrincipal) {
            found := true;
            { session with revoked_at = ?now };
          } else session;
        },
      );
      if (found) #ok(()) else #err(#not_found);
    };

    public func getSession(sessionPrincipal : Principal) : ?Types.Session {
      findSession(sessionPrincipal);
    };

    public func revokeOwnedSession(userId : Types.UserId, sessionPrincipal : Principal, now : Types.TimestampNs) : {
      #ok : ();
      #err : Types.AppError;
    } {
      switch (findSession(sessionPrincipal)) {
        case null #err(#not_found);
        case (?session) {
          if (session.user_id != userId) #err(#forbidden) else revokeSession(sessionPrincipal, now);
        };
      };
    };

    public func revokeAllSessions(userId : Types.UserId, now : Types.TimestampNs) : Nat {
      var count = 0;
      sessions := Array.map<Types.Session, Types.Session>(
        sessions,
        func(session) {
          if (session.user_id == userId and session.revoked_at == null) {
            count += 1;
            { session with revoked_at = ?now };
          } else session;
        },
      );
      count;
    };

    public func addPayoutAccount(
      userId : Types.UserId,
      route : Types.Route,
      address : Text,
      normalizedAddress : Text,
      verification : Types.VerificationState,
      now : Types.TimestampNs,
    ) : { #ok : Types.PayoutAccount; #err : Types.AppError } {
      if (address == "" or normalizedAddress == "") return #err(#invalid("address is required"));
      switch (getUser(userId)) {
        case null return #err(#not_found);
        case (?_) {};
      };
      switch (
        Array.find<Types.PayoutAccount>(
          payoutAccounts,
          func(account) {
            account.verification != #revoked and routeEqual(account.route, route) and account.normalized_address == normalizedAddress;
          },
        )
      ) {
        case (?_) return #err(#conflict("normalized payout address already exists for route"));
        case null {};
      };
      let account : Types.PayoutAccount = {
        id = nextPayoutAccountId;
        user_id = userId;
        route;
        address;
        normalized_address = normalizedAddress;
        verification;
        active = false;
        default_for_route = false;
        created_at = now;
        verified_at = null;
      };
      nextPayoutAccountId += 1;
      payoutAccounts := Array.append(payoutAccounts, [account]);
      #ok(account);
    };

    public func verifyPayoutAccount(
      userId : Types.UserId,
      accountId : Types.PayoutAccountId,
      now : Types.TimestampNs,
    ) : { #ok : Types.PayoutAccount; #err : Types.AppError } {
      updateOwnedAccount(
        userId,
        accountId,
        func(account) {
          if (account.verification == #revoked) #err(#forbidden) else
          #ok({ account with verification = #verified; verified_at = ?now });
        },
      );
    };

    public func setPayoutAccountActive(
      userId : Types.UserId,
      accountId : Types.PayoutAccountId,
      active : Bool,
    ) : { #ok : Types.PayoutAccount; #err : Types.AppError } {
      updateOwnedAccount(
        userId,
        accountId,
        func(account) {
          if (active and account.verification != #verified) {
            #err(#forbidden);
          } else {
            #ok({
              account with active;
              default_for_route = if (active) account.default_for_route else false;
            });
          };
        },
      );
    };

    public func setDefaultPayoutAccount(
      userId : Types.UserId,
      accountId : Types.PayoutAccountId,
    ) : { #ok : Types.PayoutAccount; #err : Types.AppError } {
      let selected = findPayoutAccount(accountId);
      switch (selected) {
        case null #err(#not_found);
        case (?account) {
          if (account.user_id != userId) return #err(#forbidden);
          if (not account.active or account.verification != #verified) return #err(#forbidden);
          payoutAccounts := Array.map<Types.PayoutAccount, Types.PayoutAccount>(
            payoutAccounts,
            func(candidate) {
              if (candidate.user_id == userId and routeEqual(candidate.route, account.route)) {
                { candidate with default_for_route = candidate.id == accountId };
              } else candidate;
            },
          );
          switch (findPayoutAccount(accountId)) {
            case (?updated) #ok(updated);
            case null #err(#internal("default account disappeared"));
          };
        };
      };
    };

    public func revokePayoutAccount(
      userId : Types.UserId,
      accountId : Types.PayoutAccountId,
    ) : { #ok : Types.PayoutAccount; #err : Types.AppError } {
      updateOwnedAccount(
        userId,
        accountId,
        func(account) {
          #ok({
            account with
            verification = #revoked;
            active = false;
            default_for_route = false;
          });
        },
      );
    };

    public func listPayoutAccounts(userId : Types.UserId) : [Types.PayoutAccount] {
      Array.filter<Types.PayoutAccount>(payoutAccounts, func(account) { account.user_id == userId });
    };

    public func getPayoutAccount(accountId : Types.PayoutAccountId) : ?Types.PayoutAccount {
      findPayoutAccount(accountId);
    };

    public func updatePayoutAccountAddress(
      userId : Types.UserId,
      accountId : Types.PayoutAccountId,
      address : Text,
      normalizedAddress : Text,
    ) : { #ok : Types.PayoutAccount; #err : Types.AppError } {
      if (address == "" or normalizedAddress == "") return #err(#invalid("address is required"));
      let account = switch (findPayoutAccount(accountId)) {
        case null return #err(#not_found);
        case (?value) value;
      };
      if (account.user_id != userId) return #err(#forbidden);
      if (account.verification != #verified) return #err(#forbidden);
      switch (
        Array.find<Types.PayoutAccount>(
          payoutAccounts,
          func(candidate) {
            candidate.id != accountId and candidate.verification != #revoked and routeEqual(candidate.route, account.route) and candidate.normalized_address == normalizedAddress;
          },
        )
      ) {
        case (?_) return #err(#conflict("normalized payout address already exists for route"));
        case null {};
      };
      updateOwnedAccount(
        userId,
        accountId,
        func(current) {
          #ok({
            current with
            address;
            normalized_address = normalizedAddress;
            verification = #pending;
            active = false;
            default_for_route = false;
            verified_at = null;
          });
        },
      );
    };

    public func putPayoutProofChallenge(challenge : Types.PayoutProofChallenge) : {
      #ok : Types.PayoutProofChallenge;
      #err : Types.AppError;
    } {
      if (challenge.challenge_id.size() != 32) return #err(#invalid("challenge id must be 32 bytes"));
      if (Principal.isAnonymous(challenge.session_principal)) return #err(#invalid("anonymous principal cannot own a challenge"));
      if (challenge.expires_at <= challenge.issued_at) return #err(#invalid("challenge expiry must follow issuance"));
      payoutProofChallenges := Array.filter<Types.PayoutProofChallenge>(
        payoutProofChallenges,
        func(existing) {
          existing.consumed_at == null and existing.expires_at > challenge.issued_at;
        },
      );
      let activeForSession = Array.filter<Types.PayoutProofChallenge>(
        payoutProofChallenges,
        func(existing) {
          existing.session_principal == challenge.session_principal;
        },
      ).size();
      if (activeForSession >= 5) {
        return #err(#rate_limited({ retry_after_ns = 60_000_000_000 }));
      };
      switch (findPayoutAccount(challenge.payout_account_id)) {
        case null return #err(#not_found);
        case (?account) {
          if (account.user_id != challenge.user_id) return #err(#forbidden);
          if (account.verification == #revoked) return #err(#forbidden);
        };
      };
      if (findPayoutProofChallenge(challenge.challenge_id) != null) return #err(#conflict("challenge id already exists"));
      payoutProofChallenges := Array.append(payoutProofChallenges, [challenge]);
      #ok(challenge);
    };

    public func consumePayoutProofChallenge(
      challengeId : Blob,
      accountId : Types.PayoutAccountId,
      userId : Types.UserId,
      sessionPrincipal : Principal,
      now : Types.TimestampNs,
    ) : { #ok : Types.PayoutProofChallenge; #err : Types.AppError } {
      switch (findPayoutProofChallenge(challengeId)) {
        case null #err(#not_found);
        case (?challenge) {
          if (challenge.payout_account_id != accountId or challenge.user_id != userId or challenge.session_principal != sessionPrincipal) return #err(#forbidden);
          if (challenge.consumed_at != null) return #err(#conflict("challenge already consumed"));
          if (now >= challenge.expires_at) return #err(#expired);
          let consumed = { challenge with consumed_at = ?now };
          payoutProofChallenges := Array.map<Types.PayoutProofChallenge, Types.PayoutProofChallenge>(
            payoutProofChallenges,
            func(candidate) {
              if (candidate.challenge_id == challengeId) consumed else candidate;
            },
          );
          #ok(consumed);
        };
      };
    };

    public func snapshotRecipient(
      userId : Types.UserId,
      route : Types.Route,
      roundId : Types.RoundId,
      now : Types.TimestampNs,
    ) : { #ok : Types.RecipientSnapshot; #err : Types.AppError } {
      switch (
        Array.find<Types.RecipientSnapshotRecord>(
          recipientSnapshots,
          func(record) {
            record.round_id == roundId and record.snapshot.user_id == userId and routeEqual(record.snapshot.route, route);
          },
        )
      ) {
        case (?existing) return #ok(existing.snapshot);
        case null {};
      };
      switch (
        Array.find<Types.PayoutAccount>(
          payoutAccounts,
          func(account) {
            account.user_id == userId and routeEqual(account.route, route) and account.active and account.default_for_route and account.verification == #verified;
          },
        )
      ) {
        case null #err(#not_found);
        case (?account) {
          let snapshot : Types.RecipientSnapshot = {
            user_id = userId;
            payout_account_id = account.id;
            route = account.route;
            normalized_address = account.normalized_address;
            captured_at = now;
          };
          recipientSnapshots := Array.append(recipientSnapshots, [{ round_id = roundId; snapshot }]);
          #ok(snapshot);
        };
      };
    };

    public func creditCarriedBalance(
      allocationId : Types.AllocationId,
      userId : Types.UserId,
      balance : Types.CarriedBalance,
    ) : { #ok : (); #err : Types.AppError } {
      if (balance.atoms == 0) return #err(#invalid("carried amount must be positive"));
      switch (getUser(userId)) {
        case null return #err(#not_found);
        case (?_) {};
      };
      switch (Array.find<Types.CarriedCredit>(carriedCredits, func(credit) { credit.allocation_id == allocationId })) {
        case (?existing) {
          if (existing.user_id == userId and existing.balance == balance) #ok(()) else #err(#conflict("allocation already credited with different data"));
        };
        case null {
          carriedCredits := Array.append(carriedCredits, [{ allocation_id = allocationId; user_id = userId; balance }]);
          #ok(());
        };
      };
    };

    public func getCarriedBalances(userId : Types.UserId) : [Types.CarriedBalance] {
      Array.map<Types.CarriedCredit, Types.CarriedBalance>(
        Array.filter<Types.CarriedCredit>(carriedCredits, func(credit) { credit.user_id == userId }),
        func(credit) { credit.balance },
      );
    };

    func findSession(sessionPrincipal : Principal) : ?Types.Session {
      Array.find<Types.Session>(sessions, func(session) { session.session_principal == sessionPrincipal });
    };

    func findEthereumLoginChallenge(challengeId : Blob) : ?Types.EthereumLoginChallenge {
      Array.find<Types.EthereumLoginChallenge>(ethereumLoginChallenges, func(challenge) { challenge.challenge_id == challengeId });
    };

    func findOAuthAttempt(attemptId : Blob) : ?Types.OAuthAttempt {
      Array.find<Types.OAuthAttempt>(oauthAttempts, func(attempt) { attempt.attempt_id == attemptId });
    };

    func findPayoutProofChallenge(challengeId : Blob) : ?Types.PayoutProofChallenge {
      Array.find<Types.PayoutProofChallenge>(payoutProofChallenges, func(challenge) { challenge.challenge_id == challengeId });
    };

    func findPayoutAccount(accountId : Types.PayoutAccountId) : ?Types.PayoutAccount {
      Array.find<Types.PayoutAccount>(payoutAccounts, func(account) { account.id == accountId });
    };

    func updateOwnedAccount(
      userId : Types.UserId,
      accountId : Types.PayoutAccountId,
      update : Types.PayoutAccount -> {
        #ok : Types.PayoutAccount;
        #err : Types.AppError;
      },
    ) : { #ok : Types.PayoutAccount; #err : Types.AppError } {
      switch (findPayoutAccount(accountId)) {
        case null #err(#not_found);
        case (?account) {
          if (account.user_id != userId) return #err(#forbidden);
          switch (update(account)) {
            case (#err(error)) #err(error);
            case (#ok(updated)) {
              payoutAccounts := Array.map<Types.PayoutAccount, Types.PayoutAccount>(
                payoutAccounts,
                func(candidate) {
                  if (candidate.id == accountId) updated else candidate;
                },
              );
              #ok(updated);
            };
          };
        };
      };
    };
  };

  func issuerEqual(left : Types.SessionIssuer, right : Types.SessionIssuer) : Bool {
    switch (left, right) {
      case (#ethereum_wallet, #ethereum_wallet) true;
      case (#internet_identity, #internet_identity) true;
      case (#oauth(leftProvider), #oauth(rightProvider)) leftProvider == rightProvider;
      case _ false;
    };
  };

  func encodeUserId(value : Types.UserId) : Blob {
    var remaining = value;
    let bytes = Array.init<Nat8>(8, 0);
    var index = 8;
    while (index > 0) {
      index -= 1;
      bytes[index] := Nat8.fromNat(Nat64.toNat(remaining % 256));
      remaining /= 256;
    };
    Blob.fromArrayMut(bytes);
  };

  func decodeUserId(value : Blob) : ?Types.UserId {
    let bytes = Blob.toArray(value);
    if (bytes.size() != 8) return null;
    var result : Nat64 = 0;
    for (byte in bytes.vals()) result := result * 256 + Nat64.fromNat(Nat8.toNat(byte));
    ?result;
  };

  public func routeEqual(left : Types.Route, right : Types.Route) : Bool {
    networkEqual(left.network, right.network) and assetOptionEqual(left.asset, right.asset);
  };

  func networkEqual(left : Types.NetworkId, right : Types.NetworkId) : Bool {
    switch (left, right) {
      case (#icp, #icp) true;
      case (#bitcoin, #bitcoin) true;
      case (#ethereum, #ethereum) true;
      case (#solana, #solana) true;
      case (#polkadot, #polkadot) true;
      case (#stellar, #stellar) true;
      case (#cosmos, #cosmos) true;
      case (#bitcoin_cash, #bitcoin_cash) true;
      case (#other(leftName), #other(rightName)) leftName == rightName;
      case _ false;
    };
  };

  func assetOptionEqual(left : ?Types.AssetId, right : ?Types.AssetId) : Bool {
    switch (left, right) {
      case (null, null) true;
      case (?leftAsset, ?rightAsset) {
        leftAsset.ledger == rightAsset.ledger and leftAsset.symbol == rightAsset.symbol and leftAsset.decimals == rightAsset.decimals;
      };
      case _ false;
    };
  };
};
