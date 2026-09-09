/// A deliberately small, audited replacement for the released `hex@1.0.2`
/// package at the same `mo:hex` import boundary. It covers the complete API
/// used by the retained `identify@0.0.2` backend: byte encoding and formatted
/// URL encoding. It stores no state and performs no calls.
module {
  public type Format = {
    pre : Text;
    post : Text;
    sep : Text;
    preItem : Text;
    empty : Text;
    upper : Bool;
  };

  public let COMPACT : Format = {
    pre = ""; post = ""; sep = ""; preItem = ""; empty = ""; upper = false;
  };

  public let COMPACT_UPPER : Format = {
    pre = ""; post = ""; sep = ""; preItem = ""; empty = ""; upper = true;
  };

  public let COMPACT_PREFIX : Format = {
    pre = "0x"; post = ""; sep = ""; preItem = ""; empty = ""; upper = false;
  };

  public let VERBOSE : Format = {
    pre = "[ "; post = " ]"; sep = ", "; preItem = "0x"; empty = "[]"; upper = false;
  };

  public let VERBOSE_UPPER : Format = {
    pre = "[ "; post = " ]"; sep = ", "; preItem = "0x"; empty = "[]"; upper = true;
  };

  public let URL : Format = {
    pre = ""; post = ""; sep = ""; preItem = "%"; empty = ""; upper = true;
  };

  public func encodeNibble(nibble : Nat8) : Text {
    switch (nibble) {
      case (0) { "0" }; case (1) { "1" }; case (2) { "2" }; case (3) { "3" };
      case (4) { "4" }; case (5) { "5" }; case (6) { "6" }; case (7) { "7" };
      case (8) { "8" }; case (9) { "9" }; case (10) { "a" }; case (11) { "b" };
      case (12) { "c" }; case (13) { "d" }; case (14) { "e" }; case (15) { "f" };
      case (_) { assert false; "" };
    };
  };

  public func encodeNibbleUpper(nibble : Nat8) : Text {
    switch (nibble) {
      case (0) { "0" }; case (1) { "1" }; case (2) { "2" }; case (3) { "3" };
      case (4) { "4" }; case (5) { "5" }; case (6) { "6" }; case (7) { "7" };
      case (8) { "8" }; case (9) { "9" }; case (10) { "A" }; case (11) { "B" };
      case (12) { "C" }; case (13) { "D" }; case (14) { "E" }; case (15) { "F" };
      case (_) { assert false; "" };
    };
  };

  public func encodeByte(byte : Nat8) : Text {
    encodeNibble(byte / 16) # encodeNibble(byte % 16);
  };

  public func encodeByteUpper(byte : Nat8) : Text {
    encodeNibbleUpper(byte / 16) # encodeNibbleUpper(byte % 16);
  };

  public func toText(bytes : [Nat8]) : Text {
    var output = "";
    for (byte in bytes.vals()) { output #= encodeByte(byte) };
    output;
  };

  public func toTextFormat(bytes : [Nat8], options : Format) : Text {
    if (bytes.size() == 0) { return options.empty };
    let encode = if (options.upper) { encodeByteUpper } else { encodeByte };
    var output = options.pre;
    var first = true;
    for (byte in bytes.vals()) {
      if (not first) { output #= options.sep };
      output #= options.preItem # encode(byte);
      first := false;
    };
    output # options.post;
  };
};
