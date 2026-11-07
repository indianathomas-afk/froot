/**
 * NOTIFY-4 acceptance fixture — the Tasks and Communication email.
 *
 *   npx tsx scripts/verify-notify-taskcomm.ts
 *
 * Rulings: Gary 2026-11-06, F0–F11 and riders (docs/DECISIONS.md; forks in
 * docs/prompts/NOTIFY-TASKCOMM_AUDIT.md § 10). Every EXPECTED value below is
 * written from those rulings, not read back from the code under test.
 *
 * Creates one throwaway org ("NOTIFY-4 Fixture Org …"), every principal named
 * "NOTIFY-4 …" (CLAUDE.md § Name every test principal). Dates are placed
 * relative to TODAY in America/Los_Angeles, so the daily email's reported day
 * is yesterday Pacific. Mail goes to a capture sender in LIVE mode, so delivery
 * rows and states are real; nothing leaves the machine. Everything is deleted
 * afterwards and the removal is re-queried.
 *
 * NEGATIVE CONTROLS, one per scoping rule (prompt § BUILD): a manager must NOT
 * see an unassigned store's message or a corporate update targeted elsewhere; a
 * contact matching a manager must NOT get the org-wide view; a store login
 * added as a contact must NOT receive it; a denied manager must NOT receive it;
 * a manager without reports.view must NOT get store performance.
 *
 * NOT HERE, said rather than implied: PUT /api/task-comm/settings and the
 * preview on POST /api/notify/test need a Clerk session; the preview's BUILD
 * and RENDER paths are exercised directly. Both routes are on the staging test
 * list in the NOTIFY-4 row.
 */
import "dotenv/config"
import { prisma } from "../src/lib/prisma"
import type { DeliveryMode, EmailMessage, EmailSender } from "../src/lib/notify"
import { localDateStr } from "../src/lib/reports"
import { zonedInstant } from "../src/lib/checklist-lifecycle"
import { addDays } from "../src/lib/milestones"
import { can, grantsFrom, overridesFrom } from "../src/lib/permissions"
import { getKind, type KindIntent, type NotificationOrg } from "../src/lib/notifications/registry"
import { scheduleProblem, slotDue } from "../src/lib/notifications/schedule"
import { dispatchNotifications, enqueueNotification } from "../src/lib/notifications/dispatch"
import { renderEmail } from "../src/lib/email-template"
import { computeOperationsReport } from "../src/lib/operations-report"
import { runScheduledEmails } from "../src/lib/scheduled-emails"
import {
  TASK_COMM_DEFAULT_SUBJECT,
  TASK_COMM_KIND,
  authorFirstName,
  hydrateTaskComm,
  renderTaskComm,
  taskCommKind,
  type TaskCommPayload,
} from "../src/lib/notifications/kinds/task-comm"
import { testKind, type TestPayload } from "../src/lib/notifications/kinds/test"
import { buildTaskCommSnapshot, loadTaskCommSettings, processTaskComm, reportedPeriod } from "../src/lib/task-comm-alerts"

