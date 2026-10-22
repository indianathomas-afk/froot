/**
 * MS-6 acceptance fixture — milestone eligibility per staff member, and the
 * "Labor" → "Labor Settings" rename.
 *
 *   npx tsx scripts/verify-ms6.ts
 *
 * Rulings: docs/prompts/2026-10-21_MS-6_milestone_eligibility.md (R1–R8) and
 * docs/prompts/2026-10-21_MS-6_AUDIT.md (F1–F6, "approved as recommended",
 * Gary 2026-10-21).
 *
 *   A. Gates and structure — milestones.manage is ADMIN-only (MANAGER, STORE,
 *      STAFF → 403), Milestones off → 404; the route's gate order; the column
 *      is ADMIN + Milestones-on only, after CONFID., disabled with the R7
 *      tooltip on a "Not in Froot" row; every read path carries the flag; no
 *      Square sync/import path names the column (R8); the rename.
 *   B. Database (DEV branch, local .env) — default true on create; ADMIN
 *      flips off/on through setMilestoneEligible with an AuditLog row per
 *      change and none for a no-op; foreign-org and "Not in Froot" ids refused;
 *      one person shows one value on two stores' rosters (R6); an ineligible
 *      member gets no on-time result, no raise result, no tab, no report row,
 *      no milestone email (producer AND dispatch re-check); flip back on
 *      restores every one; the staff-sync write payloads leave the flag alone.
 *      Every fixture row is named "MS-6 …" (CLAUDE.md § Name every test
 *      principal) and deleted afterwards.
 */
import "dotenv/config"
import { readFileSync } from "node:fs"
import type { Organization } from "@prisma/client"
import { prisma } from "../src/lib/prisma"
import { can, overridesFrom, type PermissionUser } from "../src/lib/permissions"
import { milestonesActive, milestonesDenialStatus } from "../src/lib/milestones-access"
import { getMilestoneSettings, getOnTimeForStaff, lookbackRange } from "../src/lib/attendance"
import { getRaiseEligibility, getRaiseSettings } from "../src/lib/raise-eligibility"
import { buildMilestoneReport, type ReportViewer } from "../src/lib/milestone-report"
import { processMilestoneAlerts } from "../src/lib/milestone-alerts"
import { MILESTONE_KIND } from "../src/lib/notifications/kinds/milestone"
import { getKind } from "../src/lib/notifications/registry"
import { dispatchNotifications, enqueueNotification } from "../src/lib/notifications/dispatch"
import { getStoreRoster } from "../src/lib/labor-roster"
import { squareStartDateData } from "../src/lib/milestones-square"
import { MILESTONE_ELIGIBILITY_AUDIT_ACTION, setMilestoneEligible } from "../src/lib/milestone-eligibility"
import { localDateStr, dbDate } from "../src/lib/reports"
import { addDays } from "../src/lib/milestones"
import type { EmailSender } from "../src/lib/notify"

