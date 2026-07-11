# Authorization matrix (observed)

Roles are not persisted. “Administrator” is possession of `x-admin-password`; “service account” is possession of exact `CRON_JOB_AUTHORIZATION`; moderator is **UNKNOWN** (BanVotingService may impose voter eligibility, but no moderator role exists in schema).

|Operation / endpoint|Anonymous|Authenticated|Owner|Moderator|Administrator|Service account|Implementation / condition|Finding|
|---|---|---|---|---|---|---|---|---|
|Read users, leaderboard, salary stats, user by ID|allow|allow|allow|allow|allow|allow|`users.ts` GET handlers|User list exposes full Prisma records, including email/KYC data.|
|Create user / email registration|allow|attach email|same|same|same|same|`users.ts:POST /`; `auth.ts:register/email`|Unauthenticated registration allowed.|
|Update/delete user|deny|only matching ID|allow|deny unless owner|deny unless owner|deny|`users.ts` PUT/DELETE|Confirmed ownership check.|
|Read caller GDP share|deny|allow|allow|allow|allow|allow|`requireAuth`|—|
|Start evaluation|deny|eligible only|eligible only|same|same|same|`requireAuth`, `requireAdditionalConnections`|No KYC requirement despite `requireKYC` existing.|
|Submit ban/unban vote|deny|service decides|service decides|UNKNOWN|same|same|`banVoting.ts`, `BanVotingService.submitBanVote`|Route validates self/type; service authorization needs review.|
|Read ban data/assessments|allow|allow|allow|allow|allow|allow|no middleware|Assessment visibility is public.|
|Login social identities|allow|can attach|same|same|same|same|`auth.ts:login/*`|Four direct social login handlers appear to accept a handle without validating accessToken: critical.|
|KYC initiate/status/disconnect|initiate: inspect handler; status/disconnect deny|allow|allow|same|same|same|manual session checks|Callback signature authorization UNKNOWN.|
|Read all logs/stats|allow|allow|allow|allow|allow|allow|`logs.ts` no middleware|Potential raw AI request/response/session token exposure.|
|Read own logs|deny|allow|allow|same|same|same|`requireAuth`; path ID equality|`/logs/my` query validation inconsistent.|
|GDP refresh|allow|allow|allow|allow|allow|allow|`global.ts` no middleware|Public external fetch/write trigger.|
|Token/network/history status|allow|allow|allow|allow|allow|allow|`multi-network-gas.ts` no middleware|User history has no ownership condition.|
|Run gas distribution|allow|allow|allow|allow|allow|allow|no middleware|Critical financial-operation exposure.|
|Create country/region account secrets|allow|allow|allow|allow|allow|allow|no middleware|Critical secret-generation/storage operation exposure.|
|Cleanup stats/dry run/execute|deny|allow|allow|allow|allow|allow|`cleanup.ts:requireAuth` only|Any session can execute system-wide account deletion.|
|Admin distribution controls|deny|deny|deny|deny|header secret|deny|`admin.ts:authAdmin`|Not user-role based; timing-safe comparison absent.|
|Cron jobs|deny|deny|deny|deny|deny|exact header|`cron.ts:ensureCronAuth`|Background job starts asynchronously; cron status public.|

## Contradictions / gaps

- UI naming may imply administrative actions, but authorization is header secrets or merely any session; no `role` column exists (`schema.prisma`).
- `requireKYC` exists but is unused by route registration (`middleware/auth.ts`; `rg requireKYC`): **confirmed dead/unused route middleware**.
- Route comment says `run-distribution` “should be protected in production,” while it is exposed: **confirmed contradiction**.
