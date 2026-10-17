/**
 * MS-4a acceptance fixture — checklist milestones, the F13 switch, the Copy
 * button, the pay warning.
 *
 *   npx tsx scripts/verify-ms4a.ts
 *
 * Rulings: docs/DECISIONS.md 2026-10-17 — MS-4 (Gary). F0: "Count TASKS where
 * the person is named (not whole checklists)." F1: a list of thresholds like
 * tenure. F13: a separate "Checklist milestones" switch, OFF by default,
 * independent of the Milestones toggle; off = nothing on the tab and only the
 * switch on the setup page. F8: Copy copies the message as written. F7
 * addition: the settings page warns admins not to type pay into the text.
 * CHK-16 (Gary, 2026-10-17): ship without covering-staff credit.
 *
 *   A. Structure — the gates and the wiring that a database run cannot reach:
 *      the tab and setup page read checklist data only with the switch on; the
 *      CRUD routes 404 with it off; Copy writes the message unchanged; the pay
 *      warning is on the page and in the dialog. Negative controls: each
 *      predicate rejects a broken copy of the source.
 *   B. Pure math — checklistProgress at N-1 / N, the date of the Nth task, the
 *      archived rule, terminated, a lowered count.
 *   C. Database (dev branch) — the switch's default and round trip; the
 *      duplicate-taskCount rule; namedTaskDates counts named tasks only, for
 *      this member only, in this org only, store-local; an un-tick lowers the
 *      count; the stored message reaches the tab unchanged. Every row is under
 *      "MS-4a Fixture Org", staff named "MS-4a Staff …" (CLAUDE.md § Name every
 *      test principal), deleted in `finally`.
 */
import "dotenv/config"
import { readFileSync } from "node:fs"
import { prisma } from "../src/lib/prisma"
import { checklistProgress, type ChecklistMilestoneInput } from "../src/lib/milestones"
import {
  checklistMilestonesEnabled,
  createChecklistMilestone,
  namedTaskDates,
  setChecklistMilestonesEnabled,
  updateChecklistMilestone,
} from "../src/lib/milestones-db"

