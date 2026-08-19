import { NextResponse } from "next/server"
import { can } from "@/lib/permissions"
import { getUserStoreScope } from "@/lib/auth"
import { requireSquareLabor, requireLaborStore } from "@/lib/labor-access"
import { getLaborActuals } from "@/lib/labor-actuals"
import { localDateStr } from "@/lib/reports"

// AL-1 — THE PHASE-1 VERIFICATION SURFACE, and the only human-reachable read the
// phase ships. GET /api/square/labor/actuals?storeId=…&startDate=…&endDate=…
//
// WHY A JSON ROUTE AND NO CARD. Phase 1 makes the labor number EXIST and be
// TRUSTWORTHY; Phase 2 puts it on cards. A phase that shipped a number and a
// surface in one commit could not tell a wrong number from a wrong render.
//
// RESPONSE SHAPE, documented because the staging pass reads it by hand:
//   laborPct          number | null  — NULL when sales are 0. Never a 0.
//   laborCost         number         — dollars; a FLOOR when costComplete=false
//   laborHours        number
//   sales             number         — dollars, NET sales (Gary, 2026-08-18)
//   health            "fresh" | "stale" | "error" | "never"
//   timecardCount     number
//   openTimecardCount number         — still on the clock; this cost is growing
//   wageMissingCount  number         — timecards Square carries no wage for
//   costComplete      boolean
//   otApplied         false          — straight time only, Phase 1
//   lastSyncOkAt      string | null  — ISO 8601, UTC
//
// AGGREGATES ONLY. There is NO per-person field in this response — no team
// member id, no name, no per-person hours, no per-person wage — because
// getLaborActuals never selects one. That is the strongest available answer to
// DEBT-10 (138 employees' emails exposed in production) and to the STORE-account
// rule: a shared in-store login cannot receive per-person data from a route that
// assembles none. The per-person surfaces are Phase 3's and they arrive with
// labor.costs.view, the MANAGE-tier capability PERM-4 (c) introduces.
export async function GET(req: Request) {
  const ctx = await requireSquareLabor()
  if ("error" in ctx) return ctx.error

  // ADMIN via square.manage — see the note in ../sync/route.ts. Even though this
  // response carries no per-person data, it carries DOLLARS, and dollars are
  // DEBT-10 territory: hours are not sensitive, wages are.
  const { actor } = await getUserStoreScope()
  if (!can(actor, "square.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const url = new URL(req.url)
  const storeId = url.searchParams.get("storeId")
  if (!storeId) return NextResponse.json({ error: "storeId is required" }, { status: 400 })

  const store = await requireLaborStore(ctx, storeId)
  if ("error" in store) return store.error

  const today = localDateStr(new Date(), store.timezone)
  const startDate = url.searchParams.get("startDate") ?? today
  const endDate = url.searchParams.get("endDate") ?? today
  const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)
  if (!isDate(startDate) || !isDate(endDate)) {
    return NextResponse.json({ error: "Dates must be yyyy-mm-dd" }, { status: 400 })
  }
  if (startDate > endDate) {
    return NextResponse.json({ error: "startDate is after endDate" }, { status: 400 })
  }

  // NO try/catch AROUND A SQUARE CALL, because there is no Square call here —
  // this route reads mirrored rows only. It therefore works, and reads as stale
  // rather than broken, while Square is disconnected or down. That is seam (c)'s
  // ON BUT UNHEALTHY state, and it is the reason health lives in its own table.
  const actuals = await getLaborActuals(ctx.org, store, startDate, endDate)
  return NextResponse.json({ storeId: store.id, startDate, endDate, timezone: store.timezone, ...actuals })
}
