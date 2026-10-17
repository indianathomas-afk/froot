/**
 * CHK-15 acceptance fixture — who a checklist tick may name.
 *
 *   npx tsx scripts/verify-chk15.ts
 *
 * Ruling: MS-4 fork F12 (Gary, 2026-10-17): "treat the cross-company staff id
 * as a security fix"; "F12 is forward-only". Audit and forks:
 * docs/prompts/2026-10-17_CHK-15_AUDIT.md (F-A b, F-B b, F-C, F-D).
 *
 *   A. Structure — the route imports and calls resolveTaskLogStaff; the call is
 *      guarded by `!existing` (an un-tick is never refused, even of a log
 *      naming someone since terminated); it sits BEFORE the Pending → In
 *      Progress write and before the create (F-A b); the create saves the
 *      resolved id and no raw-body path is left. The picker query filters
 *      ACTIVE; saved-tick names come from a separate org-scoped query (F-B b).
 *      Negative controls: each predicate rejects a broken copy of the source.
 *   B. Database (dev branch) — the resolver against real rows: foreign-company
 *      id refused with a sentence naming no company and identical to an unknown
 *      id's; terminated refused; unassigned / assigned-elsewhere refused;
 *      corporate with no assignment allowed; assigned active allowed; null,
 *      "" and "manager" allowed as null; a non-string refused (F-D). Every row
 *      is under "CHK-15 Fixture Org" / "CHK-15 Fixture Org B", staff named
 *      "CHK-15 Staff …" (CLAUDE.md § Name every test principal), deleted in
 *      `finally`.
 */
import "dotenv/config"
import { readFileSync } from "node:fs"
import { prisma } from "../src/lib/prisma"
import { resolveTaskLogStaff, STAFF_NOT_USABLE } from "../src/lib/task-log-staff"

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
const ROUTE = readFileSync("src/app/api/checklists/[id]/task-log/route.ts", "utf8")
const PAGE = readFileSync("src/app/(app)/store-view/checklist/[id]/page.tsx", "utf8")
const CLIENT = readFileSync("src/app/(app)/store-view/checklist/[id]/checklist-execution-client.tsx", "utf8")

