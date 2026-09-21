# G2 privacy, public-disclosure, consent, and governance decision record

Decision date: 2026-09-21  
Status: owner-approved G2 input; **not G2 approval** and not authorization to collect,
import, publish, deploy, or otherwise process data.

## Scope and legal posture

This record fixes the owner decisions needed to finish the G2 design. It is a
conservative product and data-governance baseline for a service with users in
multiple jurisdictions; it is not a representation that one policy guarantees
compliance in every jurisdiction. Before collection, import, publication, or
activation, the applicable-law review must confirm the lawful basis, notices,
data-subject rights process, cross-border transfer posture, retention exception,
and any local restriction for the relevant processing.

Until a legally capable DAO is recorded as its successor, the data controller
is **Victor Porton's Foundation**, contact **porton@vporton.name**. If governance
is transferred to a DAO that is not legally capable of acting as controller, the
Foundation remains the designated representative/processor for data-subject
requests. It remains so after transfer until an equivalent, legally sufficient
representative is recorded. A future succession record must name the controller
or representative, contact, authority, effective time, and the request-handling
and retention obligations it accepts; an on-chain governance handoff alone is
not enough.

## Public disclosure boundary

The certified public projection may expose only the following identity- or
activity-linked classes, subject to its existing bounded pagination, certified
projection, and field-allowlist requirements:

- verified display legal name obtained through KYC;
- caller principal;
- payout addresses;
- payment history; and
- evaluation history.

There is no username in the target product and none may be created as a public
identifier merely to replace the display legal name. This decision does not make
every field on a user, payment, evaluation, or audit record public. In
particular, public projections must never contain raw KYC documents, date of
birth, residential address, photo, document/ID number, biometric data, or raw
KYC-provider responses. Email addresses, OAuth subjects/profiles, raw social
identifiers, verification tokens, credentials, and restricted audit payloads
remain non-public unless a later, narrowly recorded decision changes a specific
field and purpose after applicable-law review.

## Retention, erasure, and restricted evidence

The default evidence-only retention period is ten years after the last
financially or legally material event. A concrete legal hold may retain the
minimum necessary evidence until the identified dispute or legal requirement is
resolved. There is no blanket forever-retention rule: when the retention period
expires, or when applicable law requires it, non-required PII must be redacted
or cryptographically erased while preserving the minimum immutable accounting,
authorization, and audit record required for reconciliation and legal evidence.

The required G2 design must specify per sensitive field: purpose and lawful
basis, minimization, encryption/key-access boundary, retention deadline,
cryptographic-erasure process, backup/restore disposition, access-audit role,
and any financial or anti-evasion exception. Backups must be access-restricted
and participate in the approved expiry/redaction/erasure process; no backup is
an indefinite bypass of this policy.

Terminating service use does not erase immutable financial, authorization, or
audit records. Those records are moved or retained in a restricted evidence-only
mode, with access limited to the approved legal, reconciliation, security, and
data-subject-request functions. This does not authorize a public projection of
those restricted records.

## Consent

Consent is not the basis for mandatory KYC, anti-fraud, payments, or audit
processing. Optional processing requires affirmative, purpose-specific consent
and that consent is revocable. Revocation stops the optional future processing
for that purpose; it does not erase financial, authorization, or audit history
that must be retained under the preceding evidence-only rule. The G2 design
must identify each optional purpose and record consent, withdrawal, and
resulting processing state without treating consent as a waiver of applicable
data-subject rights.

## DAO and upgrade authority

The DAO is the intended active authority with full canister-upgrade power. The
controller/governance design must make that authority explicit and auditable; a
controller list is not a multisig. A bootstrap/deployer grant is a distinct
authority: once revoked, it must never reappear after an upgrade. No future DAO
authority, controller handoff, ZenDB migration, or upgrade may revive a revoked
bootstrap grant. The required G2/M2 proof must exercise revoke → upgrade →
post-upgrade authorization checks and show both that the DAO authority remains
present when intended and that the revoked bootstrap grant remains absent.

## Non-authorization and outstanding work

This record does not approve the unresolved ZenDB v2.0.1 RBAC upgrade failure,
a native-Motoko exception, application behavior, Candid, storage types, import,
backup execution, deployment, or any production change. G2 remains blocked
until its complete evidence set in `PLANS.md` is satisfied, including the
collection-specific storage decision and the required legal/technical proofs.