let failures = 0
let checks = 0
function check(label: string, ok: boolean, detail = "") {
  checks += 1
  console.log(`${ok ? "✓" : "✗ FAIL"} ${label}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures += 1
}
const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i])

const ENV_KEYS = ["VERCEL_ENV", "NOTIFY_EMAIL_PROVIDER", "NOTIFY_SANDBOX_ALLOWLIST", "NEXT_PUBLIC_APP_URL"] as const
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
function restoreEnv() {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
}

function capture() {
  const sent: EmailMessage[] = []
  const sender: EmailSender = {
    async send(m) {
      sent.push(m)
      return { id: `n4-cap-${Math.random().toString(36).slice(2, 10)}` }
    },
  }
  return { sent, sender }
}
const toOf = (m: EmailMessage) => (Array.isArray(m.to) ? m.to.join(",") : m.to).toLowerCase()
const LIVE: DeliveryMode = "live"
const TZ = "America/Los_Angeles"

async function main() {
  const [{ branch }] = await prisma.$queryRaw<{ branch: string | null }[]>`SELECT current_setting('neon.branch_id', true) AS branch`
  // CLAUDE.md § Database Evidence: the branch travels with the result.
  console.log(`BRANCH neon.branch_id=${branch ?? "(null)"}\n`)

  process.env.NEXT_PUBLIC_APP_URL = "https://notify4.example.com"
  process.env.NOTIFY_EMAIL_PROVIDER = "console"
  delete process.env.VERCEL_ENV

  // ── 1. Pure: periods (A1, F4) ──────────────────────────────────────────────
  console.log("── 1. reportedPeriod — the period BEFORE the send day (A1, F4) ──")
  const pd = reportedPeriod("daily", "2026-03-01")
  check("daily on 2026-03-01 reports 2026-02-28", pd.from === "2026-02-28" && pd.to === "2026-02-28" && pd.key === "2026-02-28", JSON.stringify(pd))
  const pw = reportedPeriod("weekly", "2026-11-09")
  check("weekly on Mon 2026-11-09 reports Mon 11-02 – Sun 11-08, key 2026-W45", pw.from === "2026-11-02" && pw.to === "2026-11-08" && pw.key === "2026-W45", JSON.stringify(pw))
  const pw2 = reportedPeriod("weekly", "2026-11-12")
  check("weekly on Thu 2026-11-12 reports the same prior week", pw2.from === "2026-11-02" && pw2.key === "2026-W45", JSON.stringify(pw2))
  const pm = reportedPeriod("monthly", "2026-11-06")
  check("monthly in November reports October, key 2026-10", pm.from === "2026-10-01" && pm.to === "2026-10-31" && pm.key === "2026-10", JSON.stringify(pm))
  const pj = reportedPeriod("monthly", "2026-01-15")
  check("monthly in January reports the previous December", pj.from === "2025-12-01" && pj.to === "2025-12-31" && pj.key === "2025-12", JSON.stringify(pj))

  // ── 2. Pure: schedule default and floor (F4) ───────────────────────────────
  console.log("\n── 2. the schedule — default daily 7 AM Pacific, 5 AM floor (F4) ──")
  const spec = getKind(TASK_COMM_KIND)!.schedule!
  const anyDay = "2026-11-10"
  check("no row: 07:05 Pacific is due, daily", (() => { const d = slotDue(spec, null, zonedInstant(anyDay, "07:05", TZ)!, "UTC"); return d.due && d.frequency === "daily" && d.localDate === anyDay })())
  check("no row: 06:55 Pacific is NOT due", !slotDue(spec, null, zonedInstant(anyDay, "06:55", TZ)!, "UTC").due)
  const row = (sendHour: number) => ({ frequency: "daily", sendHour, daysOfWeek: [1, 2, 3, 4, 5, 6, 7], dayOfMonth: null, timeZone: TZ })
  check("a saved 5 AM row is usable (the floor)", scheduleProblem(spec, row(5)) === null)
  check("a saved 4 AM row is refused (below the floor)", scheduleProblem(spec, row(4)) !== null)
  check("offers daily, weekly and monthly (day of month)", spec.frequencies.join() === "daily,weekly,monthly" && spec.monthly === "day-of-month")

  // ── 3. The capability (F1, F2) ─────────────────────────────────────────────
  console.log("\n── 3. notify.taskcomm.receive (F1, F2) ──")
  const holds = (role: string, denied: string[] = [], granted: string[] = []) =>
    can({ role, overrides: overridesFrom(denied), grants: grantsFrom(granted) }, "notify.taskcomm.receive")
  check("ADMIN and MANAGER hold it at baseline", holds("ADMIN") && holds("MANAGER"))
  check("a denial removes it", !holds("MANAGER", ["notify.taskcomm.receive"]))
  check("STORE and STAFF never hold it, even with a grant written", !holds("STORE", [], ["notify.taskcomm.receive"]) && !holds("STAFF", [], ["notify.taskcomm.receive"]))

  // ── 4. Pure: template line breaks and author names (F5, rider) ─────────────
  console.log("\n── 4. template line breaks (F5) and author names (rider) ──")
  const base = { orgName: "O", heading: "H", rows: [], footer: "F" }
  const withBreak = renderEmail({ ...base, intro: "line one\nline <two>" }).html
  check("an intro line break renders as <br>, escaped first", withBreak.includes("line one<br>line &lt;two&gt;"))
  const noBreak = renderEmail({ ...base, intro: "plain intro" }).html
  check("an intro with no line break renders exactly as before", noBreak.includes(">plain intro</p>") && !noBreak.includes("<br>"))
  check("author: staff displayName's first word", authorFirstName("Maria Lopez") === "Maria")
  check("author: staff wins over the user's name", authorFirstName("Maria Lopez", "Priya Shah") === "Maria")
  check("author: no staff record → the user's first name (fix)", authorFirstName(null, "Priya Shah") === "Priya")
  check("author: neither → \"Team member\"", authorFirstName(null, null) === "Team member" && authorFirstName("  ", "  ") === "Team member")
  check("author: a name that is an email address is never used", authorFirstName(null, "notify4-x@example.com") === "Team member")

  // ── 5. Fixture rows ─────────────────────────────────────────────────────────
  const tag = Math.random().toString(36).slice(2, 8)
  const em = (k: string) => `notify4-${k}-${tag}@example.com`
  const now = new Date()
  const today = localDateStr(now, TZ)
  const D = addDays(today, -1) // the daily email's reported day
  const at = (date: string, hhmm: string) => zonedInstant(date, hhmm, TZ)!
  const civil = (date: string) => new Date(`${date}T00:00:00.000Z`)

  const org = await prisma.organization.create({
    data: { clerkOrgId: `notify4-fixture-${tag}`, name: "NOTIFY-4 Fixture Org (safe to delete)", timezone: TZ },
  })
  const orgId = org.id
  console.log(`\nFixture org ${orgId} · today ${today}, reported day ${D} (${TZ})\n`)

  try {
    const [A, B, C] = await Promise.all(
      ["A", "B", "C"].map((n) => prisma.store.create({ data: { organizationId: orgId, name: `NOTIFY-4 Store ${n}`, timezone: TZ } }))
    )
    const mkUser = (k: string, role: "ADMIN" | "MANAGER" | "STORE", stores: { id: string }[], denied: string[] = []) =>
      prisma.user.create({
        data: {
          organizationId: orgId,
          clerkUserId: `notify4-${k}-${tag}`,
          email: em(k),
          name: `NOTIFY-4 ${k}`,
          role,
          deniedCapabilities: denied,
          storeAssignments: { create: stores.map((s) => ({ storeId: s.id })) },
        },
      })
    const U = {
      admin: await mkUser("admin", "ADMIN", []),
      mgrA: await mkUser("mgr-a", "MANAGER", [A]),
      mgrB: await mkUser("mgr-b", "MANAGER", [B]),
      mgrDenied: await mkUser("mgr-denied", "MANAGER", [A], ["notify.taskcomm.receive"]),
      mgrNoReports: await mkUser("mgr-noreports", "MANAGER", [A], ["reports.view"]),
      storeLogin: await mkUser("store-a", "STORE", [A]),
    }
    // Message authors with no staff record (fix 2): a named user, a user with
    // no name, and a user whose name field holds an email address.
    const mkAuthor = (k: string, name: string | null) =>
      prisma.user.create({ data: { organizationId: orgId, clerkUserId: `notify4-${k}-${tag}`, email: em(k), name, role: "MANAGER", deniedCapabilities: ["notify.taskcomm.receive"] } })
    const W = {
      priya: await mkAuthor("author-priya", "Priya NOTIFY-4 Author"),
      noName: await mkAuthor("author-noname", null),
      emailName: await mkAuthor("author-emailname", em("author-emailname")),
    }
    const maria = await prisma.staffMember.create({
      data: { organizationId: orgId, displayName: "NOTIFY-4 Maria Lopez", fullName: "NOTIFY-4 Maria Lopez Fixture", startDate: civil(addDays(today, -200)), storeAssignments: { create: { storeId: A.id, isPrimary: true } } },
    })
    // authorFirstName takes the FIRST word, and the fixture prefixes names — so
    // the expected author label is "NOTIFY-4".
    const mariaLabel = "NOTIFY-4"

    const msg = (storeId: string, body: string, data: Record<string, unknown> = {}) =>
      prisma.teamMessage.create({ data: { organizationId: orgId, storeId, body: `NOTIFY-4 ${body} ${tag}`, createdAt: at(D, "10:00"), ...data } })
    const M = {
      opener: await msg(A.id, "opener note", { type: "shift_note", shiftPhase: "opening", authorStaffId: maria.id }),
      equipOpen: await msg(A.id, "blender grinding", { type: "equipment", status: "open", authorStaffId: maria.id }),
      equipDone: await msg(A.id, "fridge fixed", { type: "equipment", status: "resolved", authorStaffId: maria.id }),
      archived: await msg(A.id, "archived general", { type: "general", status: "archived", authorStaffId: maria.id }),
      byUser: await msg(A.id, "manager posted", { type: "general", authorUserId: W.priya.id }),
      byNoName: await msg(A.id, "nameless user posted", { type: "general", authorUserId: W.noName.id }),
      byEmailName: await msg(A.id, "email-named user posted", { type: "general", authorUserId: W.emailName.id }),
      deletedBefore: await msg(A.id, "deleted before snapshot", { type: "general", deletedAt: at(D, "11:00") }),
      deleteLater: await msg(A.id, "deleted after snapshot", { type: "general", authorStaffId: maria.id }),
      editLater: await msg(A.id, "original text", { type: "general", authorStaffId: maria.id }),
      outside: await msg(A.id, "two days ago", { type: "general", createdAt: at(addDays(D, -1), "10:00") }),
      bSecret: await msg(B.id, "B secret staffing", { type: "staffing", authorStaffId: maria.id }),
      // Fix 1: tickets from long before any period.
      iceMachine: await msg(A.id, "ice machine broken", { type: "equipment", status: "open", authorStaffId: maria.id, createdAt: at(addDays(today, -21), "09:00") }),
      oldShortage: await msg(A.id, "old cup shortage", { type: "shortage", status: "open", authorUserId: W.priya.id, createdAt: at(addDays(today, -30), "09:00") }),
      oldResolved: await msg(A.id, "old resolved freezer", { type: "equipment", status: "resolved", authorStaffId: maria.id, createdAt: at(addDays(today, -21), "09:00") }),
      oldDeleted: await msg(A.id, "old deleted oven", { type: "equipment", status: "open", deletedAt: at(addDays(today, -2), "09:00"), createdAt: at(addDays(today, -21), "09:00") }),
      bIce: await msg(B.id, "B ice machine", { type: "equipment", status: "open", authorStaffId: maria.id, createdAt: at(addDays(today, -21), "09:00") }),
    }
    await prisma.messageAttachment.create({ data: { kind: "image", url: "https://example.invalid/n4.png", messageId: M.opener.id } })

    const corp = (title: string, data: Record<string, unknown>) =>
      prisma.corporateUpdate.create({ data: { organizationId: orgId, authorUserId: U.admin.id, title: `NOTIFY-4 ${title} ${tag}`, body: `First line of ${title}\nsecond line`, ...data } })
    const CU = {
      all: await corp("all-stores update", { publishedAt: at(D, "09:00") }),
      bOnly: await corp("B-only update", { publishedAt: at(D, "09:30"), storeIds: [B.id] }),
      draft: await corp("draft update", { publishedAt: null }),
      deleted: await corp("deleted update", { publishedAt: at(D, "09:45"), deletedAt: at(D, "12:00") }),
    }

    // Checklists on D: A untouched (Missed, never started) → "did not attempt";
    // B completed; C only a WEEKLY template's untouched row → not flagged (F8:
    // Daily only).
    const daily = await prisma.template.create({ data: { organizationId: orgId, name: "NOTIFY-4 Daily", type: "Opening", frequency: "Daily" } })
    const weekly = await prisma.template.create({ data: { organizationId: orgId, name: "NOTIFY-4 Weekly", type: "Opening", frequency: "Weekly" } })
    await prisma.checklist.create({ data: { organizationId: orgId, templateId: daily.id, storeId: A.id, date: civil(D), status: "Missed", closedAt: at(today, "03:00"), completionRate: 0 } })
    await prisma.checklist.create({ data: { organizationId: orgId, templateId: daily.id, storeId: B.id, date: civil(D), status: "Completed", startedAt: at(D, "07:00"), completedAt: at(D, "08:00"), completionRate: 1, closedAt: null } })
    await prisma.checklist.create({ data: { organizationId: orgId, templateId: weekly.id, storeId: C.id, date: civil(D), status: "Missed", closedAt: at(today, "03:00"), completionRate: 0 } })

    // Contacts: one with no user (org-wide), one matching mgrA, one matching the store login.
    const mkContact = (k: string, email: string) => prisma.notificationContact.create({ data: { organizationId: orgId, name: `NOTIFY-4 ${k}`, email } })
    const K = {
      outside: await mkContact("outside contact", em("contact-outside")),
      asMgrA: await mkContact("contact = mgr A", U.mgrA.email.toUpperCase()),
      asStore: await mkContact("contact = store login", U.storeLogin.email),
    }
    for (const c of Object.values(K)) await prisma.notificationRecipientPick.create({ data: { organizationId: orgId, kind: TASK_COMM_KIND, contactId: c.id } })

    // ── 6. Operations report extraction (F9) ──────────────────────────────────
    console.log("── 6. computeOperationsReport — the Operations Report's definition (F9) ──")
    const ops = await computeOperationsReport({ organizationId: orgId, stores: [A, B, C], from: D, to: D, now })
    const oa = ops.byStore.get(A.id), ob = ops.byStore.get(B.id)
    check("Store A: 1 tracked, 0 completed, 1 missed", oa?.total === 1 && oa.completed === 0 && oa.missed === 1, JSON.stringify(oa))
    check("Store B: 1 tracked, 1 completed", ob?.total === 1 && ob.completed === 1, JSON.stringify(ob))
    check("Store C's unscheduled weekly row is excluded, not counted", !ops.byStore.get(C.id) && ops.excludedUnscheduled === 1)

    // ── 7. Disabled → nothing ────────────────────────────────────────────────
    console.log("\n── 7. off by default (F4: OFF for every org) ──")
    const off = await processTaskComm({ sender: capture().sender, mode: LIVE, now, organizationId: orgId, frequency: "daily", localDate: today, timeZone: TZ })
    check("no settings row → skipped as disabled, nothing enqueued", off.skipped === "disabled" && (await prisma.notificationIntent.count({ where: { organizationId: orgId } })) === 0)
    await prisma.notificationKindSettings.create({ data: { organizationId: orgId, kind: TASK_COMM_KIND, enabled: true } })

    // ── 8. The snapshot (F3, riders) ─────────────────────────────────────────
    console.log("\n── 8. the snapshot — scopes, ids only (F3, riders) ──")
    const settings = await loadTaskCommSettings(orgId)
    const { payload } = await buildTaskCommSnapshot({ organizationId: orgId, frequency: "daily", localDate: today, timeZone: TZ, now, settings })
    const viewOf = (email: string) => payload.views[payload.scopes[email.toLowerCase()]]
    check("period is yesterday Pacific", payload.periodKey === D && payload.frequency === "daily", payload.periodKey)
    check("ADMIN's view is every store", sameSet(viewOf(U.admin.email)?.storeIds ?? [], [A.id, B.id, C.id]))
    check("manager A's view is Store A only", sameSet(viewOf(U.mgrA.email)?.storeIds ?? [], [A.id]))
    check("manager B's view is Store B only", sameSet(viewOf(U.mgrB.email)?.storeIds ?? [], [B.id]))
    check("a contact with no user gets the org-wide view (F3)", sameSet(viewOf(K.outside.email)?.storeIds ?? [], [A.id, B.id, C.id]))
    check("NEGATIVE: the contact matching manager A gets manager A's view, never wider (rider)", payload.scopes[U.mgrA.email.toLowerCase()] === payload.scopes[K.asMgrA.email.toLowerCase()] && sameSet(viewOf(K.asMgrA.email)?.storeIds ?? [], [A.id]))
    check("manager without reports.view: no performance section in their view", viewOf(U.mgrNoReports.email)?.reports === false)
    check("Store A did not attempt on the reported day; B and C did not get flagged", sameSet(payload.notAttempted[A.id] ?? [], [D]) && !payload.notAttempted[B.id] && !payload.notAttempted[C.id])
    check("Store A is below 90% (0%); Store B is not (100%)", payload.performance[A.id]?.below === true && payload.performance[B.id]?.below === false && payload.thresholdPct === 90)
    const aIds = payload.messageIdsByStore[A.id] ?? []
    check(
      "Store A's ids: the period's live messages; not the pre-deleted one, not the one outside the window",
      [M.opener, M.equipOpen, M.equipDone, M.archived, M.byUser, M.deleteLater, M.editLater].every((m) => aIds.includes(m.id)) && !aIds.includes(M.deletedBefore.id) && !aIds.includes(M.outside.id)
    )
    check("admin sees both published updates in the window; draft and deleted absent", sameSet(viewOf(U.admin.email)?.corporateIds ?? [], [CU.all.id, CU.bOnly.id]))
    check("NEGATIVE: manager A does not see the B-only update", sameSet(viewOf(U.mgrA.email)?.corporateIds ?? [], [CU.all.id]))
    const raw = JSON.stringify(payload)
    check("RIDER: the payload holds no message body and no update text", !raw.includes("B secret staffing") && !raw.includes("opener note") && !raw.includes("First line of"))

    // ── 9. Enqueue, mutate after the snapshot, dispatch (rider: text at send time) ──
    console.log("\n── 9. dispatch — text looked up at send time ──")
    const enq = await enqueueNotification({ organizationId: orgId, kind: TASK_COMM_KIND, dedupeKey: `${orgId}:${payload.periodKey}`, entityId: null, eventAt: now, payload })
    await prisma.teamMessage.update({ where: { id: M.deleteLater.id }, data: { deletedAt: new Date() } })
    await prisma.teamMessage.update({ where: { id: M.editLater.id }, data: { body: `NOTIFY-4 edited text ${tag}`, editedAt: new Date() } })
    const cap = capture()
    const [res] = await dispatchNotifications({ transport: { mode: LIVE, sender: () => cap.sender }, trigger: "producer", organizationId: orgId, intentIds: [enq!.intentId], now })
    const recipients = cap.sent.map(toOf)
    check(
      "recipients: admin, both managers, the no-reports manager, the outside contact (one email each)",
      sameSet(recipients, [U.admin.email, U.mgrA.email, U.mgrB.email, U.mgrNoReports.email, K.outside.email].map((e) => e.toLowerCase())),
      recipients.join(" ")
    )
    check("NEGATIVE: the denied manager gets nothing", !recipients.includes(U.mgrDenied.email.toLowerCase()))
    check("NEGATIVE: the store login, picked as a contact, gets nothing", !recipients.includes(U.storeLogin.email.toLowerCase()))
    check("the intent is sent", res?.outcome === "sent" || (await prisma.notificationIntent.findUnique({ where: { id: enq!.intentId } }))?.state === "sent")
    const mail = (e: string) => cap.sent.find((m) => toOf(m) === e.toLowerCase())
    const textOf = (e: string) => `${mail(e)?.text ?? ""}\n${mail(e)?.html ?? ""}`
    const tA = textOf(U.mgrA.email), tAdmin = textOf(U.admin.email), tOut = textOf(K.outside.email), tNoRep = textOf(U.mgrNoReports.email)
    check("subject is Gary's default (F5)", mail(U.admin.email)?.subject === TASK_COMM_DEFAULT_SUBJECT, mail(U.admin.email)?.subject)
    check("manager A's email lists Store A's messages", tA.includes("opener note") && tA.includes("blender grinding"))
    check("NEGATIVE: manager A's email does NOT contain Store B's message", !tA.includes("B secret staffing"))
    check("NEGATIVE: manager A's email does NOT contain the B-only update", !tA.includes("B-only update"))
    check("admin's and the outside contact's emails contain Store B's message", tAdmin.includes("B secret staffing") && tOut.includes("B secret staffing"))
    check("corporate update: title and first line (F7)", tAdmin.includes("all-stores update") && tAdmin.includes("First line of all-stores update"))
    check("a message deleted after the snapshot is absent at send (rider)", !tAdmin.includes("deleted after snapshot"))
    check("an edit after the snapshot shows the current text (rider)", tAdmin.includes("edited text") && !tAdmin.includes("original text"))
    check("equipment shows [Open] and [Resolved]; archived shows [Archived] (F6)", tAdmin.includes("[Open] NOTIFY-4 blender") && tAdmin.includes("[Resolved] NOTIFY-4 fridge") && tAdmin.includes("[Archived] NOTIFY-4 archived"))
    check("attachments shown as +N (F6)", tAdmin.includes("(+1 attachment)"))
    check("author: staff first name in the email (rider)", tAdmin.includes(`· ${mariaLabel}`))
    check("author: a user with no staff record shows the user's first name (fix)", tAdmin.includes("· Priya"))
    check("author: a nameless user and an email-named user both read \"Team member\" (fix)", (tAdmin.match(/· Team member/g) ?? []).length >= 4)
    check("daily: a three-week-old open ticket is NOT itemised (fix 1 is weekly/monthly only)", !tAdmin.includes("ice machine broken") && !tAdmin.includes("old cup shortage"))
    check("daily: the payload carries no open-ticket list", Object.keys(payload.openTicketIdsByStore).length === 0)
    check("no author label is built from an email address (rider)", !/·\s*notify4-/.test(tAdmin))
    check("did-not-attempt sentence for Store A (F8)", tA.includes("NOTIFY-4 Store A did not attempt any daily checklist for this day."))
    check("the holiday caveat is on the email (F8)", tA.includes("Froot does not yet record store closures by date"))
    check("store performance: Store A flagged below 90%, listed before B (F9)", tAdmin.includes("NOTIFY-4 Store A (below 90%)") && tAdmin.indexOf("Store A (below 90%)") < tAdmin.indexOf("NOTIFY-4 Store B:"))
    check("NEGATIVE: the manager without reports.view gets no store performance", tNoRep.length > 10 && !tNoRep.includes("Store performance"))
    const stored = await prisma.notificationIntent.findUnique({ where: { id: enq!.intentId }, select: { payload: true } })
    const storedRaw = JSON.stringify(stored?.payload)
    check("RIDER: the STORED intent payload holds no text after send", !storedRaw.includes("B secret staffing") && !storedRaw.includes("edited text") && !storedRaw.includes("lookup"))

    // ── 10. A second run in the same period mails nobody ─────────────────────
    console.log("\n── 10. one email per recipient per period (F3) ──")
    const cap2 = capture()
    const again = await processTaskComm({ sender: cap2.sender, mode: LIVE, now, organizationId: orgId, frequency: "daily", localDate: today, timeZone: TZ })
    check("same period again: intent already sent, no mail", again.intentState === "sent" && cap2.sent.length === 0, JSON.stringify(again))

    // ── 11. Settings: role boxes, copy, threshold (F2, F5, F9) ────────────────
    console.log("\n── 11. settings — role boxes, copy, threshold ──")
    await prisma.notificationKindSettings.update({
      where: { organizationId_kind: { organizationId: orgId, kind: TASK_COMM_KIND } },
      data: { sendToManagers: false, subject: "NOTIFY-4 custom subject", body: "Line one\nLine two", thresholdPct: 50 },
    })
    const s2 = await loadTaskCommSettings(orgId)
    const orgView = { ...(org as unknown as NotificationOrg), kindSettings: { [TASK_COMM_KIND]: s2! } }
    const ki = { id: "x", organizationId: orgId, kind: TASK_COMM_KIND, dedupeKey: "x", entityId: null, eventAt: now, payload } as KindIntent<TaskCommPayload>
    const rr = await (taskCommKind as unknown as { resolveRecipients: (i: KindIntent<TaskCommPayload>, o: NotificationOrg) => Promise<{ email: string }[]> }).resolveRecipients(ki, orgView)
    check("Managers box off: the role default is admins only (F2)", sameSet(rr.map((r) => r.email.toLowerCase()), [U.admin.email.toLowerCase()]))
    const snap2 = await buildTaskCommSnapshot({ organizationId: orgId, frequency: "daily", localDate: today, timeZone: TZ, now, settings: s2 })
    check("Managers box off: no manager in the scope map, the matching contact keeps manager A's own view", !snap2.payload.scopes[U.mgrB.email.toLowerCase()] && sameSet(snap2.payload.views[snap2.payload.scopes[K.asMgrA.email.toLowerCase()]]?.storeIds ?? [], [A.id]))
    check("threshold 50: Store A (0%) still below, recorded as 50", snap2.payload.thresholdPct === 50 && snap2.payload.performance[A.id]?.below === true)
    const h2 = await hydrateTaskComm(snap2.payload, orgId)
    const adminView = h2.views[h2.scopes[U.admin.email.toLowerCase()]]
    const r2 = renderTaskComm(h2, adminView, org.name, s2)
    check("custom subject used (F5)", r2.subject === "NOTIFY-4 custom subject")
    check("custom body's line break survives into the HTML (F5)", "html" in r2 && !!r2.html?.includes("Line one<br>Line two"))

    // ── 12. Preview (F11) ─────────────────────────────────────────────────────
    console.log("\n── 12. preview — as a manager (F11) ──")
    const pv = await buildTaskCommSnapshot({ organizationId: orgId, frequency: "daily", localDate: today, timeZone: TZ, now, settings: s2, previewUserId: U.mgrA.id })
    check("preview builds one view for manager A and maps no address", sameSet(pv.payload.views[pv.previewViewKey!]?.storeIds ?? [], [A.id]) && Object.keys(pv.payload.scopes).length === 0)
    const tp: TestPayload = { to: U.admin.email, provider: "console", stamp: "x", deployEnv: "local", sha: "x", taskCommPreview: { payload: pv.payload, viewKey: pv.previewViewKey! } }
    const tk = testKind as unknown as {
      hydrate: (p: TestPayload, o: NotificationOrg) => Promise<TestPayload>
      render: (p: TestPayload, o: NotificationOrg, to: string) => { subject: string; text?: string }
    }
    const pr = tk.render(await tk.hydrate(tp, orgView), orgView, U.admin.email)
    check("preview subject is the real one with \"Test — \" in front", pr.subject === "Test — NOTIFY-4 custom subject", pr.subject)
    check("NEGATIVE: a manager-view preview shows no Store B message", !!pr.text && pr.text.includes("opener note") && !pr.text.includes("B secret staffing"))

    // ── 12b. Weekly and monthly: every open ticket, any age (fix 1) ────────────
    console.log("\n── 12b. weekly/monthly — every ticket still open at send time, any age (fix 1) ──")
    const wkAll = await buildTaskCommSnapshot({ organizationId: orgId, frequency: "weekly", localDate: today, timeZone: TZ, now, settings: s2, previewUserId: null })
    const wkA = await buildTaskCommSnapshot({ organizationId: orgId, frequency: "weekly", localDate: today, timeZone: TZ, now, settings: s2, previewUserId: U.mgrA.id })
    const ticketsA = wkAll.payload.openTicketIdsByStore[A.id] ?? []
    check(
      "weekly snapshot: Store A's open tickets include the 21- and 30-day-old ones",
      [M.iceMachine, M.oldShortage, M.equipOpen].every((m) => ticketsA.includes(m.id))
    )
    check("weekly snapshot: no resolved or deleted ticket", ![M.oldResolved, M.oldDeleted, M.equipDone].some((m) => ticketsA.includes(m.id)))
    check("weekly snapshot: Store B's old open ticket is under Store B", (wkAll.payload.openTicketIdsByStore[B.id] ?? []).includes(M.bIce.id))
    const mo = await buildTaskCommSnapshot({ organizationId: orgId, frequency: "monthly", localDate: today, timeZone: TZ, now, settings: s2, previewUserId: null })
    check("monthly snapshot: the ice machine is there too", (mo.payload.openTicketIdsByStore[A.id] ?? []).includes(M.iceMachine.id))
    // Resolved AFTER the snapshot, before the send: must drop out ("still open at send time").
    await prisma.teamMessage.update({ where: { id: M.oldShortage.id }, data: { status: "resolved", resolvedAt: new Date() } })
    const hA = await hydrateTaskComm(wkA.payload, orgId)
    const wA = renderTaskComm(hA, hA.views[wkA.previewViewKey!], org.name, s2)
    const wAt = "text" in wA ? wA.text : ""
    check("manager A's weekly email shows the three-week-old ice machine, marked opened", wAt.includes("ice machine broken") && /opened [A-Z][a-z]{2} \d+ · NOTIFY-4/.test(wAt), wAt.split("\n").find((l) => l.includes("ice machine")) ?? "")
    check("NEGATIVE: a ticket resolved after the snapshot is absent at send", !wAt.includes("old cup shortage"))
    check("NEGATIVE: an old resolved ticket is absent", !wAt.includes("old resolved freezer"))
    check("NEGATIVE: manager A's weekly email does NOT show Store B's open ticket", !wAt.includes("B ice machine"))
    const hAll = await hydrateTaskComm(wkAll.payload, orgId)
    const wAll = renderTaskComm(hAll, hAll.views[wkAll.previewViewKey!], org.name, s2)
    check("the org-wide weekly email shows Store B's old open ticket", "text" in wAll && !!wAll.text?.includes("B ice machine"))
    check("RIDER: the weekly payload holds no ticket text", !JSON.stringify(wkAll.payload).includes("ice machine"))

    // ── 13. The hourly runner leg ─────────────────────────────────────────────
    console.log("\n── 13. runScheduledEmails — the Tasks and Communication leg ──")
    const tomorrow = addDays(today, 1)
    const r0 = await runScheduledEmails({ sender: capture().sender, mode: LIVE, now: at(tomorrow, "06:05"), organizationId: orgId })
    check("06:05 Pacific: not due", Array.isArray(r0.taskComm) && r0.taskComm.length === 0 && r0.taskCommOrgsNotDue === 1)
    const cap3 = capture()
    const r1 = await runScheduledEmails({ sender: cap3.sender, mode: LIVE, now: at(tomorrow, "07:05"), organizationId: orgId })
    const t1 = Array.isArray(r1.taskComm) ? r1.taskComm[0] : undefined
    check("07:05 Pacific: runs once, reports today as the period", t1?.periodKey === today && t1?.error === undefined, JSON.stringify(t1))
    check("Managers box still off: only the admin and the two contacts' addresses", sameSet(cap3.sent.map(toOf), [U.admin.email, U.mgrA.email, K.outside.email].map((e) => e.toLowerCase())), cap3.sent.map(toOf).join(" "))
    const r1b = await runScheduledEmails({ sender: capture().sender, mode: LIVE, now: at(tomorrow, "08:05"), organizationId: orgId })
    check("08:05 Pacific: already run (run marker)", r1b.taskCommOrgsAlreadyRun === 1)
  } finally {
    restoreEnv()
    const ints = await prisma.notificationIntent.findMany({ where: { organizationId: orgId }, select: { id: true } })
    await prisma.notificationDelivery.deleteMany({ where: { intentId: { in: ints.map((i) => i.id) } } })
    await prisma.notificationMessage.deleteMany({ where: { organizationId: orgId } })
    await prisma.notificationIntent.deleteMany({ where: { organizationId: orgId } })
    await prisma.notificationScheduleRun.deleteMany({ where: { organizationId: orgId } })
    await prisma.notificationSchedule.deleteMany({ where: { organizationId: orgId } })
    await prisma.notificationKindSettings.deleteMany({ where: { organizationId: orgId } })
    await prisma.auditLog.deleteMany({ where: { organizationId: orgId } })
    await prisma.notificationRecipientPick.deleteMany({ where: { organizationId: orgId } })
    await prisma.notificationContact.deleteMany({ where: { organizationId: orgId } })
    await prisma.messageAttachment.deleteMany({ where: { OR: [{ message: { organizationId: orgId } }, { corporateUpdate: { organizationId: orgId } }] } })
    await prisma.teamMessage.deleteMany({ where: { organizationId: orgId } })
    await prisma.corporateUpdate.deleteMany({ where: { organizationId: orgId } })
    await prisma.taskLog.deleteMany({ where: { checklist: { organizationId: orgId } } })
    await prisma.checklist.deleteMany({ where: { organizationId: orgId } })
    await prisma.template.deleteMany({ where: { organizationId: orgId } })
    await prisma.storeStaffAssignment.deleteMany({ where: { staffMember: { organizationId: orgId } } })
    await prisma.staffMember.deleteMany({ where: { organizationId: orgId } })
    await prisma.storeUserAssignment.deleteMany({ where: { user: { organizationId: orgId } } })
    await prisma.user.deleteMany({ where: { organizationId: orgId } })
    await prisma.store.deleteMany({ where: { organizationId: orgId } })
    await prisma.organization.delete({ where: { id: orgId } })
    const left = await prisma.organization.count({ where: { id: orgId } })
    check("cleanup: the fixture org is gone (re-queried)", left === 0)
  }

  console.log(`\n${checks - failures}/${checks} passed${failures ? ` — ${failures} FAILED` : ""}`)
  if (failures) process.exitCode = 1
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
