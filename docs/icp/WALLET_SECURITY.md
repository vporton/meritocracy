# Wallet custody, Chain Fusion, and authorization

Status: G1 architectural direction and G3 design draft. No wallet code, canister, key migration, or asset transfer has been performed.

## Security objective and terminology

The target eliminates server-held signing keys. It does **not** claim that automated treasury custody is “non-custodial” to recipients: assets held by a canister are controlled by the canister's code and whoever can change that code. Chain Fusion removes a single stored private key/custodian, but governance and code remain part of the custody trust model.

Security objectives:

- one logical obligation causes at most one value transfer;
- balances/liabilities/reserves/fees reconcile exactly in base units;
- no private key or seed is reconstructible by an application operator;
- production treasury upgrades occur only through the SNS governance path; proposal delay, policy caps, a pause-only role, reproducible artifacts, monitoring, and recovery drills limit controller compromise;
- ambiguous sends are reconciled, never blindly repeated;
- every authorization, destination version, policy version, attempt, ledger/chain identifier, confirmation, reorg, and manual action remains auditable;
- development/test automation is unable to reach production signing authority or real funds.

## Current custody finding

The legacy system is a server-custodial hot wallet:

- `SystemSecret.value` stores private keys, mnemonics, WIFs, and an ICP PEM in plaintext; startup can generate missing secrets and copy them into process environment.
- EVM, Solana, Bitcoin, Bitcoin Cash, Cosmos, Polkadot, Stellar, ICP, and ICRC transfers sign from Node/process-held material.
- No third-party wallet custodian was found. RPC services relay/read; Reown wallets are user-owned funding wallets.
- ICP/ck-token transfers use a local identity, not a canister-owned account, and omit useful ICRC deduplication fields.
- External sends happen before durable completion; stale attempts can be reset/replayed without chain reconciliation.
- Non-EVM country/region display addresses do not reliably select the matching signer.

These facts mean no production legacy payment state may be converted directly into an executable target operation. Every pending/failed/ambiguous row is reconciled first.

## Custody options considered

| Option | Benefit | Risk/cost | Decision |
| --- | --- | --- | --- |
| Third-party custodial/MPC wallet | Mature operations, recovery, compliance services | Reintroduces external custodian, API/key compromise and account freeze risk; may not support all chains/scopes; provider policy dependency | Rejected for new treasury custody. May be an explicitly governed emergency/off-ramp service later, never the unrecorded default |
| Server/HSM/KMS signer | Familiar architecture; HSM improves raw-key protection | Still off-chain and centrally operated; code/operator can request signatures; conflicts with fully on-chain target | Rejected for target; legacy only until cutover |
| Canister-controlled ICP/ICRC accounts | No private key; standard `(owner principal, subaccount)`; append-only ledgers; low-cost transfers | Controller/code can direct account; cross-canister calls non-atomic; ledger dedup window finite | Preferred for ICP and ICRC assets |
| Chain-key tokens (`ckBTC`, `ckETH`, `ckERC20`, etc.) | ICRC settlement on ICP, 1:1 backing, no app-operated bridge/custodian, standard transfers | Depends on NNS-controlled ledger/minter/checker and underlying chain; mint/withdraw latency/fees and supported-asset scope | Preferred where product can settle the ck asset; keep distinct from native external asset |
| Direct external address through Chain Fusion | Native BTC/EVM/Solana/etc. control without a stored private key; programmatic deposits/payouts | Highest implementation complexity: RPC consensus, fees, nonce/UTXO/sequence, finality/reorg, chain libraries, cycles | Use only when native-chain custody/payout is required and that adapter passes G3/testnet review |

ICP's current Chain Fusion model provides threshold ECDSA/Schnorr signatures, native Bitcoin integration, EVM RPC, SOL RPC, and raw HTTPS RPC paths; see [Chain Fusion](https://docs.internetcomputer.org/concepts/chain-fusion/). Chain-key tokens are ICRC ledgers backed by external assets; see [chain-key tokens](https://docs.internetcomputer.org/guides/digital-assets/chain-key-tokens/).

## Recommended custody per asset class

