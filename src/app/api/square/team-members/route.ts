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
  // ADMIN_ONLY — at staff.sync.square when DEBT-10 wrote this, at
  // staff.import.square since PERM-8 split the two halves apart (the tier is
  // identical either way; see the PERM-8 note at the gate itself). The sole
  // caller is the staff import dialog (staff/staff-buttons.tsx:167).
  // Deliberately NOT staff.manage (MANAGE) — no manager page requests this
  // payload, and narrowing later is the hard direction.
  //
  // The gap was API-SURFACE ONLY, not a live UI path: /api/square/team-members
  // is not in proxy.ts's isPublicRoute, so a Clerk session was always required,
  // and no non-admin button ever called it. A STORE or STAFF account could still
  // reach it by hand from any signed-in page.
  // PERM-8 (2026-08-29, deviation S5-D74): the capability changed from
  // staff.sync.square to staff.import.square. The TIER DID NOT CHANGE — both
  // are ADMIN_ONLY, so no role gains access here on the day this ships. What
  // changed is that staff.import.square is GRANTABLE to a MANAGER
  // (GRANTABLE_CAPABILITIES), so a specifically-granted manager now passes this
  // gate while the bulk re-sync route keeps staff.sync.square and keeps
  // refusing them. That separation is the whole point of the split: one
  // capability could not be granted here and withheld there.
  //
  // ACCEPTED AND RULED (Gary, 2026-08-29): this payload is ORG-WIDE, not
  // store-scoped, so a granted manager sees every Square team member's name and
  // email across the organisation. The WRITE they can perform is still scoped
  // to their own stores (api/staff/route.ts:81-83). This PII surface predates
  // PERM-8 — it is DEBT-10's — and store-scoping it would be separate work.
  const { actor } = await getUserStoreScope()
  if (!can(actor, "staff.import.square")) {
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
