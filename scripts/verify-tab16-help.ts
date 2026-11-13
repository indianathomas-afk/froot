/**
 * TAB-16 acceptance fixture — "Ask a manager" help requests.
 *
 *   npx tsx scripts/verify-tab16-help.ts
 *
 * Runs against the DEV database (local .env), which must already have
 * migration 20261113002310_tab16_help_requests. Creates a throwaway org
 * "TAB-16 Fixture Org (safe to delete)" with two stores, managers, contacts,
 * staff, a template, a task and a checklist, then checks:
 *   A. Labels (R10): only what really left is called emailed; failures (R9)
 *      and dry runs are said plainly; emails off says "Posted in Messages".
 *   B. The email (R8): subject, the 80-character cut, the time in the STORE's
 *      zone, both buttons, the footer link, HTML escaping, the text part.
 *   C. Recipients (R2, R3): storeManagers = MANAGER logins assigned to the
 *      store with an email, nobody else's; loadTabletHelp's contact list
 *      (defaults first, archived never, only defaults when add-more is off,
 *      none when emails are off) and manager counts per store; R5's recent list.
 *   D. A live send: managers + the ticked contacts, NOT an unticked default
 *      pick (exclude), one message each, HelpEmail counts; the hydrated text.
 *   E. R9: a failed recipient settles the intent `failed` at once with no
 *      nextAttemptAt, and a later sweep sends nothing.
 *   F. R10: a dry run is "Not emailed in this environment"; the intent is
 *      expired so nothing sends later.
 *   G. Sandbox: the allow-listed contact is emailed, the rest are counted as
 *      not emailed.
 *   H. Switched off between post and send → "The email didn't go out".
 *   I. R5: the 15-minute lookup (inside, outside, deleted, other task) and the
 *      advisory lock — two concurrent posts for one task create ONE message.
 *   J. serializeMessage: "Not listed" reads "Team member" (R4); the card's
 *      helpRequest fields.
 *   K. The NOTIFY-12 picker accepts the kind (extras), so admins can pick defaults.
 *
 * Nothing reaches Resend: every dispatch takes an injected capture transport.
 *
 * NEGATIVE CONTROLS: delete `exclude` from kinds/help-request.ts — D must FAIL
 * (the unticked default is mailed); delete `noRetry` — E must FAIL (partial,
 * nextAttemptAt set); remove the pg_advisory_xact_lock line from the copy of
 * the route's transaction below — I's concurrency check can FAIL.
 */
import "dotenv/config"
import { prisma } from "../src/lib/prisma"
import type { DeliveryMode, EmailMessage, EmailSender } from "../src/lib/notify"
import { dispatchNotifications, type Transport } from "../src/lib/notifications/dispatch"
import { askedAtText, helpRequestSubject, renderHelpRequest, type HelpRequestView } from "../src/lib/notifications/kinds/help-request"
import { validatePicks } from "../src/lib/notifications/contacts"
import { sendHelpEmail } from "../src/lib/help-request-send"
import {
  HELP_REQUEST_KIND,
  NOT_EMAILED_TEXT,
  helpEmailLabel,
  loadTabletHelp,
  recentHelpRequest,
  storeManagers,
  type HelpEmail,
} from "../src/lib/help-requests"
import { messageInclude, serializeMessage } from "../src/lib/messages"

