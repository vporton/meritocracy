# `identify` M1 compatibility fork

This is an owner-approved, local compatibility fork of released
[`identify@0.0.2`](https://github.com/f0i/identify), used only to make the
repository's M1 dependency closure checkable with Motoko `1.4.1`.

It is intentionally not a new OAuth implementation and must not be used to
enable an OAuth provider, persist credentials, or authorize a target action.

## Exact delta from upstream `0.0.2`

1. The upstream `src/frontend/agent-js/e2e/node/canisters/{counter,trap}.mo`
   E2E fixtures are excluded. They are not library API and Motoko 1.4 rejects
   actors in a library package search path.
2. Every backend `"mo:core/..."` import is changed to
   `"mo:core@1/..."`. This preserves the package's declared `core@1.0.0`
   semantics while preventing it from selecting ZenDB's distinct Core 2.4
   line.
3. The package manifest is renamed `identify-m1-compat@0.0.2-m1.1` and its
   Core dependency key is made explicit. No other source or dependency
   version is changed.

The source API entry point remains `src/lib.mo`; its content is byte-identical
to upstream. The fork is supplied to the root under the import name
`identify`, preserving the existing import contract.

`docs/icp/TOOLCHAIN_AND_OAUTH_EVIDENCE.md` records the upstream and fork
hashes, validation commands, Candid/stable review, and rollback boundary.
