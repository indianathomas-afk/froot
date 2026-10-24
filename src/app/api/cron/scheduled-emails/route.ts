import { scheduledEmailsCron } from "@/lib/scheduled-emails"

// GET /api/cron/scheduled-emails — NOTIFY-SCHED (F7). THE HOURLY RUNNER FOR
// SCHEDULED EMAIL KINDS: behind-pace alerts and milestone emails, each sent at
// the ORG'S chosen local hour, days and frequency from /settings/notifications,
// or — with no schedule row — at 15:00 UTC exactly as the daily pace-alerts
// cron did (F6). The logic is runScheduledEmails() in src/lib/scheduled-emails.ts.
//
// Registered in vercel.json at "5 * * * *", replacing pace-alerts' "0 15 * * *":
// :05 keeps it off the two :00 hourly crons (checklist-day-close,
// calendar-materialize) and ahead of the :15 sweep (notify-dispatch), and the
// first default slot at 15:05 UTC is still four hours after sales-reconcile.
// Vercel calls it with "Authorization: Bearer ${CRON_SECRET}". Crons fire on
// PRODUCTION deployments only; on staging, hand-fire it with the Preview
// secret (audit § 8).

export const maxDuration = 300

export async function GET(req: Request) {
  return scheduledEmailsCron(req, "scheduled-emails")
}
