import Error "mo:base/Error";
import LlmClient "LlmClient";

module {
  public type Failure = { #timeout; #provider_unavailable };
  public type Result = { #ok : LlmClient.RawResponse; #err : Failure };
  public type Sender = LlmClient.Request -> async LlmClient.RawResponse;

  public func classifyCode(code : Error.ErrorCode) : Failure {
    switch (code) {
      case (#system_unknown) #timeout;
      case _ #provider_unavailable;
    };
  };

  // The sender is injected so tests never contact a provider. Production
  // passes LlmClient.send. Raw provider text and reject messages are discarded.
  public func request(sender : Sender, input : LlmClient.Request) : async Result {
    try {
      #ok(await sender(input));
    } catch (error) {
      #err(classifyCode(Error.code(error)));
    };
  };
};
