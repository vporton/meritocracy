# G2 privacy, public-disclosure, consent, and governance decision record

Decision date: 2026-09-21
Amended: 2026-09-22
Status: owner-approved G2 input; **not G2 approval** and not authorization to collect,
import, publish, deploy, or otherwise process data.

## Scope and legal posture

This record fixes the owner decisions needed to finish the G2 design. It is a
conservative product and data-governance baseline for a service with users in
multiple jurisdictions; it is not a representation that one policy guarantees
compliance in every jurisdiction. The service has no country or regional
eligibility allowlist for onboarding, KYC, or payouts. A contractor's
citizenship, residence, nationality, or document-issuing country must not by
itself enable or deny access to those functions. A provider-returned issuing
country is private, minimal KYC/AML and audit context; it is not a product
eligibility classifier and does not settle every question of applicable law.

KYC and payout activation still require all ordinary identity-proof checks and
a current, versioned positive AML/sanctions decision. A negative, ambiguous,
missing, or stale AML/sanctions decision fails closed: the attestation cannot
activate a payout and any existing liability remains held and auditable until a
permitted resolution. This is not a static country list. Screening must use the
then-current applicable sanctions programs and lists for relevant jurisdictions,
persons, entities, ownership, and transactions; a North Korea-related
restriction is an example of an AML/sanctions result, not a permanent
hard-coded substitute for screening.

## Cross-border contractor terms

