# G2 restricted-data processing register and hold model

Status: implementation-design evidence as of 2026-09-26. The purpose and
proposed lawful-basis labels below require counsel/compliance review before any
collection, import, provider integration, or production processing. This is
not G2 approval and does not assert that a particular legal basis applies in
every jurisdiction.

The controller is Victor Porton's Foundation as recorded in
`G2_PRIVACY_AND_GOVERNANCE_DECISION.md`. All rows below are private/restricted:
there is no public projection, no public Candid query, and no public export.
Any backup/restore retains the same access boundary and must run the indicated
expiry/redaction process before the data can be used.

## Per-field register

| Record / field | Purpose and proposed lawful-basis label (counsel review required) | Access/audit role | Export and backup disposition | Retention, deletion, and narrow exception |
| --- | --- | --- | --- | --- |
| `migration_evidence_v1`: migration ID, source table/row ID, reason/conflict code, observation time | Reconciliation exception and migration integrity. Proposed: legal obligation / legitimate interest in security and accounting. | Restricted migration, reconciliation, legal, and data-subject-request functions; every access is auditable. | Restricted evidence-only export where approved; backups retain the same restriction. No raw source fragment. | Ten years after last financially or legally material event; redact/delete non-required evidence afterward. Concrete hold may retain only its named minimum fields. |
| `migration_evidence_v1`: canonical-row hash, related target logical ID/content hash | Deterministic equality/conflict proof without source-row retention. Proposed: legal obligation / legitimate interest in integrity. | Same restricted functions. | Same restricted evidence-only treatment; hash is not a public identifier. | Same ten-year evidence period and minimum-record exception. |
| `ai_artifact_v1`: ownership reference, creation time, size/type, model/provider label, result hash, retention deadline | Reproducibility, integrity, and controlled retention of an evaluation. Proposed: contract performance / legitimate interest in security and audit. | Restricted evaluation, audit, reconciliation, legal, and data-subject-request functions. | Restricted evidence-only export/backup; no raw prompt or provider credential. | Default evidence-only period. A sanitized historical payload is allowed only with a named reconciliation need, redaction profile, and its own deadline; delete/redact at that deadline. |
| `ai_artifact_v1`: bounded redacted canonical result | Explain/reproduce a result without retaining raw prompts/responses. Proposed: contract performance / legitimate interest in audit. | Same restricted functions. | Restricted evidence-only export/backup after the redaction profile is verified. | Default evidence-only period; concrete hold is limited to the named redacted fields. |
| `evidence_kyc_v1`: principal, status, policy/workflow version, issuing country, attested/expiry time, audit-event ID | Minimum KYC/AML decision, payout safety, and audit. Proposed: legal obligation and legitimate interest in fraud prevention/security; mandatory KYC is not consent-based. | Restricted compliance, security, reconciliation, legal, and data-subject-request functions. | No public/export route; backups are restricted. Never include provider report/session ID or raw proof. | Live fields through expiry, then redact/delete unless the minimum immutable audit record is required during the evidence period. Concrete hold may retain only named minimum attestation/audit fields. |
| `evidence_kyc_v1`: bounded closed rejection code | Explain/review an outcome without raw provider material. Proposed: legal obligation / legitimate interest in fraud prevention. | Same restricted functions. | Same restricted treatment; code set is closed and bounded. | Same attestation lifecycle; no hold converts it into raw KYC retention. |
| Private callback correlation: opaque digest, bound principal, creation/expiry time, active state | Match a callback to the initiating caller and prevent replay/misbinding. Proposed: legitimate interest in security and performance of the KYC flow. | Private application callback handler only; operational access is audited. | Never in canonical export or public projection. A backup may contain it only transiently and restore/upgrade sweeps expiry before use. | Delete immediately after attestation/audit commit, or no later than seven days. No legal hold applies and it may not be extended. |

Prohibited everywhere in these records: raw KYC documents/media, DOB, address,
ID/personal number, biometrics, provider report/session IDs, callback body,
token/credential, raw source row, raw AI prompt/request/response, and
unreviewed payloads.

## Concrete legal-hold model

A hold is a restricted, auditable record with: immutable hold ID; specific
dispute/investigation/statutory-requirement reference; approving legal or
compliance authority; start time; mandatory review date; named affected record
IDs and allowed field names; minimum necessary evidence rationale; and explicit
end condition/end time. It is not a collection-wide, user-wide, or indefinite
retention switch.

Only the named minimum fields are protected from their normal deletion/redaction
job. A hold cannot authorize collection of a prohibited field, cannot make a
record public, cannot expand ordinary access roles, and cannot be used to retain
raw KYC. It never applies to the callback correlation and never extends its
seven-day deadline. The authorized holder must review it by its review date and
close it when its recorded condition ends; normal deletion/redaction then
resumes. The hold decision and closure are themselves immutable restricted audit
events.

## Private callback-correlation lifecycle

`canisters/application/KycCallbackCorrelation.mo` implements the only approved
state shape: opaque digest, bound non-anonymous principal, created/expiry times,
and active state. The persistent application actor stores at most 1,024 active
records; each digest is ASCII-visible and at most 128 characters. There is at
most one active record per principal, and a digest cannot be rebound to a
different principal. There is no provider/session/report/token/payload field and
no Candid method.

The actor sweeps expired records during EOP initialization. Its future private
initiation path must bind the authenticated Candid caller before opening a
record. Its future callback path must commit the separately idempotent minimum
attestation/audit-event journal first, then remove the correlation immediately.
Provider-event duplicate handling belongs to that durable audit journal; the
correlation intentionally keeps no consumed receipt. Cleanup scans at most 64
records per invocation using a private cursor, and ordinary consume/lookup
rejects expiry even before a sweep. Thus a backup restore or upgrade cannot
reactivate expired correlation data.

Focused Motoko vectors cover anonymous and malformed inputs, one-active-record
conflicts, digest/principal mismatch, immediate consumption, duplicate absence,
expiry/recovery, and bounded cleanup. They do not implement a Didit integration,
signature verification, a public KYC API, an attestation store, or a legal hold
writer; those remain G2/M2 work.
