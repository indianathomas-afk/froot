import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
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
      select: RECIPIENT_SELECT,
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

  const assigned = await prisma.trainingAssignment.findMany({
    where: { trainingModuleId: trainingModule.id, staffMemberId: { in: staff.map((s) => s.id) } },
    select: { staffMemberId: true },
  })
  const alreadyHas = new Set(assigned.map((a) => a.staffMemberId))
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
      eligibility: alreadyHas.has(m.id)
        ? ("already-assigned" as const)
        : isApplicable(m)
          ? ("eligible" as const)
          : ("not-applicable" as const),
    })),
    trainers: trainers.map((t) => ({ id: t.id, name: t.name || t.email })),
  })
}