The Foundation will use one baseline independent-contractor agreement across
jurisdictions. The authoritative agreement must contain this saving clause (or
legal counsel's substantively equivalent wording):

> **Mandatory local law.** Nothing in this Agreement excludes or limits a
> non-waivable provision of law that applies to the Contractor in the country
> where the Contractor provides the Services, or in another jurisdiction whose
> law has mandatory application. To the extent of a conflict, that mandatory
> provision prevails, and the remainder of this Agreement remains effective to
> the maximum extent permitted by law.

The public Terms of Use source is the in-app `/terms-of-use` page. Publishing
that page does not itself record an individual contractor's assent or replace a
future contractor agreement: onboarding must present the applicable version and
retain the required acceptance evidence. As activity grows, the Foundation will
review the jurisdictions that become material and update the agreement or
compliance operations where needed; that review does not create a country
eligibility allowlist.

For a security incident, suspected compromise, or system, data, calculation, or
other operational error, the public terms reserve the Foundation's right to
suspend, decline, reduce, or cancel an affected payout in whole or in part,
including permanently. An already recorded payment obligation cannot be silently
erased: any cancellation or adjustment requires an explicit auditable
reconciliation record and remains subject to non-waivable law.

Before a Didit session is created, a caller-supplied country must not select an
eligibility policy. If a provider requires a country field, it may be retained
only in the one-use seven-day session correlation and used for KYC/AML integrity
handling, never as a geographic eligibility gate. An absent or inconsistent
identity proof, or a non-positive AML/sanctions result, creates no active KYC
attestation and never enables a payout.

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

- caller principal;
- payout addresses;
- payment history; and
- evaluation history.

The target stores no legal display name and creates no username. Leaderboards
display a shortened principal rather than a name. The certified ban-voting
projection additionally exposes only `provider`, public provider handle (or
ORCID ID), and `ownershipVerified` / `legacyUnverified` for GitHub, ORCID,
Bitbucket, and GitLab. It never exposes a legacy Ethereum identity separately
from a payout destination. A reverified handle needs its private immutable
provider subject; an imported handle remains `legacyUnverified` and is never
represented as verified.

This decision does not make every field on a user, payment, evaluation, or
audit record public. In particular, public projections must never contain email,
OAuth subject/profile, token, credential, payout account in ban-voting, KYC
status or country, raw KYC document, date of birth, residential address, photo,
document/ID number, biometric data, provider session ID, or provider response.

## Retention, erasure, and restricted evidence

The default evidence-only retention period is ten years after the last
financially or legally material event. A concrete legal hold may retain the
minimum necessary evidence until the identified dispute or legal requirement is
resolved. There is no blanket forever-retention rule: when the retention period
expires, or when applicable law requires it, the non-required record is
redacted or deleted while preserving the minimum immutable accounting,
authorization, and audit record required for reconciliation and legal evidence.

Raw KYC documents, date of birth, address, photo, document/ID number,
biometrics, and full Didit reports must never enter canister state, a canonical
export, CI artifact, or operator backup. The target retains only the approved
principal-bound KYC attestation: status (`approved`, `declined`, or `review`),
policy/workflow version, issuing country, time, expiry, and immutable audit
event. A one-use opaque principal-to-provider session correlation may exist for
at most seven days for callback/retry handling and is then deleted. A provider
report/session ID is not retained. Didit, rather than the canister, holds the
provider-side fraud/blocklist material.

The required G2 design must specify for each retained sensitive or
pseudonymous field its purpose and lawful basis, minimization, retention
deadline, backup/restore disposition, access-audit role, and any financial or
anti-evasion exception. There is no cryptographic-erasure requirement: it
cannot be claimed unless a separately proven key-management boundary keeps the
erasure key out of every relevant snapshot. No raw PII backup is permitted.

Terminating service use does not erase immutable financial, authorization, or
audit records. Those records are moved or retained in a restricted evidence-only
mode, with access limited to the approved legal, reconciliation, security, and
data-subject-request functions. This does not authorize a public projection of
those restricted records.

## Email, consent, and providers

There is no analytics, marketing email, or other optional processing in the
target. GA4 is prohibited. A private verified email is retained only while the
account is active to deliver necessary transactional notifications: ban-voting
opening/closing, KYC status changes, and security-sensitive principal/account
recovery. It is never login authority, public data, or a marketing contact, and
is deleted on account closure subject only to a concrete legal hold.

The selected notification provider is Resend's HTTPS Email API, not SMTP. A
future implementation must use a send-only, domain-scoped, rotatable API key;
send no sensitive content in a subject or log; disable open/link tracking and
contact-list/marketing features; and pin the reviewed Resend API, terms, DPA,
subprocessor list, retention/deletion behavior, and cross-border posture in the
global provider/compliance review record. Provisioning a Resend account or
credential is not authorized by this record.

Consent is not the basis for mandatory KYC, anti-fraud, payments, required
notifications, or audit processing. A later optional purpose requires a new
recorded decision, affirmative purpose-specific consent, and revocation that
stops the future processing without waiving data-subject rights.

## DAO and upgrade authority

The DAO is the intended active authority with full canister-upgrade power. The
controller/governance design must make that authority explicit and auditable; a
controller list is not a multisig. A principal that can upgrade a ZenDB
canister is intentionally unrestricted for that canister: it can replace code
and ZenDB may restore its out-of-box bootstrap/admin access on upgrade. That
restoration is accepted owner policy, not an RBAC failure to be worked around.
The required G2/M2 proof instead exercises a controller handoff: the successor
controller upgrades and has the intended administrative capability, while a
former controller that was removed from the controller list cannot read grants,
write, or self-regrant. This does not weaken the separate requirement that
ordinary callers have no authorization path.

The treasury is DAO-governed custody, not non-custodial merely because it is a
canister. Until DAO handoff, the owner's local `icp identity` is a bootstrap
controller only for local synthetic proof. It is never a production controller,
mainnet signer, or reason to bypass the revoke proof.

## Non-authorization and outstanding work

This record does not approve ZenDB v2.0.1 as target storage, a native-Motoko
exception, application behavior, Candid, storage types, import, backup
execution, deployment, or any production change. G2 remains blocked until its
complete evidence set in `PLANS.md` is satisfied, including the applicable
collection-specific storage decision and the required legal/technical proofs.
