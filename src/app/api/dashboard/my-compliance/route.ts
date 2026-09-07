import { NextResponse } from "next/server"
import { getActiveStaffSelf } from "@/lib/auth"
import { getStaffComplianceDetail, summarizeOwed } from "@/lib/hr-compliance"

// GET /api/dashboard/my-compliance — what the SIGNED-IN PERSON owes, for the
// SELF-1 banner on /dashboard.
//
// ── WHY THIS IS A ROUTE AND NOT A SERVER READ ON THE PAGE ───────────────────
//
// /dashboard's server component is deliberately thin — three queries, no
// caching, no streaming, and NO loading.tsx — because every heavy card on that
// page (sales performance, labor coverage, labor budget, monthly goal,
// forecasting, comms, Instagram) is client-fetched through fetchCard(). The
// compliance rollup costs SIX queries in four sequential round-trips, and one
// staff id barely reduces that: computeStaffComplianceDetails fetches the org's
// whole active document set with three nested relations regardless of who is
// asking (hr-compliance.ts:288) and filters per member in JS.
//
// Putting that on the blocking render would roughly triple the landing page's
// server work for every role on every navigation, with no skeleton behind it.
// So it goes where the rest of the page's weight already lives. The cost of
// this shape, stated rather than discovered: the banner arrives a beat after
// paint and pushes the page down once when it mounts. Reserving the slot would
// mean a permanent empty gap at the top of almost every dashboard in the org,
// since most people owe nothing — see compliance-banner.tsx.
//
// ── THE GATES ARE getActiveStaffSelf'S, NOT THIS ROUTE'S ────────────────────
//
// Deliberately routed through getActiveStaffSelf rather than resolveSelfStaff,
// even though SELF-1's other three surfaces use the latter. Three of its four
// refusals are load-bearing here and none of them is a role test:
//
//   HR MODULE — a banner about training and documents IS an HR surface, unlike
//   a person's own name in the sidebar, so the module gate belongs on it.
//   ACTIVE — acceptance criterion 6. getStaffComplianceDetail returns a
//   populated item list for a TERMINATED member ON PURPOSE (hr-compliance.ts:253,
//   "Do not fix this line"), so a terminated person's open obligations are
//   sitting right there for anything that forgets to check. This route does not
//   forget because it never sees them: the gate refuses first.
//   EXACTLY ONE — inherited from resolveSelfStaff underneath. Two matches is
//   not one match; nothing renders rather than guessing whose training to show.
//
// NO ROLE GATE, per R1 (Gary, 2026-09-07). There is no can() call in this file
// and there should never be one. The predicate is "does this login resolve to
// exactly one active staff member", which is a fact about the ROSTER, not about
// the login's role — which is also why no capability was added for it. A future
// reader adding one would be doing the idiomatic thing on this page and the
// wrong thing for this feature.
//
// SELF-SCOPED BY CONSTRUCTION. The staff id comes from the session and is never
// accepted from the client, so there is no id to tamper with and this route
// grants nobody sight of anyone else's compliance — the same discipline every
// /my/* route follows (auth.ts:158, "whatever this returns IS the scope").
export async function GET() {
  const self = await getActiveStaffSelf()
  // One shape for every refusal. The banner renders nothing for all of them,
  // and `reason` exists so a test — and a future R3 admin surface — can tell
  // "compliant" from "unresolved", which the rendered page never can.
  if (!self.ok) return NextResponse.json({ owed: null, reason: self.reason })

  const detail = await getStaffComplianceDetail(self.org.id, self.staffMember.id)
  if (!detail) return NextResponse.json({ owed: null, reason: "no-detail" })

  const owed = summarizeOwed(detail)
  if (owed.openCount === 0) return NextResponse.json({ owed: null, reason: "nothing-owed" })

  return NextResponse.json({ owed, staffId: self.staffMember.id, reason: null })
}
