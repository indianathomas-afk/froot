import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { computeAudienceDelta } from "@/lib/hr-document-audience"
import { HR_DOCUMENT_KINDS } from "@/lib/hr-documents"
import {
  COMPANY_WIDE,
  GRANTEE_STAFF,
  GRANTEE_STORE,
  type GrantedStaff,
  grantedToStaff,
} from "@/lib/hr-documents-access"
import { requireHrDocumentAccess } from "../../access"

// DOC-1 Phase B — THE WRITER. Phase A built the audience machinery and left it
// with no way to write a grant from anywhere in the application; this route is
// that way, and it is the only one.
//
// ADMIN-only on the canManage seam, like every other document config write
// (HR-2). Widening to MANAGER later is a change to the `{ admin: true }`
// argument below and nothing else.
//
// SCOPED TO Reference | Acknowledgment BY THE SAME GUARD [id]/route.ts USES.
// A FillableForm id 404s here, deliberately: forms are built at /hr/forms, are
// never listed in the library this dialog opens from, and their read policy
// branch does not consult the audience at all. Letting an audience be written
// for one would record a rule that the FillableForm surfaces do not follow.

const putSchema = z.discriminatedUnion("appliesTo", [
  // NOTE THE SHAPE, IT IS THE RULING AND NOT A CONVENIENCE. "Everyone in my
  // company" carries NO selection arrays, so this route physically cannot
  // delete a grant row on that branch — the parser refuses the fields that
  // would let it. Grant rows go dormant under appliesTo "all" and become live
  // again if the admin later narrows, which is what makes narrow-then-restore
  // lossless (Gary, 2026-08-12). Enforcing that in the type rather than in a
  // conditional is the difference between a property and a promise.
  z.object({ appliesTo: z.literal(COMPANY_WIDE) }),
  z.object({
    appliesTo: z.literal("selected"),
    storeIds: z.array(z.string().min(1)),
    staffMemberIds: z.array(z.string().min(1)),
  }),
])

type AudienceStaff = GrantedStaff & { displayName: string; status: string }

// THE REACH COUNT IS THE POLICY FUNCTION ITSELF, ASKED A HYPOTHETICAL.
// The dialog must not carry its own reading of who a store grant reaches —
// reach-count drift between picker and policy is the bug class this codebase
// names — so rather than adding a reachOfStoreGrant() helper beside
// grantedToStaff (which would be a SECOND expression of one rule, exactly the
// thing lib/hr-documents-access.ts's header exists to prevent), this builds the
// document that WOULD exist and asks the real predicate about it. The corporate
// exclusion (R3) therefore cannot be forgotten here: it is not reimplemented.
function reachOf(
  orgDbId: string,
  kind: string,
  grants: { granteeType: string; storeId: string | null; staffMemberId: string | null }[],
  staff: AudienceStaff[]
): number {
  const doc = { organizationId: orgDbId, kind, appliesTo: "selected", grants }
  return staff.filter((m) => grantedToStaff(doc, m)).length
}

// Ruling (a), Gary 2026-08-12: reach counts are ACTIVE staff only, worded
// "reaches N" as HR-22 words its store expansion. The POLICY has no
// employment-status test of any kind — grantedToStaff reaches a TERMINATED
// staff member — so this is a deliberate, named divergence between what the
// picker COUNTS and what the policy ADMITS, not drift. It is the right count
// for an operator ("how many people does this reach"), and every /my/* read
// requires an ACTIVE profile server-side anyway. Phase C owns the other half:
// compliance denominators must count ACTIVE staff only.
const activeOnly = (staff: AudienceStaff[]) => staff.filter((m) => m.status === "ACTIVE")

async function loadDocument(id: string, orgDbId: string) {
  return prisma.hrDocument.findFirst({
    where: { id, organizationId: orgDbId, kind: { in: [...HR_DOCUMENT_KINDS] } },
    select: { id: true, title: true, kind: true, appliesTo: true, isActive: true },
  })
}

