import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"

export async function GET(req: Request) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const url = new URL(req.url)
  const storeId = url.searchParams.get("storeId")
  const today = url.searchParams.get("today")

  const where: Record<string, unknown> = { organizationId: org.id }
  if (storeId) where.storeId = storeId
  if (today) {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const end = new Date(start)
    end.setDate(end.getDate() + 1)
    where.date = { gte: start, lt: end }
  }

  const checklists = await prisma.checklist.findMany({
    where,
    include: {
      template: { include: { tasks: true } },
      store: true,
      taskLogs: true,
    },
    orderBy: { date: "desc" },
  })

  const result = checklists.map((c) => ({
    id: c.id,
    templateName: c.template.name,
    templateType: c.template.type,
    status: c.status,
    date: c.date,
    storeName: c.store.name,
    taskCount: c.template.tasks.length,
    estimatedMinutes: c.template.tasks.reduce((sum, t) => sum + (t.estimatedTimeMinutes ?? 0), 0),
    completedTaskIds: c.taskLogs.map((l) => l.taskId),
  }))

  return NextResponse.json(result)
}

export async function POST(req: Request) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  let body: Record<string, string> = {}
  try { body = await req.json() } catch { /* no body */ }

  // Single-checklist creation: {templateId, storeId}
  if (body.templateId && body.storeId) {
    const existing = await prisma.checklist.findFirst({
      where: { organizationId: org.id, storeId: body.storeId, templateId: body.templateId, date: { gte: today, lt: tomorrow } },
    })
    if (existing) return NextResponse.json({ id: existing.id }, { status: 200 })

    const checklist = await prisma.checklist.create({
      data: {
        organizationId: org.id,
        storeId: body.storeId,
        templateId: body.templateId,
        date: today,
        status: "Pending",
      },
    })
    return NextResponse.json({ id: checklist.id }, { status: 201 })
  }

  // Bulk: generate for all stores × all applicable templates
  const [stores, templates] = await Promise.all([
    prisma.store.findMany({ where: { organizationId: org.id, isActive: true } }),
    prisma.template.findMany({ where: { organizationId: org.id, isActive: true }, include: { storeAssignments: true } }),
  ])

  const created: string[] = []
  for (const store of stores) {
    for (const template of templates) {
      const applicable =
        template.storeAssignments.length === 0 ||
        template.storeAssignments.some((a) => a.storeId === store.id)
      if (!applicable) continue

      const existing = await prisma.checklist.findFirst({
        where: { organizationId: org.id, storeId: store.id, templateId: template.id, date: { gte: today, lt: tomorrow } },
      })
      if (!existing) {
        const checklist = await prisma.checklist.create({
          data: { organizationId: org.id, storeId: store.id, templateId: template.id, date: today, status: "Pending" },
        })
        created.push(checklist.id)
      }
    }
  }

  return NextResponse.json({ created: created.length }, { status: 201 })
}
