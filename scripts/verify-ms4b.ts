/**
 * MS-4b acceptance fixture — milestone emails as the first grouped kind on the
 * NOTIFY-6 pipeline.
 *
 *   npx tsx scripts/verify-ms4b.ts
 *
 * Runs against the DEV database (local .env). Creates one throwaway org,
 * "MS-4b Fixture Org (safe to delete)", with two stores, seven users and a
 * dozen staff members named "MS-4b Staff …", drives the REAL producer
 * (processMilestoneAlerts) and the REAL dispatcher on a fixed clock, and
 * deletes everything afterwards. Resend is never contacted: every transport is
 * an in-process capture sender.
 *
 *   A. Producer + DRY-RUN: within 7 days → queued, eventAt = the store-local
 *      midnight of the reach date; more than 7 days → known; terminated staff,
 *      archived milestones and (with F13 off) checklist milestones → nothing.
 *      Dry-run writes ONE message per recipient, listing exactly their
 *      milestones (intentIds), consumes nothing (queued, zero deliveries), and
 *      a rerun logs nothing new.
 *   B. Recipients: ADMIN gets everything; a MANAGER only their stores'; a
 *      corporate member → ADMINs only; the grid switch-off is respected; a STORE
 *      login never; the employee never — by linked account AND by email; a
 *      manager never about themselves.
 *   C. SANDBOX: only the allow-listed address is mailed, ONE summary; the
 *      intents stay queued with zero deliveries (R1); the sweep sends nothing
 *      (R2).
 *   D. LIVE: one email per recipient, listing every new milestone; intents
 *      `sent`; one delivery per (milestone, recipient) pointing at that email;
 *      a rerun sends nothing; the 7-day boundary sends; `known` is never sent.
 *      F7: no pay / rate / raise / wage text; the suggested message is the
 *      stored one, verbatim; each milestone links its ?tab=milestones.
 *   E. F13: checklist switch on → the checklist milestone sends; a count that
 *      drops and recovers never resends.
 *   F. P6 on a summary: one recipient fails → partial; the sweep retries ONLY
 *      that recipient, once; nobody gets it twice.
 *   G. C3: the sweep never makes a grouped FIRST send; org switch off →
 *      expired, no mail.
 *   H. Time: a re-enqueue a day later keeps eventAt; a dry-run intent expires
 *      by freshness (8 days, N2) and is never sent or marked known later.
 *   I. The sample: renders through the test kind, reaches only the caller,
 *      subject "Test — …", fictional names; per-intent rows unchanged
 *      (intentId set, intentIds empty).
 *   J. SKIPPED DAYS (Gary, 2026-10-19). The producer keeps no "new since last
 *      run" list — every run recounts — so an outage loses nothing inside the
 *      window. Reached on D, no run on D+1 or D+2, run on D+3 → sent once, and
 *      D+4 does not resend. Down until D+7 → still sent. Down until D+8 →
 *      recorded known, not sent, and still not sent the day after. Each person
 *      is first seen by the producer on the late day, and each reach date is in
 *      the future at every earlier run, so no earlier run can have sent it.
 *
 * NEGATIVE CONTROLS (run by the build session, recorded in the report):
 *   - delete the matching-email test from `exclude` in kinds/milestone.ts — B's
 *     "by email" check must FAIL;
 *   - in src/lib/milestone-alerts.ts, judge the window with `>=` instead of
 *     `>` (so exactly 7 days is known) — J3 must FAIL;
 *   - set MILESTONE_SEND_WINDOW_DAYS to 0, i.e. a run announces only what was
 *     reached that day (the "new since the last run" shape) — J1 must FAIL.
 */
import "dotenv/config"
import { prisma } from "../src/lib/prisma"
import { localDateStr, dbDate } from "../src/lib/reports"
import { addDays } from "../src/lib/milestones"
import { localMidnightUtc } from "../src/lib/sales-sync"
import type { DeliveryMode, EmailMessage, EmailSender } from "../src/lib/notify"
import { dispatchNotifications, enqueueNotification, type Transport } from "../src/lib/notifications/dispatch"
import { getKind } from "../src/lib/notifications/registry"
import { MILESTONE_KIND, MILESTONE_FRESHNESS_MINUTES } from "../src/lib/notifications/kinds/milestone"
import { sampleableKinds, type TestPayload } from "../src/lib/notifications/kinds/test"
import { processMilestoneAlerts } from "../src/lib/milestone-alerts"
import { can, isGrantable, overridesFrom, ENFORCED_CAPABILITIES, type PermissionRole } from "../src/lib/permissions"

