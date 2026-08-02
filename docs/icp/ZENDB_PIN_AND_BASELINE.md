# M1 ZenDB pin and baseline

Status: M1 task 3 is **IN_PROGRESS** as of 2026-08-02. This records one immutable, locally reproducible candidate and the results that are safe to claim today. It neither approves ZenDB as an authoritative store nor authorizes a deployment, production database access, credentials, or asset movement.

## Pin

The machine-readable pin is [`third_party/zendb/v2.0.1.pin.json`](../../third_party/zendb/v2.0.1.pin.json).

| Input or artifact | Immutable value |
| --- | --- |
| Source | `https://github.com/NatLabs/ZenDB.git`, released tag `v2.0.1` |
| Commit/tree | `481d9cdac1ac41f01ba7892cfa720dbe4e87e4cd` / `b0cd3fed87a51eac02c00141ff610790b20ab0d7` |
| Git archive SHA-256 | `332e88c5ed8a777472d0843597d0b3c080b5b6f6e53d251b52aa0883b3444844` |
| Source dependency lock | `mops.lock` SHA-256 `79b2a699c484e57ee5bbaa20e50d1da7c556c4e3a132ff7a655523eeffced267` (Mops lock format 3) |
| Build toolchain | Mops CLI `2.19.2`, source-pinned `moc 1.4.1`, DFX `0.32.0` |
| Remote canister | `zendb-canister-eop`, `src/RemoteInstance/CanisterDB/lib.mo`, enhanced orthogonal persistence |
| Generated Candid SHA-256 | `6ded91f5fba2ffc85f93bd870e5cd1c4a4bea4f0d2c5b2991a4ff1b6ebb7e79d` |
| Generated Wasm SHA-256 | `513a401d21c2ada26c84ba6b0788c694aae0d230689535fb4b3870dcc2c90a5c` |

The tag's source package metadata declares `zendb` version `2.0.0`; the tag/commit—not that package version—is the authority for this candidate. The candidate is licensed `AGPL-3.0-or-later`, compatible with this repository's AGPL-3.0-only baseline.

## Reproduction boundary

Run the following from the repository root:

```sh
scripts/icp/verify-zendb-pin.sh
```

The verifier clones the exact commit into a new `/tmp/meritocracy-zendb-pin.*` directory, validates the source archive and Mops closure, starts only a local DFX replica, creates a local build canister, compares the Candid and Wasm SHA-256 values, then stops that local replica even after a failure. It never uses `--ic`, deploys, opens a production connection, or handles credentials. The temporary checkout is deliberately retained for audit and may be removed manually after review.

This baseline build completed with the source's own DFX configuration (`O3`, shrink, enhanced orthogonal persistence). DFX also reported that its Wasm optimization pass could not read the module. The produced module hash above is reproducible in the recorded environment, but that optimizer diagnostic is a release blocker until its cause and effect are independently reviewed; it is not silently waived by this pin.

Two clean local builds produced identical Candid and Wasm hashes. Their generated `.most` files were not byte-identical: Motoko `1.4.1` assigned different internal anonymous-type labels while describing the same source. This means an exact `.most` SHA-256 would be a false reproducibility claim. G2 must run a semantic stable-compatibility check over a retained prior stable signature and investigate whether a deterministic stable-signature artifact can be obtained before an upgrade is proposed.

## API and authorization findings

The candidate's generated Candid exposes `grant_collection_access` and `revoke_collection_access`, whose scope is `(database, collection)`. Its source also creates `reader`, `writer`, `observer`, and `admin` roles. A local initialization grants global `admin` to the initial owner and to the database canister principal itself.

That self-grant is an implementation-required privilege that must be explicitly audited. M1 does **not** accept it as harmless merely because ordinary ingress cannot impersonate a canister principal. The forthcoming proof must show that it cannot create an unauthorized external path, survives upgrades without scope expansion, and remains absent from the desired application-principal grant matrix except where required internally.

