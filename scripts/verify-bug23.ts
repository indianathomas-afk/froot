/**
 * BUG-23 acceptance fixture — deleting a template with history is a 409 with
 * the archive instruction, never a 500; a template without history still
 * hard-deletes; archiving is a real substitute.
 *
 *   npx tsx scripts/verify-bug23.ts
 *
 * DEV DATABASE ONLY. Every row is named for the phase (clerkOrgId
 * `fixture-bug23-*`, "BUG-23 …") and removed in `finally`; the leftover count
 * is asserted to be 0.
 *
 * Runs the SAME code the route runs: templateHasHistory() and
 * deleteTemplateUnlessHistory() from api/templates/history.ts. The route adds
 * only auth, the org lookup and the status mapping, which section F checks in
 * the source. Archive is the PATCH branch's own transaction (template update +
 * archiveCalendarEventsForTemplates), reproduced verbatim.
 */
import "dotenv/config"
import { readFileSync } from "node:fs"
import { Prisma } from "@prisma/client"
import { prisma } from "../src/lib/prisma"
import {
  TEMPLATE_HAS_HISTORY_MESSAGE,
  deleteTemplateUnlessHistory,
  isForeignKeyViolation,
  templateHasHistory,
} from "../src/app/api/templates/history"
import { archiveCalendarEventsForTemplates } from "../src/app/api/templates/archive-cascade"

let pass = 0
let fail = 0
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`}`)
}

const SECTION = "BUG-23 Opening"

