import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Char "mo:base/Char";
import Nat32 "mo:base/Nat32";
import Nat8 "mo:base/Nat8";
import Principal "mo:base/Principal";
import Text "mo:base/Text";
import Types "Types";

module {
  // Liminal 3.1.0 correctly owns the PKCE verifier and authorization code, but
  // its token exchange currently has no response-size bound and no transform.
  // Keep this false until that outcall is patched/upgraded and reviewed. The
  // registry must fail closed rather than enable an unbounded authentication
  // outcall.
  public let productionTokenExchangeReady = false;

  public type Provider = {
    name : Text;
    client_id : Text;
    authorization_endpoint : Text;
    token_endpoint : Text;
    user_info_endpoint : Text;
    scopes : [Text];
  };

  // Structural mirrors of liminal's OAuth boundary. Keeping the adapter free
  // of a direct import is intentional: liminal 3.1.0's transitive numeric
  // dependency does not compile under the repository's reviewed moc 0.16.3
  // once OAuth middleware is imported. A reviewed liminal/toolchain upgrade
  // can pass these records directly because Motoko record types are structural.
  public type OAuthContext = {
    state : Text;
    codeVerifier : Text;
    redirectAfterAuth : ?Text;
    createdAt : Int;
  };

  public type TokenInfo = {
    accessToken : Text;
    tokenType : Text;
    expiresIn : ?Int;
    refreshToken : ?Text;
    scope : ?Text;
    idToken : ?Text;
  };

  public type OAuthStore = {
    saveContext : OAuthContext -> ();
    getContext : Text -> ?OAuthContext;
    removeContext : Text -> ();
  };

  public type LiminalProviderConfig = {
    name : Text;
    clientId : Text;
    authorizationEndpoint : Text;
    tokenEndpoint : Text;
    scopes : [Text];
  };

  public type Config = {
    site_url : Text;
    providers : [Provider];
    allowed_redirect_uris : [Text];
    attempt_ttl_ns : Int;
    context_ttl_ns : Int;
    max_user_info_response_bytes : Nat64;
  };

  public type Start = {
    login_url : Text;
    attempt_id : Blob;
    expires_at : Int;
  };

  public type Attempt = {
    id : Blob;
    provider : Text;
    session_principal : Principal;
    redirect_uri : Text;
    issued_at : Int;
    expires_at : Int;
    consumed_at : ?Int;
  };

  // This value may only be constructed after a bounded user-info/OIDC adapter
  // has validated the provider response. It deliberately contains no token.
  public type ValidatedSubject = {
    provider : Text;
    subject : Text;
    oauth_state : Text;
  };

  public type Completion = {
    provider : Text;
    subject : Text;
    session_principal : Principal;
    redirect_uri : Text;
  };

  type StoredContext = {
    context : OAuthContext;
    attempt_id : Blob;
  };

  public class Adapter(config : Config) {
    var attempts : [Attempt] = [];
    var contexts : [StoredContext] = [];

    public func readiness() : { #ready; #disabled : Text } {
      if (productionTokenExchangeReady) #ready else {
        #disabled("liminal 3.1.0 token exchange is unbounded; OAuth remains fail-closed");
      };
    };

    public func begin(
      caller : Principal,
      providerName : Text,
      sessionPrincipal : Principal,
      redirectUri : Text,
      attemptId : Blob,
      now : Int,
    ) : { #ok : Start; #err : Types.AppError } {
      if (caller != sessionPrincipal or Principal.isAnonymous(caller)) {
        return #err(#unauthorized);
      };
      if (attemptId.size() != 32) return #err(#invalid("OAuth attempt_id must be 32 bytes"));
      if (config.attempt_ttl_ns <= 0 or config.context_ttl_ns <= 0) {
        return #err(#internal("OAuth expiry configuration is invalid"));
      };
      if (config.max_user_info_response_bytes == 0) {
        return #err(#internal("OAuth user-info response bound is invalid"));
      };
      let normalizedProvider = Text.toLowercase(providerName);
      let ?provider = findProvider(normalizedProvider) else return #err(#invalid("OAuth provider is not allowed"));
      if (not validProviderName(normalizedProvider)) return #err(#invalid("OAuth provider name is invalid"));
      if (not containsText(config.allowed_redirect_uris, redirectUri)) {
        return #err(#invalid("OAuth redirect URI is not allowed"));
      };
      if (findAttempt(attemptId) != null) return #err(#conflict("OAuth attempt_id already exists"));

      let expiresAt = now + config.attempt_ttl_ns;
      attempts := Array.append(
        attempts,
        [{
          id = attemptId;
          provider = normalizedProvider;
          session_principal = sessionPrincipal;
          redirect_uri = redirectUri;
          issued_at = now;
          expires_at = expiresAt;
          consumed_at = null;
        }],
      );
      let marker = attemptMarker(attemptId);
      #ok({
        login_url = siteUrlWithSlash() # "auth/" # Text.toLowercase(provider.name) # "/login?redirect=" # marker;
        attempt_id = attemptId;
        expires_at = expiresAt;
      });
    };

    // Liminal invokes this store synchronously. Only contexts carrying a
    // registry-issued opaque attempt marker are retained. PKCE verifiers stay
    // exclusively in this transient adapter and disappear on upgrade.
    public func oauthStore() : OAuthStore {
      {
        saveContext = func(context : OAuthContext) {
          let ?redirect = context.redirectAfterAuth else return;
          let ?attemptId = parseAttemptMarker(redirect) else return;
          let ?attempt = findAttempt(attemptId) else return;
          if (attempt.consumed_at != null) return;
          contexts := Array.filter<StoredContext>(contexts, func(item) { item.context.state != context.state });
          contexts := Array.append(contexts, [{ context; attempt_id = attemptId }]);
        };
        getContext = func(state : Text) : ?OAuthContext {
          switch (findContext(state)) {
            case null null;
            case (?stored) {
              switch (findAttempt(stored.attempt_id)) {
                case null null;
                case (?attempt) {
                  if (attempt.consumed_at != null) null else ?stored.context;
                };
              };
            };
          };
        };
        removeContext = func(state : Text) {
          // Liminal removes before awaiting its token outcall. Retain only the
          // state-to-attempt association; erase the verifier immediately.
          contexts := Array.map<StoredContext, StoredContext>(
            contexts,
            func(item) {
              if (item.context.state == state) {
                {
                  context = {
                    state = item.context.state;
                    codeVerifier = "";
                    redirectAfterAuth = item.context.redirectAfterAuth;
                    createdAt = item.context.createdAt;
                  };
                  attempt_id = item.attempt_id;
                };
              } else item;
            },
          );
        };
      };
    };

    // Call only with a subject produced by a bounded, provider-specific
    // user-info/OIDC validator. This consumes the attempt exactly once and
    // returns the minimum identity material needed by registry state.
    public func consumeValidatedSubject(
      validated : ValidatedSubject,
      now : Int,
    ) : { #ok : Completion; #err : Types.AppError } {
      if (validated.subject == "") return #err(#invalid("OAuth subject is empty"));
      let normalizedProvider = Text.toLowercase(validated.provider);
      let ?stored = findContext(validated.oauth_state) else return #err(#unauthorized);
      let ?attempt = findAttempt(stored.attempt_id) else return #err(#unauthorized);
      if (attempt.provider != normalizedProvider) return #err(#unauthorized);
      if (now >= attempt.expires_at) {
        eraseContext(validated.oauth_state);
        return #err(#expired);
      };
      if (now - stored.context.createdAt >= config.context_ttl_ns) {
        eraseContext(validated.oauth_state);
        return #err(#expired);
      };
      if (attempt.consumed_at != null) return #err(#conflict("OAuth attempt already consumed"));

      attempts := Array.map<Attempt, Attempt>(
        attempts,
        func(candidate) {
          if (candidate.id == attempt.id) {
            {
              candidate with consumed_at = ?now
            };
          } else candidate;
        },
      );
      eraseContext(validated.oauth_state);
      #ok({
        provider = attempt.provider;
        subject = validated.subject;
        session_principal = attempt.session_principal;
        redirect_uri = attempt.redirect_uri;
      });
    };

    public func transientTokenPolicy(tokenInfo : TokenInfo) : {
      #ok;
      #err : Types.AppError;
    } {
      if (tokenInfo.accessToken == "" or tokenInfo.tokenType == "") {
        #err(#unauthorized);
      } else {
        // Deliberately do not retain or return any token field.
        #ok;
      };
    };

    public func provider(name : Text) : ?Provider {
      findProvider(Text.toLowercase(name));
    };

    public func attempt(id : Blob) : ?Attempt { findAttempt(id) };

    func findProvider(normalizedName : Text) : ?Provider {
      Array.find<Provider>(config.providers, func(provider) { Text.toLowercase(provider.name) == normalizedName });
    };

    func findAttempt(id : Blob) : ?Attempt {
      Array.find<Attempt>(attempts, func(attempt) { attempt.id == id });
    };

    func findContext(state : Text) : ?StoredContext {
      Array.find<StoredContext>(contexts, func(item) { item.context.state == state });
    };

    func eraseContext(state : Text) {
      contexts := Array.filter<StoredContext>(contexts, func(item) { item.context.state != state });
    };

    func siteUrlWithSlash() : Text {
      if (Text.endsWith(config.site_url, #char('/'))) config.site_url else config.site_url # "/";
    };
  };

  public func liminalProvider(provider : Provider) : LiminalProviderConfig {
    {
      name = provider.name;
      clientId = provider.client_id;
      authorizationEndpoint = provider.authorization_endpoint;
      tokenEndpoint = provider.token_endpoint;
      scopes = provider.scopes;
    };
  };

  func attemptMarker(id : Blob) : Text {
    "meritocracy-attempt-" # hexEncode(id);
  };

  func parseAttemptMarker(marker : Text) : ?Blob {
    let ?hex = Text.stripStart(marker, #text("meritocracy-attempt-")) else return null;
    hexDecode32(hex);
  };

  func containsText(values : [Text], value : Text) : Bool {
    Array.find<Text>(values, func(candidate) { candidate == value }) != null;
  };

  func validProviderName(name : Text) : Bool {
    if (name == "") return false;
    for (char in name.chars()) {
      let code = Char.toNat32(char);
      if (not ((code >= 48 and code <= 57) or (code >= 97 and code <= 122) or char == '-' or char == '_')) return false;
    };
    true;
  };

  func hexEncode(blob : Blob) : Text {
    let digits : [Char] = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f'];
    let bytes = Blob.toArray(blob);
    Text.fromArray(
      Array.tabulate<Char>(
        bytes.size() * 2,
        func(index) {
          let byte = bytes[index / 2];
          let nibble = if (index % 2 == 0) Nat8.toNat(byte / 16) else Nat8.toNat(byte % 16);
          digits[nibble];
        },
      )
    );
  };

  func hexDecode32(text : Text) : ?Blob {
    let chars = Text.toArray(text);
    if (chars.size() != 64) return null;
    let bytes = Array.tabulate<Nat8>(
      32,
      func(index) {
        let high = hexNibble(chars[index * 2]);
        let low = hexNibble(chars[index * 2 + 1]);
        Nat8.fromNat(high * 16 + low);
      },
    );
    // Reject invalid hex separately because tabulate cannot return an option.
    for (char in chars.vals()) { if (hexNibble(char) == 16) return null };
    ?Blob.fromArray(bytes);
  };

  func hexNibble(char : Char) : Nat {
    let code = Char.toNat32(char);
    if (code >= 48 and code <= 57) return Nat32.toNat(code - 48);
    if (code >= 97 and code <= 102) return Nat32.toNat(code - 87);
    if (code >= 65 and code <= 70) return Nat32.toNat(code - 55);
    16;
  };
};