/** Code only — comments stripped, so a comment that names a call cannot pass for one. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/.*$/gm, "")

function routeOrderOk(src: string): boolean {
  const c = code(src)
  const imp = /import \{ resolveTaskLogStaff \} from "@\/lib\/task-log-staff"/.test(c)
  const lookup = c.indexOf("const existing = await prisma.taskLog.findFirst")
  const guard = c.indexOf("if (!existing) {")
  const call = c.indexOf("await resolveTaskLogStaff(")
  const pending = c.indexOf('status: "In Progress"')
  const untick = c.indexOf("await prisma.taskLog.delete(")
  const create = c.indexOf("await prisma.taskLog.create(")
  return imp && lookup > -1 && lookup < guard && guard < call && call < pending && call < untick && call < create
}
function routeNoRawPath(src: string): boolean {
  const c = code(src)
  return c.includes("completedByStaffId: staffId,") && !/completedByStaffId\s*&&/.test(c) && (c.match(/resolveTaskLogStaff\(/g) ?? []).length === 1
}
function pickerQuery(src: string): string {
  const start = src.indexOf("const staff = await prisma.staffMember.findMany(")
  return start < 0 ? "" : src.slice(start, src.indexOf("})", start))
}
function pickerActiveOk(src: string): boolean {
  return pickerQuery(src).includes('status: "ACTIVE"')
}
function namesQueryOk(page: string, client: string): boolean {
  const start = page.indexOf("const staffNames =")
  const block = start < 0 ? "" : page.slice(start, page.indexOf("})", start))
  return (
    block.includes("organizationId: org.id") &&
    !block.includes("status:") &&
    page.includes("staffNames={staffNames}") &&
    /staffById = Object\.fromEntries\(\[\.\.\.staffNames, \.\.\.staff\]/.test(client) &&
    // the picker still renders only `staff`
    client.includes("{staff.map((s) => (") &&
    !client.includes("staffNames.map((s) => (")
  )
}

check("A1. route: import, `existing` lookup → `!existing` guard → call, before Pending write, un-tick and create", routeOrderOk(ROUTE), true)
check("A2. route: create saves the resolved id; no raw-body path; one call", routeNoRawPath(ROUTE), true)
check("A3. picker query filters ACTIVE", pickerActiveOk(PAGE), true)
check("A4. saved-tick names: org-scoped, no status filter, display-only in the client (F-B b)", namesQueryOk(PAGE, CLIENT), true)

// Negative controls — each predicate must reject a broken copy.
const unguarded = ROUTE.replace("if (!existing) {", "if (true) {")
// The guard block lifted out and re-inserted just above the create.
const afterCreate = ROUTE.replace(
  /\n  let staffId: string \| null = null\n  if \(!existing\) \{[\s\S]*?\n  \}\n/,
  "\n  let staffId: string | null = null\n"
).replace("  await prisma.taskLog.create({", "  if (!existing) { await resolveTaskLogStaff({ organizationId: org.id, storeId: checklist.storeId, staffId: completedByStaffId }) }\n  await prisma.taskLog.create({")
const rawPath = ROUTE.replace("completedByStaffId: staffId,", "completedByStaffId: completedByStaffId && completedByStaffId !== \"manager\" ? completedByStaffId : null,")
check("A5. NC: guard removed → A1 rejects", routeOrderOk(unguarded), false)
check("A6. NC: call moved after the create → A1 rejects", routeOrderOk(afterCreate), false)
check("A7. NC: raw body id saved again → A2 rejects", routeNoRawPath(rawPath), false)
check("A8. NC: ACTIVE filter removed → A3 rejects", pickerActiveOk(PAGE.replace('      status: "ACTIVE",\n', "")), false)
check("A9. NC: picker renders staffNames → A4 rejects", namesQueryOk(PAGE, CLIENT.replace("{staff.map((s) => (", "{staffNames.map((s) => (")), false)

// ─── B. DATABASE (dev) ───────────────────────────────────────────────────────
async function db() {
  console.log("\nB. Database (dev branch)")
  const branch = await prisma.$queryRaw<{ b: string | null }[]>`select current_setting('neon.branch_id', true) as b`
  console.log(`     branch id: ${branch[0]?.b ?? "(null — not Neon)"}  — expected dev br-broad-wave-a6vpjdw0`)

  const stamp = Date.now()
  const org = await prisma.organization.create({ data: { clerkOrgId: `chk15-fixture-${stamp}`, name: "CHK-15 Fixture Org" } })
  const orgB = await prisma.organization.create({ data: { clerkOrgId: `chk15-fixture-b-${stamp}`, name: "CHK-15 Fixture Org B" } })
  try {
    const store = await prisma.store.create({ data: { organizationId: org.id, name: "CHK-15 Store", timezone: "America/Los_Angeles", squareLocationId: `chk15-loc-${stamp}` } })
    const store2 = await prisma.store.create({ data: { organizationId: org.id, name: "CHK-15 Store Two", timezone: "America/Los_Angeles", squareLocationId: `chk15-loc2-${stamp}` } })
    const storeB = await prisma.store.create({ data: { organizationId: orgB.id, name: "CHK-15 Store B", timezone: "America/Los_Angeles", squareLocationId: `chk15-locb-${stamp}` } })
    const mk = (name: string, opts: { orgId?: string; storeIds?: string[]; status?: string; isCorporate?: boolean } = {}) =>
      prisma.staffMember.create({
        data: {
          organizationId: opts.orgId ?? org.id,
          displayName: `CHK-15 Staff ${name}`,
          status: opts.status ?? "ACTIVE",
          isCorporate: opts.isCorporate ?? false,
          ...(opts.storeIds?.length ? { storeAssignments: { create: opts.storeIds.map((storeId) => ({ storeId })) } } : {}),
        },
      })

    const assigned = await mk("Assigned", { storeIds: [store.id] })
    const terminated = await mk("Terminated", { storeIds: [store.id], status: "TERMINATED" })
    const unassigned = await mk("Unassigned")
    const elsewhere = await mk("Elsewhere", { storeIds: [store2.id] })
    const corporate = await mk("Corporate", { isCorporate: true })
    const corpTerminated = await mk("Corporate Terminated", { isCorporate: true, status: "TERMINATED" })
    const foreign = await mk("Foreign", { orgId: orgB.id, storeIds: [storeB.id] })

    const r = (staffId: unknown) => resolveTaskLogStaff({ organizationId: org.id, storeId: store.id, staffId })

    const f = await r(foreign.id)
    check("B1. foreign-company id → refused", f.ok, false)
    check("B2. foreign-company refusal is the generic sentence", f.ok ? null : f.error, STAFF_NOT_USABLE)
    check("B3. …which names no company and no person", f.ok ? null : /CHK-15|Fixture|Org|Foreign/.test(f.error), false)
    const unknown = await r(`chk15-no-such-id-${stamp}`)
    check("B4. unknown id → the SAME sentence (no existence oracle)", unknown.ok ? null : unknown.error, STAFF_NOT_USABLE)

    const t = await r(terminated.id)
    check("B5. terminated → refused, named", t.ok ? null : t.error, "CHK-15 Staff Terminated is no longer an active team member. Choose another name, or Team Member.")
    const ct = await r(corpTerminated.id)
    check("B6. corporate but terminated → refused (status first)", ct.ok ? null : ct.error, "CHK-15 Staff Corporate Terminated is no longer an active team member. Choose another name, or Team Member.")

    const u = await r(unassigned.id)
    check("B7. same company, no assignment → refused", u.ok ? null : u.error, "CHK-15 Staff Unassigned isn't assigned to this store. Choose Team Member, or ask an admin to add them to this store.")
    const e = await r(elsewhere.id)
    check("B8. same company, assigned to another store only → refused", e.ok ? null : e.error, "CHK-15 Staff Elsewhere isn't assigned to this store. Choose Team Member, or ask an admin to add them to this store.")

    check("B9. corporate with no assignment → allowed", await r(corporate.id), { ok: true, staffId: corporate.id })
    check("B10. assigned active → allowed", await r(assigned.id), { ok: true, staffId: assigned.id })
    check("B11. elsewhere is allowed at THEIR store", await resolveTaskLogStaff({ organizationId: org.id, storeId: store2.id, staffId: elsewhere.id }), { ok: true, staffId: elsewhere.id })

    check("B12. null → allowed, saved as null", await r(null), { ok: true, staffId: null })
    check("B13. undefined → allowed, saved as null", await r(undefined), { ok: true, staffId: null })
    check('B14. "" → allowed, saved as null', await r(""), { ok: true, staffId: null })
    check('B15. "manager" (Team Member) → allowed, saved as null', await r("manager"), { ok: true, staffId: null })
    check("B16. non-string (number) → refused, generic (F-D)", await r(42), { ok: false, error: STAFF_NOT_USABLE })
    check("B17. non-string (object) → refused, generic (F-D)", await r({ id: assigned.id }), { ok: false, error: STAFF_NOT_USABLE })

    const allStatus400 = [f, unknown, t, u, e].every((x) => !x.ok && typeof x.error === "string" && x.error.length > 0)
    check("B18. every refusal carries a sentence for the task row", allStatus400, true)
  } finally {
    await prisma.staffMember.deleteMany({ where: { organizationId: { in: [org.id, orgB.id] } } })
    await prisma.store.deleteMany({ where: { organizationId: { in: [org.id, orgB.id] } } })
    await prisma.organization.deleteMany({ where: { id: { in: [org.id, orgB.id] } } })
    const left = await prisma.organization.count({ where: { clerkOrgId: { startsWith: "chk15-fixture" } } })
    check("B19. cleanup: no CHK-15 fixture orgs left", left, 0)
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
