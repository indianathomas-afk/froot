import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { getUserStoreScope } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { businessDayWindow } from "@/lib/reports"
import { NextResponse } from "next/server"

export async function GET(req: Request) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const { isAdmin, storeIds } = await getUserStoreScope()

  const url = new URL(req.url)
  const storeId = url.searchParams.get("storeId")
  const today = url.searchParams.get("today")

  // Non-admins can never widen access via a storeId query param — only a store
  // they're actually assigned to is honored, otherwise we scope to all of theirs.
  const where: Record<string, unknown> = { organizationId: org.id }
  if (!isAdmin) {
    where.storeId = storeId && storeIds.includes(storeId) ? storeId : { in: storeIds }
  } else if (storeId) {
    where.storeId = storeId
  }
  if (today) {
    // "Today" is each store's local business day, not the server (UTC) day.
    const now = new Date()
    const scopedStores = await prisma.store.findMany({
      where: isAdmin
        ? { organizationId: org.id, ...(storeId ? { id: storeId } : {}) }
        : { organizationId: org.id, id: storeId && storeIds.includes(storeId) ? storeId : { in: storeIds } },
      select: { id: true, timezone: true },
    })
    const byTz = new Map<string, string[]>()
    for (const s of scopedStores) byTz.set(s.timezone, [...(byTz.get(s.timezone) ?? []), s.id])
    where.OR = [...byTz.entries()].map(([tz, ids]) => {
      const w = businessDayWindow(now, tz)
      return { storeId: { in: ids }, date: { gte: w.gte, lt: w.lt } }
    })
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
    estimatedMinutes: Math.round(c.template.tasks.reduce((sum, t) => sum + (t.estimatedTimeMinutes ?? 0), 0)),
    completedTaskIds: c.taskLogs.map((l) => l.taskId),
  }))

  return NextResponse.json(result)
}

export async function POST(req: Request) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const now = new Date()
  const { isAdmin, storeIds, role } = await getUserStoreScope()

  let body: Record<string, string> = {}
  try { body = await req.json() } catch { /* no body */ }

  // Single-checklist creation: {templateId, storeId}. This INSTANTIATES today's
  // checklist for one store from a template — it never creates a definition.
  if (body.templateId && body.storeId) {
    if (!can({ role }, "checklists.create")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    // Store scope comes from StoreUserAssignment, never from the request body:
    // a non-admin may only start a checklist at a store they're assigned to.
    if (!isAdmin && !storeIds.includes(body.storeId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const store = await prisma.store.findFirst({
      where: { id: body.storeId, organizationId: org.id },
      select: { timezone: true },
    })
    if (!store) return NextResponse.json({ error: "Store not found" }, { status: 404 })

    // Scope the template to the caller's org too — without this, a template id
    // belonging to ANOTHER tenant creates a checklist here whose template
    // relation points across the org boundary, and GET then renders that org's
    // name and task list. Tenant isolation, not a role check.
    const template = await prisma.template.findFirst({
      where: { id: body.templateId, organizationId: org.id },
      select: { id: true },
    })
    if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 })

    const w = businessDayWindow(now, store.timezone)
    const existing = await prisma.checklist.findFirst({
      where: { organizationId: org.id, storeId: body.storeId, templateId: body.templateId, date: { gte: w.gte, lt: w.lt } },
    })
    if (existing) return NextResponse.json({ id: existing.id }, { status: 200 })

    const checklist = await prisma.checklist.create({
      data: {
        organizationId: org.id,
        storeId: body.storeId,
        templateId: body.templateId,
        date: w.gte,
        status: "Pending",
      },
    })
    return NextResponse.json({ id: checklist.id }, { status: 201 })
  }

  // Bulk: generate for all stores × all applicable templates. Org-wide by
  // construction — there is no store to scope it to — so ADMIN only.
  if (!can({ role }, "checklists.create.bulk")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const [stores, templates] = await Promise.all([
    prisma.store.findMany({ where: { organizationId: org.id, isActive: true } }),
    prisma.template.findMany({ where: { organizationId: org.id, isActive: true }, include: { storeAssignments: true } }),
  ])

  const created: string[] = []
  for (const store of stores) {
    const w = businessDayWindow(now, store.timezone)
    for (const template of templates) {
      const applicable =
        template.appliesTo === "selected"
          ? template.storeAssignments.some((a) => a.storeId === store.id)
          : true
      if (!applicable) continue

      const existing = await prisma.checklist.findFirst({
        where: { organizationId: org.id, storeId: store.id, templateId: template.id, date: { gte: w.gte, lt: w.lt } },
      })
      if (!existing) {
        const checklist = await prisma.checklist.create({
          data: { organizationId: org.id, storeId: store.id, templateId: template.id, date: w.gte, status: "Pending" },
        })
        created.push(checklist.id)
      }
    }
  }

  return NextResponse.json({ created: created.length }, { status: 201 })
}
