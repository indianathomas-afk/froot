import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { getUserStoreScope } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { businessDayWindow } from "@/lib/reports"
import { freezeWindow, hoursByStore } from "./expectations"
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
      template: { include: { tasks: true, templateType: { select: { name: true } } } },
      store: true,
      taskLogs: true,
    },
    orderBy: { date: "desc" },
  })

  const result = checklists.map((c) => ({
    id: c.id,
    templateName: c.template.name,
    // TPL-1a, 2026-08-08: `templateType` is emitted here and consumed NOWHERE
    // — a repo-wide grep for the key returns this line only. Left in place
    // rather than removed, since a response field is cheap and something may
    // yet want it; recorded so the next reader does not spend the search
    // working that out.
    //
    // TPL-2 step (2), 2026-08-08 — THIS IS THE SITE BEING ANSWERED FOR. The
    // key name is unchanged; only its SOURCE moved, from the legacy string to
    // the joined row. MIGRATED RATHER THAN DELETED (Gary, Q3): deleting it is
    // a response-shape change no caller asked for, and this way the field is
    // correct instead of going stale the moment a type is renamed. Deleting it
    // is a fair question for TPL-2 step (3), which revisits this surface.
    templateType: c.template.templateType?.name ?? c.template.type,
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
  const { isAdmin, storeIds, actor } = await getUserStoreScope()

  let body: Record<string, string> = {}
  try { body = await req.json() } catch { /* no body */ }

  // Single-checklist creation: {templateId, storeId}. This INSTANTIATES today's
  // checklist for one store from a template — it never creates a definition.
  if (body.templateId && body.storeId) {
    if (!can(actor, "checklists.create")) {
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
    //
    // CHK-3: the four window fields are selected because the expected window is
    // FROZEN ONTO THE ROW at create — see api/checklists/expectations.ts for why
    // here and not at completion.
    //
    // DEBT-65, RULED BY GARY 2026-08-10: "archiving stops generation entirely;
    // archived templates generate nothing, materialize nothing, and appear in no
    // report going forward". Both flags are therefore part of the SCOPE of this
    // lookup, not a policy check bolted on after it — a retired template is Not
    // Found to every generation path, and the 404 below is the whole refusal.
    //
    // THIS SITE WAS WIDER THAN THE ONE THE ROW NAMED. DEBT-65 was filed against
    // the bulk-generate filter below (`isActive: true`, no isArchived). This one
    // filtered on ORG ALONE — neither flag — so it would instantiate an archived
    // template, and an inactive one, for anybody holding the id. It is not
    // reachable from the UI, which lists through
    // api/stores/[id]/templates/route.ts (`isActive: true, isArchived: false`),
    // but "the UI does not offer it" is not a gate.
    //
    // ── WHY isActive IS HERE, AND WHY IT IS THE HALF THAT ACTUALLY FIRES ──
    // SECOND RULING, GARY 2026-08-10, AFTER A STAGING CENSUS CONTRADICTED THE
    // FIRST FIX'S PREMISE. The two flags have SEPARATE controls: the Archive
    // button writes isArchived alone (templates-client.tsx:314) and Deactivate
    // writes isActive alone (:308). Measured on staging br-square-feather and
    // dev br-broad-wave-a6vpjdw0, 2026-08-10: FIVE templates are
    // isActive=false and ZERO are isArchived=true. So at Keva "archiving" is
    // performed with DEACTIVATE, and an isArchived-only gate here would have
    // been aimed at the one control nobody uses — correct, and inert.
    //
    // Bulk generate has honoured isActive all along, which is why the census
    // shows zero checklist rows under inactive templates. This path had no such
    // check, so it was the only place the operator's real archive action did
    // not stop generation. Both flags now, and the three applicability filters
    // — here, bulk generate below, and the crew list — read one identical rule.
    const template = await prisma.template.findFirst({
      where: { id: body.templateId, organizationId: org.id, isActive: true, isArchived: false },
      select: {
        id: true,
        availabilityType: true,
        operationalPhase: true,
        startOffsetHours: true,
        endOffsetHours: true,
      },
    })
    if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 })

    const w = businessDayWindow(now, store.timezone)
    const existing = await prisma.checklist.findFirst({
      where: { organizationId: org.id, storeId: body.storeId, templateId: body.templateId, date: { gte: w.gte, lt: w.lt } },
    })
    if (existing) return NextResponse.json({ id: existing.id }, { status: 200 })

    const hours = (await hoursByStore([body.storeId])).get(body.storeId) ?? []
    const checklist = await prisma.checklist.create({
      data: {
        organizationId: org.id,
        storeId: body.storeId,
        templateId: body.templateId,
        date: w.gte,
        status: "Pending",
        ...freezeWindow(template, hours, w.day, store.timezone),
      },
    })
    return NextResponse.json({ id: checklist.id }, { status: 201 })
  }

  // Bulk: generate for all stores × all applicable templates. Org-wide by
  // construction — there is no store to scope it to — so ADMIN only.
  if (!can(actor, "checklists.create.bulk")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // DEBT-65's NAMED SITE, closed per Gary's ruling 2026-08-10 (full text on the
  // row). THE THREE APPLICABILITY FILTERS NOW READ ONE RULE — this one, the crew
  // list at api/stores/[id]/templates/route.ts:24, and CHK-3's day-close job,
  // all `isActive: true, isArchived: false`. They had disagreed since forever:
  // archiving does NOT clear isActive (both writers set one flag only), so
  // `isArchived && isActive` is the NORMAL state of an archived template, and
  // this loop generated a checklist for one at every store while /store-view
  // showed it to nobody.
  //
  // LATENT UNTIL CHK-3, LOUD AFTERWARDS: those rows sat invisible as Pending
  // until the day-close job started closing every unfinished past-day row as
  // Missed. An operator who archived a template last month would have read it on
  // the operations report — the page shipped in this same session — as a store's
  // miss, for work nobody was ever shown. Stopping generation is what keeps that
  // off the report going forward; the rows ALREADY on disk are cleanup SQL,
  // presented to Gary in the CHK-5 report and never executed from here.
  const [stores, templates] = await Promise.all([
    prisma.store.findMany({ where: { organizationId: org.id, isActive: true } }),
    prisma.template.findMany({ where: { organizationId: org.id, isActive: true, isArchived: false }, include: { storeAssignments: true } }),
  ])

  // CHK-3: one query for every store's hours, so freezing the expected window
  // on each created row costs no extra round trip inside the loop.
  const hoursByStoreId = await hoursByStore(stores.map((s) => s.id))

  const created: string[] = []
  for (const store of stores) {
    const w = businessDayWindow(now, store.timezone)
    const hours = hoursByStoreId.get(store.id) ?? []
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
          data: {
            organizationId: org.id,
            storeId: store.id,
            templateId: template.id,
            date: w.gte,
            status: "Pending",
            ...freezeWindow(template, hours, w.day, store.timezone),
          },
        })
        created.push(checklist.id)
      }
    }
  }

  return NextResponse.json({ created: created.length }, { status: 201 })
}
