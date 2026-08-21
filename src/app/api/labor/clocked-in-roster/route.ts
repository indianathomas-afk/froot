import { NextResponse } from "next/server"
import { requireLaborView, requireLaborStore } from "@/lib/labor-access"
import { can } from "@/lib/permissions"
import { getClockedInRoster } from "@/lib/labor-schedule"

// GET /api/labor/clocked-in-roster?storeId= — WHO IS ON THE FLOOR RIGHT NOW.
// name · position title · clock-in time, and nothing else.
//
// OVL-S4. This is the endpoint Gary's 2026-08-20 ruling created when it narrowed
// the S1b person-data principle for one case: three structured person-level
// fields on a STORE-visible surface, because who is standing in the room is the
// same information as looking around the room.
//
// ON CLICK ONLY, AND THAT IS WHY IT IS A SEPARATE ROUTE. The card's default
// payload (/api/labor/coverage) carries counts and colours and no name under any
// code path. Names are fetched when the popup opens and at no other moment, so
// the person-level read is an ACTION a manager took rather than a side effect of
// a dashboard rendering itself.
//
// NOW ONLY — there is no date parameter, deliberately. Historical rosters are
// out of scope by ruling, and the absence of the parameter is what enforces it.
//
// THE SAME CAPABILITY AS THE OVERLAY. labor.schedule.view, checked with can() on
// ctx.actor so a PERM-5 per-user override is consulted — the /users override
// removes the curves and this popup together, which is the ruling. Denial is a
// 403 and never a partially-populated body, matching /api/square/labor/roster's
// posture for labor.costs.view.

export async function GET(req: Request) {
  const ctx = await requireLaborView()
  if ("error" in ctx) return ctx.error

  if (!can(ctx.actor, "labor.schedule.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const storeId = new URL(req.url).searchParams.get("storeId") ?? ""
  // Org-scoped, and store-scoped for a non-admin — never trust a storeId from
  // the query string alone.
  const store = await requireLaborStore(ctx, storeId)
  if ("error" in store) return store.error

  const roster = await getClockedInRoster(ctx.org.id, store.id)
  if (roster === null) return NextResponse.json({ error: "Store not found" }, { status: 404 })

  return NextResponse.json({ roster })
}
