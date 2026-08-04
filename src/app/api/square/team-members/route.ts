import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { getUserStoreScope } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { fetchSquareTeamMembers, mapAssignedStores } from "@/lib/square"

export async function GET() {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // DEBT-10, the same two-part shape PERM-6 Task 4 applied to square/locations.
  // This route had NO role gate — only auth() — so any authenticated org member
  // including STORE and STAFF could read the org's whole Square roster. Gated at
  // staff.sync.square (ADMIN_ONLY): the sole caller is the staff import dialog
  // (staff/staff-buttons.tsx:167), which renders only under isAdmin at
  // staff/page.tsx:96 and :111, so this matches today's surface exactly rather
  // than widening it. Deliberately NOT staff.manage (MANAGE) — no manager page
  // requests this payload, and narrowing later is the hard direction.
  //
  // Note this is the FIRST call site of staff.sync.square. Its obvious sibling,
  // POST /api/staff/sync-square, still gates with an inline isAdmin check
  // (staff/sync-square/route.ts:20-21) — same tier, so not a gap; recorded as a
  // consistency item rather than changed here.
  //
  // The gap was API-SURFACE ONLY, not a live UI path: /api/square/team-members
  // is not in proxy.ts's isPublicRoute, so a Clerk session was always required,
  // and no non-admin button ever called it. A STORE or STAFF account could still
  // reach it by hand from any signed-in page.
  const { actor } = await getUserStoreScope()
  if (!can(actor, "staff.sync.square")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org?.squareAccessToken) return NextResponse.json({ error: "Square not connected" }, { status: 400 })

  const [teamMembers, existing, stores] = await Promise.all([
    fetchSquareTeamMembers(org),
    prisma.staffMember.findMany({ where: { organizationId: org.id }, select: { squareTeamMemberId: true } }),
    prisma.store.findMany({ where: { organizationId: org.id }, select: { id: true, squareLocationId: true } }),
  ])

  if (!teamMembers) return NextResponse.json({ error: "Unable to fetch team members. TEAM_MEMBERS_READ permission may be required." }, { status: 403 })

  const existingIds = new Set(existing.map((s) => s.squareTeamMemberId).filter(Boolean))

  // The missing authorization above was the finding; this allow-list is the
  // second, separate improvement. The route used to spread the ENTIRE Square
  // team-member object (`...m`), so every field Square returns on an employee
  // reached the client. fetchSquareTeamMembers CASTS the response to a narrow
  // type (square.ts:151) rather than picking fields, so the spread carried the
  // untyped remainder too — is_owner, reference_id, timestamps, wage_setting,
  // phone_number. (`status` came through as well, but carried no information:
  // this route calls fetchSquareTeamMembers with no status argument, so the
  // Square query filters to ACTIVE upstream — square.ts:128 and :144 — and
  // every member in the response is ACTIVE by construction. The import dialog
  // therefore never listed departed employees. Contrast sync-square/route.ts:
  // 27-28, which passes the argument explicitly twice because the HR-7
  // termination reconcile needs both lists.) Each field below is here because
  // a consumer reads it; line numbers are staff/staff-buttons.tsx.
  const members = teamMembers.map((m) => ({
    id: m.id, // selection key (:172) + squareTeamMemberId on the import POST (:254)
    display_name: m.display_name, // memberName() row label and displayName (:233, :251)
    given_name: m.given_name, // name fallback + fullName (:233, :252)
    family_name: m.family_name, // name fallback + fullName (:233, :252)
    // PII, and kept deliberately: the dialog sends it as the new member's email
    // (:253), and the resync fills a blank email from the same Square field
    // (staff/sync-square/route.ts:66-70). A consumer genuinely needs it, so the
    // answer is the gate above, not dropping the field (Gary, 2026-07-28).
    email_address: m.email_address,
    // assignedStoreIds / primaryStoreId / allLocations (:177-178, :198, :214,
    // :331). Derived server-side from assigned_locations, which is therefore
    // never sent raw.
    ...mapAssignedStores(m, stores),
    alreadyImported: existingIds.has(m.id),
  }))

  return NextResponse.json({ members })
}
