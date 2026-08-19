import { NextResponse } from "next/server"
import { z } from "zod"
import { can } from "@/lib/permissions"
import { getUserStoreScope } from "@/lib/auth"
import { requireSquareLabor } from "@/lib/labor-access"
import { syncTeamMemberWages } from "@/lib/labor-roster"

// AL-3 — ON-DEMAND ROSTER SYNC. POST /api/square/labor/roster/sync
//
// Pulls the org's team members and their CURRENT wage settings from Square in
// one paginated call, and mirrors them into SquareTeamMemberWage. Org-wide, not
// per store: Square's roster is an account-level list and the per-store view is
// derived from each member's assigned_locations at read time.
//
// NO CRON IS REGISTERED BY THIS PHASE, matching AL-1's ruling for timecards.
// Freshness rests on this route plus the debounced refresh the Positions card
// schedules — and unlike timecards, a wage setting changes when somebody gets a
// raise, which is a monthly event, not an hourly one.
export const maxDuration = 60

const bodySchema = z.object({
  // Square offboards by flipping status to INACTIVE rather than deleting, so a
  // leaver is still in the account. ACTIVE is the default because that is who a
  // roster card is about; INACTIVE is available for a future reconcile.
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
})

export async function POST(req: Request) {
  const ctx = await requireSquareLabor()
  if ("error" in ctx) return ctx.error

  // ADMIN via square.manage — the capability and reasoning of
  // /api/square/labor/sync and /api/square/labor/verify. square.manage is
  // ADMIN_ONLY and NOT deniable, so a 403 from here can only ever mean "not an
  // admin" and never "somebody was denied an unrelated capability".
  const { actor } = await getUserStoreScope()
  if (!can(actor, "square.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 })

  // Checked HERE and not in requireSquareLabor: this route CALLS Square, so a
  // missing token is a real precondition. Routes that only read mirrored rows
  // must not check it — a disconnect leaves the feature on and the roster stale
  // (Gary, 2026-08-05).
  if (!ctx.org.squareAccessToken) {
    return NextResponse.json({ error: "Square not connected" }, { status: 400 })
  }

  try {
    const result = await syncTeamMemberWages(ctx.org, parsed.data.status ?? "ACTIVE")
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    // Typed distinctly from an auth outcome (seam (c), DON'T #5). A Square 403
    // here means the merchant's grant is missing EMPLOYEES_READ — which would be
    // surprising, since that scope predates every labor scope and has been
    // consented by every connected merchant. The real cause is already logged.
    const message = e instanceof Error ? e.message : "roster sync failed"
    return NextResponse.json(
      { ok: false, error: "Square roster sync failed", detail: message.slice(0, 300) },
      { status: 502 }
    )
  }
}
