// M1 private-storage baseline only. Domain methods start at M2.
// No Candid method exposes this store; future state-changing methods must
// authenticate/authorize `caller` before using it.
import PrivateStore "../shared/VersionedPrivateStore";

persistent actor {
  var _privateStore : PrivateStore.State = PrivateStore.empty;
};
