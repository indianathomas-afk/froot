import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { CORPORATE_STORE_LABEL, primaryStoreName } from "@/lib/hr"
import { requireHrTrainingManageAccess } from "../../../access"
import { RECIPIENT_SELECT, applicabilityCheck, loadAssignableModule } from "../shared"

// GET /api/hr/training/assignments/bulk/recipients?moduleId=… — HR-22.
// The Bulk Assign dialog's ONE read: the caller-scoped candidate population
// with eligibility already decided SERVER-SIDE. The UI renders a rule, it never
// computes one — a picker that offers someone the write would refuse is exactly
// the UI-only enforcement R-d forbids.
//
// Same guard as the write (requireHrTrainingManageAccess), so what the picker
// shows and what POST accepts are scoped by one rule, not two.
export async function GET(req: Request) {
  const access = await requireHrTrainingManageAccess()
  if (!access.ok) return access.response

  const moduleId = new URL(req.url).searchParams.get("moduleId")
  if (!moduleId) {
    return NextResponse.json({ error: "moduleId is required" }, { status: 400 })
  }

  const loaded = await loadAssignableModule(moduleId, access.org.id)
  if (!loaded.ok) return loaded.response
  const { trainingModule } = loaded

  // Stores are NOT filtered on isActive, deliberately: deactivating a store
  // does not un-employ the people assigned to it, and hiding it would strand
  // them behind a picker that cannot reach them (ruled 2026-08-11).
  const [stores, staff, trainers] = await Promise.all([
    prisma.store.findMany({
      where: {
        organizationId: access.org.id,
        ...(access.isAdmin ? {} : { id: { in: access.storeIds } }),
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    // ACTIVE only — terminated staff are never offered. They can still reach
    // the write as a stale explicit pick, which is why POST reports them as a
    // named count rather than trusting this list.
    prisma.staffMember.findMany({
      where: {
        organizationId: access.org.id,
        status: "ACTIVE",
        ...(access.isAdmin
          ? {}
          : { storeAssignments: { some: { storeId: { in: access.storeIds } } } }),
      },
      // RECIPIENT_SELECT plus what the row LABEL needs, and nothing else. The
      // shared shape stays as-is so the write path is untouched: these two
      // additions are display facts the picker resolves, not facts the POST
      // classifier reads.
      //
      // storeAssignments is WIDENED, not replaced — storeId still feeds
      // `storeIds` and the per-store expandsTo counts. isPrimary and the store
      // name are what primaryStoreName() needs; today's payload carries a flat
      // storeIds with no primary flag, so a home store cannot be derived from it.
      select: {
        ...RECIPIENT_SELECT,
        squareTeamMemberId: true,
        storeAssignments: {
          select: { storeId: true, isPrimary: true, store: { select: { name: true } } },
        },
      },
      orderBy: { displayName: "asc" },
    }),
    // Same population the single path's Assign dialog offers (staff page.tsx
    // :405-409), fetched here so the bulk dialog has ONE read rather than
    // borrowing /api/users — which is Clerk-backed, heavier, and gated by a
    // different guard entirely.
    prisma.user.findMany({
      where: { organizationId: access.org.id, role: { in: ["ADMIN", "MANAGER"] } },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
  ])

  // Position, joined the only way it can be: SquareTeamMemberWage has no Prisma
  // relation to StaffMember, only the shared (organizationId, squareTeamMemberId)
  // key. A hand-added person has no squareTeamMemberId and therefore no position,
  // which is the normal case and not an error.
  //
  // THE SELECT IS EXACTLY THE JOIN KEY AND THE TITLE. Never a spread, never
  // `include`. This table is where pay lives — hourlyRate, annualRate, payType,
  // compConfidential — and it was split off StaffMember precisely so a wage
  // column could not ride along on a route that spreads its row. A job title is
  // not pay, so no labor.costs.view gate is added; keeping the select this
  // narrow is what makes that true rather than merely intended.
  const [assigned, wages] = await Promise.all([
    prisma.trainingAssignment.findMany({
      where: { trainingModuleId: trainingModule.id, staffMemberId: { in: staff.map((s) => s.id) } },
      select: { staffMemberId: true },
    }),
    prisma.squareTeamMemberWage.findMany({
      where: {
        organizationId: access.org.id,
        squareTeamMemberId: {
          in: staff
            .map((m) => m.squareTeamMemberId)
            .filter((id): id is string => id !== null),
        },
      },
      select: { squareTeamMemberId: true, jobTitle: true },
    }),
  ])
  const alreadyHas = new Set(assigned.map((a) => a.staffMemberId))
  const jobTitleFor = new Map(wages.map((w) => [w.squareTeamMemberId, w.jobTitle]))
  const isApplicable = applicabilityCheck(trainingModule)

  return NextResponse.json({
    // The dialog previews "N required items" before submitting, and ADMIN's
    // everything-in-scope is the one derived population that INCLUDES corporate
    // staff (R-d). Without this the preview would overstate for a MANAGER — so
    // the caller's tier is a fact the server states, not one the UI infers.
    caller: { isAdmin: access.isAdmin },
    module: {
      id: trainingModule.id,
      title: trainingModule.title,
      appliesTo: trainingModule.appliesTo,
      storeIds: trainingModule.storeAssignments.map((a) => a.storeId),
    },
    stores: stores.map((s) => ({
      id: s.id,
      name: s.name,
      // NOT "staffCount" — it counts who selecting this store actually reaches:
      // ACTIVE, non-corporate, assigned here. Corporate staff are excluded from
      // store expansion (R-d), so counting them would name one thing and mean
      // another (CHK-3: a field's name is not evidence of what it counts).
      expandsTo: staff.filter(
        (m) => !m.isCorporate && m.storeAssignments.some((a) => a.storeId === s.id)
      ).length,
    })),
    staff: staff.map((m) => ({
      id: m.id,
      displayName: m.displayName,
      storeIds: m.storeAssignments.map((a) => a.storeId),
      isCorporate: m.isCorporate,
      hasLogin: m.userId !== null,
      // Both resolved HERE, server-side, for the reason stated at the top of
      // this file: the dialog renders a rule, it never computes one. Null means
      // the segment is omitted from the row, not that anything failed.
      position: m.squareTeamMemberId ? jobTitleFor.get(m.squareTeamMemberId) ?? null : null,
      // DEBT-9: corporate staff do NOT go through the resolver. Square expands
      // them to every location (ALL_CURRENT_AND_FUTURE_LOCATIONS), so their
      // assignment rows are a sync artifact with no home base in them — the
      // literal label is the answer, and it is the same constant the signed
      // record uses. Everyone else goes through primaryStoreName() rather than a
      // sort written inline here: it is the function that freezes a store onto
      // signed documents, and a second resolver would let this dialog and the
      // legal record disagree about where someone works.
      store: m.isCorporate ? CORPORATE_STORE_LABEL : primaryStoreName(m),
      eligibility: alreadyHas.has(m.id)
        ? ("already-assigned" as const)
        : isApplicable(m)
          ? ("eligible" as const)
          : ("not-applicable" as const),
    })),
    trainers: trainers.map((t) => ({ id: t.id, name: t.name || t.email })),
  })
}
