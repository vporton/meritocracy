# Motoko release configuration

Use `release-manifest.example.json` as the signed evidence for each reviewed
release. Runtime Motoko settings belong in `../config.json`, copied from
`../config.example.json`, and are applied by the executable configuration path:

```sh
cp icp/config.example.json icp/config.json
# Edit public OAuth client IDs, principals, ledgers, and policy limits.
npm run configure:icp -- icp/config.json --network local --dry-run
npm run configure:icp -- icp/config.json --network local
```

The command resolves deployed canister IDs with `dfx`, validates the settings,
and calls every governed `configure*` method. `--dry-run` validates and prints
the calls without changing canister state. The config contains public values
only and can be committed for review; OAuth client secrets are deliberately
unsupported because canister state is public.

Registry accepts exactly ORCID, GitHub, Bitbucket, and GitLab. The configured
public client IDs are stored in Registry's durable configuration, restored
into the transient OAuth adapter after upgrades, and used in both the provider
authorization URL and authorization-code exchange.

Do not put Motoko settings in `backend/.env`. That file belongs to the legacy
Express process and is neither visible to a canister nor durable canister
configuration. Do not put credentials or signing material in this directory;
keep those in an external secret store and never replicate them in a canister.

See `docs/icp/OPERATIONS.md` for the release and configuration procedure, then
run `npm run preflight:icp` against the completed manifest.