| Legacy/product asset | Target custody | Production enablement |
| --- | --- | --- |
| ICP | Unified-treasury ICRC account/subaccounts | First tier after ICRC replay/reconciliation tests |
| ckBTC, ckETH, ckUSDT, ckUSDC, ckEURC and other approved ck assets | Unified-treasury ICRC accounts; deposits/minting through official minter flow | First tier per exact ledger/minter canister allowlist and testnet/rehearsal |
| Native BTC | Direct Chain Fusion treasury address via Bitcoin API, or accept/mint ckBTC when native payout is unnecessary | Second tier; UTXO/fee/confirmation/reorg audit required |
| Ethereum, Arbitrum, Optimism, Base, Polygon, Celo/Sepolia | Direct per-chain threshold-ECDSA treasury address through NNS-controlled EVM RPC; use ck assets only where their ledger/minter flow is the approved asset path | Second tier per chain ID, provider consistency, nonce/fee/finality audit |
| Native/ERC-20 | Canonical contract+chain asset registry; direct EVM transaction only after bytecode/decimals/fee policy allowlist | Never infer asset by symbol |
| Solana | Threshold-Schnorr Ed25519 plus SOL RPC/direct RPC; or ckSOL when approved and suitable | Later tier; durable nonce/blockhash/finality and Motoko transaction-library maturity required |
| Bitcoin Cash | Threshold ECDSA with BCH-specific transaction/address rules and multi-provider HTTPS RPC | Later tier; no BTC-code reuse without BCH vectors/audit |
| Cosmos | Threshold ECDSA address with chain ID/account number/sequence and multi-provider RPC | Later tier; per-chain codec/fee/finality audit |
| Polkadot | Supported account/signature type with threshold Ed25519 where accepted, chain genesis hash/runtime/nonce/era/finality | Later tier; runtime-upgrade compatibility and codec audit |
| Stellar | Threshold Ed25519, sequence/timebounds/memo, multi-provider RPC | Later tier; envelope hash/finality audit |

“Supported by a threshold signature scheme” is not the same as a production-ready adapter. No network is marked parity complete until transaction construction, canonical address, fee, replay, finality, reorg, cycle, and failure-injection tests pass.

## Unified Chain Fusion treasury

One SNS-controlled `treasury_canister` is the sole application authority for both accounting and custody. It is not blackholed and there is no separate vault canister. Its proposed pinned ZenDB canister is a treasury-role-restricted storage dependency, not an independently callable accounting authority. The treasury canister owns:

- double-entry accounting journal, obligations and holds, payment-cycle/rounding/remainder policy, immutable payment intents/destination snapshots, reconciliation reports, and stable scheduler/cursors;
- ICP/ICRC accounts/subaccounts, Chain Fusion key-derivation paths and signing requests, immutable operation receipts, and chain nonce/sequence/UTXO reservations;
- asset/network allowlists, transaction and rolling-window caps, fee caps, destination encoding validation, and immediate pause state.

Every payment method authenticates its caller and authorizes the exact action in the treasury canister before signing/sending. Because its ZenDB receipt collection is remote, “persists the operation receipt” means the treasury first commits a native durable intent, writes the receipt under the immutable application `operationId` logical key, and confirms the stored content hash before any signing call. The treasury canister alone has collection-scoped write/read capability; users, browsers, other application canisters, operators, and pause-only principals have no direct receipt-collection access, while ZenDB administration remains governance-only. The method binds:

```text
operationId
policyVersion
assetId + chain/network
source scope/subaccount/derivation path
destination canonical bytes
amount base units
maximum fee and expiry
business obligation hash
```

The first accepted operation ID stores the canonical operation hash. An identical replay returns the stored state/result. A different request under that ID is rejected and audited. A timeout or lost ZenDB reply is reconciled by the same logical key and hash before signing or retrying; an absent key may be rewritten with identical bytes, while a conflicting hash pauses payment. A ZenDB-generated document ID is never the replay key. No receipt/history cleanup is allowed. Timeout/unknown external-chain results stay ambiguous until authoritative reconciliation.

