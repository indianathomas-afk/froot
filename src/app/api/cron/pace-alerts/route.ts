import { scheduledEmailsCron } from "@/lib/scheduled-emails"

// ── NOTIFY-SCHED, 2026-10-24: UNREGISTERED, AND NOW A DELEGATE ───────────────
// This path is no longer in vercel.json. The hourly /api/cron/scheduled-emails
// ("5 * * * *") replaced its "0 15 * * *" entry (F7), and the pace loop and the
// milestone leg that lived here moved to runScheduledEmails() in
// src/lib/scheduled-emails.ts — store query, threshold resolution and the
// per-store / per-leg try/catch unchanged. The route stays so a hand-fired curl
// of the old path still works, and it RESPECTS SCHEDULES: it runs the same
// evaluator, so it evaluates only slots that are due and not yet run.
// The response is the runner's; `stores` became `storesConsidered`.
// THE COMMENT BELOW IS KEPT AS WRITTEN AND DESCRIBES THE ROUTE BEFORE THIS
// CHANGE.
// GET /api/cron/pace-alerts — once daily, alert admins + assigned managers
// when a store falls below its org's alert threshold (NOTIFY-2a:
// Organization.paceAlertThresholdPct, else PACE_ALERT_THRESHOLD_PCT, else 90%)
// of its MTD goal, measured through yesterday. At most one alert per store per
// month — since NOTIFY-6 the lock is the store-month NotificationIntent's state
// (each store is evaluated, enqueued and dispatched inline by
// processPaceAlertForStore; failures are retried by /api/cron/notify-dispatch).
// Registered in vercel.json; Vercel
// calls it with "Authorization: Bearer ${CRON_SECRET}". Runs after the nightly
// sales-reconcile so yesterday's actuals are settled.

export const maxDuration = 300

export async function GET(req: Request) {
  return scheduledEmailsCron(req, "pace-alerts")
}
