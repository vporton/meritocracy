// Synthetic controller for the standalone ZenDB post-upgrade proof. The
// runner deploys this actor and gives it sole controller authority over an
// empty local CanisterDB before it installs the one exact, locally-built
// pinned artifact. It is never part of the Meritocracy deployment.

import CanisterDB "../../src/RemoteInstance/CanisterDB";
import ExactUpgradeArtifact "./M1ExactUpgradeArtifact";
import ZenDB "../../src";
import Principal "mo:core@2.4/Principal";
import Runtime "mo:core@2.4/Runtime";
import Sha256 "mo:sha2@0.1/Sha256";

persistent actor this {
  type Intent = {
    logicalId : Text;
    contentHash : Blob;
    state : Text;
    updatedAtNs : Int;
  };

  type UpgradeOptions = {
    skip_pre_upgrade : ?Bool;
    wasm_memory_persistence : ?{ #keep; #replace };
  };

  type InstallCodeMode = {
    #install;
    #reinstall;
    #upgrade : ?UpgradeOptions;
  };

  type ManagementCanister = actor {
    install_code : shared {
      arg : Blob;
      wasm_module : Blob;
      mode : InstallCodeMode;
      canister_id : Principal;
      sender_canister_version : ?Nat64;
    } -> async ();
  };

  transient let management : ManagementCanister = actor ("aaaaa-aa");
  let database = "m1_post_upgrade";
  let collection = "intents";
  var target : ?Principal = null;
  var phase = "unconfigured";

  let schema : ZenDB.Types.Schema = #Record([
    ("logicalId", #Text),
    ("contentHash", #Blob),
    ("state", #Text),
    ("updatedAtNs", #Int),
  ]);

  func db() : CanisterDB.CanisterDB {
    let ?principal = target else Runtime.trap("post-upgrade owner has no target");
    actor (Principal.toText(principal));
  };

  func exact(wasm : Blob) : Bool {
    wasm.size() == ExactUpgradeArtifact.byteLength and
    Sha256.fromBlob(#sha256, wasm) == ExactUpgradeArtifact.sha256;
  };

  public func configure(databaseCanister : Principal) : async Bool {
    if (phase != "unconfigured") return false;
    target := ?databaseCanister;
    phase := "configured";
    true;
  };

  // The caller can supply only the generated digest-bound artifact. The
  // target canister's controller is this actor, so the anonymous local runner
  // has no direct install or upgrade authority over the database canister.
  public func installInitialExact(wasm : Blob) : async Bool {
    let ?databaseCanister = target else return false;
    if (phase != "configured" or not exact(wasm)) return false;
    phase := "initialInstallStarted";
    await management.install_code({
      mode = #install;
      canister_id = databaseCanister;
      wasm_module = wasm;
      arg = "";
      sender_canister_version = null;
    });
    phase := "installed";
    true;
  };

  // The owner is the bootstrap administrator created by the exact candidate
  // module. It creates a bounded synthetic collection, then revokes itself
  // before any upgrade. Nothing can re-grant it afterward.
  public func prepareAndRevoke() : async Bool {
    if (phase != "installed") return false;
    let remote = db();
    let #ok(_) = await remote.zendb_v1_create_database(database) else return false;
    let #ok(_) = await remote.zendb_v1_create_collection(database, collection, schema, null) else return false;
    let #ok(_) = await remote.zendb_v1_collection_create_index(
      database,
      collection,
      "logical_id_unique",
      [("logicalId", #Ascending)],
      ?{ is_unique = true },
    ) else return false;
    let record : Intent = {
      logicalId = "intent:post-upgrade-retained";
      contentHash = "post-upgrade-retained";
      state = "pending";
      updatedAtNs = 100;
    };
    let #ok(_) = await remote.zendb_v1_collection_insert_document(database, collection, to_candid (record)) else return false;
    let owner = Principal.fromActor(this);
    let #ok(_) = await remote.revoke_global_access(owner, "admin") else return false;
    let #ok(grants) = await remote.get_my_access_details() else return false;
    if (grants.size() != 0) return false;
    phase := "revoked";
    true;
  };

  // This is deliberately a normal upgrade, with no replacement of stable
  // Wasm memory. The exact v2.0.1 standalone actor-class artifact does not
  // carry the EOP marker accepted by the local replica, so #keep is rejected;
  // #replace would invalidate this state-preservation proof and is prohibited.
  public func upgradeOwnedExact(wasm : Blob) : async Bool {
    let ?databaseCanister = target else return false;
    if (phase != "revoked" or not exact(wasm)) return false;
    phase := "upgradeStarted";
    await management.install_code({
      mode = #upgrade(null);
      canister_id = databaseCanister;
      wasm_module = wasm;
      arg = "";
      sender_canister_version = null;
    });
    phase := "upgraded";
    true;
  };

  // A successful result proves the candidate retained the revoked RBAC state:
  // the original owner cannot read grants, write, or re-escalate after the
  // exact candidate upgrade. The retained record is not read because this
  // revoked principal intentionally lacks collection read authority.
  public func verifyPostUpgradeRevocation() : async Bool {
    if (phase != "upgraded") return false;
    let remote = db();
    let #ok(grants) = await remote.get_my_access_details() else Runtime.trap("post-upgrade owner cannot read its RBAC state");
    if (grants.size() != 0) Runtime.trap("post-upgrade upgrade restored the revoked bootstrap grant");
    let probe : Intent = {
      logicalId = "intent:post-upgrade-probe";
      contentHash = "post-upgrade-probe";
      state = "pending";
      updatedAtNs = 101;
    };
    switch (await remote.zendb_v1_collection_insert_document(database, collection, to_candid (probe))) {
      case (#ok(_)) Runtime.trap("post-upgrade revoked owner can still write");
      case (#err(_)) {};
    };
    switch (await remote.grant_global_access(Principal.fromActor(this), "admin")) {
      case (#ok(_)) Runtime.trap("post-upgrade revoked owner can restore its admin role");
      case (#err(_)) true;
    };
  };
};