The SNS is the only production controller. Its proposals require the reviewed delay, reproducible Wasm and stable/Candid compatibility evidence, test results, security diff, controller/module-hash verification, and an exercised recovery plan. Independent safety principals can pause only; they cannot resume, upgrade, change policy/caps, change controllers, or send funds. Because the treasury remains upgradeable, a controller compromise can request signatures through malicious code; G3 therefore validates the governance, pause, cap, monitoring, and recovery controls rather than claiming immutable-code containment.

An SNS is per application, not a generic testnet controller. Before G3, the authorized human decision must name whether this application will launch its own SNS or use an already governed application path, and record the ownership/tokenomics, applicable `sns_init` or existing-SNS configuration, voting/quorum/delay, cycle-management, root-handoff, and recovery model. That decision is intentionally not inferred from the architectural direction to use an SNS. Local SNS tooling or PocketIC may prove the controller interface before G3. The isolated, non-custodial mainnet SNS testflight explicitly authorized at G4 proves handoff/recovery mechanics with a testflight SNS under a bounded approved cycle budget; the separately reviewed production SNS handoff follows it. Neither is a pre-G4 deployment or an excuse to test with production data, derivation paths, payment authority, or custodial assets.

### Scope isolation

Global, country, and EU/region treasuries get independent cryptographic authority:

- ICRC: deterministic subaccount `H("meritocracy-v1" || scopeType || scopeId || assetId)` owned by the unified treasury.
- Direct chains: threshold-key derivation path includes version, chain/network, and canonical scope. EVM chains use separate derivation paths/addresses to avoid shared-key cross-chain coupling.
- A scope balance is allocated only within that scope. Global funds cannot be counted again for every country/region.
- Displayed deposit address is derived by the same treasury method that will later sign, and tests prove the address/public key/derivation path relationship.

## Accounting model

Money uses integer base units and a canonical asset registry. Suggested journal accounts include:

- `ExternalObserved(asset,scope)`
- `TreasuryAvailable(asset,scope)`
- `UserLiability(user,asset,scope)`
- `PaymentReserved(operation)`
- `Paid(operation)`
- `NetworkFeeExpense(asset,scope)`
- `UnexplainedDifference(asset,scope)` — must be zero to activate.

Every journal group balances debits and credits. A “failed” attempt does not erase the liability. KYC/liveliness/ban state holds the obligation; it does not convert it to zero. The legacy code path that marks backlog processed on KYC failure is `INTENTIONALLY_CHANGED` unless an explicit later policy lawfully directs another destination with an auditable journal entry.

GDP share allocation must define:

1. eligible snapshot and policy version;
2. exact available base units after fee reserve;
3. fixed-point share representation;
4. floor/rounding rule;
5. deterministic remainder assignment (for example, largest fractional remainder then stable user ID);
6. sum of liabilities exactly equals distributable amount;
7. no user is paid from a later address version than the intent snapshot.

## Payment state machine

```text
ObligationHeld
  -> IntentPrepared
  -> TreasuryAccepted
  -> Signed/Broadcast (or LedgerSubmitted)
  -> SubmittedAmbiguous | SubmittedKnown
  -> ConfirmedProvisional
  -> Finalized

Any non-final state may -> Paused or NeedsManualReview.
Finalized never returns to payable; a reorg appends a reversal/recovery state,
not a second hidden obligation.
```

Before each `await`, the state transition and attempt ID are committed. After return, code reloads the record and validates attempt epoch/hash. A callback from an old attempt cannot complete a newer attempt. Traps/timeouts never release or recreate value silently.

## Replay and duplicate prevention

### Unified treasury layer

- `operationId = SHA-256(domain || obligationId || userId || scopeId || assetId || cycleId || destinationVersion || policyVersion)` over canonical length-delimited bytes, not JSON or current time.
- Payment intent creation is unique by obligation and asset. Attempt IDs are monotonic children of one operation.
- The unified treasury stores `operationId -> operationHash/state/result` forever in its receipt collection and reconciliation journal. It signs only after its native intent and remote logical-key/content-hash receipt are acknowledged; collection RBAC and post-upgrade grant audits ensure no other principal can create or alter that receipt.
- The canonical hash preserves address case/bytes according to the chain. It never lowercases a Base58/case-sensitive address.
- Manual recovery can only advance the existing operation with evidence; it cannot mint a replacement obligation.