const TZ = "America/Los_Angeles"
const HOUR = 3_600_000
const DAY = 24 * HOUR
// 15:00 UTC = 08:00 PDT, the cron's own hour.
const NOW = new Date("2026-10-19T15:00:00.000Z")
const TODAY = localDateStr(NOW, TZ)

let failures = 0
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${label}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures += 1
}

const ENV_KEYS = ["HR_MODULE_AVAILABLE", "NOTIFY_SANDBOX_ALLOWLIST", "NEXT_PUBLIC_APP_URL", "NOTIFY_EMAIL_PROVIDER"] as const
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
function restoreEnv() {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
}

type Capture = { sent: EmailMessage[]; sender: EmailSender }
function capture(failFor: string[] = []): Capture {
  const sent: EmailMessage[] = []
  const fail = new Set(failFor.map((s) => s.toLowerCase()))
  return {
    sent,
    sender: {
      async send(m) {
        const to = Array.isArray(m.to) ? m.to.join(",") : m.to
        if (fail.has(to.toLowerCase())) throw new Error(`fixture: ${to} refused`)
        sent.push(m)
        return { id: `ms4b-cap-${Math.random().toString(36).slice(2, 10)}` }
      },
    },
  }
}
const tp = (mode: DeliveryMode, cap: Capture): Transport => ({ mode, sender: () => cap.sender })
const run = (mode: DeliveryMode, cap: Capture, orgId: string, now = NOW) =>
  processMilestoneAlerts({ sender: cap.sender, mode, now, organizationId: orgId })
const to = (m: EmailMessage) => (Array.isArray(m.to) ? m.to[0] : m.to)
const same = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|")

