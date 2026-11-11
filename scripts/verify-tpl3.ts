/**
 * TPL-3 acceptance fixture — deleted template tasks with history are RETIRED,
 * not silently kept; retired tasks leave live reads and stay on history.
 *
 *   npx tsx scripts/verify-tpl3.ts
 *
 * DEV DATABASE ONLY. Every row is named for the phase (clerkOrgId
 * `fixture-tpl3-*`, "TPL-3 …") and removed in `finally`; the leftover count is
 * asserted to be 0.
 *
 * Runs the SAME code the route runs: syncTemplateTasks (api/templates/
 * task-sync.ts) inside a transaction with syncTemplateSections and
 * pruneEmptySections, in the route's order; tasksForChecklist
 * (src/lib/checklist-tasks.ts) for every checklist view; savedTaskIdFor
 * ((app)/templates/attachment-match.ts) for the form's attachment mapping.
 * The template-read filter itself is a Prisma `where`, so section E checks
 * every reader's SOURCE carries it.
 *
 * Shape: tasks A (logged on a past COMPLETED checklist), B (never logged),
 * C (kept), D (logged on TODAY's OPEN checklist). The save keeps C, removes
 * A, B, D and adds NEW. Expected: A and D retired, B hard-deleted.
 */
import "dotenv/config"
import { readFileSync } from "node:fs"
import { prisma } from "../src/lib/prisma"
import { syncTemplateTasks } from "../src/app/api/templates/task-sync"
import { syncTemplateSections, pruneEmptySections } from "../src/app/api/templates/sections"
import { tasksForChecklist } from "../src/lib/checklist-tasks"
import { savedTaskIdFor } from "../src/app/(app)/templates/attachment-match"

let pass = 0
let fail = 0
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`}`)
}

const DAY = 24 * 60 * 60 * 1000
const SECTION = "TPL-3 Opening"

type Incoming = { id?: string; sectionName: string; description: string; orderIndex: number }

async function save(templateId: string, incoming: Incoming[]) {
  return prisma.$transaction(async (tx) => {
    const synced = await syncTemplateSections(tx, templateId, [{ id: null, name: SECTION, sortOrder: 0 }])
    if (!synced.ok) throw new Error(synced.error)
    const result = await syncTemplateTasks(tx, templateId, incoming, (t) => ({
      sectionName: t.sectionName,
      sectionId: synced.byName.get(t.sectionName) ?? null,
      description: t.description,
      orderIndex: t.orderIndex,
      excludedStoreIds: [],
    }))
    await pruneEmptySections(tx, templateId)
    // The PATCH response's task include, verbatim in shape.
    const response = await tx.task.findMany({ where: { templateId, retiredAt: null }, orderBy: { orderIndex: "asc" } })
    return { ...result, response }
  })
}

