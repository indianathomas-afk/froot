import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { getUserStoreScope } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { getSquareClient } from "@/lib/square"

// SQ-VER-1 verification probe — the first L-2 code, and deliberately the
// smallest possible piece of it. It proves THREE things in one request that
// nothing else can prove together:
//   1. the version — SQUARE_VERSION is past Square's 2025-05-21 Labor floor,
//   2. the scope — TIMECARDS_READ is in the authorize URL (SQ-SCOPE-1), and
//   3. the GRANT — the merchant's connected token actually carries it.
// (3) is the reason this route exists. Square's merchant dashboard does not
// show the permissions on a live grant, so the 2026-08-18 re-consent could
// not be verified by looking; it can only be verified by calling. A 403 here
// means the re-consent did not carry the new scopes — re-run the consent URL.
// That is the fix, not a code change.
//
// THIS ROUTE MUST NEVER GROW A BODY. Three scalars, forever. No timecard
// fields, no team-member names, no wages — that is DEBT-10 territory, and the
// wage half of L-2 serves through labor.costs.view when it is built. A future
// session that needs timecard data builds L-2's real ingest behind the seam
// (SquareTimecard, its own toggle, its own failure posture); it does not
// widen this probe.
export async function GET() {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // ADMIN-only, the gate pattern /api/square/locations uses. The CAPABILITY is
  // square.manage rather than that route's stores.manage, on purpose:
  // stores.manage sits in ENFORCED_CAPABILITIES and is therefore deniable
  // per-user from the /users grid, so a store-permission override could 403
  // this probe for a reason with nothing to do with Square — and a 403 here is
  // read as "the grant is missing the labor scopes". square.manage is
  // ADMIN_ONLY and not deniable (permissions.ts:199), so its 403 can only mean
  // "not an admin", which keeps this route's one ambiguous signal unambiguous.
  const { actor } = await getUserStoreScope()
  if (!can(actor, "square.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org?.squareAccessToken) return NextResponse.json({ error: "Square not connected" }, { status: 400 })

  // THE ORG OAUTH TOKEN ONLY. getSquareClient throws SQUARE_NOT_CONNECTED
  // instead of falling back to the SQUARE_ACCESS_TOKEN personal token the way
  // fetchSquareTeamMembers does — a probe that can fall back proves nothing
  // about the MERCHANT's grant, which is the entire point of (3) above.
  const client = await getSquareClient(org)

  // SearchTimecards, no filter, limit 1 — the smallest call that has to
  // authorize. AN EMPTY RESULT IS A FULL PASS: it means the call was
  // authorized and the account simply has no timecard in the default window.
  // `ok` is the only criterion (Gary, 2026-08-18); `hasData` is reported so
  // the staging pass can tell "authorized and empty" from "authorized with
  // data", and is never itself a pass/fail.
  let httpStatus = 0
  let hasData = false
  try {
    const res = await fetch(`${client.baseUrl}/v2/labor/timecards/search`, {
      method: "POST",
      headers: client.headers,
      body: JSON.stringify({ limit: 1 }),
    })
    httpStatus = res.status
    if (res.ok) {
      const data = await res.json().catch(() => null)
      hasData = Array.isArray(data?.timecards) && data.timecards.length > 0
    }
  } catch {
    // No HTTP response at all — transport or token-refresh failure, which is
    // NOT a verdict from Square. httpStatus 0 says exactly that and keeps the
    // response the same three fields in every outcome, so the staging pass
    // never has to parse a 500 page to find out what happened.
    httpStatus = 0
  }

  return NextResponse.json({ ok: httpStatus >= 200 && httpStatus < 300, httpStatus, hasData })
}