let passes = 0
let failures = 0
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) passes++
  else failures++
  console.log(`${ok ? "  ok  " : "FAIL  "}${name}${ok ? "" : `\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`)
}

const LA = "America/Los_Angeles"
const src = (p: string) => readFileSync(p, "utf8")
const P = (role: string): PermissionUser => ({ role: role as PermissionUser["role"], overrides: overridesFrom([]) })

// ─── A. GATES AND STRUCTURE ──────────────────────────────────────────────────
console.log("A. Gates and structure")
check(
  "A1. milestones.manage: ADMIN yes; MANAGER, STORE, STAFF no (R4)",
  (["ADMIN", "MANAGER", "STORE", "STAFF"] as const).map((r) => can(P(r), "milestones.manage")),
  [true, false, false, false]
)
check("A2. refused = 403, Milestones off = 404", [milestonesDenialStatus("forbidden"), milestonesDenialStatus("disabled")], [403, 404])

const routeSrc = src("src/app/api/staff/[id]/milestone-eligibility/route.ts")
const gateAt = routeSrc.indexOf('requireMilestones("milestones.manage")')
check(
  "A3. route: requireMilestones(milestones.manage) first, before the body is parsed or anything is written",
  [gateAt > -1, gateAt < routeSrc.indexOf("putSchema.safeParse"), gateAt < routeSrc.indexOf("setMilestoneEligible({")],
  [true, true, true]
)
check("A4. route exports PUT only", [/export async function PUT\(/.test(routeSrc), /export async function (GET|POST|PATCH|DELETE)\(/.test(routeSrc)], [true, false])

const libSrc = src("src/lib/milestone-eligibility.ts")
check(
  "A5. write is org-scoped and audited",
  [/where: \{ id: args\.staffMemberId, organizationId: args\.organizationId \}/.test(libSrc), /writeAuditLog\(/.test(libSrc)],
  [true, true]
)

const clientSrc = src("src/app/(app)/settings/labor/labor-settings-client.tsx")
check("A6. column is ADMIN + Milestones-on only (F1, R5)", /const showMilestones = isAdmin && milestonesOn/.test(clientSrc), true)
check(
  "A7. MILESTONES header sits after CONFID.",
  clientSrc.indexOf("Confid.\n") > -1 && clientSrc.indexOf("Confid.\n") < clientSrc.indexOf("                    Milestones\n"),
  true
)
check(
  "A8. \"Not in Froot\" row: disabled switch with the R7 tooltip",
  /r\.staffMemberId \? \([\s\S]*?\) : \([\s\S]*?title="Add to Froot to set milestones\."[\s\S]*?disabled/.test(clientSrc),
  true
)
check("A9. switch saves through the new route by staffMemberId", /\/api\/staff\/\$\{encodeURIComponent\(staffMemberId\)\}\/milestone-eligibility/.test(clientSrc), true)
check(
  "A10. page passes milestonesActive(org) to the client",
  /milestonesOn=\{milestonesActive\(org\)\}/.test(src("src/app/(app)/settings/labor/page.tsx")),
  true
)

// Every read path (audit §2).
const profileSrc = src("src/app/(app)/staff/[id]/page.tsx")
const staffSrc = src("src/app/(app)/staff/page.tsx")
check(
  "A11. /staff/[id]: tab gate carries the flag (R2)",
  /const showMilestonesTab = canSeeHrTabs && milestonesActive\(org\) && member\.milestoneEligible/.test(profileSrc),
  true
)
check("A12. /staff: both engine calls pass the flag", (staffSrc.match(/milestoneEligible: m\.milestoneEligible/g) ?? []).length, 2)
check(
  "A13. report: roster query filters milestoneEligible: true",
  /organizationId: org\.id,[\s\S]{0,200}milestoneEligible: true,/.test(src("src/lib/milestone-report.ts")),
  true
)
check(
  "A14. MS-4b producer: ACTIVE and eligible only",
  /where: \{ organizationId: org\.id, status: "ACTIVE", milestoneEligible: true \}/.test(src("src/lib/milestone-alerts.ts")),
  true
)
check(
  "A15. MS-4b dispatch re-checks the flag",
  /!member\.milestoneEligible\) return \[\]/.test(src("src/lib/notifications/kinds/milestone.ts")),
  true
)
check(
  "A16. engines take the flag as a REQUIRED field (no `?:`)",
  [/\n  milestoneEligible: boolean\n/.test(src("src/lib/attendance.ts")), /\n  milestoneEligible: boolean\n/.test(src("src/lib/raise-eligibility.ts"))],
  [true, true]
)

// R8 — nothing that syncs or imports from Square names the column.
const rosterSrc = src("src/lib/labor-roster.ts")
const writeRosterBody = rosterSrc.slice(rosterSrc.indexOf("async function writeRoster("), rosterSrc.indexOf("export async function writeWageSnapshots("))
const syncFiles = [
  "src/app/api/staff/sync-square/route.ts",
  "src/app/api/staff/[id]/resync-square/route.ts",
  "src/app/api/staff/route.ts",
  "src/app/api/square/labor/roster/sync/route.ts",
  "src/lib/square.ts",
  "src/lib/milestones-square.ts",
]
check(
  "A17. R8: no Square sync/import path, nor writeRoster, names milestoneEligible",
  [...syncFiles.map((f) => src(f).includes("milestoneEligible")), writeRosterBody.length > 0 && writeRosterBody.includes("milestoneEligible")],
  [...syncFiles.map(() => false), false]
)

// Rename.
check(
  "A18. sidebar reads \"Labor Settings\", route unchanged",
  /\{ href: "\/settings\/labor", label: "Labor Settings",/.test(src("src/components/layout/sidebar.tsx")),
  true
)
check("A19. page H1 reads \"Labor Settings\"", />Labor Settings<\/h1>/.test(src("src/app/(app)/settings/labor/page.tsx")), true)
check(
  "A20. the module card on /settings keeps \"Weekly Labor Model\"",
  /<CardTitle>Weekly Labor Model<\/CardTitle>/.test(src("src/app/(app)/settings/page.tsx")),
  true
)

// ─── B. DATABASE ─────────────────────────────────────────────────────────────
async function db() {
  console.log("\nB. Database")
  const saved = {
    H: process.env.HR_MODULE_AVAILABLE,
    L: process.env.LABOR_MODULE_AVAILABLE,
    Q: process.env.SQUARE_LABOR_AVAILABLE,
    U: process.env.NEXT_PUBLIC_APP_URL,
    A: process.env.NOTIFY_SANDBOX_ALLOWLIST,
  }
  process.env.HR_MODULE_AVAILABLE = "true"
  process.env.LABOR_MODULE_AVAILABLE = "true"
  process.env.SQUARE_LABOR_AVAILABLE = "true"
  process.env.NEXT_PUBLIC_APP_URL = "https://ms6.example.com"
  delete process.env.NOTIFY_SANDBOX_ALLOWLIST

  const stamp = Math.random().toString(36).slice(2, 8)
  const created = await prisma.organization.create({
    data: {
      clerkOrgId: `ms6-fixture-${stamp}`,
      name: "MS-6 Fixture Org (safe to delete)",
      activeModules: ["hr", "labor"],
      squareLaborEnabled: true,
      milestonesEnabled: true,
      milestoneAlertsEnabled: true,
      timezone: LA,
    },
  })
  const other = await prisma.organization.create({
    data: { clerkOrgId: `ms6-fixture-other-${stamp}`, name: "MS-6 Fixture Other Org (safe to delete)", activeModules: ["hr"], milestonesEnabled: false },
  })
  const orgIds = [created.id, other.id]
  const [{ branch }] = await prisma.$queryRaw<{ branch: string | null }[]>`SELECT current_setting('neon.branch_id', true) AS branch`
  console.log(`  branch ${branch ?? "(null — not Neon)"} · org ${created.id} (MS-6 Fixture Org)`)

  try {
    const org: Organization = await prisma.organization.findUniqueOrThrow({ where: { id: created.id } })
    check("B0. Milestones off → milestonesActive false → route 404", [milestonesActive(org), milestonesActive(other)], [true, false])

    const now = new Date()
    const today = localDateStr(now, LA)
    const [s1, s2] = await Promise.all(
      ["Cart", "Plaza"].map((n, i) =>
        prisma.store.create({ data: { organizationId: org.id, name: `MS-6 Store ${n}`, timezone: LA, squareLocationId: `ms6-loc-${i}-${stamp}` } })
      )
    )
    const tm = (n: string) => `ms6-tm-${n}-${stamp}`
    // Reached the 30-day milestone today — the producer would queue both.
    const mk = (name: string) =>
      prisma.staffMember.create({
        data: {
          organizationId: org.id,
          displayName: `MS-6 ${name}`,
          squareTeamMemberId: tm(name),
          startDate: dbDate(addDays(today, -30)),
          storeAssignments: { create: [{ storeId: s1.id, isPrimary: true }, { storeId: s2.id, isPrimary: false }] },
        },
        include: { storeAssignments: true },
      })
    const kel = await mk("Kelton")
    const eve = await mk("Eve")
    check("B1. default true on create (R1)", [kel.milestoneEligible, eve.milestoneEligible], [true, true])

    // Square roster rows: both people on every store, plus one "Not in Froot".
    const wage = (id: string) =>
      prisma.squareTeamMemberWage.create({
        data: { organizationId: org.id, squareTeamMemberId: id, status: "ACTIVE", allLocations: true, locationIds: [], payType: "SALARY", syncedAt: now },
      })
    await Promise.all([wage(tm("Kelton")), wage(tm("Eve")), wage(tm("NotInFroot"))])
    await prisma.tenureMilestone.create({
      data: { organizationId: org.id, dayCount: 30, title: "MS-6 Thirty days", recognition: "MS-6 shout-out", employeeMessage: "MS-6 thanks" },
    })

    const admin = await prisma.user.create({
      data: { clerkUserId: `ms6-admin-${stamp}`, organizationId: org.id, email: `ms6-admin-${stamp}@example.com`, role: "ADMIN" },
    })

    // ── Flip OFF (ADMIN) ──
    const off = await setMilestoneEligible({ organizationId: org.id, staffMemberId: kel.id, milestoneEligible: false, actorUserId: admin.clerkUserId })
    check("B2. ADMIN flips Kelton off", off, { ok: true, milestoneEligible: false })
    const audits = () =>
      prisma.auditLog.findMany({ where: { organizationId: org.id, action: MILESTONE_ELIGIBILITY_AUDIT_ACTION }, orderBy: { createdAt: "asc" } })
    const a1 = await audits()
    check(
      "B3. AuditLog: who, member, old → new",
      // jsonb does not keep key order, so the metadata is read field by field.
      a1.map((a) => {
        const m = a.metadata as { staffName: string; before: boolean; after: boolean }
        return [a.userId, a.entityType, a.entityId, m.staffName, m.before, m.after]
      }),
      [[admin.clerkUserId, "StaffMember", kel.id, "MS-6 Kelton", true, false]]
    )
    await setMilestoneEligible({ organizationId: org.id, staffMemberId: kel.id, milestoneEligible: false, actorUserId: admin.clerkUserId })
    check("B4. a no-op flip writes no audit row", (await audits()).length, 1)
    check(
      "B5. another org's caller cannot reach this member (404)",
      await setMilestoneEligible({ organizationId: other.id, staffMemberId: kel.id, milestoneEligible: true, actorUserId: null }),
      { ok: false }
    )
    check(
      "B6. \"Not in Froot\" row cannot be set: its Square id is no StaffMember (R7)",
      await setMilestoneEligible({ organizationId: org.id, staffMemberId: tm("NotInFroot"), milestoneEligible: false, actorUserId: null }),
      { ok: false }
    )

    // ── R6: the same value on each store's roster ──
    const ADMIN = P("ADMIN")
    const known = [s1.squareLocationId!, s2.squareLocationId!]
    const rosterVal = async (loc: string) => {
      const r = await getStoreRoster(org, loc, known, ADMIN)
      return Object.fromEntries(r.rows.map((x) => [x.displayName ?? "NotInFroot", x.milestoneEligible]))
    }
    check(
      "B7. one person, every store: Kelton off on both rosters; Not in Froot is null (R6, R7)",
      [await rosterVal(s1.squareLocationId!), await rosterVal(s2.squareLocationId!)],
      [
        { "MS-6 Eve": true, "MS-6 Kelton": false, NotInFroot: null },
        { "MS-6 Eve": true, "MS-6 Kelton": false, NotInFroot: null },
      ]
    )

    // ── R2: an ineligible member gets nothing ──
    const settings = await getMilestoneSettings(org.id)
    const members = async () => prisma.staffMember.findMany({ where: { organizationId: org.id }, include: { storeAssignments: true } })
    const onTimeIds = async () => {
      const ms = await members()
      const r = await getOnTimeForStaff(
        org,
        ms.map((m) => ({
          id: m.id,
          squareTeamMemberId: m.squareTeamMemberId,
          assignedStoreIds: m.storeAssignments.map((a) => a.storeId),
          range: lookbackRange(settings.onTimeLookbackDays, now, LA, null),
          milestoneEligible: m.milestoneEligible,
        })),
        settings,
        now
      )
      return [r.has(kel.id), r.has(eve.id)]
    }
    const raiseIds = async () => {
      const ms = await members()
      const r = await getRaiseEligibility(
        org,
        ms.map((m) => ({
          id: m.id,
          squareTeamMemberId: m.squareTeamMemberId,
          assignedStoreIds: m.storeAssignments.map((a) => a.storeId),
          startDate: m.startDate,
          status: m.status,
          zone: LA,
          milestoneEligible: m.milestoneEligible,
        })),
        await getRaiseSettings(org.id),
        settings,
        { now }
      )
      return [r.has(kel.id), r.has(eve.id)]
    }
    const tabFor = async (id: string) => {
      const m = await prisma.staffMember.findUniqueOrThrow({ where: { id } })
      return milestonesActive(org) && m.milestoneEligible // canSeeHrTabs held true: the ADMIN case
    }
    const vAdmin: ReportViewer = { actor: ADMIN, role: "ADMIN", isAdmin: true, storeIds: [], selfStaffId: null }
    const reportNames = async () => (await buildMilestoneReport({ org, viewer: vAdmin, now })).rows.map((r) => r.name).sort()

    check("B8. on-time: no result for Kelton, Eve still has one", await onTimeIds(), [false, true])
    check("B9. raise: no result for Kelton, Eve still has one", await raiseIds(), [false, true])
    check("B10. /staff/[id] tab: hidden for Kelton, shown for Eve", [await tabFor(kel.id), await tabFor(eve.id)], [false, true])
    check("B11. report: Kelton not listed (so in no total), Eve listed", await reportNames(), ["MS-6 Eve"])

    const sender: EmailSender = { async send() { return { id: `ms6-cap-${Math.random().toString(36).slice(2, 8)}` } } }
    const intentFor = (id: string) =>
      prisma.notificationIntent.findFirst({ where: { organizationId: org.id, kind: MILESTONE_KIND, dedupeKey: { startsWith: `${id}:` } } })
    const r1 = await processMilestoneAlerts({ sender, mode: "dry-run", now, organizationId: org.id })
    check("B12. MS-4b producer: Eve queued, Kelton never considered", [r1[0]?.members, !!(await intentFor(eve.id)), !!(await intentFor(kel.id))], [1, true, false])

    // Dispatch re-check: Eve's intent is queued; switch Eve off; the kind now
    // resolves nobody for it, so it waits and expires unsent.
    const eveIntent = await intentFor(eve.id)
    const def = getKind(MILESTONE_KIND)!
    const recipientsFor = async () =>
      (await def.resolveRecipients({ organizationId: org.id, payload: eveIntent!.payload } as never, org as never)).length
    const beforeFlip = await recipientsFor()
    await setMilestoneEligible({ organizationId: org.id, staffMemberId: eve.id, milestoneEligible: false, actorUserId: admin.clerkUserId })
    check("B13. MS-4b dispatch: a queued intent resolves no recipient once its member is switched off", [beforeFlip > 0, await recipientsFor()], [true, 0])

    // B13b–d — THE REAL DISPATCHER on a queued intent whose member is off: what
    // the NOTIFY-6 intent row records. A fresh intent (own dedupeKey, Eve's
    // payload) so nothing earlier in this run has touched it.
    const drop = await enqueueNotification({
      organizationId: org.id,
      kind: MILESTONE_KIND,
      dedupeKey: `${eve.id}:tenure:ms6-drop-${stamp}`,
      entityId: eve.id,
      eventAt: eveIntent!.eventAt,
      payload: eveIntent!.payload as never,
    })
    const dropRow = () =>
      prisma.notificationIntent.findUniqueOrThrow({
        where: { id: drop!.intentId },
        select: { state: true, attempts: true, lastError: true, nextAttemptAt: true, sentAt: true },
      })
    const dropTrail = async () => [
      await prisma.notificationDelivery.count({ where: { intentId: drop!.intentId } }),
      await prisma.notificationMessage.count({ where: { organizationId: org.id, intentIds: { has: drop!.intentId } } }),
    ]
    const transport = { mode: "dry-run" as const, sender: () => sender }
    const [dispatched] = await dispatchNotifications({ transport, trigger: "producer", organizationId: org.id, intentIds: [drop!.intentId], now })
    check(
      "B13b. switched off, dispatched now: outcome stays queued, reason \"no eligible recipients\"",
      [dispatched?.outcome, dispatched?.reason, dispatched?.eligible],
      ["queued", "no eligible recipients", 0]
    )
    check(
      "B13c. …and the intent row is untouched: queued, attempts 0, no lastError, no nextAttemptAt, no sentAt; no delivery, no message",
      [await dropRow(), await dropTrail()],
      [{ state: "queued", attempts: 0, lastError: null, nextAttemptAt: null, sentAt: null }, [0, 0]]
    )
    const pastWindow = new Date(eveIntent!.eventAt.getTime() + (8 * 24 * 60 + 1) * 60_000)
    await dispatchNotifications({ transport, trigger: "sweep", organizationId: org.id, intentIds: [drop!.intentId], now: pastWindow })
    check(
      "B13d. still off past the 8-day window: the sweep EXPIRES it, \"past the freshness window\"; never sent",
      [await dropRow(), await dropTrail()],
      [{ state: "expired", attempts: 0, lastError: "past the freshness window", nextAttemptAt: null, sentAt: null }, [0, 0]]
    )
    await setMilestoneEligible({ organizationId: org.id, staffMemberId: eve.id, milestoneEligible: true, actorUserId: admin.clerkUserId })

    // ── R8: the staff-sync write payloads leave the flag alone ──
    const startData = squareStartDateData(false, "2025-01-15T18:00:00Z", LA)
    await prisma.staffMember.update({ where: { id: kel.id }, data: startData })
    await prisma.staffMember.update({ where: { id: kel.id }, data: { email: `ms6-kelton-${stamp}@example.com` } })
    await prisma.staffMember.update({ where: { id: kel.id }, data: { startDate: dbDate(addDays(today, -30)) } }) // restore for B15
    check("B14. R8: replayed Square sync writes leave Kelton off", (await prisma.staffMember.findUniqueOrThrow({ where: { id: kel.id } })).milestoneEligible, false)

    // ── R3: flip back ON restores everything ──
    const back = await setMilestoneEligible({ organizationId: org.id, staffMemberId: kel.id, milestoneEligible: true, actorUserId: admin.clerkUserId })
    check("B15. ADMIN flips Kelton back on", back, { ok: true, milestoneEligible: true })
    check("B16. restored: on-time", await onTimeIds(), [true, true])
    check("B17. restored: raise", await raiseIds(), [true, true])
    check("B18. restored: tab", await tabFor(kel.id), true)
    check("B19. restored: report row", await reportNames(), ["MS-6 Eve", "MS-6 Kelton"])
    await processMilestoneAlerts({ sender, mode: "dry-run", now, organizationId: org.id })
    check("B20. restored: Kelton's milestone now queued for email (as if never off, F5)", !!(await intentFor(kel.id)), true)
    check(
      "B21. audit trail: off, on (Eve), off→on… one row per real change",
      (await audits()).map((a) => [(a.metadata as { staffName: string }).staffName, (a.metadata as { after: boolean }).after]),
      [["MS-6 Kelton", false], ["MS-6 Eve", false], ["MS-6 Eve", true], ["MS-6 Kelton", true]]
    )
  } finally {
    const intents = await prisma.notificationIntent.findMany({ where: { organizationId: { in: orgIds } }, select: { id: true } })
    await prisma.notificationDelivery.deleteMany({ where: { intentId: { in: intents.map((i) => i.id) } } })
    await prisma.notificationMessage.deleteMany({ where: { organizationId: { in: orgIds } } })
    await prisma.notificationIntent.deleteMany({ where: { organizationId: { in: orgIds } } })
    await prisma.auditLog.deleteMany({ where: { organizationId: { in: orgIds } } })
    await prisma.tenureMilestone.deleteMany({ where: { organizationId: { in: orgIds } } })
    await prisma.milestoneSettings.deleteMany({ where: { organizationId: { in: orgIds } } })
    await prisma.squareTeamMemberWage.deleteMany({ where: { organizationId: { in: orgIds } } })
    await prisma.storeStaffAssignment.deleteMany({ where: { staffMember: { organizationId: { in: orgIds } } } })
    await prisma.staffMember.deleteMany({ where: { organizationId: { in: orgIds } } })
    await prisma.user.deleteMany({ where: { organizationId: { in: orgIds } } })
    await prisma.store.deleteMany({ where: { organizationId: { in: orgIds } } })
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } })
    console.log(`  fixture orgs ${orgIds.join(", ")} (MS-6) and everything under them deleted.`)
    for (const [k, v] of Object.entries({
      HR_MODULE_AVAILABLE: saved.H,
      LABOR_MODULE_AVAILABLE: saved.L,
      SQUARE_LABOR_AVAILABLE: saved.Q,
      NEXT_PUBLIC_APP_URL: saved.U,
      NOTIFY_SANDBOX_ALLOWLIST: saved.A,
    })) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

db()
  .catch((e) => {
    console.error(e)
    failures++
  })
  .finally(async () => {
    await prisma.$disconnect()
    console.log(`\n${passes} passed, ${failures} failed`)
    process.exit(failures > 0 ? 1 : 0)
  })