let passes = 0
let failures = 0
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) passes++
  else failures++
  console.log(`${ok ? "  ok  " : "FAIL  "}${name}${ok ? "" : `\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`)
}

// ─── A. STRUCTURE ────────────────────────────────────────────────────────────
console.log("A. Structure")
const read = (p: string) => readFileSync(p, "utf8")
const PROFILE = read("src/app/(app)/staff/[id]/page.tsx")
const TAB = read("src/app/(app)/staff/[id]/staff-milestones.tsx")
const COPY = read("src/app/(app)/staff/[id]/copy-message-button.tsx")
const SETUP = read("src/app/(app)/staff/milestones/page.tsx")
const SETUP_CLIENT = read("src/app/(app)/staff/milestones/milestones-client.tsx")
const SECTION = read("src/app/(app)/staff/milestones/checklist-milestones.tsx")
const LIST = read("src/app/(app)/staff/milestones/milestone-list.tsx")
const ROUTE = read("src/app/api/milestones/checklist/route.ts")
const ROUTE_ID = read("src/app/api/milestones/checklist/[id]/route.ts")
const SWITCH = read("src/app/api/milestones/checklist/switch/route.ts")

/** Code only — comments stripped, so a comment that names a call cannot pass for one. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "")

/** The tab reads tasks only inside the switch check, which is inside the tab gate. */
function profileGateOk(src: string): boolean {
  const c = code(src)
  const tabGate = c.indexOf("if (showMilestonesTab) {", c.indexOf("const rows = await prisma.tenureMilestone.findMany") - 400)
  const sw = c.indexOf("if (await checklistMilestonesEnabled(member.organizationId)) {")
  const rows = c.indexOf("prisma.checklistMilestone.findMany(")
  const dates = c.indexOf("await namedTaskDates(")
  return tabGate > -1 && tabGate < sw && sw < rows && rows < dates && (c.match(/namedTaskDates\(/g) ?? []).length === 1 && c.includes("checklist={checklistMilestoneProgress}")
}
/** Setup page: rows read only when the switch is on. */
function setupGateOk(src: string): boolean {
  return /const checklistRows = checklistOn\s*\?\s*await prisma\.checklistMilestone\.findMany\(/.test(code(src))
}
/** CRUD routes: the switch is checked after requireMilestones and answers 404. */
function routeGateOk(src: string): boolean {
  const c = code(src)
  const req = c.indexOf('requireMilestones("milestones.manage")')
  const sw = c.indexOf("checklistMilestonesEnabled(access.org.id)")
  return req > -1 && sw > req && /checklistMilestonesEnabled\(access\.org\.id\)\)\)\s*(\{\s*return \{ res: )?(return )?NextResponse\.json\(\{ error: "Not found" \}, \{ status: 404 \}\)/.test(c)
}
function switchGateOk(src: string): boolean {
  return code(src).includes('requireMilestones("milestones.manage")')
}
/** F8: Copy writes the prop unchanged, and the tab passes the stored field. */
function copyAsWrittenOk(copy: string, tab: string): boolean {
  const c = code(copy)
  return (
    c.includes("navigator.clipboard.writeText(message)") &&
    !/message\.(replace|replaceAll|trim|split)|\{firstName\}/.test(c) &&
    code(tab).includes("<CopyMessageButton message={employeeMessage} />") &&
    (code(tab).match(/employeeMessage=\{m\.employeeMessage\}/g) ?? []).length === 2
  )
}
/** F13: the list card renders only with the switch on. */
function sectionSwitchOk(src: string): boolean {
  return code(src).includes("{on && enabled && <MilestoneListCard kind={KIND} rows={rows} />}")
}
/** F7 addition: the warning on the page and in the dialog. */
function payWarningOk(client: string, list: string): boolean {
  return code(client).includes('<PayWarning className="mt-3" />') && code(list).includes("<PayWarning />") && /no raise amounts, rates or dates/.test(list)
}

check("A1. /staff/[id]: tasks read only inside tab gate → F13 switch → active-row check", profileGateOk(PROFILE), true)
check("A2. /staff/milestones: checklist rows read only with the switch on", setupGateOk(SETUP), true)
check("A3. POST/GET /api/milestones/checklist: 404 with the switch off", routeGateOk(ROUTE), true)
check("A4. PATCH /api/milestones/checklist/[id]: 404 with the switch off", routeGateOk(ROUTE_ID), true)
check("A5. PUT .../switch: milestones.manage behind the module gate", switchGateOk(SWITCH), true)
check("A6. Copy copies the stored message as written (F8), both kinds", copyAsWrittenOk(COPY, TAB), true)
check("A7. setup section: list card only with the switch on (F13)", sectionSwitchOk(SECTION), true)
check("A8. pay warning on the page and in the dialog (F7 addition)", payWarningOk(SETUP_CLIENT, LIST), true)

/** Every exported handler opens with the milestones.manage gate — directly, or
 *  through the route's gate() helper, which itself opens with it. */
function handlersGated(src: string): boolean {
  const handlers = [...src.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)\([\s\S]*?\n}/g)]
  const opens = (h: string) =>
    /^export async function \w+\([^)]*\)[^{]*{\s*(const access = await requireMilestones\("milestones\.manage"\)\s*if \(!access\.ok\) return|const \{ access, res \} = await gate\(\)\s*if \(!access\) return res)/.test(h)
  const helperOk = !src.includes("async function gate()") || /async function gate\(\) \{\s*const access = await requireMilestones\("milestones\.manage"\)/.test(src)
  return handlers.length > 0 && handlers.every((h) => opens(h[0])) && helperOk
}
check("A15. every handler in the three checklist routes opens with the milestones.manage gate", [ROUTE, ROUTE_ID, SWITCH].every(handlersGated), true)
check("A16. NC: a handler that skips the gate → A15 rejects", handlersGated(ROUTE.replace("const { access, res } = await gate()\n  if (!access) return res\n\n  const rows", "const access = { org: { id: \"x\" } }\n  const res = null\n\n  const rows")), false)

check("A9. NC: switch check removed from the tab → A1 rejects", profileGateOk(PROFILE.replace("if (await checklistMilestonesEnabled(member.organizationId)) {", "if (true) {")), false)
check("A10. NC: setup reads rows unconditionally → A2 rejects", setupGateOk(SETUP.replace("const checklistRows = checklistOn\n    ? await", "const checklistRows = true\n    ? await")), false)
check("A11. NC: route switch check removed → A3 rejects", routeGateOk(ROUTE.replace("if (!(await checklistMilestonesEnabled(access.org.id))) {", "if (false) {")), false)
check("A12. NC: Copy trims the message → A6 rejects", copyAsWrittenOk(COPY.replace("writeText(message)", "writeText(message.trim())"), TAB), false)
check("A13. NC: list card shown with the switch off → A7 rejects", sectionSwitchOk(SECTION.replace("{on && enabled && <MilestoneListCard", "{<MilestoneListCard")), false)
check("A14. NC: dialog warning removed → A8 rejects", payWarningOk(SETUP_CLIENT, LIST.replace("            <PayWarning />\n", "")), false)

// ─── B. PURE MATH ────────────────────────────────────────────────────────────
console.log("\nB. checklistProgress")
const ms = (id: string, taskCount: number, extra: Partial<ChecklistMilestoneInput> = {}): ChecklistMilestoneInput => ({
  id,
  taskCount,
  title: `T${taskCount}`,
  recognition: "r",
  employeeMessage: `m${taskCount}`,
  ...extra,
})
const days = (n: number) => Array.from({ length: n }, (_, i) => `2026-09-${String(1 + Math.floor(i / 2)).padStart(2, "0")}`)
const three = [ms("a", 3), ms("b", 5)]

const at2 = checklistProgress({ taskDates: days(2), terminated: false, milestones: three })
check("B1. N-1 (2 of 3): nothing achieved", at2.achieved.length, 0)
check("B2. N-1: next is 3, one to go", [at2.next?.taskCount, at2.next?.tasksToGo], [3, 1])
const at3 = checklistProgress({ taskDates: days(3), terminated: false, milestones: three })
check("B3. N (3 of 3): achieved", at3.achieved.map((m) => m.id), ["a"])
check("B4. reached on the date of the 3rd task", at3.achieved[0].achievedOn, days(3)[2])
check("B5. next is 5; progress from 3 → 5 is 0%", [at3.next?.taskCount, at3.progressPct], [5, 0])
check("B6. count = number of named tasks", at3.tasksCompleted, 3)
const all = checklistProgress({ taskDates: days(6), terminated: false, milestones: three })
check("B7. past every milestone: both achieved, no next", [all.achieved.length, all.next], [2, null])
check("B8. un-tick lowers the count → milestone un-achieves", checklistProgress({ taskDates: days(2), terminated: false, milestones: three }).achieved.length, 0)
const term = checklistProgress({ taskDates: days(3), terminated: true, milestones: three })
check("B9. terminated: keeps achieved, no next", [term.achieved.length, term.next, term.progressPct], [1, null, null])
// Archived: reached on/before its archive date stays; after does not; never next.
const archKept = checklistProgress({ taskDates: days(3), terminated: false, milestones: [ms("a", 3, { isArchived: true, archivedOn: days(3)[2] })] })
check("B10. archived, reached on its archive date → kept, marked archived", archKept.achieved.map((m) => [m.id, m.archived]), [["a", true]])
const archLate = checklistProgress({ taskDates: days(3), terminated: false, milestones: [ms("a", 3, { isArchived: true, archivedOn: "2026-08-31" })] })
check("B11. archived before it was reached → not achieved, not next", [archLate.achieved.length, archLate.next], [0, null])
const archNoDate = checklistProgress({ taskDates: days(9), terminated: false, milestones: [ms("a", 3, { isArchived: true, archivedOn: null })] })
check("B12. archived with no date → counts for nobody", archNoDate.achieved.length, 0)
check("B13. none set up → nothing, no next", checklistProgress({ taskDates: days(4), terminated: false, milestones: [] }), {
  tasksCompleted: 4,
  terminated: false,
  achieved: [],
  next: null,
  progressPct: null,
})
check("B14. message passes through unchanged", at3.achieved[0].employeeMessage, "m3")

// ─── C. DATABASE (dev) ───────────────────────────────────────────────────────
async function db() {
  console.log("\nC. Database (dev branch)")
  const branch = await prisma.$queryRaw<{ b: string | null }[]>`select current_setting('neon.branch_id', true) as b`
  console.log(`     branch id: ${branch[0]?.b ?? "(null — not Neon)"}  — expected dev br-broad-wave-a6vpjdw0`)

  const stamp = Date.now()
  const org = await prisma.organization.create({ data: { clerkOrgId: `ms4a-fixture-${stamp}`, name: "MS-4a Fixture Org" } })
  const orgB = await prisma.organization.create({ data: { clerkOrgId: `ms4a-fixture-b-${stamp}`, name: "MS-4a Fixture Org B" } })
  try {
    // Switch: no settings row = OFF; on/off round trip; other columns default.
    check("C1. no settings row → switch OFF (F13 default)", await checklistMilestonesEnabled(org.id), false)
    await setChecklistMilestonesEnabled(org.id, true)
    check("C2. switched on → ON", await checklistMilestonesEnabled(org.id), true)
    const row = await prisma.milestoneSettings.findUniqueOrThrow({ where: { organizationId: org.id } })
    check("C3. first save leaves every other setting at its default", [row.onTimeRedBelow, row.onTimeGreenAtOrAbove, row.raiseCooldownDays, row.raiseComplianceGate], [80, 90, 90, true])
    await setChecklistMilestonesEnabled(org.id, false)
    check("C4. switched off → OFF, row kept", [await checklistMilestonesEnabled(org.id), await prisma.milestoneSettings.count({ where: { organizationId: org.id } })], [false, 1])
    check("C5. another org is untouched (still no row, OFF)", await checklistMilestonesEnabled(orgB.id), false)

    // Duplicate-taskCount rule.
    const fields = (taskCount: number) => ({ taskCount, title: `MS-4a ${taskCount}`, recognition: "Shout-out", employeeMessage: `Thanks for ${taskCount} tasks!\nKeep going.` })
    const m3 = await createChecklistMilestone(org.id, fields(3))
    check("C6. create 3 → row", typeof m3 === "object", true)
    check("C7. second active 3 → clash", await createChecklistMilestone(org.id, fields(3)), "clash")
    check("C8. another org may use 3", typeof (await createChecklistMilestone(orgB.id, fields(3))) === "object", true)
    const m5 = await createChecklistMilestone(org.id, fields(5))
    if (typeof m3 !== "object" || typeof m5 !== "object") throw new Error("setup")
    check("C9. edit 5 → 3 clashes", await updateChecklistMilestone(org.id, m5.id, { taskCount: 3 }), "clash")
    const archived = await updateChecklistMilestone(org.id, m3.id, { isArchived: true })
    check("C10. archive stamps archivedAt", typeof archived === "object" && archived.archivedAt instanceof Date, true)
    const again3 = await createChecklistMilestone(org.id, fields(3))
    check("C11. archived 3 frees the number", typeof again3 === "object", true)
    check("C12. restoring the old 3 now clashes", await updateChecklistMilestone(org.id, m3.id, { isArchived: false }), "clash")
    check("C13. foreign id → not-found (org-scoped)", await updateChecklistMilestone(orgB.id, m5.id, { title: "x" }), "not-found")

    // Named-task counting (F0).
    const store = await prisma.store.create({ data: { organizationId: org.id, name: "MS-4a Store", timezone: "America/Los_Angeles", squareLocationId: `ms4a-loc-${stamp}` } })
    const storeB = await prisma.store.create({ data: { organizationId: orgB.id, name: "MS-4a Store B", timezone: "America/Los_Angeles", squareLocationId: `ms4a-locb-${stamp}` } })
    const staff = (name: string, organizationId: string, storeId: string) =>
      prisma.staffMember.create({ data: { organizationId, displayName: `MS-4a Staff ${name}`, storeAssignments: { create: [{ storeId }] } } })
    const maria = await staff("Maria", org.id, store.id)
    const other = await staff("Other", org.id, store.id)

    const setup = async (organizationId: string, storeId: string, tag: string) => {
      const template = await prisma.template.create({ data: { organizationId, name: `MS-4a Template ${tag}`, type: "Opening" } })
      const tasks = await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          prisma.task.create({ data: { templateId: template.id, sectionName: "MS-4a", description: `MS-4a task ${tag}${i}` } })
        )
      )
      const checklist = await prisma.checklist.create({ data: { organizationId, templateId: template.id, storeId, date: new Date("2026-10-17T00:00:00Z") } })
      return { template, tasks, checklist }
    }
    const a = await setup(org.id, store.id, "A")
    const b = await setup(orgB.id, storeB.id, "B")

    const log = (checklistId: string, taskId: string, completedByStaffId: string | null, completedAt: string) =>
      prisma.taskLog.create({ data: { checklistId, taskId, completedByStaffId, completedAt: new Date(completedAt) } })
    // Maria: two named. The second at 03:30 UTC on Oct 18 is still Oct 17 in Los Angeles.
    await log(a.checklist.id, a.tasks[0].id, maria.id, "2026-10-16T18:00:00Z")
    const second = await log(a.checklist.id, a.tasks[1].id, maria.id, "2026-10-18T03:30:00Z")
    await log(a.checklist.id, a.tasks[2].id, null, "2026-10-17T18:00:00Z") // "Team Member"
    await log(a.checklist.id, a.tasks[3].id, other.id, "2026-10-17T18:00:00Z") // someone else
    // A row in ANOTHER org's checklist naming Maria — the pre-CHK-15 shape.
    await log(b.checklist.id, b.tasks[0].id, maria.id, "2026-10-17T18:00:00Z")

    const dates = await namedTaskDates({ organizationId: org.id, staffMemberId: maria.id, zone: "America/Los_Angeles" })
    check("C14. counts Maria's named tasks only (not Team Member, not others, not another org)", dates.length, 2)
    check("C15. dates are store-local, oldest first (03:30 UTC Oct 18 → Oct 17 PT)", dates, ["2026-10-16", "2026-10-17"])
    check("C16. other member counted separately", (await namedTaskDates({ organizationId: org.id, staffMemberId: other.id, zone: "America/Los_Angeles" })).length, 1)

    // Third task → the 3-task milestone (N-1 → N), with the stored message intact.
    await setChecklistMilestonesEnabled(org.id, true)
    const rows = await prisma.checklistMilestone.findMany({ where: { organizationId: org.id } })
    const input = rows.map((r) => ({ ...r, archivedOn: r.isArchived && r.archivedAt ? "2026-10-01" : null }))
    check("C17. at 2 named tasks: 3-task milestone not reached", checklistProgress({ taskDates: dates, terminated: false, milestones: input }).achieved.length, 0)
    await log(a.checklist.id, a.tasks[4].id, maria.id, "2026-10-17T20:00:00Z")
    const now3 = await namedTaskDates({ organizationId: org.id, staffMemberId: maria.id, zone: "America/Los_Angeles" })
    const p3 = checklistProgress({ taskDates: now3, terminated: false, milestones: input })
    check("C18. at 3: the active 3-task milestone is reached", p3.achieved.map((m) => m.id), [typeof again3 === "object" ? again3.id : ""])
    check("C19. Copy text = the stored message, newline and all", p3.achieved[0]?.employeeMessage, "Thanks for 3 tasks!\nKeep going.")
    check("C20. next is 5, two to go", [p3.next?.taskCount, p3.next?.tasksToGo], [5, 2])

    // Un-tick deletes the TaskLog (the task-log route's toggle) → count drops.
    await prisma.taskLog.delete({ where: { id: second.id } })
    const after = await namedTaskDates({ organizationId: org.id, staffMemberId: maria.id, zone: "America/Los_Angeles" })
    check("C21. un-tick lowers the count; the milestone un-achieves", [after.length, checklistProgress({ taskDates: after, terminated: false, milestones: input }).achieved.length], [2, 0])
  } finally {
    const orgIds = [org.id, orgB.id]
    await prisma.taskLog.deleteMany({ where: { checklist: { organizationId: { in: orgIds } } } })
    await prisma.checklist.deleteMany({ where: { organizationId: { in: orgIds } } })
    await prisma.task.deleteMany({ where: { template: { organizationId: { in: orgIds } } } })
    await prisma.template.deleteMany({ where: { organizationId: { in: orgIds } } })
    await prisma.checklistMilestone.deleteMany({ where: { organizationId: { in: orgIds } } })
    await prisma.milestoneSettings.deleteMany({ where: { organizationId: { in: orgIds } } })
    await prisma.staffMember.deleteMany({ where: { organizationId: { in: orgIds } } })
    await prisma.store.deleteMany({ where: { organizationId: { in: orgIds } } })
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } })
    const left = await prisma.organization.count({ where: { clerkOrgId: { startsWith: "ms4a-fixture" } } })
    check("C22. cleanup: no MS-4a fixture orgs left", left, 0)
  }
}

db()
  .catch((e) => {
    failures++
    console.error("FAIL  async section threw:", e)
  })
  .finally(async () => {
    await prisma.$disconnect()
    console.log(`\n${passes} passed, ${failures} failed`)
    process.exit(failures === 0 ? 0 : 1)
  })
