export function makeUserSoftDeletePayload(deletionTimestamp: Date) {
  return {
    isDeleted: true,
    deletedAt: deletionTimestamp,
    email: null,
    ethereumAddress: null,
    solanaAddress: null,
    bitcoinAddress: null,
    polkadotAddress: null,
    cosmosAddress: null,
    stellarAddress: null,
    orcidId: null,
    githubHandle: null,
    bitbucketHandle: null,
    gitlabHandle: null,
    onboarded: false,
    emailVerified: false
  };
}
