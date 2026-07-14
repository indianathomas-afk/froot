import { auth } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getUserStoreScope } from "@/lib/auth"

// Sets the member's primary (home) store. Square doesn't expose a home
// location, so this is the admin's way to correct or set it after import.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { isAdmin } = await getUserStoreScope()
  if (!isAdmin) return NextResponse.json({ error: "Admin access required" }, { status: 403 })

  const { id } = await params
  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const { primaryStoreId } = await req.json()

  const member = await prisma.staffMember.findFirst({
    where: { id, organizationId: org.id },
    include: { storeAssignments: true },
  })
  if (!member) return NextResponse.json({ error: "Staff member not found" }, { status: 404 })
  if (primaryStoreId && !member.storeAssignments.some((a) => a.storeId === primaryStoreId)) {
    return NextResponse.json({ error: "Store is not assigned to this staff member" }, { status: 400 })
  }

  await prisma.$transaction([
    prisma.storeStaffAssignment.updateMany({ where: { staffMemberId: id }, data: { isPrimary: false } }),
    ...(primaryStoreId
      ? [prisma.storeStaffAssignment.updateMany({ where: { staffMemberId: id, storeId: primaryStoreId }, data: { isPrimary: true } })]
      : []),
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