The API returns generated document IDs from insert operations. It does not, in this candidate, expose caller-supplied document IDs or a version/hash compare-and-set update. M1 therefore retains the application logical-ID design: every authoritative document has an indexed logical-ID field; the owning Motoko canister serializes a logical key through its durable intent and reconciles it by logical ID/content hash after each remote await. Direct database grants to importers, browsers, users, and unrelated canisters are prohibited. A conflicting hash or version fails closed. Any collection whose invariant cannot be protected by this protocol and a pinned, tested ZenDB operation needs a narrowly scoped native-Motoko exception at G2.

## Remaining proof work

The first repeatable remote-RBAC baseline is now `scripts/icp/test-zendb-rbac.sh`. It validates the exact source archive and dependency lock before running the candidate's `CanisterDB.Test` against PocketIC with distinct synthetic proxy-canister principals. The companion [`third_party/zendb/v2.0.1.rbac-proof.json`](../../third_party/zendb/v2.0.1.rbac-proof.json) records its pinned runner, exact coverage, and deliberate limits. It proves collection scope isolation and that ungranted/writer callers cannot read, write, manage collections, or grant roles; it also demonstrates why database-level access is unacceptable for the target matrix. It does not make a grant, deployment, or collection authoritative.

Run it from the repository root:

```sh
scripts/icp/test-zendb-rbac.sh
```

The first target-data proof harness is `scripts/icp/test-zendb-authoritative.sh`,
with its executed coverage recorded in
[`third_party/zendb/v2.0.1.authoritative-proof.json`](../../third_party/zendb/v2.0.1.authoritative-proof.json).
It validates the pin before copying a synthetic test into an ephemeral source
checkout and runs it only against a fresh, project-local ephemeral DFX `0.32.0`
loopback replica. It never invokes `mops install` (which makes an unrelated
compatibility request in Mops `2.19.2`); DFX builds using the source's pinned
`mops sources` packtool after the source archive and lock have been verified.
The runner pings its `local` network before creation, names `--network local`
for every create/build/deploy/call operation, and uses `--no-wallet`, so it
cannot share the ordinary developer port or fall through to another configured
network. Each DFX operation is bounded to 180 seconds and then force-terminated
after a further 10 seconds; the cleanup trap attempts to stop the ephemeral
replica on every failure path. Every DFX command uses DFX's built-in `anonymous`
identity, so the harness neither reads a developer PEM/keyring nor selects a
wallet/signing authority. The corrected runner passed on `2026-08-02` against
the exact pinned source, DFX `0.32.0`, Mops CLI `2.19.2`, and moc `1.4.1`. It
created the remote database before its collection, created a unique `logicalId`
index, rejected identical and conflicting retries, recovered the first content
hash through a one-result logical-ID lookup, and advanced a one-document opaque
cursor page without an offset. The local replica stopped after `runTests`
returned normally. The cursor is in ZenDB-generated document-ID order, not
application logical-ID order, so it is appropriate only for bounded repair
traversal; application logical-ID/hash reconciliation remains mandatory.

The previous Mops `pic-js-mops` route remains unsuitable: its single ingress
message is limited to 2,097,152 bytes while the test actor statically linked to
the candidate measured 3,281,858 bytes. The harness therefore uses the exact
pinned DFX local installer, and records a pass only after that installer
succeeds and `runTests` returns normally. The recorded pass is local DFX
execution evidence, not a claim about the Mops installer, an ICP deployment, or
a production-sized load test. It is evidence for the application's required
intent/lookup protocol, not evidence that ZenDB supplies idempotent insert,
caller-selected document IDs, CAS, or a multi-document transaction.