async function main() {
  const [env] = await prisma.$queryRawUnsafe<{ neon_branch_id: string | null }[]>(
    "SELECT current_setting('neon.branch_id', true)::text AS neon_branch_id"
  )
  console.log(`BUG-23 fixture · Neon branch: ${env?.neon_branch_id ?? "UNKNOWN (null — not Neon?)"}`)

  const stamp = Date.now()
  const org = await prisma.organization.create({ data: { clerkOrgId: `fixture-bug23-${stamp}`, name: "BUG-23 Fixture Org" } })
  try {
    const store = await prisma.store.create({
      data: { organizationId: org.id, name: "BUG-23 Store", timezone: "America/Los_Angeles", squareLocationId: `bug23-loc-${stamp}` },
    })
    // A template with sections, tasks and a store assignment — every CASCADE
    // child, so a clean delete proves the cascades (and the intra-template
    // Task.sectionId RESTRICT) do not block.
    async function mkTemplate(name: string) {
      const t = await prisma.template.create({
        data: { organizationId: org.id, name, type: "Opening", storeAssignments: { create: [{ storeId: store.id }] } },
      })
      const section = await prisma.section.create({ data: { templateId: t.id, name: SECTION, sortOrder: 0 } })
      const task = await prisma.task.create({
        data: { templateId: t.id, sectionName: SECTION, sectionId: section.id, description: `${name} task`, orderIndex: 0 },
      })
      return { t, section, task }
    }

    // ── A. No history → hard delete (R3) ──────────────────────────────────────
    console.log("\nA. Template with no history")
    const clean = await mkTemplate("BUG-23 Clean")
    check("A1. helper says no history", await templateHasHistory(clean.t.id), false)
    check("A2. delete → ok (route: 200)", await deleteTemplateUnlessHistory(clean.t.id), { ok: true })
    check("A3. template row gone", await prisma.template.count({ where: { id: clean.t.id } }), 0)
    check("A4. tasks + sections cascaded", [
      await prisma.task.count({ where: { templateId: clean.t.id } }),
      await prisma.section.count({ where: { templateId: clean.t.id } }),
    ], [0, 0])

    // ── B. Checklist history → 409, row intact (R1, R4) ───────────────────────
    console.log("\nB. Template with a Checklist")
    const withCl = await mkTemplate("BUG-23 With Checklist")
    const cl = await prisma.checklist.create({
      data: { organizationId: org.id, templateId: withCl.t.id, storeId: store.id, date: new Date(), status: "Completed", completedAt: new Date() },
    })
    await prisma.taskLog.create({ data: { checklistId: cl.id, taskId: withCl.task.id, sectionId: withCl.section.id } })
    check("B1. helper says history", await templateHasHistory(withCl.t.id), true)
    check("B2. delete → refused for history (route: 409)", await deleteTemplateUnlessHistory(withCl.t.id), { ok: false, reason: "history" })
    check("B3. template row intact", await prisma.template.count({ where: { id: withCl.t.id } }), 1)
    check("B4. exact 409 message", TEMPLATE_HAS_HISTORY_MESSAGE, "This template has checklist history — archive it instead.")
    // The backstop. The unguarded delete is the BUG-23 500. Under the Neon
    // driver adapter a RESTRICT violation is NOT a P2003 — it is a
    // DriverAdapterError carrying SQLSTATE 23001 (this check was first written
    // expecting P2003 and failed; see history.ts). B5 pins the shape the catch
    // has to recognise; B5b runs the catch's own matcher on that same error.
    let rawShape: string | null = null
    let rawErr: unknown = null
    try {
      await prisma.template.delete({ where: { id: withCl.t.id } })
    } catch (e) {
      rawErr = e
      const cause = (e as { cause?: { kind?: string; code?: string } }).cause
      rawShape = e instanceof Prisma.PrismaClientKnownRequestError ? `prisma:${e.code}` : `${cause?.kind}:${cause?.code}`
    }
    check("B5. unguarded delete throws a RESTRICT violation (postgres 23001 or P2003)", ["postgres:23001", "prisma:P2003"].includes(rawShape ?? ""), true)
    check("B5b. the catch's matcher recognises that real error (→ 409, not 500)", isForeignKeyViolation(rawErr), true)
    check("B5c. …and does not swallow an unrelated error", isForeignKeyViolation(new Error("boom")), false)
    check("B6. still intact after the raw attempt", await prisma.template.count({ where: { id: withCl.t.id } }), 1)

    // ── C. Only history is a TaskLog on a RETIRED task → 409 ─────────────────
    // The log sits on a checklist belonging to ANOTHER template, so this
    // template has no Checklist row of its own: the TaskLog path alone decides.
    console.log("\nC. Template whose only history is a TaskLog on a retired task")
    const onlyLog = await mkTemplate("BUG-23 Only TaskLog")
    await prisma.task.update({ where: { id: onlyLog.task.id }, data: { retiredAt: new Date() } })
    await prisma.taskLog.create({ data: { checklistId: cl.id, taskId: onlyLog.task.id } })
    check("C1. no Checklist row of its own", await prisma.checklist.count({ where: { templateId: onlyLog.t.id } }), 0)
    check("C2. helper says history", await templateHasHistory(onlyLog.t.id), true)
    check("C3. delete → refused for history (route: 409)", await deleteTemplateUnlessHistory(onlyLog.t.id), { ok: false, reason: "history" })
    check("C4. template row intact", await prisma.template.count({ where: { id: onlyLog.t.id } }), 1)

    // ── D. Calendar event only → history (CAL-2 RESTRICT path) ───────────────
    console.log("\nD. Template whose only reference is a CalendarEvent")
    const onCal = await mkTemplate("BUG-23 On Calendar")
    await prisma.calendarEvent.create({
      data: {
        organizationId: org.id, title: "BUG-23 Event", category: "Operations", templateId: onCal.t.id,
        recurrence: "Weekly", startDate: new Date(),
      },
    })
    check("D1. helper says history", await templateHasHistory(onCal.t.id), true)
    check("D2. delete → refused for history", await deleteTemplateUnlessHistory(onCal.t.id), { ok: false, reason: "history" })

    // ── E. Archive is a real substitute (R2) ─────────────────────────────────
    console.log("\nE. Archiving a template with history")
    const matWhere = { organizationId: org.id, isActive: true, isArchived: false }
    const before = (await prisma.template.findMany({ where: matWhere, select: { id: true } })).map((t) => t.id)
    check("E1. before archive, it is in the materialise set", before.includes(withCl.t.id), true)
    // PATCH { isArchived: true } — the route's transaction, verbatim in shape.
    await prisma.$transaction(async (tx) => {
      await tx.template.update({ where: { id: withCl.t.id }, data: { isArchived: true } })
      await archiveCalendarEventsForTemplates(tx, org.id, [withCl.t.id])
    })
    const row = await prisma.template.findUnique({ where: { id: withCl.t.id }, select: { isArchived: true, isActive: true } })
    check("E2. archive succeeded (isArchived true; isActive untouched)", row, { isArchived: true, isActive: true })
    const after = (await prisma.template.findMany({ where: matWhere, select: { id: true } })).map((t) => t.id)
    check("E3. excluded from the next materialise query", after.includes(withCl.t.id), false)
    check("E4. its past checklist kept", await prisma.checklist.count({ where: { id: cl.id } }), 1)

    // ── F. Source: every generation path carries the same where; route wiring ─
    console.log("\nF. Source checks")
    const src = (p: string) => readFileSync(p, "utf8")
    const flag = "isActive: true, isArchived: false"
    check("F1. day-close materialise filters archived", src("src/app/api/cron/checklist-day-close/route.ts").includes(flag), true)
    check("F2. checklists route (single + bulk) filters archived", src("src/app/api/checklists/route.ts").split(flag).length - 1 >= 2, true)
    check("F3. store-view picker filters archived", src("src/app/api/stores/[id]/templates/route.ts").includes(flag), true)
    check("F4. schedulable-templates filters archived", src("src/app/api/calendar/schedulable-templates/route.ts").includes(flag), true)
    check("F5. calendar materialise skips archived templates", src("src/app/api/cron/calendar-materialize/route.ts").includes("event.template.isArchived"), true)
    const route = src("src/app/api/templates/[id]/route.ts")
    check("F6. DELETE route uses the guard and returns 409", route.includes("deleteTemplateUnlessHistory(id)") && route.includes("status: 409"), true)
    check("F7. no bare prisma.template.delete left in the route", route.includes("prisma.template.delete("), false)
  } finally {
    await prisma.calendarOccurrence.deleteMany({ where: { event: { organizationId: org.id } } })
    await prisma.calendarEvent.deleteMany({ where: { organizationId: org.id } })
    await prisma.taskLog.deleteMany({ where: { checklist: { organizationId: org.id } } })
    await prisma.checklist.deleteMany({ where: { organizationId: org.id } })
    await prisma.task.deleteMany({ where: { template: { organizationId: org.id } } })
    await prisma.section.deleteMany({ where: { template: { organizationId: org.id } } })
    await prisma.template.deleteMany({ where: { organizationId: org.id } })
    await prisma.store.deleteMany({ where: { organizationId: org.id } })
    await prisma.organization.deleteMany({ where: { id: org.id } })
    const left = await prisma.organization.count({ where: { clerkOrgId: { startsWith: "fixture-bug23-" } } })
    check("Cleanup: no fixture-bug23 orgs left", left, 0)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  await prisma.$disconnect()
  process.exit(fail ? 1 : 0)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
