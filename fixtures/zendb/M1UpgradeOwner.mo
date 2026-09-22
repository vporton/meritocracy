// Synthetic controller used only by the local ZenDB ownership-handoff proof.
// Two separately installed instances play the former owner (A) and successor
// owner (B). Neither is part of the Meritocracy deployment.

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
    // `controllers` is the only setting this local fixture can change. Its
    // optional-record Candid shape is compatible with the management
    // canister's larger settings record; no other setting is supplied.
    update_settings : shared {
      canister_id : Principal;
      settings : { controllers : ?[Principal] };
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
    let ?principal = target else Runtime.trap("ownership-handoff owner has no target");
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

  // The former owner can supply only the generated digest-bound artifact.
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

  // The former owner creates bounded synthetic data, then revokes its own
  // candidate-level bootstrap role before giving up management control.
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
      logicalId = "intent:ownership-handoff-retained";
      contentHash = "ownership-handoff-retained";
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

  // A makes B the sole management controller. A cannot perform the later
  // upgrade after this management-canister handoff.
  public func handoffSoleController(successor : Principal) : async Bool {
    let ?databaseCanister = target else return false;
    if (phase != "revoked") return false;
    phase := "handoffStarted";
    await management.update_settings({
      canister_id = databaseCanister;
      settings = { controllers = ?[successor] };
      sender_canister_version = null;
    });
    phase := "handedOff";
    true;
  };

  // B is the actual management-canister caller for this normal state-keeping
  // upgrade. The exact artifact is the only Wasm this fixture accepts.
  public func upgradeOwnedExact(wasm : Blob) : async Bool {
    let ?databaseCanister = target else return false;
    if (phase != "configured" or not exact(wasm)) return false;
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

  // B must have intended admin capability after its own upgrade and be able to
  // mutate the bounded synthetic collection.
  public func verifySuccessorAdmin() : async Bool {
    if (phase != "upgraded") return false;
    let remote = db();
    let #ok(grants) = await remote.get_my_access_details() else return false;
    if (grants.size() == 0) return false;
    let probe : Intent = {
      logicalId = "intent:successor-admin-probe";
      contentHash = "successor-admin-probe";
      state = "pending";
      updatedAtNs = 101;
    };
    let #ok(_) = await remote.zendb_v1_collection_insert_document(database, collection, to_candid (probe)) else return false;
    true;
  };

  // The script invokes this only after B has successfully upgraded. A must
  // remain unable to read grants, write, or self-regrant.
  public func verifyFormerOwnerDenied() : async Bool {
    if (phase != "handedOff") return false;
    let remote = db();
    switch (await remote.get_my_access_details()) {
      case (#ok(grants)) {
        if (grants.size() != 0) Runtime.trap("former owner regained access details");
      };
      case (#err(_)) {};
    };
    let probe : Intent = {
      logicalId = "intent:former-owner-denied";
      contentHash = "former-owner-denied";
      state = "pending";
      updatedAtNs = 102;
    };
    switch (await remote.zendb_v1_collection_insert_document(database, collection, to_candid (probe))) {
      case (#ok(_)) Runtime.trap("former owner can still write");
      case (#err(_)) {};
    };
    switch (await remote.grant_global_access(Principal.fromActor(this), "admin")) {
      case (#ok(_)) Runtime.trap("former owner can regrant admin");
      case (#err(_)) true;
    };
  };
};
