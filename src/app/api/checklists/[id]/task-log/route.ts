import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId, userId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const checklist = await prisma.checklist.findFirst({ where: { id, organizationId: org.id } })
  if (!checklist) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const { taskId, photoUrl, temperatureValue, notes } = await req.json()

  // Update checklist to In Progress if Pending
  if (checklist.status === "Pending") {
    await prisma.checklist.update({
      where: { id },
      data: { status: "In Progress", startedAt: new Date() },
    })
  }

  // Find user record
  const user = userId
    ? await prisma.user.findFirst({ where: { clerkUserId: userId, organizationId: org.id } })
    : null

  // Upsert task log (toggle: delete if exists, create if not)
  const existing = await prisma.taskLog.findFirst({ where: { checklistId: id, taskId } })
  if (existing) {
    await prisma.taskLog.delete({ where: { id: existing.id } })
    return NextResponse.json({ action: "uncompleted" })
  }

  await prisma.taskLog.create({
    data: {
      checklistId: id,
      taskId,
      completedByUserId: user?.id ?? null,
      photoUrl: photoUrl ?? null,
      temperatureValue: temperatureValue ?? null,
      notes: notes ?? null,
    },
  })

  return NextResponse.json({ action: "completed" })
}