The runner now also contains (and must be rerun on a network-capable machine)
an owning-canister lost-reply/duplicate-delivery fixture. It journals the
remote-write phase before an intentionally trapped reply, then reconciles the
same logical ID and content hash without allocating a second key. Before
revocation it audits the exact two global admins (the provisional owner and
ZenDB's internal self-grant), revokes the owner, upgrades the remote
`CanisterDB` artifact, and checks that the owner cannot regain grants or write
after upgrade. It also has a bounded collection-v1-to-v2 fixture: it replays
an unacknowledged one-document source page, accepts a duplicate only when its
logical ID and content hash match, retains the v1 collection, and verifies both
v2 records before a visibility switch would be eligible. These are implemented
evidence only until a local rerun completes; a failed build or unavailable
network is not treated as a pass.

When `M1_ZENDB_SOURCE_DIR` names an already available ZenDB checkout, the
runner verifies and exports the exact pinned commit into its ephemeral working
directory instead of cloning from that checkout. This keeps the supplied source
read-only and avoids an accidental network fetch from a partial/promisor clone;
the extracted archive must still match the pinned SHA-256 before the test is
copied in. The runner explicitly sets the Mops `DFX_MOC_PATH=moc-wrapper`
setting so non-interactive/CI invocations do not depend on reloading a shell
profile. Neither behavior expands this limited executed proof into an
authoritative-storage approval.

Run it from the repository root:

```sh
scripts/icp/test-zendb-authoritative.sh
```

The local-only harness `scripts/icp/test-zendb-benchmark.sh` copies
`fixtures/zendb/M1BoundedBenchmark.mo` into the same immutable source boundary,
then runs 16-document expected and 32-document 2x synthetic distributions on a
fresh DFX replica. It exercises its owning-side rejection checks for an
over-envelope document or batch before any remote call, creates the documented
logical-ID and repair indexes, and reports
candidate-provided query/replace/delete instruction counts plus document/index
byte figures. It also deletes and recreates the repair index to record rebuild
entries. Its exact planned coverage and API gaps are recorded in
[`third_party/zendb/v2.0.1.benchmark-proof.json`](../../third_party/zendb/v2.0.1.benchmark-proof.json).

The `2026-08-02` execution passed on a fresh ephemeral project-local DFX
loopback replica with the exact pinned source archive, DFX `0.32.0`, Mops CLI
`2.19.2`, and moc `1.4.1`. The expected/2x results, respectively, were: 16/32
input documents; 181/174 average document bytes; 2,982/5,878 bounded remote
write bytes; 186/183 one-document recovery-read bytes; 1,511,238/1,475,755
query instructions; 3,087,405/3,064,034 replace instructions; 1,310,724/
1,310,369 delete instructions; 854/1,545 logical-ID index bytes; and 16/32
rebuilt repair-index entries. The owner-side 262,145-byte-document and
1,048,577-byte-batch rejection assertions also passed before any remote call.
The complete machine-readable record is
[`third_party/zendb/v2.0.1.benchmark-proof.json`](../../third_party/zendb/v2.0.1.benchmark-proof.json).

ZenDB v2.0.1 does not return insert or index-create instruction counts, and
this harness intentionally does not invent them. It also does not establish
archive cross-canister byte costs, low-cycle behavior, or any
durable-intent/RBAC/upgrade proof. Those omissions remain G2 blockers. DFX
again reported that its Wasm optimization pass could not read the module; the
existing release blocker remains unwaived.

The runner deliberately does not call `mops install`: Mops CLI `2.19.2`
performs an unrelated compatibility request to the ICP API before that command
resolves the already pinned lock. DFX instead invokes the source's pinned Mops
packtool during the local build. Before it creates a canister, the runner pings
the fresh `local` replica; every create, build, deploy, and call command names
`--network local`, and creation uses `--no-wallet`. A missing or unhealthy
local replica therefore fails the run before an operation can use a configured
remote network. The runner also configures DFX with an ephemeral
project-local loopback bind address, so it neither shares nor stops a
developer's ordinary `127.0.0.1:4943` replica. These are runner safety
properties, not benchmark evidence.

Run it from the repository root, optionally with an immutable local source
checkout through `M1_ZENDB_SOURCE_DIR`:

```sh
scripts/icp/test-zendb-benchmark.sh
```

Before task 3 can be marked implemented and before G2 can be requested, add and pass the remaining target benchmark/proof suite for generated expected, 2×, and rejection-limit distributions. It must measure insert/query/update/delete/reindex instructions, bytes/document, index multiplier, archive cross-canister bytes, and low-cycle behavior; prove documented indexes; and cover the owning application's durable intent across actual duplicate delivery/lost reply, bootstrap revocation, post-upgrade grant audit and self-grant ingress boundary, repair/resume, crash/upgrade recovery, and archive failure. All test records must be synthetic and stay local/PocketIC.

Rollback: delete only the undeployed pin manifest, verifier, and this evidence file. The legacy Node/PostgreSQL service, production data, signing authority, and assets are unchanged.
