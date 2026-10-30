# ZenDB split-toolchain evaluation

Status: M1 negative compatibility evidence, 2026-10-30. This record evaluates
only a local source checkout. It neither approves ZenDB as storage nor creates
a remote ZenDB canister, grant, deployment, provider credential, or target
data.

## Decision boundary

The owner authorized evaluation with two pinned Motoko toolchains after the
project's OAuth dependency and ZenDB could not share one compiler:

| Build domain | Compiler | Purpose |
| --- | --- | --- |
| Application interfaces and `identify@0.0.2` | Motoko `0.16.3` | Current M1 OAuth caller-binding fixture |
| ZenDB candidate only | Motoko `1.4.1` | Isolated `v2.0.1` source/dependency probe |

This is **not** permission to combine Motoko source compiled by different
toolchains in one actor. A private in-process Motoko library is compiled into
the same Wasm as its owning actor. Therefore an actor using ZenDB must
eventually use one compiler compatible with both ZenDB and its authentication
and actor dependencies, or ZenDB must be rejected. An extra remote canister
would evade that compiler constraint but is prohibited by the approved private
storage topology.

## Exact candidate and reproducibility inputs

| Item | Value |
| --- | --- |
| Source repository | `https://github.com/NatLabs/ZenDB.git` |
| Git commit/tag under evaluation | `481d9cdac1ac41f01ba7892cfa720dbe4e87e4cd` (`v2.0.1`) |
| Git archive SHA-256 | `332e88c5ed8a777472d0843597d0b3c080b5b6f6e53d251b52aa0883b3444844` |
| ZenDB `mops.toml` SHA-256 | `09f5e7cd4281ca46953419cdad9fa1a1b376d211288a66af780f505b07336d18` |
| ZenDB `mops.lock` SHA-256 | `79b2a699c484e57ee5bbaa20e50d1da7c556c4e3a132ff7a655523eeffced267` |
| ZenDB `src/lib.mo` SHA-256 | `4c499eb64d9b1fe4989606a159cd740d8ea0faf17be5b04f029ead6c36bc0a59` |
| ZenDB compiler | Motoko `1.4.1` |
| ZenDB compiler binary SHA-256 | `2c7f1c242601db08465d9c96f9a933cc4458d2d74c8587261f970797c32f9d9d` |

`scripts/icp/test-zendb-toolchain-isolation.sh` checks every listed input,
rejects a dirty checkout, and prevents an application-toolchain Motoko source
from importing ZenDB. The guard is always runnable:

```sh
scripts/icp/test-zendb-toolchain-isolation.sh --guard-only
```

The full local probe requires a clean source checkout, for example one supplied
by an operator from the exact commit:

```sh
M1_ZENDB_SOURCE_DIR=/path/to/clean/zendb \
  scripts/icp/test-zendb-toolchain-isolation.sh
```

## Result: candidate remains incompatible

The exact ZenDB project declares Motoko `1.4.1`, but its locked dependency
closure fails while compiling `src/lib.mo` with that compiler:

```text
memory-collection@0.4.0 ... field bytes does not exist in module
```

The script deliberately treats that exact failure as a passing **negative
compatibility** check. A different failure, a changed hash, a dirty source tree,
or an unexpected successful compile fails the script and requires review.

Consequently the split-toolchain decision establishes a reproducible boundary
and rules out accidental imports; it does **not** make ZenDB `v2.0.1` an M1
candidate. M1 remains blocked from private-storage implementation with ZenDB
until a single reproducible compatible compiler/dependency closure is selected
and its build, exact state-preserving upgrade, logical-ID/hash recovery,
boundedness, and owning-actor authorization tests pass. No unmerged or future
upstream change is evidence.
