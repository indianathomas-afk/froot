import { auth } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getUserStoreScope } from "@/lib/auth"

const patchSchema = z.object({
  displayName: z.string().trim().min(1).max(200).optional(),
  fullName: z.string().trim().max(200).nullish(),
  email: z.string().trim().email().max(320).nullish().or(z.literal("")),
  // When present, REPLACES the member's store assignments wholesale.
  storeIds: z.array(z.string().min(1)).optional(),
  primaryStoreId: z.string().min(1).nullish(),
})

// Edit a staff member: display/full name, email, store assignments, and
// primary (home) store. Works for both manual and Square-imported members —
// Square-linked fields can be corrected by hand here, and Resync from Square
// pulls Square's version back on demand. ADMIN org-wide; MANAGER only for
// staff already assigned to one of their stores. A body carrying just
// primaryStoreId is the light-touch path the location chips use.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { isAdmin, storeIds: scopeStoreIds, role } = await getUserStoreScope()
  if (!isAdmin && role !== "MANAGER") {
    return NextResponse.json({ error: "Manager or Admin access required" }, { status: 403 })
  }

  const { id } = await params
  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const member = await prisma.staffMember.findFirst({
    where: { id, organizationId: org.id },
    include: { storeAssignments: true },
  })
  // Cross-org or unknown IDs 404 — don't leak existence.
  if (!member) return NextResponse.json({ error: "Staff member not found" }, { status: 404 })
  if (!isAdmin && !member.storeAssignments.some((a) => scopeStoreIds.includes(a.storeId))) {
    return NextResponse.json({ error: "Staff member not found" }, { status: 404 })
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  const { displayName, fullName, email, storeIds, primaryStoreId } = parsed.data

  // Resolve the assignment set this edit will end with — the new storeIds when
  // provided, else the member's current assignments — and validate the primary
  // against it. All store ids must belong to the org.
  if (storeIds) {
    const orgStores = await prisma.store.findMany({
      where: { id: { in: storeIds }, organizationId: org.id },
      select: { id: true },
    })
    if (orgStores.length !== new Set(storeIds).size) {
      return NextResponse.json({ error: "One or more stores are invalid" }, { status: 400 })
    }
  }
  const finalStoreIds = storeIds ?? member.storeAssignments.map((a) => a.storeId)
  if (primaryStoreId && !finalStoreIds.includes(primaryStoreId)) {
    return NextResponse.json({ error: "Primary store must be one of the assigned stores" }, { status: 400 })
  }

  const fieldData: { displayName?: string; fullName?: string | null; email?: string | null } = {}
  if (displayName !== undefined) fieldData.displayName = displayName
  if (fullName !== undefined) fieldData.fullName = fullName || null
  if (email !== undefined) fieldData.email = email || null

  await prisma.$transaction([
    ...(Object.keys(fieldData).length > 0
      ? [prisma.staffMember.update({ where: { id }, data: fieldData })]
      : []),
    // Replace assignments only when storeIds was supplied; otherwise leave the
    // membership set alone and just move the primary flag.
    ...(storeIds
      ? [
          prisma.storeStaffAssignment.deleteMany({ where: { staffMemberId: id } }),
          prisma.storeStaffAssignment.createMany({
            data: finalStoreIds.map((storeId) => ({
              staffMemberId: id,
              storeId,
              isPrimary: storeId === primaryStoreId,
            })),
          }),
        ]
      : [
          prisma.storeStaffAssignment.updateMany({ where: { staffMemberId: id }, data: { isPrimary: false } }),
          ...(primaryStoreId
            ? [
                prisma.storeStaffAssignment.updateMany({
                  where: { staffMemberId: id, storeId: primaryStoreId },
                  data: { isPrimary: true },
                }),
              ]
            : []),
        ]),
  ])

  return NextResponse.json({ success: true })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  // HR-7 rule 2/4: a staff member with records is never deleted — offboarding
  // is terminate (status flip, records retained). Delete stays available only
  // for a mistaken import that never accumulated anything. Checked explicitly
  // (not left to FK restricts) so cascade-deletable records like manager
  // notes and acknowledgment rows also block.
  const member = await prisma.staffMember.findFirst({ where: { id, organizationId: org.id } })
  if (!member) return NextResponse.json({ success: true })

  const counts = await Promise.all([
    prisma.taskLog.count({ where: { completedByStaffId: id } }),
    prisma.teamMessage.count({ where: { authorStaffId: id } }),
    prisma.managerNote.count({ where: { staffMemberId: id } }),
    prisma.hrDocumentAcknowledgment.count({ where: { staffMemberId: id } }),
    prisma.hrSignedRecord.count({ where: { staffMemberId: id } }),
    prisma.formSubmission.count({ where: { staffMemberId: id } }),
    prisma.trainingAssignment.count({ where: { staffMemberId: id } }),
    prisma.trainingLessonProgress.count({ where: { completedByStaffId: id } }),
  ])
  if (counts.some((c) => c > 0)) {
    return NextResponse.json(
      { error: "This staff member has records and cannot be deleted — terminate them instead" },
      { status: 409 }
    )
  }

  await prisma.staffMember.deleteMany({ where: { id, organizationId: org.id } })
  return NextResponse.json({ success: true })
}
