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

  // Generate checklists for all stores based on active templates
  const [stores, templates] = await Promise.all([
    prisma.store.findMany({ where: { organizationId: org.id, isActive: true } }),
    prisma.template.findMany({ where: { organizationId: org.id, isActive: true } }),
  ])

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const created: string[] = []
  for (const store of stores) {
    for (const template of templates) {
      const existing = await prisma.checklist.findFirst({
        where: { organizationId: org.id, storeId: store.id, templateId: template.id, date: today },
      })
      if (!existing) {
        const checklist = await prisma.checklist.create({
          data: {
            organizationId: org.id,
            storeId: store.id,
            templateId: template.id,
            date: today,
            status: "Pending",
          },
        })
        created.push(checklist.id)
      }
    }
  }

  return NextResponse.json({ created: created.length }, { status: 201 })
}