async function loadGrants(hrDocumentId: string) {
  return prisma.hrDocumentGrant.findMany({
    where: { hrDocumentId },
    select: { id: true, granteeType: true, storeId: true, staffMemberId: true },
  })
}

// The picker population. ACTIVE staff, PLUS anyone who currently holds a STAFF
// grant on this document whatever their status — and that union is load-bearing
// rather than tidy. The write below is a DELTA against what the dialog submits,
// so a grant-holder the picker never offered would be absent from the submitted
// set and would be silently revoked by the next save. Terminated grant-holders
// are therefore shown, marked, and pre-checked; un-checking one becomes a
// deliberate act instead of a side effect of someone else's termination.
async function loadStaff(orgDbId: string, grantedStaffIds: string[]): Promise<AudienceStaff[]> {
  return prisma.staffMember.findMany({
    where: {
      organizationId: orgDbId,
      OR: [{ status: "ACTIVE" }, { id: { in: grantedStaffIds } }],
    },
    select: {
      id: true,
      displayName: true,
      status: true,
      isCorporate: true,
      storeAssignments: { select: { storeId: true } },
    },
    orderBy: { displayName: "asc" },
  })
}

// GET /api/hr/documents/[id]/audience — the dialog's ONE read. Eligibility,
// reach and the current audience all arrive decided; the component renders what
// it is told and computes no rule of its own (HR-22's R-d).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const access = await requireHrDocumentAccess({ admin: true })
  if (!access.ok) return access.response
  const { org } = access

  const doc = await loadDocument(id, org.id)
  if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 })

  const grants = await loadGrants(doc.id)
  const grantedStaffIds = grants
    .filter((g) => g.granteeType === GRANTEE_STAFF && g.staffMemberId)
    .map((g) => g.staffMemberId!)

  // Stores are NOT filtered on isActive, matching the training recipients route
  // (ruled 2026-08-11): deactivating a store does not un-employ the people
  // rostered to it, and hiding it would strand them behind a picker that cannot
  // reach them.
  const [stores, staff] = await Promise.all([
    prisma.store.findMany({
      where: { organizationId: org.id },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    loadStaff(org.id, grantedStaffIds),
  ])

  const active = activeOnly(staff)

  return NextResponse.json({
    document: {
      id: doc.id,
      title: doc.title,
      appliesTo: doc.appliesTo,
      isActive: doc.isActive,
    },
    stores: stores.map((s) => ({
      id: s.id,
      name: s.name,
      // "reaches", not "staffCount" — CHK-3, a field's name is not evidence of
      // what it counts. This is what CHECKING THIS BOX would actually reach.
      reaches: reachOf(
        org.id,
        doc.kind,
        [{ granteeType: GRANTEE_STORE, storeId: s.id, staffMemberId: null }],
        active
      ),
    })),
    staff: staff.map((m) => ({
      id: m.id,
      displayName: m.displayName,
      isCorporate: m.isCorporate,
      status: m.status,
      storeIds: m.storeAssignments.map((a) => a.storeId),
    })),
    granted: {
      storeIds: grants
        .filter((g) => g.granteeType === GRANTEE_STORE && g.storeId)
        .map((g) => g.storeId!),
      staffMemberIds: grantedStaffIds,
    },
  })
}

// PUT /api/hr/documents/[id]/audience — the audience edit.
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const access = await requireHrDocumentAccess({ admin: true })
  if (!access.ok) return access.response
  const { org, dbUser } = access
  if (!dbUser) return NextResponse.json({ error: "Admin access required" }, { status: 403 })

  const parsed = putSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid audience" }, { status: 400 })
  }

  const doc = await loadDocument(id, org.id)
  if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 })

  // ── "Everyone in my company" ─────────────────────────────────────────────
  // The flag, and nothing else. Existing grant rows are left exactly where they
  // are, dormant, so narrowing later restores the previous audience intact.
  if (parsed.data.appliesTo === COMPANY_WIDE) {
    await prisma.hrDocument.update({
      where: { id: doc.id },
      data: { appliesTo: COMPANY_WIDE },
    })
    const grants = await loadGrants(doc.id)
    const staff = await loadStaff(
      org.id,
      grants.filter((g) => g.staffMemberId).map((g) => g.staffMemberId!)
    )
    return NextResponse.json({
      appliesTo: COMPANY_WIDE,
      added: 0,
      removed: 0,
      // Everyone means everyone; asked through the same predicate so the number
      // on screen and the number the policy would give cannot diverge.
      reaches: activeOnly(staff).filter((m) =>
        grantedToStaff({ organizationId: org.id, kind: doc.kind, appliesTo: COMPANY_WIDE, grants: [] }, m)
      ).length,
    })
  }

  // ── "Choose stores or people" ────────────────────────────────────────────
  const storeIds = [...new Set(parsed.data.storeIds)]
  const staffMemberIds = [...new Set(parsed.data.staffMemberIds)]

  // Every id must belong to THIS org. A foreign id that merely fails to match
  // later would leave a grant row pointing outside the tenant; refusing the
  // whole request is the only honest answer.
  const [validStores, validStaff] = await Promise.all([
    storeIds.length
      ? prisma.store.findMany({
          where: { organizationId: org.id, id: { in: storeIds } },
          select: { id: true },
        })
      : Promise.resolve([]),
    staffMemberIds.length
      ? prisma.staffMember.findMany({
          where: { organizationId: org.id, id: { in: staffMemberIds } },
          select: { id: true },
        })
      : Promise.resolve([]),
  ])
  if (validStores.length !== storeIds.length) {
    return NextResponse.json({ error: "Unknown store in the selection" }, { status: 400 })
  }
  // Staff are validated on ORG MEMBERSHIP ONLY, never on status: the picker
  // deliberately offers terminated grant-holders so a save does not revoke them
  // (see loadStaff), and re-submitting one must therefore be accepted.
  if (validStaff.length !== staffMemberIds.length) {
    return NextResponse.json({ error: "Unknown team member in the selection" }, { status: 400 })
  }

  // The delta itself lives in lib/hr-document-audience.ts — a route file can
  // export nothing but handlers, and this is the piece that most needs to be
  // callable by a verification script rather than re-typed into one.
  const existing = await loadGrants(doc.id)
  const delta = computeAudienceDelta(existing, storeIds, staffMemberIds)

  const createRows = [
    ...delta.createStoreIds.map((storeId) => ({
      hrDocumentId: doc.id,
      granteeType: GRANTEE_STORE,
      storeId,
      createdById: dbUser.id,
    })),
    ...delta.createStaffMemberIds.map((staffMemberId) => ({
      hrDocumentId: doc.id,
      granteeType: GRANTEE_STAFF,
      staffMemberId,
      createdById: dbUser.id,
    })),
  ]

  // One transaction: the flag and the rows move together or not at all, so no
  // reader ever sees "selected" against a half-written audience. skipDuplicates
  // plus the two unique objects (the STORE @@unique and the partial STAFF index,
  // docs/MIGRATIONS.md § Protected indexes) absorb the concurrent-admin race
  // instead of 500-ing on it.
  await prisma.$transaction([
    prisma.hrDocument.update({ where: { id: doc.id }, data: { appliesTo: "selected" } }),
    ...(delta.removeIds.length
      ? [prisma.hrDocumentGrant.deleteMany({ where: { id: { in: delta.removeIds } } })]
      : []),
    ...(createRows.length
      ? [prisma.hrDocumentGrant.createMany({ data: createRows, skipDuplicates: true })]
      : []),
  ])

  const grants = await loadGrants(doc.id)
  const staff = await loadStaff(
    org.id,
    grants.filter((g) => g.staffMemberId).map((g) => g.staffMemberId!)
  )

  return NextResponse.json({
    appliesTo: "selected",
    added: createRows.length,
    removed: delta.removeIds.length,
    // The authoritative post-save number, from the same predicate the policy
    // uses. The dialog shows no live client-side total precisely so that this
    // one has no rival.
    reaches: reachOf(org.id, doc.kind, grants, activeOnly(staff)),
  })
}
