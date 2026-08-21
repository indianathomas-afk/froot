import { NextResponse } from "next/server"
import { requireSquareLabor, requireLaborStore } from "@/lib/labor-access"
import { can } from "@/lib/permissions"
import { localDateStr } from "@/lib/reports"
import { addDaysStr, SCHEDULE_WINDOW_DAYS_FORWARD } from "@/lib/labor-schedule"
import { getDayInspector } from "@/lib/labor-inspector"

// GET /api/labor/day-inspector?storeId=&date= — ONE STORE, ONE DAY, EVERY
// TIMECARD ON A TIMELINE with the scheduled shifts ghosted behind and the
// variance flags computed.
//
// OVL-S5. The endpoint behind the troubleshooting page BUG-10 earned: diagnosing
// a Square-vs-Froot labor variance without database access.
//
// FIVE GATES, WHICH IS TWO MORE THAN /settings/labor CARRIES (S5-D1).
// requireSquareLabor() is the labor availability gate + the per-org labor toggle +
// squareLaborAvailable() + org.squareLaborEnabled, each failing as a 404 so an org
// without the overlay cannot probe whether it exists. Every row this route reads
// is Square-labor-sourced, so where the overlay is off the honest answer is that
// the surface does not exist — not a page rendering whatever rows predate the
// toggle being flipped.
//
// THEN labor.manage, checked with can() on ctx.actor so a PERM-5 per-user override
// is consulted. MANAGER/ADMIN ONLY AND NOT STORE-VISIBLE (Gary, 2026-08-21) — this
// is the inverse of the S3/S4 overlay's labor.schedule.view, and deliberately so:
// the overlay shows counts on a shared iPad login, this shows a named person's
// whole day. Denial is a 403 and never a partially-populated body.
//
// NEVER WAGES, RATES, TIPS OR NOTES, and never a Square team-member id. That is
// structural — see the select lists in getDayInspector — not a promise this route
// is holding up.
//
// READ-ONLY, AND NO SYNC IS TRIGGERED. Unlike the dashboard's labor cards this
// route does not call scheduleLaborRefresh: the page reports staleness rather than
// repairing it before the reader can see it (standing law, S5-D6).

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: Request) {
  const ctx = await requireSquareLabor()
  if ("error" in ctx) return ctx.error

  if (!can(ctx.actor, "labor.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const url = new URL(req.url)
  const storeId = url.searchParams.get("storeId") ?? ""
  // Org-scoped, and store-scoped for a non-admin — never trust a storeId from the
  // query string alone.
  const store = await requireLaborStore(ctx, storeId)
  if ("error" in store) return store.error

  const today = localDateStr(new Date(), store.timezone)
  const dateParam = url.searchParams.get("date")
  let date = dateParam && DATE_RE.test(dateParam) ? dateParam : today
  // FORWARD ONLY. Past days are the entire point and are never clamped; the future
  // is capped at the schedule sync's own horizon, because beyond it no scheduled
  // shift can exist and the page would render an empty day that looks like a
  // finding.
  const horizon = addDaysStr(today, SCHEDULE_WINDOW_DAYS_FORWARD)
  if (date > horizon) date = horizon

  const payload = await getDayInspector(ctx.org.id, store.id, date)
  if (payload === null) return NextResponse.json({ error: "Store not found" }, { status: 404 })

  return NextResponse.json({
    store: { id: store.id, name: store.name, timezone: store.timezone },
    today,
    ...payload,
  })
}
