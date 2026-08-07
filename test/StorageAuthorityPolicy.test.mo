import Principal "mo:base/Principal";
import StorageCatalog "../canisters/shared/StorageCatalog";
import Policy "../canisters/storage_authority/StorageAuthorityPolicy";

let anonymous = Principal.fromText("2vxsx-fae");
let unrelated = Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai");

// Distinct, non-anonymous principals are a deployment precondition. Use
// generated principal bytes here so the test does not accidentally give the
// bootstrap/deployer fixture a privileged entry in the matrix.
let validConfig : Policy.Config = {
  core = Principal.fromBlob("\01\01");
  workflow = Principal.fromBlob("\01\02");
  treasury = Principal.fromBlob("\01\03");
  archive = Principal.fromBlob("\01\04");
  evidence = Principal.fromBlob("\01\05");
  governance = Principal.fromBlob("\01\06");
};

let bootstrap = Principal.fromBlob("\01\07");
let logicalId = "meritocracy-legacy-logical-id-v1:users:sha256:0123456789abcdef";

assert (Policy.isValidConfig(validConfig));
assert (not Policy.isValidConfig({ validConfig with governance = validConfig.core }));
assert (not Policy.isValidConfig({ validConfig with governance = anonymous }));
assert (Policy.canInstall(validConfig, bootstrap));
assert (not Policy.canInstall(validConfig, anonymous));
assert (not Policy.canInstall(validConfig, validConfig.core));
assert (not Policy.canInstall(validConfig, validConfig.governance));

assert (Policy.authorizeData(validConfig, validConfig.core, #core, logicalId) == #allowed);
assert (Policy.authorizeData(validConfig, validConfig.workflow, #workflow, logicalId) == #allowed);
assert (Policy.authorizeData(validConfig, validConfig.treasury, #treasury, logicalId) == #allowed);
assert (Policy.authorizeData(validConfig, validConfig.archive, #archive, logicalId) == #allowed);
assert (Policy.authorizeData(validConfig, validConfig.evidence, #evidence, logicalId) == #allowed);

// Direct browser/user ingress, an unrelated canister, governance, and the
// installer/deployer are all denied data access. A correct application caller
// cannot select another owner's collection through this policy.
assert (Policy.authorizeData(validConfig, anonymous, #core, logicalId) == #anonymousCaller);
assert (Policy.authorizeData(validConfig, unrelated, #core, logicalId) == #callerNotAllowed);
assert (Policy.authorizeData(validConfig, validConfig.governance, #core, logicalId) == #callerNotAllowed);
assert (Policy.authorizeData(validConfig, bootstrap, #core, logicalId) == #callerNotAllowed);
assert (Policy.authorizeData(validConfig, validConfig.core, #treasury, logicalId) == #callerNotAllowed);
assert (Policy.authorizeData(validConfig, validConfig.workflow, #archive, logicalId) == #callerNotAllowed);

assert (Policy.authorizeGovernance(validConfig, validConfig.governance) == #allowed);
assert (Policy.authorizeGovernance(validConfig, validConfig.core) == #callerNotAllowed);
assert (Policy.authorizeGovernance(validConfig, bootstrap) == #callerNotAllowed);
assert (Policy.authorizeGovernance(validConfig, anonymous) == #anonymousCaller);

assert (Policy.isValidLogicalId(logicalId));
assert (not Policy.isValidLogicalId(""));
assert (not Policy.isValidLogicalId("bad\nlogical-id"));
assert (
  Policy.authorizeData(validConfig, validConfig.core, #core, "") == #malformedLogicalId
);
assert (
  Policy.authorizeData(validConfig, validConfig.core, #core, "bad\nlogical-id") == #malformedLogicalId
);
assert (
  Policy.authorizeData({ validConfig with governance = validConfig.core }, validConfig.core, #core, logicalId) == #invalidConfiguration
);

// Keep every catalogue owner covered so a future collection cannot silently
// acquire a caller principal outside this fixed matrix.
for (collection in StorageCatalog.collections().vals()) {
  assert (
    Policy.authorizeData(
      validConfig,
      Policy.ownerPrincipal(validConfig, collection.owner),
      collection.owner,
      logicalId,
    ) == #allowed
  );
};
