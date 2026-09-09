import Hex "mo:hex";

assert (Hex.toText([0, 15, 16, 255]) == "000f10ff");
assert (Hex.encodeByteUpper(255) == "FF");
assert (Hex.toTextFormat([32, 47], Hex.URL) == "%20%2F");
assert (Hex.toTextFormat([], Hex.VERBOSE) == "[]");
assert (Hex.toTextFormat([1, 2], Hex.VERBOSE) == "[ 0x01, 0x02 ]");
