# identify 0.0.2 backend package view

Source: `https://github.com/f0i/identify`, Mops package `identify@0.0.2`.

This directory contains the 17 files from the upstream `src/backend/`
directory, byte-for-byte. Their sorted `sha256sum` manifest has SHA-256
`d52869373f65c32aa0395b1cb4013cc987e03bebae5cd82b919d50bf7359f79f`.
The copied `mops.toml` has SHA-256
`64319d0b9f91d8e0af1489d2e9d0b7ea2a760778df3df5130d1bda12f6562d18`.

The upstream package also places a frontend E2E actor under `src/`. Motoko
1.4.1 rejects that non-static actor when compiling a library package. The
actor is not a canister dependency and is excluded only from this build view;
no backend source or public backend API is changed. This view remains
credential-free and is not an authorization, OAuth-provider, or deployment
implementation.
