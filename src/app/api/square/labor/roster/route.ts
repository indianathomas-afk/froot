import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getUserStoreScope } from "@/lib/auth"
import { requireSquareLabor, requireLaborStore } from "@/lib/labor-access"
import { canSeeWages } from "@/lib/labor-dashboard"
import { getStoreRoster } from "@/lib/labor-roster"

// AL-3 — ONE STORE'S TEAM ROSTER WITH PAY. GET /api/square/labor/roster?storeId=…
//
// Feeds the "Team from Square" view of the Positions card. Behind
// requireSquareLabor (both labor gates, both Square gates, each failing to 404)
// AND canSeeWages, so a viewer without labor.costs.view gets a 403 and never a
// partially-populated body.
//
// NO AUTOMATIC SQUARE CALL HAPPENS HERE, and that is deliberate rather than
// unfinished. This route reads MIRRORED ROWS only. AL-2's dashboard schedules a
// debounced timecard refresh because a labor percentage is a today number that
// goes stale within the hour; a WAGE SETTING changes when somebody gets a raise.
// Spending a Square request on every settings-page load to re-read a number that
// moves monthly — and needing a claim row to keep two concurrent loads from
// racing for it — would cost more than it buys. Freshness is the explicit
// "Sync roster" action (POST /api/square/labor/roster/sync), which is the same
// posture AL-1 shipped for timecards: build the sync, do not schedule it.
//
// A DISCONNECTED SQUARE IS NOT CHECKED, on purpose. The mirrored rows still
// serve and read as stale with their last-synced stamp (Gary, 2026-08-05, and
// AL-2's R1). 404ing a roster Froot still holds because a token expired would be
// the opposite of that ruling.

export async function GET(req: Request) {
  const ctx = await requireSquareLabor()
  if ("error" in ctx) return ctx.error

  const { actor } = await getUserStoreScope()
  if (!canSeeWages(ctx.org, actor)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const storeId = new URL(req.url).searchParams.get("storeId")
  if (!storeId) return NextResponse.json({ error: "storeId is required" }, { status: 400 })

  // Org-scoped, and store-scoped for a non-admin — never trust a storeId from
  // the query string alone.
  const store = await requireLaborStore(ctx, storeId)
  if ("error" in store) return store.error

  // Every Square location this org has a Store for, so the roster read can tell
  // an unmapped location from a mapped one.
  const linked = await prisma.store.findMany({
    where: { organizationId: ctx.org.id, squareLocationId: { not: null } },
    select: { squareLocationId: true },
  })

  const roster = await getStoreRoster(
    ctx.org,
    store.squareLocationId,
    linked.map((s) => s.squareLocationId!).filter(Boolean)
  )

  return NextResponse.json({
    storeId: store.id,
    storeLinked: !!store.squareLocationId,
    ...roster,
    syncedAt: roster.syncedAt?.toISOString() ?? null,
  })
}