let failures = 0
function check(label: string, ok: boolean, detail = "") {
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

type Capture = { sent: EmailMessage[]; sender: EmailSender }
function capture(failFor: string[] = []): Capture {
  const sent: EmailMessage[] = []
  return {
    sent,
    sender: {
      async send(m) {
        const to = Array.isArray(m.to) ? m.to.join(",") : m.to
        if (failFor.includes(to)) throw new Error(`capture: refused ${to}`)
        sent.push(m)
        return { id: `tab16-cap-${Math.random().toString(36).slice(2, 10)}` }
      },
    },
  }
}
const transport = (mode: DeliveryMode, cap: Capture): Transport => ({ mode, sender: () => cap.sender })
const toOf = (m: EmailMessage) => (Array.isArray(m.to) ? m.to.join(",") : m.to)

function partsA() {
  console.log("\nA. Labels (R9, R10)")
  check("emails off", helpEmailLabel({ state: "off" }) === "Posted in Messages")
  const base = { state: "done" as const, storeName: "Carson", intentId: null }
  check(
    "all sent",
    helpEmailLabel({ ...base, managersSent: 2, contactsSent: ["a@x.com"], failed: 0, notEmailed: 0 }) ===
      "Emailed to Carson managers + 1 contact"
  )
  check(
    "contacts only (store has no manager)",
    helpEmailLabel({ ...base, managersSent: 0, contactsSent: ["a@x.com", "b@x.com"], failed: 0, notEmailed: 0 }) === "Emailed to 2 contacts"
  )
  check(
    "some failed",
    helpEmailLabel({ ...base, managersSent: 1, contactsSent: [], failed: 1, notEmailed: 0 }) === "Emailed to Carson managers · 1 didn't go out"
  )
  check("all failed", helpEmailLabel({ ...base, managersSent: 0, contactsSent: [], failed: 3, notEmailed: 0 }) === "The email didn't go out")
  check("dry run", helpEmailLabel({ ...base, managersSent: 0, contactsSent: [], failed: 0, notEmailed: 3 }) === NOT_EMAILED_TEXT)
  check(
    "sandbox mix",
    helpEmailLabel({ ...base, managersSent: 0, contactsSent: ["a@x.com"], failed: 0, notEmailed: 2 }) ===
      "Emailed to 1 contact · 2 not emailed in this environment"
  )
}

function partsB() {
  console.log("\nB. The email (R8)")
  const v: HelpRequestView = {
    storeName: "Carson",
    timeZone: "America/Denver",
    checklistName: "Opener",
    checklistId: "chk_1",
    taskLabel: "Turn on Menu displays",
    askerName: "Tristan <b>",
    reason: "Watched it, still stuck",
    note: "Line one\nline two",
    // 16:44 UTC = 9:44 AM MST (Denver) = 8:44 AM PST (Los Angeles).
    askedAt: "2026-11-12T16:44:00.000Z",
    training: [
      { label: "Training video", kind: "Video" },
      { label: "Menu display quick guide", kind: "PDF" },
    ],
  }
  const r = renderHelpRequest(v, "Keva Juice")
  check("subject", r.subject === "Help needed at Carson: Turn on Menu displays", r.subject)
  const long = helpRequestSubject({ storeName: "Carson", taskLabel: "x".repeat(120) })
  check("long task cut at 80 with an ellipsis", long === `Help needed at Carson: ${"x".repeat(79)}…`)
  check("time in the store's zone (Denver)", askedAtText(v.askedAt, "America/Denver") === "Thursday, November 12 · 9:44 AM")
  check("…and not the server's (LA differs)", askedAtText(v.askedAt, "America/Los_Angeles") === "Thursday, November 12 · 8:44 AM")
  check("heading names the asker and checklist", r.html.includes("Tristan &lt;b&gt; needs a hand with an opener task"))
  check("asker name escaped (no raw <b>)", !r.html.includes("Tristan <b>"))
  check("Reply in Messages button", r.html.includes("https://tab16.example.com/messages") && r.html.includes("Reply in Messages"))
  check("Open the checklist button", r.html.includes("https://tab16.example.com/store-view/checklist/chk_1") && r.html.includes("Open the checklist"))
  check("footer link to Settings", r.html.includes("https://tab16.example.com/settings/notifications") && r.html.includes("Help request emails list"))
  check("reason, note and training in the text part", r.text.includes("Watched it, still stuck") && r.text.includes("Line one") && r.text.includes("Menu display quick guide"))
  check("both links in the text part", r.text.includes("Open the checklist: https://tab16.example.com/store-view/checklist/chk_1"))
}

async function main() {
  process.env.NEXT_PUBLIC_APP_URL = "https://tab16.example.com"
  process.env.NOTIFY_EMAIL_PROVIDER = "console"
  delete process.env.VERCEL_ENV
  partsA()
  partsB()

  const tag = Date.now().toString(36)
  const em = (k: string) => `tab16-${k}-${tag}@example.com`
  const org = await prisma.organization.create({
    data: { clerkOrgId: `tab16-fixture-${tag}`, name: "TAB-16 Fixture Org (safe to delete)" },
  })
  const [{ branch }] = await prisma.$queryRaw<{ branch: string | null }[]>`SELECT current_setting('neon.branch_id', true) AS branch`
  console.log(`\nFixture org ${org.id} — TAB-16 · neon.branch_id=${branch ?? "(null)"}`)

  try {
    const s1 = await prisma.store.create({ data: { organizationId: org.id, name: "TAB-16 Store", timezone: "America/Denver" } })
    const s2 = await prisma.store.create({ data: { organizationId: org.id, name: "TAB-16 Other", timezone: "America/Los_Angeles" } })
    const mkUser = (key: string, role: "ADMIN" | "MANAGER" | "STORE", email: string, storeIds: string[]) =>
      prisma.user.create({
        data: {
          clerkUserId: `tab16-${key}-${tag}`,
          organizationId: org.id,
          email,
          role,
          storeAssignments: { create: storeIds.map((storeId) => ({ storeId })) },
        },
      })
    const m1 = await mkUser("m1", "MANAGER", em("m1"), [s1.id])
    await mkUser("m2-noemail", "MANAGER", "  ", [s1.id])
    await mkUser("m3", "MANAGER", em("m3"), [s2.id])
    await mkUser("admin", "ADMIN", em("admin"), [])
    const login = await mkUser("store", "STORE", em("store"), [s1.id])

    const mkContact = (k: string, archived = false) =>
      prisma.notificationContact.create({
        data: { organizationId: org.id, name: `TAB-16 ${k}`, email: em(k), archivedAt: archived ? new Date() : null },
      })
    const c1 = await mkContact("c1")
    const c2 = await mkContact("c2")
    const c3 = await mkContact("c3")
    const c4 = await mkContact("c4-archived", true)
    for (const c of [c1, c2, c4]) {
      await prisma.notificationRecipientPick.create({ data: { organizationId: org.id, kind: HELP_REQUEST_KIND, contactId: c.id } })
    }
    await prisma.notificationKindSettings.create({ data: { organizationId: org.id, kind: HELP_REQUEST_KIND, enabled: true } })

    const tristan = await prisma.staffMember.create({
      data: { organizationId: org.id, displayName: "TAB-16 Tristan", storeAssignments: { create: { storeId: s1.id } } },
    })
    const template = await prisma.template.create({ data: { organizationId: org.id, name: "TAB-16 Opener", type: "Opener" } })
    const task = await prisma.task.create({
      data: { templateId: template.id, sectionName: "Front", description: "TAB-16 Turn on Menu displays", videoUrl: "https://youtu.be/dQw4w9WgXcQ" },
    })
    const task2 = await prisma.task.create({ data: { templateId: template.id, sectionName: "Front", description: "TAB-16 Other task" } })
    const checklist = await prisma.checklist.create({
      data: { organizationId: org.id, templateId: template.id, storeId: s1.id, date: new Date() },
    })

    // ── C ──────────────────────────────────────────────────────────────────
    console.log("\nC. Recipients and the tablet's view (R2, R3)")
    const mgrs = await storeManagers(org.id, s1.id)
    check("store managers = the one MANAGER at this store with an email", sameSet(mgrs.map((u) => u.id), [m1.id]))
    let view = (await loadTabletHelp(org.id, [s1.id, s2.id])).get(s1.id)!
    check("emails on", view.emailsOn === true)
    check("manager count 1 (blank email and other store excluded)", view.managerCount === 1)
    check(
      "contacts: defaults first, then the rest; archived never",
      view.contacts.map((c) => c.id).join() === [c1.id, c2.id, c3.id].join() && view.contacts.filter((c) => c.isDefault).length === 2
    )
    check("other store's manager count", (await loadTabletHelp(org.id, [s2.id])).get(s2.id)!.managerCount === 1)
    await prisma.notificationKindSettings.update({
      where: { organizationId_kind: { organizationId: org.id, kind: HELP_REQUEST_KIND } },
      data: { tabletAddContacts: false },
    })
    view = (await loadTabletHelp(org.id, [s1.id])).get(s1.id)!
    check("add-more off → only the defaults", sameSet(view.contacts.map((c) => c.id), [c1.id, c2.id]))
    await prisma.notificationKindSettings.update({
      where: { organizationId_kind: { organizationId: org.id, kind: HELP_REQUEST_KIND } },
      data: { tabletAddContacts: true, enabled: false },
    })
    view = (await loadTabletHelp(org.id, [s1.id])).get(s1.id)!
    check("emails off → no Send to list", view.emailsOn === false && view.contacts.length === 0)
    await prisma.notificationKindSettings.update({
      where: { organizationId_kind: { organizationId: org.id, kind: HELP_REQUEST_KIND } },
      data: { enabled: true },
    })

    const post = (taskId = task.id, staffId: string | null = tristan.id, createdAt?: Date) =>
      prisma.teamMessage.create({
        data: {
          organizationId: org.id,
          storeId: s1.id,
          authorUserId: login.id,
          authorStaffId: staffId,
          type: "help_request",
          body: "TAB-16 the screen stays black",
          sourceChecklistId: checklist.id,
          taskId,
          helpReason: "still_stuck",
          helpEmail: { state: "off" },
          ...(createdAt ? { createdAt } : {}),
        },
      })
    const args = (messageId: string, contactIds: string[], at = new Date()) => ({
      organizationId: org.id,
      storeId: s1.id,
      storeName: s1.name,
      messageId,
      contactIds,
      managerEmails: mgrs.map((u) => u.email.toLowerCase()),
      eventAt: at,
    })

    // ── D ──────────────────────────────────────────────────────────────────
    console.log("\nD. A live send (R2, R3)")
    const msgD = await post()
    const capD = capture()
    // c2 is a default pick the team member UNticked; c3 is an extra they ticked.
    const eD = await sendHelpEmail(args(msgD.id, [c1.id, c3.id]), transport("live", capD))
    check(
      "mailed = the manager + the ticked contacts, not the unticked default",
      sameSet(capD.sent.map(toOf), [em("m1"), em("c1"), em("c3")]),
      capD.sent.map(toOf).join(", ")
    )
    check("one message per recipient", capD.sent.length === 3)
    check(
      "HelpEmail counts",
      eD.state === "done" && eD.managersSent === 1 && sameSet(eD.contactsSent, [em("c1"), em("c3")]) && eD.failed === 0 && eD.notEmailed === 0
    )
    check("label", helpEmailLabel(eD) === "Emailed to TAB-16 Store managers + 2 contacts", helpEmailLabel(eD))
    const intentD = await prisma.notificationIntent.findFirst({ where: { organizationId: org.id, dedupeKey: msgD.id } })
    check("intent sent", intentD?.state === "sent")
    const first = capD.sent[0]
    check("subject from the stored ids", first?.subject === "Help needed at TAB-16 Store: TAB-16 Turn on Menu displays", first?.subject)
    check(
      "hydrated text: asker, reason, note, training, store-zone time",
      !!first?.text?.includes("TAB-16 Tristan") &&
        !!first?.text?.includes("Watched it, still stuck") &&
        !!first?.text?.includes("the screen stays black") &&
        !!first?.text?.includes("Training video") &&
        !!first?.text?.includes(askedAtText(msgD.createdAt.toISOString(), "America/Denver"))
    )

    // ── E ──────────────────────────────────────────────────────────────────
    console.log("\nE. R9 — a failure is final")
    const msgE = await post(task2.id)
    const capE = capture([em("c3")])
    const eE = await sendHelpEmail(args(msgE.id, [c1.id, c3.id]), transport("live", capE))
    check("one failed, two sent", eE.state === "done" && eE.failed === 1 && eE.managersSent === 1 && eE.contactsSent.length === 1)
    check("label says it", helpEmailLabel(eE) === "Emailed to TAB-16 Store managers + 1 contact · 1 didn't go out", helpEmailLabel(eE))
    const intentE = await prisma.notificationIntent.findFirst({ where: { organizationId: org.id, dedupeKey: msgE.id } })
    check("intent failed at once, no retry time", intentE?.state === "failed" && intentE.nextAttemptAt === null && intentE.attempts === 1)
    const capSweep = capture()
    await dispatchNotifications({ transport: transport("live", capSweep), trigger: "sweep", organizationId: org.id, kinds: [HELP_REQUEST_KIND] })
    check("a later sweep sends nothing", capSweep.sent.length === 0)

    // ── F ──────────────────────────────────────────────────────────────────
    console.log("\nF. R10 — a dry run")
    const msgF = await post(task2.id)
    const capF = capture()
    const eF = await sendHelpEmail(args(msgF.id, [c1.id]), transport("dry-run", capF))
    check("nothing handed to the provider", capF.sent.length === 0)
    check("label", helpEmailLabel(eF) === NOT_EMAILED_TEXT, helpEmailLabel(eF))
    const intentF = await prisma.notificationIntent.findFirst({ where: { organizationId: org.id, dedupeKey: msgF.id } })
    check("intent expired, so nothing sends later", intentF?.state === "expired")

    // ── G ──────────────────────────────────────────────────────────────────
    console.log("\nG. Sandbox (staging)")
    process.env.NOTIFY_SANDBOX_ALLOWLIST = em("c1")
    const msgG = await post(task2.id)
    const capG = capture()
    const eG = await sendHelpEmail(args(msgG.id, [c1.id, c3.id]), transport("sandbox", capG))
    check("only the allow-listed contact is emailed", capG.sent.map(toOf).join() === em("c1"))
    check("label", helpEmailLabel(eG) === "Emailed to 1 contact · 2 not emailed in this environment", helpEmailLabel(eG))
    delete process.env.NOTIFY_SANDBOX_ALLOWLIST

    // ── H ──────────────────────────────────────────────────────────────────
    console.log("\nH. Switched off between the post and the send")
    await prisma.notificationKindSettings.update({
      where: { organizationId_kind: { organizationId: org.id, kind: HELP_REQUEST_KIND } },
      data: { enabled: false },
    })
    const msgH = await post(task2.id)
    const capH = capture()
    const eH: HelpEmail = await sendHelpEmail(args(msgH.id, [c1.id]), transport("live", capH))
    check("no mail, and the label says it didn't go out", capH.sent.length === 0 && helpEmailLabel(eH) === "The email didn't go out", helpEmailLabel(eH))
    await prisma.notificationKindSettings.update({
      where: { organizationId_kind: { organizationId: org.id, kind: HELP_REQUEST_KIND } },
      data: { enabled: true },
    })

    // ── I ──────────────────────────────────────────────────────────────────
    console.log("\nI. R5 — one per task per store every 15 minutes")
    const now = new Date()
    const fresh = await recentHelpRequest(prisma, s1.id, task.id, now)
    check("inside the window: found", fresh?.id === msgD.id)
    const later = new Date(msgD.createdAt.getTime() + 15 * 60 * 1000 + 1000)
    const newestTask = await prisma.teamMessage.findFirst({ where: { taskId: task.id }, orderBy: { createdAt: "desc" } })
    check("15 minutes later: none", (await recentHelpRequest(prisma, s1.id, task.id, new Date(Math.max(later.getTime(), newestTask!.createdAt.getTime() + 15 * 60 * 1000 + 1000)))) === null)
    check("another store: none", (await recentHelpRequest(prisma, s2.id, task.id, now)) === null)
    await prisma.teamMessage.update({ where: { id: msgD.id }, data: { deletedAt: new Date() } })
    check("deleted: none", (await recentHelpRequest(prisma, s1.id, task.id, now)) === null)
    const recent = (await loadTabletHelp(org.id, [s1.id])).get(s1.id)!.recent
    check("tablet recent list: task2's newest, once", recent.length === 1 && recent[0].taskId === task2.id && recent[0].askerName === "TAB-16 Tristan")

    // The route's transaction, copied: lock → check → create.
    const task3 = await prisma.task.create({ data: { templateId: template.id, sectionName: "Front", description: "TAB-16 Race task" } })
    const attempt = () =>
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`tab16:${s1.id}:${task3.id}`}))`
        const existing = await recentHelpRequest(tx, s1.id, task3.id, new Date())
        if (existing) return "duplicate"
        await tx.teamMessage.create({
          data: { organizationId: org.id, storeId: s1.id, type: "help_request", body: "", taskId: task3.id, sourceChecklistId: checklist.id },
        })
        return "created"
      })
    const results = await Promise.all([attempt(), attempt(), attempt()])
    const created = await prisma.teamMessage.count({ where: { taskId: task3.id } })
    check("three concurrent posts → one message", created === 1 && results.filter((r) => r === "created").length === 1, results.join(", "))

    // ── J ──────────────────────────────────────────────────────────────────
    console.log("\nJ. Messages rendering data")
    const anon = await post(task3.id, null)
    await prisma.teamMessage.update({ where: { id: anon.id }, data: { helpEmail: eD } })
    const loaded = await prisma.teamMessage.findUniqueOrThrow({ where: { id: anon.id }, include: messageInclude })
    const ser = serializeMessage(loaded, null)
    check("Not listed → Team member, never the store login", ser.author.name === "Team member")
    check(
      "helpRequest fields",
      ser.helpRequest?.task === "TAB-16 Race task" &&
        ser.helpRequest.checklist === "TAB-16 Opener" &&
        ser.helpRequest.reason === "Watched it, still stuck" &&
        ser.helpRequest.emailed === "Emailed to TAB-16 Store managers + 2 contacts"
    )
    const general = await prisma.teamMessage.create({
      data: { organizationId: org.id, storeId: s1.id, type: "general", body: "TAB-16 hi", authorUserId: m1.id },
      include: messageInclude,
    })
    check("other types: helpRequest null", serializeMessage(general, null).helpRequest === null)

    // ── K ──────────────────────────────────────────────────────────────────
    console.log("\nK. Settings picker")
    const v = await validatePicks(org, HELP_REQUEST_KIND, { contactIds: [c1.id, c3.id] })
    check("NOTIFY-12 save path accepts help.request picks", v.ok === true)
  } finally {
    restoreEnv()
    const intents = await prisma.notificationIntent.findMany({ where: { organizationId: org.id }, select: { id: true } })
    await prisma.notificationDelivery.deleteMany({ where: { intentId: { in: intents.map((i) => i.id) } } })
    await prisma.notificationMessage.deleteMany({ where: { organizationId: org.id } })
    await prisma.notificationIntent.deleteMany({ where: { organizationId: org.id } })
    await prisma.auditLog.deleteMany({ where: { organizationId: org.id } })
    await prisma.messageRead.deleteMany({ where: { message: { organizationId: org.id } } })
    await prisma.teamMessage.deleteMany({ where: { organizationId: org.id } })
    await prisma.checklist.deleteMany({ where: { organizationId: org.id } })
    await prisma.task.deleteMany({ where: { template: { organizationId: org.id } } })
    await prisma.template.deleteMany({ where: { organizationId: org.id } })
    await prisma.storeStaffAssignment.deleteMany({ where: { staffMember: { organizationId: org.id } } })
    await prisma.staffMember.deleteMany({ where: { organizationId: org.id } })
    await prisma.notificationKindSettings.deleteMany({ where: { organizationId: org.id } })
    await prisma.notificationRecipientPick.deleteMany({ where: { organizationId: org.id } })
    await prisma.notificationContact.deleteMany({ where: { organizationId: org.id } })
    await prisma.storeUserAssignment.deleteMany({ where: { user: { organizationId: org.id } } })
    await prisma.user.deleteMany({ where: { organizationId: org.id } })
    await prisma.store.deleteMany({ where: { organizationId: org.id } })
    await prisma.organization.delete({ where: { id: org.id } })
    console.log(`\nFixture org ${org.id} (TAB-16) and everything under it deleted.`)
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED`)
    process.exit(1)
  }
  console.log("\nAll TAB-16 checks passed.")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
