import Array "mo:base/Array";
import Char "mo:base/Char";
import Nat "mo:base/Nat";
import Nat32 "mo:base/Nat32";
import Text "mo:base/Text";
import Types "Types";

module {
  public type Argument = { name : Text; value : Text };
  public type ToolCall = { name : Text; arguments : [Argument] };
  public type Limits = { max_weight_numerator : Nat };
  public func normalize(calls : [ToolCall], limits : Limits) : {
    #ok : Types.EvaluationOutcome;
    #err : Text;
  } {
    if (calls.size() != 1 or calls[0].name != "record_assessment") return #err("exactly one record_assessment tool call is required");
    let args = calls[0].arguments;
    if (hasDuplicates(args)) return #err("tool arguments must be unique");
    let ?decision = argument(args, "decision") else return #err("decision is required");
    switch (decision) {
      case ("accepted") {
        if (args.size() != 3) return #err("accepted result has unexpected arguments");
        let ?numeratorText = argument(args, "weight_numerator") else return #err("weight_numerator is required");
        let ?denominatorText = argument(args, "weight_denominator") else return #err("weight_denominator is required");
        let ?numerator = decimal(numeratorText) else return #err("weight_numerator must be an unsigned canonical decimal");
        let ?denominator = decimal(denominatorText) else return #err("weight_denominator must be an unsigned canonical decimal");
        if (denominator == 0 or numerator > limits.max_weight_numerator) return #err("weight is outside configured bounds");
        #ok(#accepted({ weight_numerator = numerator; weight_denominator = denominator }));
      };
      case ("rejected") {
        if (args.size() != 2) return #err("rejected result has unexpected arguments");
        let ?code = argument(args, "reason_code") else return #err("reason_code is required");
        if (Array.find<Text>(["insufficient_evidence", "ineligible", "policy"], func(value) { value == code }) == null) return #err("reason_code is not allowed");
        #ok(#rejected(code));
      };
      case _ #err("decision must be accepted or rejected");
    };
  };
  public func allowedHttpsHost(uri : Text, allowedHosts : [Text]) : Bool {
    let ?rest = Text.stripStart(uri, #text("https://")) else return false;
    if (rest == "") return false;
    var authority = "";
    label chars for (char in rest.chars()) {
      if (char == '/' or char == '?' or char == '#') break chars;
      authority #= Char.toText(char);
    };
    if (authority == "" or Text.contains(authority, #char('@')) or Text.contains(authority, #char(':'))) return false;
    let host = Text.toLowercase(authority);
    if (host != authority and Text.toLowercase(authority) != host) return false;
    if (Text.startsWith(host, #char('.')) or Text.endsWith(host, #char('.')) or Text.contains(host, #text(".."))) return false;
    for (char in host.chars()) {
      let n = Char.toNat32(char);
      if (not ((n >= 97 and n <= 122) or (n >= 48 and n <= 57) or char == '.' or char == '-')) return false;
    };
    Array.find<Text>(allowedHosts, func(value) { Text.toLowercase(value) == host }) != null;
  };
  // Persist only scheme/host/path. Query strings and fragments frequently
  // contain bearer tokens or personal identifiers and are never public data.
  public func publicHttpsUri(uri : Text, allowedHosts : [Text]) : ?Text {
    if (not allowedHttpsHost(uri, allowedHosts)) return null;
    let ?rest = Text.stripStart(uri, #text("https://")) else return null;
    var authority = "";
    var path = "";
    var inPath = false;
    label chars for (char in rest.chars()) {
      if (char == '?' or char == '#') break chars;
      if (not inPath and char == '/') inPath := true;
      if (inPath) path #= Char.toText(char) else authority #= Char.toText(char);
    };
    ?("https://" # Text.toLowercase(authority) # path);
  };
  func argument(args : [Argument], name : Text) : ?Text {
    switch (Array.find<Argument>(args, func(arg) { arg.name == name })) {
      case null null;
      case (?arg) ?arg.value;
    };
  };
  func hasDuplicates(args : [Argument]) : Bool {
    var i = 0;
    while (i < args.size()) {
      var j = i + 1;
      while (j < args.size()) {
        if (args[i].name == args[j].name) return true;
        j += 1;
      };
      i += 1;
    };
    false;
  };
  func decimal(value : Text) : ?Nat {
    if (value == "" or (Text.size(value) > 1 and Text.startsWith(value, #char('0')))) return null;
    var result : Nat = 0;
    for (char in value.chars()) {
      let n = Char.toNat32(char);
      if (n < 48 or n > 57) return null;
      result := result * 10 + Nat32.toNat(n - 48);
    };
    ?result;
  };
};