### ICP/ICRC and ck-token transfers

- Always set one stable `created_at_time` and an operation-derived `memo` for every retry. ICRC ledgers reject identical transfers inside their deduplication window and return the original block index. The current standard documents a 24-hour duplicate window; see [digital asset standards](https://docs.internetcomputer.org/references/digital-asset-standards/) and [ledger deduplication](https://docs.internetcomputer.org/guides/digital-assets/ledgers/).
- `#Duplicate { duplicate_of }` is success evidence, not a failure.
- `#TemporarilyUnavailable`/unknown results retry only with identical arguments while safe. `#TooOld` never causes a new timestamp/send until ICRC-3/index/archive scan proves absence.
- For high-value transfers, use an operation-specific treasury subaccount two-step pattern where supported: fund the unique subaccount, then drain it to the recipient. An ambiguous second step is reconciled by the operation subaccount balance and ledger blocks before retry. Fee/complexity tradeoff is finalized at G3.
- Store ledger ID, block index, memo, created time, from/to subaccounts, amount, fee, and a verified block hash/transaction record.

### EVM chains

- Derive a separate address per chain/network/scope. Reserve one nonce through a single acknowledged compare-and-set/lease method proven against the pinned treasury store before signing.
- Build one canonical EIP-1559/legacy transaction binding chain ID, nonce, destination, value/data, gas limit, max fees, and operation data/memo where possible.
- Store unsigned hash, signature, signed bytes, and expected tx hash before broadcast. Rebroadcast only identical signed bytes; it has the same nonce/hash.
- If the nonce is consumed, query multiple EVM RPC providers for tx/receipt/address nonce and reconcile. Never allocate a new nonce for the same obligation because the old result is unknown.
- Fee replacement may use the same nonce only under a preapproved bounded policy and must preserve destination/value/data. Every signed variant is retained.
- Finality uses configured confirmations/finalized tag per chain. A receipt disappearance/reorg returns to reconciliation; it does not automatically create a second payment.
- The NNS-controlled EVM RPC canister provides multi-provider consistent/inconsistent results and submission; see [Ethereum integration](https://docs.internetcomputer.org/guides/chain-fusion/ethereum/).

### Bitcoin and Bitcoin Cash

- Lease exact UTXO outpoints through a single acknowledged compare-and-set/lease method proven against the pinned treasury store before signing. No other operation may select leased/spent inputs.
- Deterministically select inputs, fee rate/size, recipient, change, locktime, and sighash under a bounded policy. Persist unsigned/signed bytes and txid before broadcast.
- Retry only the identical transaction. Query UTXOs and txid first; if inputs are spent by an unknown transaction, enter manual review.
- Confirm to the approved depth, then monitor through the reorg window. Reorg appends state and rechecks UTXOs/tx presence.
- BTC uses the native Bitcoin API for UTXOs/broadcast; see [Bitcoin integration](https://docs.internetcomputer.org/guides/chain-fusion/bitcoin/). BCH requires its own codec/RPC/provider consensus and test vectors.

### Solana

- Prefer a reviewed durable nonce account per scope so a retry does not depend only on an expiring recent blockhash. Reserve nonce state in treasury before signing.
- Store exact message/signature/transaction ID. Re-submit identical bytes while valid; after expiry, query transaction/finality and durable nonce state before constructing a replacement attempt under the same operation.
- Bind program IDs, accounts, amount, fee payer, memo/operation ID, cluster genesis/network, and compute budget. Finalize only at the approved commitment level.

### Cosmos

- Bind chain ID, account number, reserved sequence, messages, fee/gas, timeout height, and operation memo.
- Re-submit identical signed transaction. If sequence advanced or result is unknown, query tx hash/account sequence from multiple providers before any new sequence.

### Polkadot

- Bind genesis hash, runtime/spec/transaction versions, nonce, mortal era, call bytes, tip, and operation evidence.
- Query tx hash, account nonce, finalized head, and era expiry before rebuilding. Runtime upgrades require codec compatibility tests.

### Stellar

- Reserve account sequence, network passphrase, memo/operation ID, timebounds, fee, and operation envelope.
- Re-submit identical envelope. Query transaction hash and account sequence before consuming another sequence; finalize under network-defined ledger closure policy.

## Donations and deposits

- Browser wallets remain user controlled; the UI verifies the expected chain/cluster, asset contract/ledger, amount, destination, and helper/minter before requesting a transaction.
- ICP/ICRC donations go directly to the published unified-treasury account for the selected asset/scope; no per-donor deposit subaccount is required. The ledger-index scanner credits each observed block exactly once by ledger/block identity. The selected scope is determined by the published receiving account/subaccount, never by a memo. A donor may attach an optional bounded memo as untrusted display metadata, but a missing, duplicate, forged, or unknown memo never blocks acceptance, creates a second credit, assigns a donor identity, or grants an entitlement. Any donor-recognition claim requires a separate caller-bound ownership proof and remains separate from the ledger credit.
- ckBTC/ckETH/ckERC20 deposits follow official minter flows. Creating/sending to a deposit address is not complete until the minter update/mint step and ICRC credit are confirmed.
- Direct external deposits use published treasury-derived scope addresses and a durable scanner cursor/finality rule. Observed deposits credit the accounting journal exactly once by chain transaction/outpoint/log identity.
- Public treasury views show observed height/time/finality and certified application-journal roots; they never add a logical reserve to an already inclusive wallet balance.

## Payout destination authorization

- Login identities and payout destinations are separate.
- Add/change requires Internet Identity step-up and, where feasible, an address-specific proof of control bound to application origin, user, chain, action, candidate destination, and expiration.
- Unsupported proof types require a more conservative governance/manual review policy; syntax validation alone is not “verified.”
- Risky changes have a delay and cancellation/notification window. Old and new versions remain in immutable history.
- A payment intent snapshots a destination version. Later changes cannot redirect an already prepared operation.
- Canonical destination duplicates across users are surfaced under an explicit policy; non-unique legacy destinations are not silently merged.

## Controller and upgrade authority

### Pre-production

- One reviewed governance canister is the sole controller before SNS handoff. Human principals are signers of that governance, not independent controllers.
- Named roles, least privilege, out-of-band recovery, and a reviewed proposal log are required.
- Local SNS tooling or PocketIC SNS/NNS subnets must exercise proposal, delay, pause/recovery, upgrade, controller, and cycle-management behavior against the pinned production controller interface. This is evidence for G3, not evidence that a production SNS already exists.

### Production direction

- SNS is the sole controller of `frontend_assets`, `core`, `workflow`, `archive_router/shards`, and the unified `treasury`. No production canister is blackholed or has an empty controller list.
- Upgrade proposal contains source commit, reproducible Wasm/assets hashes, dependency lock, Candid/stable compatibility, state migration plan, tests, security diff, cycles/freezing impact, and rollback module hash.
- Proposal delay allows public/security review. Deployed module hashes and controller lists are verified after execution.
- G4 first authorizes an isolated mainnet SNS testflight, not a custodial deployment: its canister IDs, bounded approved cycle budget, test-only environment/derivation domain, controller recovery/abort procedure, and evidence retention are fixed in the signed runbook. It may use only valueless external test assets and must prove that no production data, production derivation path, payment authority, or custodial asset is present before it tests testflight-SNS-root-only control and recovery. Failure returns to the pre-production controller and blocks the separately reviewed production SNS handoff/deployment.

ICP's controller model gives controllers power to install/upgrade/delete canisters and redirect held assets. The official guidance recommends governance or immutability for valuable canisters; see [canister control](https://docs.internetcomputer.org/guides/security/canister-control/) and [canister settings](https://docs.internetcomputer.org/guides/canister-management/settings/).

## If a controller or frontend is compromised

### Mutable governance/controller compromise

Assumed effects:

- attacker can upgrade frontend/core/workflow/treasury/archive canisters, expose their data/API credentials, falsify non-certified application views, stop service, and request malicious-looking operations;
- attacker cannot extract a Chain Fusion private key because none exists, but upgraded treasury code can request signatures; the SNS proposal delay, safety pause, policy caps, monitoring, and recovery process are therefore release-blocking controls.

Response:

1. Independent safety principals call the treasury pause-only method; pause is immediate and idempotent.
2. Freeze frontend update permissions/custom domain if possible; publish verified safe canister IDs/module hashes out of band.
3. Rotate OAuth/OpenAI/Didit/email/RPC credentials and revoke allowances; they may have been exposed.
4. Reconcile every operation since last trusted module hash against ledgers/chains and journal roots.
5. Restore mutable canisters through governance recovery/replacement; do not resume payouts from unverified state.
6. Resume requires separate governance and safety approvals plus delay and published reconciliation.

### Frontend-only compromise

- A malicious frontend can phish user approvals/delegations and propose bad destination changes, but cannot call treasury payment methods directly.
- Strict CSP/certified assets, short II delegations, canister method authorization, human-readable transaction consent, destination delay/notifications, and module-hash monitoring reduce impact.
- Replace frontend through governance and revoke affected user delegations/allowances; inspect pending destination changes.

### Safety-role compromise

The role can pause only. It can cause denial of service but cannot resume, upgrade, change policy, or move assets.

### Protocol/subnet or SNS-governance capture

This exceeds application-only recovery. Threshold keys and canister execution share ICP trust assumptions. Treasury policy caps constrain ordinary application paths and SNS governance process, not a protocol failure capable of violating canister execution. Disclose this residual trust clearly.

## Legacy key disposition

For each `SystemSecret` and environment wallet credential:

1. Record name, source ID, supported networks/scopes, public address, one-way fingerprint, last known use, and observed balance. Never put plaintext in general export/report/canister.
2. Classify `retire-empty`, `rotate-api`, `transfer-asset`, `retain-offline-for-rollback`, or `unknown/manual-review`.
3. Reconcile address balance and transaction history before any transfer.
4. After G4, execute separately authorized transfers to published unified-treasury deposit addresses using a human-reviewed manifest, small canary first, finality wait, and exact balance/fee reconciliation.
5. Keep the old sender disabled after transfer; do not let Node and ICP spend the same pool.
6. At rollback-window closure, revoke/delete legacy secrets under dual control and retain only proof/fingerprint/disposition.

No missing secret is generated automatically. Missing authority is a hard stop.

## G3 acceptance requirements

- Exact supported asset/network/scope registry and custody choice.
- Unified treasury decision, caps, rolling windows, pause/resume, SNS controller state, upgrade/recovery policy, and residual governance-risk analysis.
- Named SNS governance/safety roles, quorum/delay, reproducible upgrade process, controller verification, and compromise drill.
- A recorded human decision identifies the application SNS launch/ownership model, applicable `sns_init`/tokenomics or existing-SNS configuration, voting/quorum/delay, cycle-management, root handoff, and recovery policy. Local SNS/PocketIC tests prove that exact controller interface; the G4 runbook separately defines the isolated non-custodial mainnet testflight with its bounded approved cycle budget and abort/recovery proof before the separately reviewed production handoff.
- State-machine/property tests prove conservation and one-operation/one-transfer under concurrency, duplicate calls, callback traps, timeouts, upgrades, cycle shortage, ambiguous sends, fee changes, finality, and reorgs.
- ICRC `Duplicate/TooOld`, EVM nonce/replacement, BTC/BCH UTXO, Solana nonce/blockhash, Cosmos/Stellar/Polkadot sequence/finality test evidence.
- Destination proof/change-delay and KYC/hold/compensation policy.
- Legacy key/balance/pending-payment reconciliation report with no unresolved automated send.
- Independent custody/authorization security review.
- Test-network deployment with valueless assets; no real funds. Verify direct-to-treasury donation, no per-donor deposit-address requirement, and one-credit-per-ledger/chain-observation behavior, including duplicate delivery/reorg and duplicate or forged memos. A G4-authorized mainnet SNS testflight is a separate isolated, non-custodial procedure with only its approved cycle budget, not a testnet deployment.
