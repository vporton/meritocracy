# Timing Plan: Worth Assessment, Ban/Unban Voting, and Payments

Status: Partially implemented

## Goals
- Give voters enough time to ban scammers before disputed funds leave the treasury.
- Give enough time to unban wrongly banned users.
- Keep gas/resource usage low.
- Ensure a wrongly banned user gets full compensation quickly after unban.

## Time Structure (UTC)

| Process | Cadence | Purpose |
|---|---|---|
| Full worth assessment | Every 2 months | High-quality baseline of `shareInGDP` |
| Light worth refresh | Weekly, Monday 01:00 | Catch significant changes between full runs |
| Vote week anchor | Monday 00:00 | Reset weekly quorum bucket (`weekStartDate`) |
| Regular payout preparation (Stage 1) | Weekly (Sunday 20:00) or biweekly | Low-gas recurring payouts for non-disputed users |
| Payout execution (Stage 2) | Immediately after Stage 1, single batch | Minimize transaction overhead |
| Compensation payout runner | Hourly | Release held money quickly after unban |
| Vote week close/reporting | Sunday 20:00 | Close weekly reporting, carry unresolved cases |

## Case Lifecycle for Ban/Unban

1. `ACTIVE`: user receives regular payouts.
2. First `BAN` vote opens a case and moves user to `UNDER_REVIEW`.
3. While `UNDER_REVIEW`, that user's payouts are not sent; they are moved into a per-user compensation escrow ledger.
4. If ban quorum is met, user becomes `BANNED` immediately (scammer protection).
5. `UNBAN` voting is allowed immediately after a ban and runs in the same week plus a fixed appeal window.
6. If unban quorum is met, user returns to `ACTIVE` and all escrow is released in the next hourly compensation run.

Recommended windows:
- Ban decision window: up to 72 hours from case opening.
- Fast unban/appeal window: up to 72 hours after ban.
- Hard finalization window: 14 days max before escrow is either released (if unbanned) or forfeited by policy (if ban confirmed).

## Payment Rules

- Never freeze payments globally because of one dispute.
- Only disputed users are temporarily held in escrow.
- Escrowed money must stay attributable by user and epoch.
- Default payout mode: weekly.
- Optional payout mode for lower gas budgets: biweekly.
- Use one batch execution per payout cycle (not many runs per day).
- Unban must trigger priority payout:
  - `compensation = all held slices + any missed slices during the ban period`
  - target SLA: submit pending tx within 15 minutes; execute within 1 hour.
- Compensation payouts should bypass minimum distribution threshold checks to avoid extra delay.

## Why This Balances Speed and Safety

- Scammers can be blocked quickly: first BAN vote starts hold, quorum creates immediate ban.
- Voters get time to correct mistakes: dedicated unban window plus appeal window.
- Wrongly banned users are made whole quickly: no waiting for next weekly payout.
- Regular users are paid on a gas-efficient weekly (or biweekly) cycle.

## Data/Implementation Notes

Use existing components with minimal structural changes:
- `BanVotingService`: keep weekly quorum grouping; add case state + timestamps.
- Voting pleas: when the first ban or unban vote starts, broadcast a plea to verified-email users unless they have set `votingPleaUnsubscribed`; the notice should warn that if people don't vote, scammers can take all their money.
- `CronService`: add high-frequency payout/compensation jobs.
- `PendingTransactionService`: use idempotent stage-1/stage-2 flow for both regular and compensation payouts.
- Add a ledger table for held slices (example statuses: `HELD_FOR_REVIEW`, `RELEASED_AFTER_UNBAN`, `FORFEITED_AFTER_CONFIRMED_BAN`).

### Fly.io Keepalive for Long Tasks

Long-running tasks now start a self-keepalive timer that calls `API_URL/api/cron/status` every 60 seconds and stops automatically when the task finishes.

Implemented in:
- `CronService.runBiMonthlyEvaluation()` (re-evaluation of all users)
- `CronService.runWeeklyGasDistribution()` (weekly/biweekly full payout flow)
- `CronService.runCompensationPayouts()` (batch release for unbanned users)
- `POST /api/evaluation/start` (single-user onboarding evaluation)

This keeps the machine network-active during long processing windows and reduces risk of Fly.io suspension while request-driven jobs are still running.

## Example: Ban Then Unban (No Week-Long Delay)

1. Tuesday 09:00: case opens -> user moves to `UNDER_REVIEW`, payouts held.
2. Tuesday 14:00: ban quorum reached -> user is `BANNED`.
3. Wednesday 10:00: unban quorum reached -> user returns to `ACTIVE`.
4. Wednesday <=11:00: compensation runner releases full held amount.

Result: user is fully compensated shortly after unban, while standard payouts stay weekly/biweekly to reduce gas costs.
