# Cron Job Setup

This document explains how the Meritocracy backend now runs its recurring maintenance flows via external HTTP schedulers rather than an in-process scheduler.

## Overview

Each cron job is exposed as a dedicated `POST /api/cron/*` endpoint. The jobs are triggered by https://cron-job.org per the expressions listed below, and each endpoint launches the work in the background so that the HTTP request returns immediately (the long-running flow continues on the server side).

## Cron endpoints

| Job | Endpoint | Cron expression (UTC) | Description |
| --- | --- | --- | --- |
| Bi-monthly user evaluation | `POST /api/cron/bi-monthly-evaluation` | `0 2 1 */2 *` | Runs on the 1st day of every other month at 02:00 UTC to re-run the evaluation flow for every onboarded user. |
| Weekly gas distribution | `POST /api/cron/weekly-gas-distribution` | `0 20 * * 0` | Runs every Sunday at 20:00 UTC (biweekly toggle respected) to process the multi-network gas token distribution. |
| Compensation payout | `POST /api/cron/compensation-payout` | `0 * * * *` | Runs hourly on the hour to release held balances once compensation becomes due. |
| Didit Liveliness renewal | `POST /api/cron/liveliness-check` | `0 9 * * *` | Sends renewal links to payout-eligible users whose Liveliness check is due or overdue. |
| Monthly connected account cleanup | `POST /api/cron/monthly-cleanup` | `0 4 1 * *` | Runs on the 1st day of every month at 04:00 UTC to remove disconnected accounts. |
| World GDP refresh | `POST /api/cron/world-gdp-refresh` | `0 6 1 * *` | Runs on the 1st day of every month at 06:00 UTC to refresh the stored world GDP value when the cached copy is older than a month. |

Each request must originate from cron-job.org and include the header `Authorization: Basic <token>`, where the `<token>` (including the `Basic ` prefix) is stored in the `CRON_JOB_AUTHORIZATION` environment variable. The server rejects requests that lack the header or whose token does not match exactly, ensuring only the authorized job service can trigger these flows.

## Background execution

The handlers do **not** wait for the job to finish before responding. They immediately return `202 Accepted` after the task is queued, and the real work continues asynchronously. This keeps cron-job.org from timing out (cron-job.org aborts requests after ~25 seconds). Detailed logs inside each job record progress, errors, and summaries.

## Monitoring

- **Status**: `GET /api/cron/status` returns whether a job is currently running and restates the cron expressions. This endpoint is safe to call without authentication.
- **Admin triggers**: There are still admin-only endpoints (`/api/admin/trigger-distribution`, `/api/admin/trigger-re-worth-assessment`) that can start the weekly distribution or quarterly evaluation manually; they share the same locking logic as the cron jobs.
- **Logs**: Each job prints start/end markers and, for the quarterly evaluation, it logs the per-user successes/failures plus salary statistics updates.

## Summary

The original `node-cron` dependency has been removed so the backend no longer runs its own scheduler. Instead, `https://cron-job.org` calls the protected endpoints above. That service retries failed jobs and stops a job after 25 failures, so it is critical to keep monitoring logs and the `/api/cron/status` endpoint to ensure the external scheduler is healthy.