async function main() {
  process.env.HR_MODULE_AVAILABLE = "true"
  process.env.NEXT_PUBLIC_APP_URL = "https://ms4b.example.com"
  delete process.env.NOTIFY_SANDBOX_ALLOWLIST

  const tag = Math.random().toString(36).slice(2, 8)
  const org = await prisma.organization.create({
    data: {
      clerkOrgId: `ms4b-fixture-${tag}`,
      name: "MS-4b Fixture Org (safe to delete)",
      timezone: TZ,
      activeModules: ["hr"],
      milestonesEnabled: true,
      milestoneAlertsEnabled: true,
    },
  })
  const [{ branch }] = await prisma.$queryRaw<{ branch: string | null }[]>`SELECT current_setting('neon.branch_id', true) AS branch`
  console.log(`branch ${branch ?? "(null — not Neon)"} · org ${org.id} · today ${TODAY} (${TZ}) · now ${NOW.toISOString()}`)

  try {
    // ── Structure ──────────────────────────────────────────────────────────
    const def = getKind(MILESTONE_KIND)
    check("S1 registry: milestone.reached is grouped, 8-day freshness (N2)", def?.batch === "per-recipient-daily" && def.freshnessMinutes === 11520 && MILESTONE_FRESHNESS_MINUTES === 11520)
    const holds = (role: PermissionRole) => can({ role, overrides: overridesFrom([]) }, "notify.milestone.receive")
    check("S2 capability baseline ADMIN + MANAGER, never STORE/STAFF", holds("ADMIN") && holds("MANAGER") && !holds("STORE") && !holds("STAFF"))
    check("S3 not grantable to STORE/STAFF", !isGrantable("notify.milestone.receive", "STORE") && !isGrantable("notify.milestone.receive", "STAFF"))
    const row = ENFORCED_CAPABILITIES.find((e) => e.capability === "notify.milestone.receive")
    check("S4 grid line \"Milestone reached\" under Email notifications", row?.label === "Milestone reached" && row.area === "Email notifications")
    check("S5 the milestone kind is sampleable", sampleableKinds().includes(MILESTONE_KIND))

    // ── Fixture rows ───────────────────────────────────────────────────────
    const [storeA, storeB] = await Promise.all(
      ["A", "B"].map((x) =>
        prisma.store.create({ data: { organizationId: org.id, name: `MS-4b Store ${x}`, timezone: TZ, squareLocationId: `ms4b-${x}-${tag}` } })
      )
    )
    const user = (key: string, role: "ADMIN" | "MANAGER" | "STORE", extra: { deniedCapabilities?: string[] } = {}) =>
      prisma.user.create({
        data: { clerkUserId: `ms4b-${key}-${tag}`, organizationId: org.id, email: `ms4b-${key}-${tag}@example.com`, role, ...extra },
      })
    const adm = await user("admin", "ADMIN")
    const mA = await user("mgr-a", "MANAGER")
    const mB = await user("mgr-b", "MANAGER")
    const mDenied = await user("mgr-denied", "MANAGER", { deniedCapabilities: ["notify.milestone.receive"] })
    const mSelf = await user("mgr-self", "MANAGER")
    const mSelfEmail = await user("mgr-selfemail", "MANAGER")
    const sA = await user("store-a", "STORE")
    for (const [u, s] of [[mA, storeA], [mB, storeB], [mDenied, storeA], [mSelf, storeA], [mSelfEmail, storeA], [sA, storeA]] as const) {
      await prisma.storeUserAssignment.create({ data: { userId: u.id, storeId: s.id } })
    }

    const tenure30 = await prisma.tenureMilestone.create({
      data: { organizationId: org.id, dayCount: 30, title: "MS-4b Thirty days", recognition: "MS-4b team shout-out", employeeMessage: "MS-4b: thank you for a great first month!" },
    })
    // Archived TODAY: anyone who reached it before today keeps it as history —
    // and history is never announced.
    const tenure31 = await prisma.tenureMilestone.create({
      data: { organizationId: org.id, dayCount: 31, title: "MS-4b Archived 31", recognition: "", employeeMessage: "", isArchived: true, archivedAt: NOW },
    })
    const checklist2 = await prisma.checklistMilestone.create({
      data: { organizationId: org.id, taskCount: 2, title: "MS-4b Two tasks", recognition: "MS-4b checklist cheer", employeeMessage: "MS-4b: two tasks done!" },
    })

    const staff = (name: string, reachedDaysAgo: number, storeId: string, extra: Record<string, unknown> = {}) =>
      prisma.staffMember.create({
        data: {
          organizationId: org.id,
          displayName: `MS-4b Staff ${name}`,
          startDate: dbDate(addDays(TODAY, -(30 + reachedDaysAgo))),
          storeAssignments: { create: [{ storeId, isPrimary: true }] },
          ...extra,
        },
      })
    const ana = await staff("Ana", 0, storeA.id)
    const ben = await staff("Ben", 3, storeB.id)
    const cara = await staff("Cara", 7, storeA.id) // the boundary: exactly 7 days → sends
    const dan = await staff("Dan", 8, storeA.id) // 8 days → known
    const corp = await staff("Corp", 0, storeA.id, { isCorporate: true })
    const selfLinked = await staff("SelfLinked", 0, storeA.id, { userId: mSelf.id })
    const selfEmail = await staff("SelfEmail", 0, storeA.id, { email: `  MS4B-MGR-SELFEMAIL-${tag.toUpperCase()}@EXAMPLE.COM ` })
    const term = await staff("Term", 0, storeA.id, { status: "TERMINATED", terminatedAt: NOW })

    // Ana's two named tasks — the checklist milestone (switch OFF for now).
    const template = await prisma.template.create({ data: { organizationId: org.id, name: "MS-4b Template", type: "Opening" } })
    const tasks = await Promise.all([0, 1].map((i) => prisma.task.create({ data: { templateId: template.id, sectionName: "MS-4b", description: `MS-4b task ${i}` } })))
    const checklist = await prisma.checklist.create({ data: { organizationId: org.id, templateId: template.id, storeId: storeA.id, date: dbDate(TODAY) } })
    await prisma.taskLog.create({ data: { checklistId: checklist.id, taskId: tasks[0].id, completedByStaffId: ana.id, completedAt: new Date("2026-10-18T17:00:00.000Z") } })
    const secondTask = await prisma.taskLog.create({ data: { checklistId: checklist.id, taskId: tasks[1].id, completedByStaffId: ana.id, completedAt: new Date("2026-10-19T14:00:00.000Z") } })

    const key = (staffId: string, kind = "tenure", mid = tenure30.id) => `${staffId}:${kind}:${mid}`
    const intentOf = (staffId: string, kind = "tenure", mid = tenure30.id) =>
      prisma.notificationIntent.findUnique({
        where: { organizationId_kind_dedupeKey: { organizationId: org.id, kind: MILESTONE_KIND, dedupeKey: key(staffId, kind, mid) } },
      })
    const msgs = (where: Record<string, unknown> = {}) =>
      prisma.notificationMessage.findMany({ where: { organizationId: org.id, kind: MILESTONE_KIND, ...where }, orderBy: { createdAt: "asc" } })

    const E = (u: { email: string }) => u.email.toLowerCase()
    const expected: Record<string, string[]> = {
      [E(adm)]: [ana.id, ben.id, cara.id, corp.id, selfLinked.id, selfEmail.id],
      [E(mA)]: [ana.id, cara.id, selfLinked.id, selfEmail.id],
      [E(mB)]: [ben.id],
      [E(mSelf)]: [ana.id, cara.id, selfEmail.id],
      [E(mSelfEmail)]: [ana.id, cara.id, selfLinked.id],
    }
    const tenureQueued = [ana, ben, cara, corp, selfLinked, selfEmail]

    // ── A. Producer + dry-run ──────────────────────────────────────────────
    const dry = capture()
    const [rA] = await run("dry-run", dry, org.id)
    check("A1 producer: 6 queued, 1 known", rA?.queued === 6 && rA.known === 1, JSON.stringify(rA))
    const queuedRows = await Promise.all(tenureQueued.map((s) => intentOf(s.id)))
    check("A2 within 7 days → queued", queuedRows.every((i) => i?.state === "queued"))
    check("A3 more than 7 days → known", (await intentOf(dan.id))?.state === "known")
    check(
      "A4 eventAt = store-local midnight of the reach date (ruling 2), never the run time",
      queuedRows[0]!.eventAt.getTime() === localMidnightUtc(TODAY, TZ).getTime() &&
        queuedRows[2]!.eventAt.getTime() === localMidnightUtc(addDays(TODAY, -7), TZ).getTime()
    )
    check("A5 terminated staff → no intent (F9)", (await intentOf(term.id)) === null)
    check("A6 archived milestone → no intent (F9)", (await prisma.notificationIntent.count({ where: { organizationId: org.id, dedupeKey: { endsWith: tenure31.id } } })) === 0)
    check("A7 checklist switch off → no checklist intent at all (F13)", (await intentOf(ana.id, "checklist", checklist2.id)) === null)
    const payloadKeys = Object.keys(queuedRows[0]!.payload as object).sort().join(",")
    check(
      "A8 payload carries no pay field (F7)",
      payloadKeys === "employeeMessage,milestoneId,milestoneKind,reachedOn,recognition,staffMemberId,staffName,storeName,thresholdLabel,title",
      payloadKeys
    )
    const dryMsgs = await msgs({ mode: "dry-run" })
    check("A9 dry-run: one message per recipient", same(dryMsgs.map((m) => m.to), Object.keys(expected)), dryMsgs.map((m) => m.to).join(" "))
    const intentIdByStaff = new Map(queuedRows.map((i) => [(i!.payload as { staffMemberId: string }).staffMemberId, i!.id]))
    const ids = (staffIds: string[]) => staffIds.map((s) => intentIdByStaff.get(s)!)
    check(
      "A10 each dry-run summary lists exactly that recipient's milestones (intentIds)",
      dryMsgs.every((m) => same(m.intentIds, ids(expected[m.to])) && m.intentId === null),
      dryMsgs.map((m) => `${m.to.split("-")[1]}:${m.intentIds.length}`).join(" ")
    )
    check("A11 dry-run consumes nothing: zero deliveries, still queued, nothing captured",
      (await prisma.notificationDelivery.count({ where: { intent: { organizationId: org.id } } })) === 0 && dry.sent.length === 0)
    await run("dry-run", dry, org.id)
    check("A12 a dry-run rerun logs nothing new", (await msgs({ mode: "dry-run" })).length === dryMsgs.length)

    // ── B. Recipients (read off the dry-run rows) ──────────────────────────
    const all = await msgs()
    check("B1 grid switch-off respected", !all.some((m) => m.to === E(mDenied)))
    check("B2 a STORE login is never a recipient", !all.some((m) => m.to === E(sA)))
    const covered = (u: { email: string }) => all.filter((m) => m.to === E(u)).flatMap((m) => m.intentIds)
    check("B3 employee excluded by linked account (and a manager never about themselves)", !covered(mSelf).includes(intentIdByStaff.get(selfLinked.id)!))
    check("B4 employee excluded by matching email (trimmed, case-insensitive)", !covered(mSelfEmail).includes(intentIdByStaff.get(selfEmail.id)!))
    check("B5 out-of-scope manager never a recipient (Store B manager: Store B only)", same(covered(mB), ids([ben.id])))
    check("B6 corporate → ADMINs only", all.filter((m) => m.intentIds.includes(intentIdByStaff.get(corp.id)!)).every((m) => m.to === E(adm)))

    // ── C. Sandbox ─────────────────────────────────────────────────────────
    process.env.NOTIFY_SANDBOX_ALLOWLIST = ` ${adm.email.toUpperCase()} `
    const sb = capture()
    await run("sandbox", sb, org.id)
    check("C1 sandbox mails only the allow-listed address, ONE summary", sb.sent.length === 1 && to(sb.sent[0]) === E(adm), sb.sent.map(to).join(" "))
    check("C2 that summary lists all six of the admin's milestones", (sb.sent[0]?.subject ?? "") === "6 new staff milestones")
    check("C3 R1: intents still queued, zero deliveries",
      (await Promise.all(tenureQueued.map((s) => intentOf(s.id)))).every((i) => i?.state === "queued") &&
        (await prisma.notificationDelivery.count({ where: { intent: { organizationId: org.id } } })) === 0)
    check("C4 withheld recipients already dry-run-logged: no new dry-run rows", (await msgs({ mode: "dry-run" })).length === dryMsgs.length)
    const sbSweep = capture()
    await dispatchNotifications({ transport: tp("sandbox", sbSweep), trigger: "sweep", organizationId: org.id, now: NOW })
    check("C5 R2: the sweep sends nothing in sandbox", sbSweep.sent.length === 0)
    delete process.env.NOTIFY_SANDBOX_ALLOWLIST

    // ── D. Live ────────────────────────────────────────────────────────────
    const live = capture()
    const [rD] = await run("live", live, org.id)
    check("D1 one email per recipient", same(live.sent.map(to), Object.keys(expected)), live.sent.map(to).join(" "))
    check("D2 every queued milestone is now sent", (await Promise.all(tenureQueued.map((s) => intentOf(s.id)))).every((i) => i?.state === "sent"), JSON.stringify(rD))
    const dels = await prisma.notificationDelivery.findMany({ where: { intent: { organizationId: org.id } } })
    const pairCount = Object.values(expected).reduce((n, v) => n + v.length, 0)
    check("D3 one sent delivery per (milestone, recipient), each pointing at its email", dels.length === pairCount && dels.every((d) => d.state === "sent" && !!d.messageId), `${dels.length}/${pairCount}`)
    const liveMsgs = await msgs({ mode: "live" })
    check("D4 the live summaries' intentIds match the deliveries", liveMsgs.every((m) => same(m.intentIds, dels.filter((d) => d.messageId === m.id).map((d) => d.intentId))))
    const bodies = live.sent.map((m) => `${m.html ?? ""}\n${m.text}`)
    check("D5 F7: no pay, rate, raise or wage text in any email", bodies.every((b) => !/\$|\bwage|\bpay\b|pay rate|hourly|\braise/i.test(b)))
    const admMail = live.sent.find((m) => to(m) === E(adm))!
    check("D6 the suggested message is the stored message, verbatim", admMail.text.includes(tenure30.employeeMessage) && (admMail.html ?? "").includes(tenure30.employeeMessage))
    check("D7 each milestone links its Milestones tab", admMail.text.includes(`https://ms4b.example.com/staff/${ana.id}?tab=milestones`) && (admMail.html ?? "").includes(`/staff/${ana.id}?tab=milestones`))
    // Optional chaining so a broken run reports instead of crashing; D1 asserts the email exists.
    check("D8 a Store B manager's email never names a Store A employee", !(live.sent.find((m) => to(m) === E(mB))?.text ?? "").includes("MS-4b Staff Ana"))
    check("D9 the 7-day boundary sends (Cara, reached exactly 7 days ago)", admMail.text.includes("MS-4b Staff Cara"))
    const live2 = capture()
    await run("live", live2, org.id)
    check("D10 a rerun sends nothing", live2.sent.length === 0)
    check("D11 known is never sent", (await intentOf(dan.id))?.state === "known" && (await prisma.notificationDelivery.count({ where: { intent: { dedupeKey: key(dan.id) } } })) === 0)

    // ── E. Checklist milestones (F13) ──────────────────────────────────────
    await prisma.milestoneSettings.create({ data: { organizationId: org.id, checklistMilestonesEnabled: true } })
    const ck = capture()
    await run("live", ck, org.id)
    check("E1 checklist switch on → the checklist milestone sends to Store A's recipients",
      same(ck.sent.map(to), [E(adm), E(mA), E(mSelf), E(mSelfEmail)]) && ck.sent.every((m) => m.subject === "MS-4b Staff Ana reached MS-4b Two tasks"),
      ck.sent.map((m) => `${to(m)}: ${m.subject}`).join(" | "))
    await prisma.taskLog.delete({ where: { id: secondTask.id } })
    const ck2 = capture()
    await run("live", ck2, org.id)
    await prisma.taskLog.create({ data: { checklistId: checklist.id, taskId: tasks[1].id, completedByStaffId: ana.id, completedAt: new Date("2026-10-19T14:30:00.000Z") } })
    const ck3 = capture()
    await run("live", ck3, org.id)
    check("E2 a count that drops and recovers never resends", ck2.sent.length === 0 && ck3.sent.length === 0 && (await intentOf(ana.id, "checklist", checklist2.id))?.state === "sent")

    // ── F. P6 on a summary ─────────────────────────────────────────────────
    const gil = await staff("Gil", 0, storeA.id)
    const p6 = capture([mA.email])
    await run("live", p6, org.id)
    const gilIntent = await intentOf(gil.id)
    check("F1 one recipient fails → partial", gilIntent?.state === "partial" && same(p6.sent.map(to), [E(adm), E(mSelf), E(mSelfEmail)]), `${gilIntent?.state}`)
    const retry = capture()
    await dispatchNotifications({ transport: tp("live", retry), trigger: "sweep", organizationId: org.id, now: new Date(NOW.getTime() + 2 * HOUR) })
    check("F2 the sweep retries ONLY the failed recipient, once", retry.sent.length === 1 && to(retry.sent[0]) === E(mA), retry.sent.map(to).join(" "))
    check("F3 then sent; every recipient has exactly one sent delivery", (await intentOf(gil.id))?.state === "sent" &&
      (await prisma.notificationDelivery.findMany({ where: { intentId: gilIntent!.id } })).every((d) => d.state === "sent"))
    const retry2 = capture()
    await dispatchNotifications({ transport: tp("live", retry2), trigger: "sweep", organizationId: org.id, now: new Date(NOW.getTime() + 3 * HOUR) })
    check("F4 nobody gets it twice", retry2.sent.length === 0)

    // ── G. Sweep first sends; org switch ───────────────────────────────────
    const hal = await staff("Hal", 0, storeB.id)
    const halEnq = await enqueueNotification({
      organizationId: org.id,
      kind: MILESTONE_KIND,
      dedupeKey: key(hal.id),
      entityId: hal.id,
      eventAt: localMidnightUtc(TODAY, TZ),
      payload: { ...(gilIntent!.payload as object), staffMemberId: hal.id, staffName: "MS-4b Staff Hal", storeName: "MS-4b Store B" },
    })
    const sw = capture()
    await dispatchNotifications({ transport: tp("live", sw), trigger: "sweep", organizationId: org.id, now: NOW })
    check("G1 C3: the sweep never makes a grouped first send", sw.sent.length === 0 && (await intentOf(hal.id))?.state === "queued")
    await prisma.organization.update({ where: { id: org.id }, data: { milestoneAlertsEnabled: false } })
    const off = capture()
    const offResults = await run("live", off, org.id)
    await dispatchNotifications({ transport: tp("live", off), trigger: "producer", intentIds: [halEnq!.intentId], now: NOW })
    check("G2 org switch off → the producer reads nothing, a queued intent expires, no mail",
      offResults.length === 0 && off.sent.length === 0 && (await intentOf(hal.id))?.state === "expired")
    await prisma.organization.update({ where: { id: org.id }, data: { milestoneAlertsEnabled: true } })

    // ── H. Time ────────────────────────────────────────────────────────────
    const fay = await staff("Fay", 0, storeB.id)
    await run("dry-run", capture(), org.id)
    const fay1 = await intentOf(fay.id)
    await run("dry-run", capture(), org.id, new Date(NOW.getTime() + DAY))
    const fay2 = await intentOf(fay.id)
    check("H1 a re-enqueue a day later keeps eventAt at the reach date", fay1?.state === "queued" && fay2?.eventAt.getTime() === fay1.eventAt.getTime() && fay2.updatedAt > fay1.updatedAt)
    await dispatchNotifications({ transport: tp("dry-run", capture()), trigger: "sweep", organizationId: org.id, now: new Date(NOW.getTime() + 7 * DAY + 12 * HOUR) })
    // eventAt is Oct 19 07:00 UTC (PDT midnight); NOW+7d12h is 7d20h after it.
    check("H2 still queued inside the 8-day backstop", (await intentOf(fay.id))?.state === "queued")
    await dispatchNotifications({ transport: tp("dry-run", capture()), trigger: "sweep", organizationId: org.id, now: new Date(NOW.getTime() + 9 * DAY) })
    check("H3 a dry-run intent expires by freshness — not sent, not known", (await intentOf(fay.id))?.state === "expired")
    const late = capture()
    await run("live", late, org.id, new Date(NOW.getTime() + 9 * DAY))
    check("H4 switching to live later never sends it, never relabels it", !late.sent.some((m) => m.text.includes("MS-4b Staff Fay")) && (await intentOf(fay.id))?.state === "expired")

    // ── I. The sample and the per-intent kinds ─────────────────────────────
    const caller = `ms4b-caller-${tag}@example.com`
    const testPayload: TestPayload = { to: caller, provider: "console", stamp: NOW.toISOString(), deployEnv: "local", sha: "ms4b", sampleOf: MILESTONE_KIND }
    const tEnq = await enqueueNotification({ organizationId: org.id, kind: "test", dedupeKey: `ms4b-sample-${tag}`, eventAt: new Date(), payload: testPayload })
    const smp = capture()
    await dispatchNotifications({ transport: tp("live", smp), trigger: "producer", intentIds: [tEnq!.intentId] })
    check("I1 the sample reaches only the caller", smp.sent.length === 1 && to(smp.sent[0]) === caller)
    check("I2 it is the milestone summary, marked as a test, with fictional names",
      smp.sent[0]?.subject === "Test — 2 new staff milestones" && smp.sent[0].text.includes("Sample Person") && !smp.sent[0].text.includes("MS-4b Staff"))
    const tMsg = await prisma.notificationMessage.findFirst({ where: { intentId: tEnq!.intentId } })
    check("I3 a per-intent kind's row is unchanged: intentId set, intentIds empty", !!tMsg && tMsg.kind === "test" && tMsg.intentIds.length === 0)

    // ── J. Skipped days ────────────────────────────────────────────────────
    // Three people whose 30-day milestone falls in the FUTURE relative to every
    // run above, at different days, so each is first seen on its late run.
    const at = (days: number) => new Date(NOW.getTime() + days * DAY) // 15:00 UTC that day
    const mentions = (c: Capture, name: string) => c.sent.filter((m) => m.text.includes(`MS-4b Staff ${name}`))
    const D1 = 10, D2 = 20, D3 = 30
    const jo = await staff("Jo", -D1, storeB.id) // reached TODAY+10
    const kim = await staff("Kim", -D2, storeB.id) // reached TODAY+20
    const lee = await staff("Lee", -D3, storeB.id) // reached TODAY+30
    const storeBRecipients = [E(adm), E(mB)]

    // Reached on D; the job does not run on D+1 or D+2; it runs on D+3.
    const j3 = capture()
    await run("live", j3, org.id, at(D1 + 3))
    const joIntent = await intentOf(jo.id)
    check(
      "J1 reached D, no run D+1 or D+2, run D+3 → sent once to each recipient",
      same(mentions(j3, "Jo").map(to), storeBRecipients) && joIntent?.state === "sent",
      `${mentions(j3, "Jo").map(to).join(" ")} · ${joIntent?.state}`
    )
    check("J1b dated the day it was reached, not the late run", joIntent?.eventAt.getTime() === localMidnightUtc(addDays(TODAY, D1), TZ).getTime())
    const j4 = capture()
    await run("live", j4, org.id, at(D1 + 4))
    check("J2 the next day does not resend it", mentions(j4, "Jo").length === 0)

    // Down until D+7: still inside ruling 2's window.
    const j7 = capture()
    await run("live", j7, org.id, at(D2 + 7))
    check(
      "J3 job down until D+7 → still sent",
      same(mentions(j7, "Kim").map(to), storeBRecipients) && (await intentOf(kim.id))?.state === "sent",
      mentions(j7, "Kim").map(to).join(" ")
    )

    // Down until D+8: more than 7 days → known, never sent.
    const j8 = capture()
    await run("live", j8, org.id, at(D3 + 8))
    const j9 = capture()
    await run("live", j9, org.id, at(D3 + 9))
    const leeIntent = await intentOf(lee.id)
    check(
      "J4 job down until D+8 → recorded known, not sent (and not the day after)",
      mentions(j8, "Lee").length === 0 && mentions(j9, "Lee").length === 0 && leeIntent?.state === "known" &&
        (await prisma.notificationDelivery.count({ where: { intentId: leeIntent.id } })) === 0,
      `${leeIntent?.state}`
    )
  } finally {
    restoreEnv()
    const intents = await prisma.notificationIntent.findMany({ where: { organizationId: org.id }, select: { id: true } })
    await prisma.notificationDelivery.deleteMany({ where: { intentId: { in: intents.map((i) => i.id) } } })
    await prisma.notificationMessage.deleteMany({ where: { organizationId: org.id } })
    await prisma.notificationIntent.deleteMany({ where: { organizationId: org.id } })
    await prisma.auditLog.deleteMany({ where: { organizationId: org.id } })
    await prisma.taskLog.deleteMany({ where: { checklist: { organizationId: org.id } } })
    await prisma.checklist.deleteMany({ where: { organizationId: org.id } })
    await prisma.task.deleteMany({ where: { template: { organizationId: org.id } } })
    await prisma.template.deleteMany({ where: { organizationId: org.id } })
    await prisma.tenureMilestone.deleteMany({ where: { organizationId: org.id } })
    await prisma.checklistMilestone.deleteMany({ where: { organizationId: org.id } })
    await prisma.milestoneSettings.deleteMany({ where: { organizationId: org.id } })
    await prisma.staffMember.deleteMany({ where: { organizationId: org.id } })
    await prisma.storeUserAssignment.deleteMany({ where: { user: { organizationId: org.id } } })
    await prisma.user.deleteMany({ where: { organizationId: org.id } })
    await prisma.store.deleteMany({ where: { organizationId: org.id } })
    await prisma.organization.delete({ where: { id: org.id } })
    console.log(`\nFixture org ${org.id} (MS-4b) and everything under it deleted.`)
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED`)
    process.exit(1)
  }
  console.log("\nAll MS-4b checks passed.")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
