import { NextResponse } from "next/server"
import { z } from "zod"
import { can } from "@/lib/permissions"
import { getUserStoreScope } from "@/lib/auth"
import { requireSquareLabor, requireLaborStore } from "@/lib/labor-access"
import { syncTimecardsForStore } from "@/lib/labor-actuals"
import { localDateStr } from "@/lib/reports"

// AL-1 — ON-DEMAND TIMECARD SYNC. POST /api/square/labor/sync
//
// POLL, NOT WEBHOOK, and the mandate has a measurement behind it: LABOR-0B
// found src/app/api/webhooks/square/route.ts:71-73 returns HTTP 200 with NO log
// line for any event type outside the four it handles, and Square does not retry
// a 200. A labor.timecard.* subscription added before the handler learns the type
// would be silently swallowed with no trace. DEBT-69 is the second argument —
// webhook-driven syncs multiply, and this one has no correctness need to.
//
// Body: { storeId, startDate?, endDate? } with yyyy-mm-dd dates, interpreted as
// STORE-LOCAL WORKDAYS (Square's `workday` filter). Both default to the store's
// local today, so the smallest useful call is just { storeId }.
export const maxDuration = 300

const bodySchema = z.object({
  storeId: z.string().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

export async function POST(req: Request) {
  const ctx = await requireSquareLabor()
  if ("error" in ctx) return ctx.error

  // ADMIN via square.manage — the capability and the reasoning of
  // /api/square/labor/verify, not the stores.manage /api/square/locations uses.
  // stores.manage sits in ENFORCED_CAPABILITIES and is deniable per-user, so an
  // unrelated store override could 403 this for a reason that has nothing to do
  // with Square. square.manage is ADMIN_ONLY and not deniable.
  const { actor } = await getUserStoreScope()
  if (!can(actor, "square.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 })

  const store = await requireLaborStore(ctx, parsed.data.storeId)
  if ("error" in store) return store.error
  if (!store.squareLocationId) {
    return NextResponse.json({ error: "Store is not linked to a Square location" }, { status: 400 })
  }

  // Checked HERE rather than in requireSquareLabor: this route CALLS Square, so
  // a missing token is a real precondition. Routes that only read mirrored rows
  // must not check it — a disconnect leaves the feature on and the data stale
  // (Gary, 2026-08-05), and 404ing data Froot still holds would be the opposite.
  if (!ctx.org.squareAccessToken) {
    return NextResponse.json({ error: "Square not connected" }, { status: 400 })
  }

  const today = localDateStr(new Date(), store.timezone)
  const startDate = parsed.data.startDate ?? today
  const endDate = parsed.data.endDate ?? today
  if (startDate > endDate) {
    return NextResponse.json({ error: "startDate is after endDate" }, { status: 400 })
  }

  try {
    const result = await syncTimecardsForStore(ctx.org, store, startDate, endDate)
    return NextResponse.json({ ok: true, storeId: store.id, startDate, endDate, ...result })
  } catch (e) {
    // TYPED DISTINCTLY FROM AN AUTH OUTCOME, which is the whole point of catching
    // at this boundary (seam (c), and DON'T #5 — never extend labor-access's
    // 401-masking catch to cover integration errors). A Square 403 here means the
    // merchant's grant is missing TIMECARDS_READ and the fix is re-running the
    // consent URL, not a code change. 502 says "the upstream refused", which is
    // what actually happened; the real cause is already in the server log and is
    // echoed here for the staging pass.
    const message = e instanceof Error ? e.message : "sync failed"
    return NextResponse.json({ ok: false, error: "Square sync failed", detail: message.slice(0, 300) }, { status: 502 })
  }
}
