import { NextResponse } from "next/server"
import { dispatchNotifications, resolveTransport } from "@/lib/notifications/dispatch"

// GET /api/cron/notify-dispatch — NOTIFY-6, the hourly sweep. Retries every
// `queued` and `partial` notification intent whose nextAttemptAt has passed,
// for every kind and every org, and expires the ones past their freshness
// window or whose org switch is off. Registered in vercel.json at
// "15 * * * *"; Vercel calls it with "Authorization: Bearer ${CRON_SECRET}".
// Shaped on api/cron/pace-alerts/route.ts.
//
// ITS OWN ROUTE, NOT A LEG IN checklist-day-close (audit C4): a provider
// timeout must not eat the day-close budget, and a day-close failure must not
// stop email retries. :15, so it runs after pace's own inline dispatch at
// 15:00 and off the two hourly crons at :00.
//
// THE SWEEP NEVER MAKES A SANDBOX SEND, first or repeat (R2, Gary's words: "the
// hourly retry never sends in sandbox") — the dispatcher enforces it via
// trigger "sweep". On staging this run therefore mails nobody. It still writes:
// expiries; a "Dry run — not sent" log line for a withheld or console-mode
// recipient not yet logged for that intent (at most once per intent and
// recipient); a failed message row when such a recipient's email will not
// render; and lastError on an intent whose dispatch threw. (Before NOTIFY-11
// this said "writes nothing else", which was never true of the first two.)
//
// NO ORG SCOPE, DELIBERATELY: a system job with no session. Every write is keyed
// to the intent's own organizationId.

export const maxDuration = 300

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 })
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Resolved once, before anything is read: an unknown provider fails the run
  // with zero rows written, as in the pace cron.
  const transport = resolveTransport()
  const results = await dispatchNotifications({ transport, trigger: "sweep" })

  const counts: Record<string, number> = {}
  for (const r of results) counts[r.outcome] = (counts[r.outcome] ?? 0) + 1
  const orgs = [...new Set(results.map((r) => r.organizationId))]
  // ORGS ARE NAMED BY ID, never by name (CLAUDE.md § Database Evidence).
  console.log(
    `[cron:notify-dispatch] mode=${transport.mode} ${results.length} intent(s) across ${orgs.length} org(s): ` +
      (Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ") || "nothing due") +
      (orgs.length ? ` (orgs ${orgs.join(" ")})` : "")
  )
  return NextResponse.json({
    ok: true,
    mode: transport.mode,
    intents: results.length,
    counts,
    results: results.map((r) => ({
      intentId: r.intentId,
      organizationId: r.organizationId,
      kind: r.kind,
      outcome: r.outcome,
      reason: r.reason,
      sent: r.recipients.filter((x) => x.status === "sent").length,
      failed: r.recipients.filter((x) => x.status === "failed").length,
    })),
  })
}
