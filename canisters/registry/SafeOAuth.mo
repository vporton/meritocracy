import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Nat "mo:base/Nat";
import Principal "mo:base/Principal";
import Text "mo:base/Text";
import BaseX "mo:base-x-encoder";
import IC "mo:ic@3";
import Json "mo:json";
import Liminal "mo:liminal";
import OAuth "mo:liminal/Middleware/OAuth";
import Sha256 "mo:sha2@0/Sha256";
import UrlKit "mo:url-kit@4";
import Types "Types";

module {
  // These aliases intentionally bind this implementation to Liminal's public
  // HTTP and OAuth contracts while avoiding OAuth.new's unbounded outcall.
  public type HttpRequest = Liminal.RawUpdateHttpRequest;
  public type HttpResponse = Liminal.RawUpdateHttpResponse;
  public type LiminalProvider = OAuth.ProviderConfig;

  public type ProviderKind = { #github; #google };
  public type Provider = {
    kind : ProviderKind;
    config : LiminalProvider;
    user_info_endpoint : Text;
  };
  public type Config = {
    site_url : Text;
    providers : [Provider];
    allowed_redirect_uris : [Text];
    attempt_ttl_ns : Int;
    max_token_response_bytes : Nat64;
    max_user_info_response_bytes : Nat64;
    http_cycles : Nat;
  };
  public type Start = { login_url : Text; attempt_id : Blob; expires_at : Int };
  public type Completion = {
    provider : Text;
    subject : Text;
    session_principal : Principal;
    redirect_uri : Text;
  };
  type Attempt = {
    id : Blob;
    provider : Text;
    session_principal : Principal;
    redirect_uri : Text;
    state : Text;
    verifier : Text;
    issued_at : Int;
    expires_at : Int;
    consumed : Bool;
  };

  public class Adapter(config : Config) {
    // This class must be held in a transient actor field. In particular,
    // verifier and authorization-code material must never cross an upgrade.
    var attempts : [Attempt] = [];

    public func begin(
      caller : Principal,
      providerName : Text,
      sessionPrincipal : Principal,
      redirectUri : Text,
      attemptEntropy : Blob,
      verifierEntropy : Blob,
      now : Int,
    ) : { #ok : Start; #err : Types.AppError } {
      if (Principal.isAnonymous(caller) or caller != sessionPrincipal) return #err(#unauthorized);
      if (attemptEntropy.size() != 32 or verifierEntropy.size() != 32) return #err(#internal("OAuth entropy must be 32 bytes"));
      if (config.attempt_ttl_ns <= 0 or config.max_token_response_bytes == 0 or config.max_user_info_response_bytes == 0) {
        return #err(#internal("OAuth bounds are invalid"));
      };
      let providerKey = Text.toLowercase(providerName);
      let ?provider = findProvider(providerKey) else return #err(#invalid("OAuth provider is not allowed"));
      if (not contains(config.allowed_redirect_uris, redirectUri)) return #err(#invalid("OAuth redirect URI is not allowed"));
      prune(now);
      let attemptId = attemptEntropy;
      if (findAttempt(attemptId) != null) return #err(#conflict("OAuth attempt already exists"));
      let state = base64Url(attemptEntropy);
      let verifier = base64Url(verifierEntropy);
      let challenge = BaseX.toBase64(Sha256.fromBlob(#sha256, Text.encodeUtf8(verifier)).vals(), #url({ includePadding = false }));
      let callback = callbackUri(providerKey);
      let authUrl = provider.config.authorizationEndpoint # "?" # form([
        ("response_type", "code"),
        ("client_id", provider.config.clientId),
        ("redirect_uri", callback),
        ("state", state),
        ("scope", Text.join(" ", provider.config.scopes.vals())),
        ("code_challenge", challenge),
        ("code_challenge_method", "S256"),
      ]);
      let expiresAt = now + config.attempt_ttl_ns;
      attempts := Array.append(attempts, [{ id = attemptId; provider = providerKey; session_principal = sessionPrincipal; redirect_uri = redirectUri; state; verifier; issued_at = now; expires_at = expiresAt; consumed = false }]);
      #ok({
        login_url = authUrl;
        attempt_id = attemptId;
        expires_at = expiresAt;
      });
    };

    public func attemptCount() : Nat { attempts.size() };

    public func complete(
      providerName : Text,
      state : Text,
      code : Text,
      now : Int,
      transform : IC.TransformFunction,
    ) : async { #ok : Completion; #err : Types.AppError } {
      if (code == "") return #err(#unauthorized);
      let providerKey = Text.toLowercase(providerName);
      let ?provider = findProvider(providerKey) else return #err(#unauthorized);
      let ?attempt = findState(state) else return #err(#unauthorized);
      if (attempt.provider != providerKey) return #err(#unauthorized);
      if (attempt.consumed) return #err(#conflict("OAuth attempt already consumed"));
      if (now >= attempt.expires_at) {
        eraseState(state);
        return #err(#expired);
      };

      // Remove the verifier from replicated heap before the first await. A
      // failed outcall requires a fresh browser authorization flow.
      eraseState(state);
      let tokenBody = form([
        ("grant_type", "authorization_code"),
        ("code", code),
        ("redirect_uri", callbackUri(providerKey)),
        ("client_id", provider.config.clientId),
        ("code_verifier", attempt.verifier),
      ]);
      let tokenResponse = await boundedRequest(
        provider.config.tokenEndpoint,
        #post,
        [
          { name = "Content-Type"; value = "application/x-www-form-urlencoded" },
          { name = "Accept"; value = "application/json" },
        ],
        ?Text.encodeUtf8(tokenBody),
        config.max_token_response_bytes,
        transform,
      );
      if (tokenResponse.status != 200) return #err(#unauthorized);
      let #ok(tokenJson) = decodeJson(tokenResponse.body) else return #err(#unauthorized);
      let #ok(accessToken) = Json.getAsText(tokenJson, "access_token") else return #err(#unauthorized);
      let #ok(tokenType) = Json.getAsText(tokenJson, "token_type") else return #err(#unauthorized);
      if (Text.toLowercase(tokenType) != "bearer" or accessToken == "") return #err(#unauthorized);

      let userResponse = await boundedRequest(
        provider.user_info_endpoint,
        #get,
        [
          { name = "Accept"; value = "application/json" },
          { name = "Authorization"; value = "Bearer " # accessToken },
          { name = "User-Agent"; value = "Meritocracy-ICP" },
        ],
        null,
        config.max_user_info_response_bytes,
        transform,
      );
      // accessToken is not assigned to any field and becomes unreachable here.
      if (userResponse.status != 200) return #err(#unauthorized);
      let #ok(subject) = parseSubject(provider.kind, userResponse.body) else return #err(#unauthorized);
      #ok({
        provider = providerKey;
        subject;
        session_principal = attempt.session_principal;
        redirect_uri = attempt.redirect_uri;
      });
    };

    func boundedRequest(
      url : Text,
      method : { #get; #head; #post },
      headers : [IC.HttpHeader],
      body : ?Blob,
      maxBytes : Nat64,
      transform : IC.TransformFunction,
    ) : async IC.HttpRequestResult {
      await (with cycles = config.http_cycles) IC.ic.http_request({
        url;
        max_response_bytes = ?maxBytes;
        headers;
        body;
        method;
        is_replicated = ?false;
        transform = ?{ function = transform; context = Blob.fromArray([]) };
      });
    };

    func findProvider(name : Text) : ?Provider {
      Array.find<Provider>(config.providers, func(provider) { Text.toLowercase(provider.config.name) == name });
    };
    func findAttempt(id : Blob) : ?Attempt {
      Array.find<Attempt>(attempts, func(attempt) { attempt.id == id });
    };
    func findState(state : Text) : ?Attempt {
      Array.find<Attempt>(attempts, func(attempt) { attempt.state == state });
    };
    func eraseState(state : Text) {
      attempts := Array.filter<Attempt>(attempts, func(attempt) { attempt.state != state });
    };
    func prune(now : Int) {
      attempts := Array.filter<Attempt>(attempts, func(attempt) { not attempt.consumed and attempt.expires_at > now });
    };
    func callbackUri(provider : Text) : Text {
      withSlash(config.site_url) # "auth/" # provider # "/callback";
    };
  };

  public func stripResponseHeaders(args : IC.TransformArg) : IC.HttpRequestResult {
    { status = args.response.status; headers = []; body = args.response.body };
  };

  public func parseSubject(kind : ProviderKind, body : Blob) : {
    #ok : Text;
    #err;
  } {
    let #ok(userJson) = decodeJson(body) else return #err;
    switch (kind) {
      case (#github) {
        let #ok(id) = Json.getAsNat(userJson, "id") else return #err;
        #ok(Nat.toText(id));
      };
      case (#google) {
        let #ok(sub) = Json.getAsText(userJson, "sub") else return #err;
        if (sub == "") #err else #ok(sub);
      };
    };
  };

  public func githubProvider(clientId : Text) : Provider {
    {
      kind = #github;
      config = {
        name = "github";
        clientId;
        authorizationEndpoint = OAuth.GitHub.authorizationEndpoint;
        tokenEndpoint = OAuth.GitHub.tokenEndpoint;
        scopes = ["read:user"];
      };
      user_info_endpoint = OAuth.GitHub.userInfoEndpoint;
    };
  };

  public func googleProvider(clientId : Text) : Provider {
    {
      kind = #google;
      config = {
        name = "google";
        clientId;
        authorizationEndpoint = OAuth.Google.authorizationEndpoint;
        tokenEndpoint = OAuth.Google.tokenEndpoint;
        scopes = ["openid", "profile"];
      };
      user_info_endpoint = "https://openidconnect.googleapis.com/v1/userinfo";
    };
  };

  func decodeJson(body : Blob) : { #ok : Json.Json; #err } {
    let ?text = Text.decodeUtf8(body) else return #err;
    switch (Json.parse(text)) {
      case (#ok(value)) #ok(value);
      case (#err(_)) #err;
    };
  };
  func base64Url(value : Blob) : Text {
    BaseX.toBase64(value.vals(), #url({ includePadding = false }));
  };
  func contains(values : [Text], value : Text) : Bool {
    Array.find<Text>(values, func(candidate) { candidate == value }) != null;
  };
  func withSlash(value : Text) : Text {
    if (Text.endsWith(value, #char('/'))) value else value # "/";
  };
  func form(values : [(Text, Text)]) : Text {
    Text.join(
      "&",
      Array.map<(Text, Text), Text>(
        values,
        func(pair) {
          UrlKit.encodeText(pair.0, true) # "=" # UrlKit.encodeText(pair.1, true);
        },
      ).vals(),
    );
  };
};
