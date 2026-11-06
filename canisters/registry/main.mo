import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Char "mo:base/Char";
import Nat8 "mo:base/Nat8";
import Principal "mo:base/Principal";
import Random "mo:base/Random";
import Nat64 "mo:base/Nat64";
import Text "mo:base/Text";
import Time "mo:base/Time";
import Sha3 "mo:sha3";
import Attestation "Attestation";
import EthereumAuth "EthereumAuth";
import State "State";
import Types "Types";

persistent actor Registry {
  type AttestationIssuer = {
    name : Text;
    caller : Principal;
    public_key : Blob;
  };
  type Result<T> = { #ok : T; #err : Types.AppError };
  type UnitResult = { #ok; #err : Types.AppError };
  type HeaderField = (Text, Text);
  type StreamingCallbackResponse = { body : Blob; token : ?Blob };
  type StreamingStrategy = {
    #Callback : {
      callback : shared query Blob -> async ?StreamingCallbackResponse;
      token : Blob;
    };
  };
  type HttpRequest = {
    url : Text;
    method : Text;
    headers : [HeaderField];
    body : Blob;
    certificate_version : ?Nat16;
  };
  type HttpUpdateRequest = {
    url : Text;
    method : Text;
    headers : [HeaderField];
    body : Blob;
  };
  type HttpResponse = {
    status_code : Nat16;
    headers : [HeaderField];
    body : Blob;
    streaming_strategy : ?StreamingStrategy;
    upgrade : ?Bool;
  };
  type HttpUpdateResponse = {
    status_code : Nat16;
    headers : [HeaderField];
    body : Blob;
    streaming_strategy : ?StreamingStrategy;
  };

  let sevenDaysNs : Int = 604_800_000_000_000;
  let challengeLifetimeNs : Int = 300_000_000_000;
  let schemaHash : Blob = Blob.fromArray([
    0x68,
    0xf2,
    0xde,
    0xe2,
    0xfc,
    0x1c,
    0xbc,
    0x5b,
    0x3f,
    0x8b,
    0x62,
    0x66,
    0x03,
    0x12,
    0xd3,
    0x56,
    0x05,
    0xd6,
    0x92,
    0xff,
    0x8c,
    0xfb,
    0xbe,
    0x14,
    0xbd,
    0x8c,
    0x7c,
    0x81,
    0x2f,
    0xb9,
    0x08,
    0x10,
  ]);

  var stableState : Types.StableState = Types.emptyState;
  var roundsCanister : ?Principal = null;
  var sessionConsumers : [Principal] = [];
  var attestationIssuers : [AttestationIssuer] = [];
  var allowedDomains : [Text] = [];
  var allowedActions : [Text] = [];

  public shared ({ caller }) func configure_authorities(
    config : {
      rounds_canister : ?Principal;
      session_consumers : [Principal];
      attestation_issuers : [AttestationIssuer];
      allowed_domains : [Text];
      allowed_actions : [Text];
    }
  ) : async UnitResult {
    if (not Principal.isController(caller)) return #err(#forbidden);
    roundsCanister := config.rounds_canister;
    sessionConsumers := config.session_consumers;
    attestationIssuers := config.attestation_issuers;
    allowedDomains := config.allowed_domains;
    allowedActions := config.allowed_actions;
    #ok;
  };

  public query func interface_version() : async {
    major : Nat16;
    minor : Nat16;
    patch : Nat16;
    schema_hash : Blob;
  } {
    { major = 1; minor = 1; patch = 0; schema_hash = schemaHash };
  };

  public shared ({ caller }) func begin_ethereum_login(
    input : {
      address : Text;
      session_principal : Principal;
      requested_action : Text;
      domain : Text;
    }
  ) : async Result<{ challenge_id : Blob; message : Text; expires_at : Int }> {
    if (Principal.isAnonymous(caller) or caller != input.session_principal) return #err(#unauthorized);
    if (not containsText(allowedDomains, input.domain)) return #err(#invalid("domain is not allowed"));
    if (not containsText(allowedActions, input.requested_action)) return #err(#invalid("requested action is not allowed"));
    if (activeEthereumChallengeCount(caller, Time.now()) >= 5) {
      return #err(#rate_limited({ retry_after_ns = 60_000_000_000 }));
    };
    let normalized = switch (EthereumAuth.normalizeAddress(input.address)) {
      case (#err(message)) return #err(#invalid(message));
      case (#ok(value)) value;
    };
    let challengeId = await Random.blob();
    if (challengeId.size() != 32) return #err(#internal("raw randomness was not 32 bytes"));
    // Authority configuration can change while raw_rand is in flight.
    if (not containsText(allowedDomains, input.domain)) return #err(#invalid("domain is not allowed"));
    if (not containsText(allowedActions, input.requested_action)) return #err(#invalid("requested action is not allowed"));
    let now = Time.now();
    let expiresAt = now + challengeLifetimeNs;
    let message = EthereumAuth.buildLoginMessage(normalized, input.session_principal, input.domain, input.requested_action, blobHex(challengeId), now, expiresAt);
    let store = State.Store(stableState);
    switch (store.putEthereumLoginChallenge({ challenge_id = challengeId; normalized_address = normalized; session_principal = input.session_principal; requested_action = input.requested_action; domain = input.domain; message; issued_at = now; expires_at = expiresAt; consumed_at = null })) {
      case (#err(error)) #err(error);
      case (#ok(_)) {
        stableState := store.snapshot();
        #ok({ challenge_id = challengeId; message; expires_at = expiresAt });
      };
    };
  };

  public shared ({ caller }) func complete_ethereum_login(input : { challenge_id : Blob; signature : Blob; public_key : Blob }) : async Result<Types.Session> {
    if (Principal.isAnonymous(caller)) return #err(#unauthorized);
    let now = Time.now();
    let store = State.Store(stableState);
    let challenge = switch (store.consumeEthereumLoginChallenge(input.challenge_id, caller, now)) {
      case (#err(error)) return #err(error);
      case (#ok(value)) value;
    };
    switch (EthereumAuth.verifyLogin(challenge.message, challenge.normalized_address, input.signature, input.public_key)) {
      case (#err(message)) return #err(#invalid(message));
      case (#ok) {};
    };
    let subjectHash = EthereumAuth.subjectHash(challenge.normalized_address);
    let userId = switch (store.resolveIdentity(#ethereum_wallet, subjectHash)) {
      case (?existing) existing;
      case null {
        let user = store.createUser(null, now);
        switch (store.bindIdentity(#ethereum_wallet, subjectHash, user.profile.user_id)) {
          case (#err(error)) return #err(error);
          case (#ok) user.profile.user_id;
        };
      };
    };
    let session = makeSession(caller, userId, #ethereum_wallet, now);
    switch (store.putSession(session)) {
      case (#err(error)) #err(error);
      case (#ok(value)) { stableState := store.snapshot(); #ok(value) };
    };
  };

  public shared ({ caller }) func complete_internet_identity_login(input : { session_principal : Principal; requested_action : Text }) : async Result<Types.Session> {
    if (Principal.isAnonymous(caller) or Principal.isAnonymous(input.session_principal)) return #err(#unauthorized);
    if (not containsText(allowedActions, input.requested_action)) return #err(#invalid("requested action is not allowed"));
    let now = Time.now();
    let store = State.Store(stableState);
    let subjectHash = hashBlob(Principal.toBlob(caller));
    let userId = switch (store.resolveIdentity(#internet_identity, subjectHash)) {
      case (?existing) existing;
      case null {
        let user = store.createUser(null, now);
        switch (store.bindIdentity(#internet_identity, subjectHash, user.profile.user_id)) {
          case (#err(error)) return #err(error);
          case (#ok) user.profile.user_id;
        };
      };
    };
    let session = makeSession(input.session_principal, userId, #internet_identity, now);
    switch (store.putSession(session)) {
      case (#err(error)) #err(error);
      case (#ok(value)) { stableState := store.snapshot(); #ok(value) };
    };
  };

  public shared ({ caller }) func begin_oauth_login(input : { provider : Text; session_principal : Principal; redirect_uri : Text }) : async Result<{ login_url : Text; attempt_id : Blob; expires_at : Int }> {
    if (Principal.isAnonymous(caller) or caller != input.session_principal) return #err(#unauthorized);
    #err(#transient_("OAuth adapter is not configured"));
  };

  public query func http_request(_request : HttpRequest) : async HttpResponse {
    response(426, "OAuth routes require an update call", true);
  };
  public shared func http_request_update(_request : HttpUpdateRequest) : async HttpUpdateResponse {
    {
      status_code = 503;
      headers = [("content-type", "text/plain; charset=utf-8")];
      body = Text.encodeUtf8("OAuth adapter is not configured");
      streaming_strategy = null;
    };
  };

  public shared query ({ caller }) func me() : async Result<Types.User> {
    let store = State.Store(stableState);
    switch (store.authorizeSession(caller, Time.now())) {
      case (#err(error)) #err(error);
      case (#ok(auth)) switch (store.getUser(auth.user_id)) {
        case null #err(#not_found);
        case (?user) #ok(user);
      };
    };
  };

  public query func get_public_profile(userId : Types.UserId) : async Result<Types.PublicProfile> {
    switch (State.Store(stableState).getUser(userId)) {
      case null #err(#not_found);
      case (?user) #ok(user.profile);
    };
  };

  public query func list_public_profiles(page : { cursor : ?Blob; limit : Nat32 }) : async Result<{ items : [Types.PublicProfile]; next_cursor : ?Blob }> {
    State.Store(stableState).listPublicProfiles(page.cursor, page.limit);
  };

  public shared ({ caller }) func update_public_profile(patch : { name : ?Text }) : async Result<Types.User> {
    switch (patch.name) {
      case (?name) if (name == "" or Text.size(name) > 100) return #err(#invalid("name must contain 1 to 100 characters"));
      case null {};
    };
    let store = State.Store(stableState);
    let auth = switch (store.authorizeSession(caller, Time.now())) {
      case (#err(error)) return #err(error);
      case (#ok(value)) value;
    };
    let result = store.updateProfile(auth.user_id, patch.name);
    switch (result) {
      case (#ok(_)) stableState := store.snapshot();
      case (#err(_)) {};
    };
    result;
  };

  public shared ({ caller }) func add_payout_account(input : { route : Types.Route; address : Text }) : async Result<Types.PayoutAccount> {
    let store = State.Store(stableState);
    let now = Time.now();
    let auth = switch (store.authorizeSession(caller, now)) {
      case (#err(error)) return #err(error);
      case (#ok(value)) value;
    };
    let normalized = switch (input.route.network) {
      case (#ethereum) switch (EthereumAuth.normalizeAddress(input.address)) {
        case (#err(message)) return #err(#invalid(message));
        case (#ok(value)) value;
      };
      case _ {
        if (input.address == "") return #err(#invalid("address is required"));
        input.address;
      };
    };
    let result = store.addPayoutAccount(auth.user_id, input.route, input.address, normalized, #pending, now);
    switch (result) {
      case (#ok(_)) stableState := store.snapshot();
      case (#err(_)) {};
    };
    result;
  };

  public shared ({ caller }) func import_legacy_payout_account(
    userId : Types.UserId,
    input : { route : Types.Route; address : Text },
  ) : async Result<Types.PayoutAccount> {
    if (not Principal.isController(caller)) return #err(#forbidden);
    let normalized = switch (input.route.network) {
      case (#ethereum) switch (EthereumAuth.normalizeAddress(input.address)) {
        case (#err(message)) return #err(#invalid(message));
        case (#ok(value)) value;
      };
      case _ {
        if (input.address == "") return #err(#invalid("address is required"));
        input.address;
      };
    };
    let store = State.Store(stableState);
    let result = store.addPayoutAccount(userId, input.route, input.address, normalized, #legacy_imported, Time.now());
    switch (result) {
      case (#ok(_)) stableState := store.snapshot();
      case (#err(_)) {};
    };
    result;
  };

  public shared ({ caller }) func begin_payout_proof(accountId : Types.PayoutAccountId) : async Result<{ challenge_id : Blob; message : Text; expires_at : Int }> {
    let now = Time.now();
    let preliminary = State.Store(stableState);
    let preliminaryAuth = switch (preliminary.authorizeSession(caller, now)) {
      case (#err(error)) return #err(error);
      case (#ok(value)) value;
    };
    let preliminaryAccount = switch (preliminary.getPayoutAccount(accountId)) {
      case null return #err(#not_found);
      case (?value) value;
    };
    if (preliminaryAccount.user_id != preliminaryAuth.user_id) return #err(#forbidden);
    switch (preliminaryAccount.route.network) {
      case (#ethereum) {};
      case _ return #err(#invalid("wallet proof adapter is not enabled for this network"));
    };
    if (activePayoutChallengeCount(caller, now) >= 5) {
      return #err(#rate_limited({ retry_after_ns = 60_000_000_000 }));
    };
    let challengeId = await Random.blob();
    // Re-read after the await so a concurrent update cannot be overwritten by
    // committing a snapshot made before the management-canister call.
    let commitNow = Time.now();
    let store = State.Store(stableState);
    let auth = switch (store.authorizeSession(caller, commitNow)) {
      case (#err(error)) return #err(error);
      case (#ok(value)) value;
    };
    let account = switch (store.getPayoutAccount(accountId)) {
      case null return #err(#not_found);
      case (?value) value;
    };
    if (account.user_id != auth.user_id) return #err(#forbidden);
    switch (account.route.network) {
      case (#ethereum) {};
      case _ return #err(#invalid("wallet proof adapter is not enabled for this network"));
    };
    if (challengeId.size() != 32) return #err(#internal("raw randomness was not 32 bytes"));
    let expiresAt = commitNow + challengeLifetimeNs;
    let message = EthereumAuth.buildLoginMessage(account.normalized_address, caller, "meritocracy.payout", "prove-payout-account:" # Nat64.toText(account.id), blobHex(challengeId), commitNow, expiresAt);
    switch (store.putPayoutProofChallenge({ challenge_id = challengeId; payout_account_id = account.id; user_id = auth.user_id; session_principal = caller; message; issued_at = commitNow; expires_at = expiresAt; consumed_at = null })) {
      case (#err(error)) #err(error);
      case (#ok(_)) {
        stableState := store.snapshot();
        #ok({ challenge_id = challengeId; message; expires_at = expiresAt });
      };
    };
  };

  public shared ({ caller }) func complete_payout_proof(accountId : Types.PayoutAccountId, proof : Blob) : async Result<Types.PayoutAccount> {
    if (proof.size() != 130) return #err(#invalid("Ethereum payout proof must contain a 65-byte signature and 65-byte public key"));
    let parts = Blob.toArray(proof);
    let signature = Blob.fromArray(Array.tabulate<Nat8>(65, func(index) { parts[index] }));
    let publicKey = Blob.fromArray(Array.tabulate<Nat8>(65, func(index) { parts[index + 65] }));
    let now = Time.now();
    let store = State.Store(stableState);
    let auth = switch (store.authorizeSession(caller, now)) {
      case (#err(error)) return #err(error);
      case (#ok(value)) value;
    };
    let account = switch (store.getPayoutAccount(accountId)) {
      case null return #err(#not_found);
      case (?value) value;
    };
    if (account.user_id != auth.user_id) return #err(#forbidden);
    let challenge = switch (latestPayoutChallenge(stableState, accountId, auth.user_id, caller)) {
      case null return #err(#not_found);
      case (?value) value;
    };
    switch (EthereumAuth.verifyLogin(challenge.message, account.normalized_address, signature, publicKey)) {
      case (#err(message)) return #err(#invalid(message));
      case (#ok) {};
    };
    switch (store.consumePayoutProofChallenge(challenge.challenge_id, accountId, auth.user_id, caller, now)) {
      case (#err(error)) return #err(error);
      case (#ok(_)) {};
    };
    let result = store.verifyPayoutAccount(auth.user_id, accountId, now);
    switch (result) {
      case (#ok(_)) stableState := store.snapshot();
      case (#err(_)) {};
    };
    result;
  };

  public shared ({ caller }) func set_payout_account_active(accountId : Types.PayoutAccountId, active : Bool) : async Result<Types.PayoutAccount> {
    withAuthorizedUpdate(caller, func(store, userId) { store.setPayoutAccountActive(userId, accountId, active) });
  };
  public shared ({ caller }) func set_default_payout_account(accountId : Types.PayoutAccountId) : async Result<Types.PayoutAccount> {
    withAuthorizedUpdate(caller, func(store, userId) { store.setDefaultPayoutAccount(userId, accountId) });
  };
  public shared ({ caller }) func revoke_payout_account(accountId : Types.PayoutAccountId) : async Result<Types.PayoutAccount> {
    withAuthorizedUpdate(caller, func(store, userId) { store.revokePayoutAccount(userId, accountId) });
  };

  public shared query ({ caller }) func list_my_payout_accounts() : async Result<[Types.PayoutAccount]> {
    let store = State.Store(stableState);
    switch (store.authorizeSession(caller, Time.now())) {
      case (#err(error)) #err(error);
      case (#ok(auth)) #ok(store.listPayoutAccounts(auth.user_id));
    };
  };

  public shared ({ caller }) func revoke_session(target : Principal) : async UnitResult {
    let now = Time.now();
    let store = State.Store(stableState);
    let auth = switch (store.authorizeSession(caller, now)) {
      case (#err(error)) return #err(error);
      case (#ok(value)) value;
    };
    switch (store.revokeOwnedSession(auth.user_id, target, now)) {
      case (#err(error)) #err(error);
      case (#ok) { stableState := store.snapshot(); #ok };
    };
  };

  public shared ({ caller }) func revoke_all_sessions() : async UnitResult {
    let now = Time.now();
    let store = State.Store(stableState);
    let auth = switch (store.authorizeSession(caller, now)) {
      case (#err(error)) return #err(error);
      case (#ok(value)) value;
    };
    ignore store.revokeAllSessions(auth.user_id, now);
    stableState := store.snapshot();
    #ok;
  };

  public shared ({ caller }) func authorize_session(target : Principal) : async Result<{ user_id : Types.UserId; expires_at : Int }> {
    if (not containsPrincipal(sessionConsumers, caller)) return #err(#forbidden);
    State.Store(stableState).authorizeSession(target, Time.now());
  };

  public shared ({ caller }) func snapshot_recipient(input : { user_id : Types.UserId; route : Types.Route; round_id : Types.RoundId }) : async Result<Types.RecipientSnapshot> {
    if (not isRounds(caller)) return #err(#forbidden);
    let store = State.Store(stableState);
    let result = store.snapshotRecipient(input.user_id, input.route, input.round_id, Time.now());
    switch (result) {
      case (#ok(_)) stableState := store.snapshot();
      case (#err(_)) {};
    };
    result;
  };

  public shared query ({ caller }) func get_eligibility(userId : Types.UserId) : async Result<Types.EligibilityState> {
    let store = State.Store(stableState);
    let permitted = if (isRounds(caller) or containsPrincipal(sessionConsumers, caller)) true else switch (store.authorizeSession(caller, Time.now())) {
      case (#ok(auth)) auth.user_id == userId;
      case (#err(_)) false;
    };
    if (not permitted) return #err(#forbidden);
    switch (store.getUser(userId)) {
      case null #err(#not_found);
      case (?user) #ok(user.eligibility);
    };
  };

  public shared ({ caller }) func put_attestation(
    attestation : {
      user_id : Types.UserId;
      issuer : Text;
      status : { #eligible; #ineligible };
      reference_hash : Blob;
      issued_at : Int;
      expires_at : ?Int;
      signature : Blob;
    }
  ) : async Result<Types.EligibilityState> {
    let issuerConfig = switch (findAttestationIssuer(attestation.issuer, caller)) {
      case null return #err(#forbidden);
      case (?value) value;
    };
    if (attestation.reference_hash.size() != 32) return #err(#invalid("reference_hash must be 32 bytes"));
    if (issuerConfig.public_key.size() != 32) return #err(#internal("attestation issuer public key must be 32 bytes"));
    if (attestation.signature.size() != 64) return #err(#invalid("attestation signature must be 64 bytes"));
    let now = Time.now();
    if (attestation.issued_at > now) return #err(#invalid("attestation issuance is in the future"));
    switch (attestation.expires_at) {
      case (?expiry) if (expiry <= attestation.issued_at or expiry <= now) return #err(#expired);
      case _ {};
    };
    let canonicalMessage = Attestation.message(
      attestation.user_id,
      attestation.issuer,
      attestation.status,
      attestation.reference_hash,
      attestation.issued_at,
      attestation.expires_at,
    );
    if (not Attestation.verify(issuerConfig.public_key, attestation.signature, canonicalMessage)) {
      return #err(#unauthorized);
    };
    let eligibility : Types.EligibilityState = {
      status = switch (attestation.status) {
        case (#eligible) #eligible;
        case (#ineligible) #ineligible;
      };
      issuer = ?attestation.issuer;
      reference_hash = ?attestation.reference_hash;
      expires_at = attestation.expires_at;
    };
    let store = State.Store(stableState);
    let result = store.putEligibility(attestation.user_id, eligibility);
    switch (result) {
      case (#ok(_)) stableState := store.snapshot();
      case (#err(_)) {};
    };
    result;
  };

  public shared query ({ caller }) func get_carried_balances(userId : Types.UserId) : async Result<[Types.CarriedBalance]> {
    let store = State.Store(stableState);
    let permitted = if (isRounds(caller)) true else switch (store.authorizeSession(caller, Time.now())) {
      case (#ok(auth)) auth.user_id == userId;
      case (#err(_)) false;
    };
    if (permitted) #ok(store.getCarriedBalances(userId)) else #err(#forbidden);
  };

  public shared ({ caller }) func credit_carried_balance(input : { user_id : Types.UserId; balance : Types.CarriedBalance; allocation_id : Types.AllocationId }) : async UnitResult {
    if (not isRounds(caller)) return #err(#forbidden);
    let store = State.Store(stableState);
    switch (store.creditCarriedBalance(input.allocation_id, input.user_id, input.balance)) {
      case (#err(error)) #err(error);
      case (#ok) { stableState := store.snapshot(); #ok };
    };
  };

  func makeSession(principal : Principal, userId : Types.UserId, issuer : Types.SessionIssuer, now : Int) : Types.Session {
    {
      session_principal = principal;
      user_id = userId;
      issuer;
      issued_at = now;
      expires_at = now + sevenDaysNs;
      revoked_at = null;
    };
  };
  func withAuthorizedUpdate(caller : Principal, operation : (State.Store, Types.UserId) -> Result<Types.PayoutAccount>) : Result<Types.PayoutAccount> {
    let store = State.Store(stableState);
    let auth = switch (store.authorizeSession(caller, Time.now())) {
      case (#err(error)) return #err(error);
      case (#ok(value)) value;
    };
    let result = operation(store, auth.user_id);
    switch (result) {
      case (#ok(_)) stableState := store.snapshot();
      case (#err(_)) {};
    };
    result;
  };
  func latestPayoutChallenge(state : Types.StableState, accountId : Types.PayoutAccountId, userId : Types.UserId, principal : Principal) : ?Types.PayoutProofChallenge {
    var found : ?Types.PayoutProofChallenge = null;
    for (challenge in state.payout_proof_challenges.vals()) {
      if (challenge.payout_account_id == accountId and challenge.user_id == userId and challenge.session_principal == principal and challenge.consumed_at == null) found := ?challenge;
    };
    found;
  };
  func hashBlob(value : Blob) : Blob {
    let digest = Sha3.Keccak(256);
    digest.update(Blob.toArray(value));
    Blob.fromArray(digest.finalize());
  };
  func blobHex(value : Blob) : Text {
    let digits : [Char] = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f'];
    var result = "";
    for (byte in Blob.toArray(value).vals()) {
      let n = Nat8.toNat(byte);
      result #= Char.toText(digits[n / 16]) # Char.toText(digits[n % 16]);
    };
    result;
  };
  func containsText(values : [Text], value : Text) : Bool {
    Array.find<Text>(values, func(candidate) { candidate == value }) != null;
  };
  func activeEthereumChallengeCount(principal : Principal, now : Int) : Nat {
    Array.filter<Types.EthereumLoginChallenge>(
      stableState.ethereum_login_challenges,
      func(challenge) {
        challenge.session_principal == principal and challenge.consumed_at == null and challenge.expires_at > now;
      },
    ).size();
  };
  func activePayoutChallengeCount(principal : Principal, now : Int) : Nat {
    Array.filter<Types.PayoutProofChallenge>(
      stableState.payout_proof_challenges,
      func(challenge) {
        challenge.session_principal == principal and challenge.consumed_at == null and challenge.expires_at > now;
      },
    ).size();
  };
  func containsPrincipal(values : [Principal], value : Principal) : Bool {
    Array.find<Principal>(values, func(candidate) { candidate == value }) != null;
  };
  func isRounds(caller : Principal) : Bool {
    switch (roundsCanister) {
      case (?configured) caller == configured;
      case null false;
    };
  };
  func findAttestationIssuer(name : Text, caller : Principal) : ?AttestationIssuer {
    Array.find<AttestationIssuer>(
      attestationIssuers,
      func(candidate) {
        candidate.name == name and candidate.caller == caller;
      },
    );
  };
  func response(status : Nat16, message : Text, upgrade : Bool) : HttpResponse {
    {
      status_code = status;
      headers = [("content-type", "text/plain; charset=utf-8")];
      body = Text.encodeUtf8(message);
      streaming_strategy = null;
      upgrade = ?upgrade;
    };
  };
};