async function main() {
  const [env] = await prisma.$queryRawUnsafe<{ neon_branch_id: string | null }[]>(
    "SELECT current_setting('neon.branch_id', true)::text AS neon_branch_id"
  )
  console.log(`TPL-3 fixture · Neon branch: ${env?.neon_branch_id ?? "UNKNOWN (null — not Neon?)"}`)

  const stamp = Date.now()
  const org = await prisma.organization.create({ data: { clerkOrgId: `fixture-tpl3-${stamp}`, name: "TPL-3 Fixture Org" } })
  try {
    const store = await prisma.store.create({
      data: { organizationId: org.id, name: "TPL-3 Store", timezone: "America/Los_Angeles", squareLocationId: `tpl3-loc-${stamp}` },
    })
    const template = await prisma.template.create({ data: { organizationId: org.id, name: "TPL-3 Template", type: "Opening" } })
    const section = await prisma.section.create({ data: { templateId: template.id, name: SECTION, sortOrder: 0 } })
    const mk = (description: string, orderIndex: number) =>
      prisma.task.create({ data: { templateId: template.id, sectionName: SECTION, sectionId: section.id, description, orderIndex } })
    const A = await mk("TPL-3 A logged on past", 0)
    const B = await mk("TPL-3 B never logged", 1)
    const C = await mk("TPL-3 C kept", 2)
    const D = await mk("TPL-3 D logged today", 3)

    const now = Date.now()
    const past = await prisma.checklist.create({
      data: {
        organizationId: org.id, templateId: template.id, storeId: store.id, date: new Date(now - 3 * DAY),
        status: "Completed", completedAt: new Date(now - 3 * DAY + 3600_000),
      },
    })
    await prisma.taskLog.create({ data: { checklistId: past.id, taskId: A.id, sectionId: section.id, completedAt: new Date(now - 3 * DAY) } })
    const today = await prisma.checklist.create({
      data: { organizationId: org.id, templateId: template.id, storeId: store.id, date: new Date(now), status: "In Progress" },
    })
    await prisma.taskLog.create({ data: { checklistId: today.id, taskId: D.id, sectionId: section.id } })

    // ── A. The save ─────────────────────────────────────────────────────────
    console.log("\nA. Save: keep C, remove A B D, add NEW")
    const first = await save(template.id, [
      { id: C.id, sectionName: SECTION, description: C.description, orderIndex: 0 },
      { sectionName: SECTION, description: "TPL-3 NEW with attachment", orderIndex: 1 },
    ])
    check("A1. retiredCount = 2 (A, D — both have TaskLog history)", first.retired, 2)
    check("A2. deletedCount = 1 (B — no history)", first.deleted, 1)
    check("A3. one task created", first.created, 1)

    const rows = await prisma.task.findMany({ where: { templateId: template.id }, select: { id: true, retiredAt: true } })
    const byId = new Map(rows.map((r) => [r.id, r]))
    check("A4. A still exists", byId.has(A.id), true)
    check("A5. A.retiredAt is set", byId.get(A.id)?.retiredAt != null, true)
    check("A6. D.retiredAt is set", byId.get(D.id)?.retiredAt != null, true)
    check("A7. B is hard-deleted", byId.has(B.id), false)
    check("A8. C is live", byId.get(C.id)?.retiredAt ?? null, null)
    check("A9. A's TaskLog is intact", await prisma.taskLog.count({ where: { taskId: A.id } }), 1)
    check("A10. D's TaskLog is intact", await prisma.taskLog.count({ where: { taskId: D.id } }), 1)
    check("A11. the section survives (retired tasks still reference it)", await prisma.section.count({ where: { id: section.id } }), 1)

    const NEW = first.response.find((t) => t.description === "TPL-3 NEW with attachment")!

    // ── B. Template read and the PATCH response ─────────────────────────────
    console.log("\nB. Template read (retiredAt: null)")
    check("B1. response holds only live tasks, in orderIndex order", first.response.map((t) => t.id), [C.id, NEW.id])
    const read = await prisma.template.findUniqueOrThrow({
      where: { id: template.id },
      include: { tasks: { where: { retiredAt: null }, orderBy: { orderIndex: "asc" } } },
    })
    check("B2. template read excludes A and D", read.tasks.map((t) => t.id), [C.id, NEW.id])

    // ── C. Attachment lands on the right task ───────────────────────────────
    console.log("\nC. Pending attachment mapping")
    const localIds = [C.id, "local-new-1"]
    check("C1. savedTaskIdFor maps the new task's attachment to NEW", savedTaskIdFor(localIds, "local-new-1", first.response), NEW.id)
    // The pre-TPL-3 response carried the skipped tasks, ordered by orderIndex,
    // and the form read it by position. Rebuilt here to show it went wrong.
    const oldResponse = await prisma.task.findMany({ where: { templateId: template.id }, orderBy: [{ orderIndex: "asc" }, { id: "asc" }] })
    check("C2. (regression) by-position on the old response would NOT have found NEW", oldResponse[1]?.id === NEW.id, false)
    check("C3. savedTaskIdFor on the old response still finds NEW", savedTaskIdFor(localIds, "local-new-1", oldResponse), NEW.id)
    check("C4. an unknown local id maps to nothing", savedTaskIdFor(localIds, "nope", first.response), undefined)

    // ── D. Checklists (ruling R1) ───────────────────────────────────────────
    console.log("\nD. Checklist task sets (src/lib/checklist-tasks.ts)")
    const allRows = await prisma.task.findMany({ where: { templateId: template.id }, orderBy: { orderIndex: "asc" } })
    const view = async (checklistId: string) => {
      const c = await prisma.checklist.findUniqueOrThrow({ where: { id: checklistId }, include: { taskLogs: { select: { taskId: true } } } })
      return tasksForChecklist(allRows, { completedAt: c.completedAt, closedAt: c.closedAt, loggedTaskIds: c.taskLogs.map((l) => l.taskId) })
        .map((t) => t.description)
        .sort()
    }
    const fresh = await prisma.checklist.create({
      data: { organizationId: org.id, templateId: template.id, storeId: store.id, date: new Date(now + DAY) },
    })
    check("D1. a freshly generated checklist excludes A and D", await view(fresh.id), [C.description, NEW.description].sort())
    check("D2. today's open checklist keeps D (ticked today — rule 2), drops A", await view(today.id), [C.description, D.description, NEW.description].sort())
    check(
      "D3. the past completed checklist still shows A (logged) and D (retired after it finished — rule 3)",
      await view(past.id),
      [A.description, C.description, D.description, NEW.description].sort()
    )

    // ── E. Every reader carries the filter (source) ─────────────────────────
    console.log("\nE. Reader coverage (source)")
    const src = (p: string) => readFileSync(p, "utf8")
    const templateReaders = [
      "src/app/api/templates/route.ts",
      "src/app/(app)/templates/[id]/edit/page.tsx",
      "src/app/(app)/templates/[id]/page.tsx",
      "src/app/print/template/[id]/page.tsx",
      "src/app/api/templates/export/route.ts",
      "src/app/api/stores/[id]/templates/route.ts",
      "src/app/api/templates/[id]/route.ts",
    ]
    for (const p of templateReaders) check(`E. ${p} filters retiredAt: null`, src(p).includes("where: { retiredAt: null }"), true)
    const checklistReaders = [
      "src/app/(app)/store-view/checklist/[id]/page.tsx",
      "src/app/print/checklist/[id]/page.tsx",
      "src/app/api/checklists/route.ts",
      "src/app/api/dashboard/summary/route.ts",
      "src/app/api/checklists/[id]/submit/route.ts",
      "src/app/api/cron/checklist-day-close/route.ts",
      "src/app/api/checklists/[id]/task-log/route.ts",
      "src/app/api/upload/checklist-photo/route.ts",
      // TAB-8, 2026-11-10: the tablet Tasks panel's reader. It called
      // tasksForChecklist since TAB-1 but was never on this list.
      "src/app/(app)/dashboard/tablet-data.ts",
    ]
    for (const p of checklistReaders) check(`E. ${p} uses tasksForChecklist`, src(p).includes("tasksForChecklist("), true)
    // TAB-8, 2026-11-10: GET /api/stores/[id]/tablet-tasks (body in its
    // read.ts) reads checklists through loadTabletData (tablet-data.ts, above)
    // — the function /dashboard renders the tablet with — so it reaches
    // tasksForChecklist by delegation, never with its own task query.
    const tab8Route = src("src/app/api/stores/[id]/tablet-tasks/read.ts")
    check(
      "E. tablet-tasks route (read.ts) reads through loadTabletData and has no task query of its own",
      [tab8Route.includes("loadTabletData("), /tasks\s*:/.test(tab8Route), /\.task\./.test(tab8Route)],
      [true, false, false]
    )
    check("E. no reader uses a `not:` form on retiredAt", templateReaders.concat(checklistReaders).some((p) => /retiredAt:\s*\{\s*not/.test(src(p))), false)

    // ── F. Idempotency and ruling R2 ────────────────────────────────────────
    console.log("\nF. Re-save and stale tab")
    const again = await save(template.id, [
      { id: C.id, sectionName: SECTION, description: C.description, orderIndex: 0 },
      { id: NEW.id, sectionName: SECTION, description: NEW.description, orderIndex: 1 },
    ])
    check("F1. re-saving the same template retires and deletes nothing", [again.retired, again.deleted, again.created], [0, 0, 0])
    const countBefore = await prisma.task.count({ where: { templateId: template.id } })
    const stale = await save(template.id, [
      { id: A.id, sectionName: SECTION, description: A.description, orderIndex: 0 },
      { id: C.id, sectionName: SECTION, description: C.description, orderIndex: 1 },
      { id: NEW.id, sectionName: SECTION, description: NEW.description, orderIndex: 2 },
    ])
    check("F2. a stale tab naming retired A UN-RETIRES it (R2 a)", (await prisma.task.findUniqueOrThrow({ where: { id: A.id } })).retiredAt, null)
    check("F3. ...without creating a duplicate row", [stale.created, await prisma.task.count({ where: { templateId: template.id } })], [0, countBefore])
    check("F4. ...and A is back in the live response", stale.response.map((t) => t.id), [A.id, C.id, NEW.id])
    check("F5. D, absent from the stale payload, stays retired", (await prisma.task.findUniqueOrThrow({ where: { id: D.id } })).retiredAt != null, true)
  } finally {
    await prisma.taskLog.deleteMany({ where: { checklist: { organizationId: org.id } } })
    await prisma.checklist.deleteMany({ where: { organizationId: org.id } })
    await prisma.task.deleteMany({ where: { template: { organizationId: org.id } } })
    await prisma.section.deleteMany({ where: { template: { organizationId: org.id } } })
    await prisma.template.deleteMany({ where: { organizationId: org.id } })
    await prisma.store.deleteMany({ where: { organizationId: org.id } })
    await prisma.organization.deleteMany({ where: { id: org.id } })
    const left = await prisma.organization.count({ where: { clerkOrgId: { startsWith: "fixture-tpl3-" } } })
    check("Cleanup: no fixture-tpl3 orgs left", left, 0)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  await prisma.$disconnect()
  if (fail > 0) process.exit(1)
}

main().catch(async (err) => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})
