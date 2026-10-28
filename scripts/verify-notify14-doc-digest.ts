/**
 * NOTIFY-14 acceptance fixture — the overdue & due-soon document digest.
 *
 *   npx tsx scripts/verify-notify14-doc-digest.ts
 *
 * Rulings: Gary 2026-10-27, F1–F17 (docs/DECISIONS.md; forks in
 * docs/prompts/NOTIFY-DOC-DIGEST_AUDIT.md § 10(a)). Every EXPECTED value below
 * is written from those rulings, not read back from the code under test.
 *
 * Creates two throwaway orgs ("NOTIFY-14 Fixture Org …"), every principal
 * named "NOTIFY-14 …" (CLAUDE.md § Name every test principal). Dates are
 * placed relative to today in America/Los_Angeles at local noon, so a run at
 * any hour lands each due date on the intended day. Mail goes to a capture
 * sender in LIVE mode, so delivery rows and states are real; nothing leaves
 * the machine. Everything is deleted afterwards and removal is re-queried.
 *
 * NOT HERE, said rather than implied: the admin routes (PUT
 * /api/doc-digest/settings, the preview on POST /api/notify/test) need a Clerk
 * session; the preview's RENDER path is exercised through the test kind. Both
 * routes are on Gary's staging test plan.
 */
import "dotenv/config"
import { prisma } from "../src/lib/prisma"
import type { DeliveryMode, EmailMessage, EmailSender } from "../src/lib/notify"
import { documentDueLabel } from "../src/lib/hr-due-wording"
import { addDays } from "../src/lib/milestones"
import { localDateStr } from "../src/lib/reports"
import { zonedInstant } from "../src/lib/checklist-lifecycle"
import { buildDocDigestSnapshot, processDocDigest } from "../src/lib/doc-digest-alerts"
import { CORPORATE_GROUP, UNASSIGNED_GROUP, type DocDigestView } from "../src/lib/hr-doc-digest"
import { ALL_VIEW, DOC_DIGEST_KIND, docDigestKind, type DocDigestPayload } from "../src/lib/notifications/kinds/doc-digest"
import { testKind, type TestPayload } from "../src/lib/notifications/kinds/test"
import { getKind, type KindIntent, type NotificationOrg } from "../src/lib/notifications/registry"
import { slotDue } from "../src/lib/notifications/schedule"
import { runScheduledEmails } from "../src/lib/scheduled-emails"
import { ACTION_SENT, NOTIFICATION_ENTITY_TYPE } from "../src/lib/notification-log"
import { can, grantsFrom, overridesFrom } from "../src/lib/permissions"

let failures = 0
let checks = 0
function check(label: string, ok: boolean, detail = "") {
  checks += 1
  console.log(`${ok ? "✓" : "✗ FAIL"} ${label}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures += 1
}
const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i])

const ENV_KEYS = ["VERCEL_ENV", "NOTIFY_EMAIL_PROVIDER", "NOTIFY_SANDBOX_ALLOWLIST", "NEXT_PUBLIC_APP_URL", "HR_MODULE_AVAILABLE", "HR_INTERNAL_ORG_IDS"] as const
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
function restoreEnv() {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
}

type Capture = { sent: EmailMessage[]; sender: EmailSender }
function capture(): Capture {
  const sent: EmailMessage[] = []
  return {
    sent,
    sender: {
      async send(m) {
        sent.push(m)
        return { id: `n14-cap-${Math.random().toString(36).slice(2, 10)}` }
      },
    },
  }
}
const toOf = (m: EmailMessage) => (Array.isArray(m.to) ? m.to.join(",") : m.to).toLowerCase()

const TZ = "America/Los_Angeles"
const FILE = {
  fileUrl: "https://example.invalid/notify14.pdf",
  fileName: "notify14.pdf",
  contentType: "application/pdf",
  sizeBytes: 1000,
  uploadedByUserId: "fixture",
}
const LIVE: DeliveryMode = "live"
// Monday 2026-11-02 (PST, UTC-8): 08:30 local = 16:30 UTC.
const MON_0830 = new Date("2026-11-02T16:30:00.000Z")
const MON_0730 = new Date("2026-11-02T15:30:00.000Z")
const TUE_0830 = new Date("2026-11-03T16:30:00.000Z")

async function main() {
  const [{ branch }] = await prisma.$queryRaw<{ branch: string | null }[]>`SELECT current_setting('neon.branch_id', true) AS branch`
  // CLAUDE.md § Database Evidence: the branch travels with the result.
  console.log(`BRANCH neon.branch_id=${branch ?? "(null)"}\n`)

  process.env.HR_MODULE_AVAILABLE = "true"
  delete process.env.HR_INTERNAL_ORG_IDS
  process.env.NEXT_PUBLIC_APP_URL = "https://notify14.example.com"
  process.env.NOTIFY_EMAIL_PROVIDER = "console"
  delete process.env.VERCEL_ENV

  // ── 1. Pure: the default schedule (F2) and the no-row paths it must not move
  console.log("── 1. slotDue — the digest's default row; pace and milestone unchanged ──")
  const digestSpec = getKind(DOC_DIGEST_KIND)!.schedule!
  const paceSpec = getKind("pace.alert")!.schedule!
  const msSpec = getKind("milestone.reached")!.schedule!
  const d1 = slotDue(digestSpec, null, MON_0830, "UTC")
  check("no row: Monday 08:30 Pacific is due, weekly (F2)", d1.due && d1.frequency === "weekly" && d1.localDate === "2026-11-02", JSON.stringify(d1))
  check("no row: Monday 07:30 Pacific is NOT due (before 8 AM)", !slotDue(digestSpec, null, MON_0730, "UTC").due)
  check("no row: Tuesday 08:30 Pacific is NOT due (weekly = Monday)", !slotDue(digestSpec, null, TUE_0830, "UTC").due)
  check(
    "a saved daily row overrides the default: Tuesday 08:30 due",
    slotDue(digestSpec, { frequency: "daily", sendHour: 8, daysOfWeek: [1, 2, 3, 4, 5], dayOfMonth: null, timeZone: TZ }, TUE_0830, TZ).due
  )
  const p1 = slotDue(paceSpec, null, MON_0730, "America/New_York")
  const m1 = slotDue(msSpec, null, MON_0730, TZ)
  check("pace no-row is still the 15:00 UTC legacy slot, frequency undefined", p1.due && p1.frequency === undefined)
  check("milestone no-row is still the 15:00 UTC legacy slot, frequency undefined", m1.due && m1.frequency === undefined)
  check("digest offers daily and weekly only, hours 5–20 (F3)", digestSpec.frequencies.join() === "daily,weekly" && digestSpec.hours.min === 5 && digestSpec.hours.max === 20)

  console.log("\n── 1b. the capability (F5) ──")
  const holds = (role: string, denied: string[] = [], granted: string[] = []) =>
    can({ role, overrides: overridesFrom(denied), grants: grantsFrom(granted) }, "notify.docdue.receive")
  check("ADMIN and MANAGER hold notify.docdue.receive at baseline", holds("ADMIN") && holds("MANAGER"))
  check("a denial removes it", !holds("MANAGER", ["notify.docdue.receive"]))
  check("STORE and STAFF never hold it, even with a grant written", !holds("STORE", [], ["notify.docdue.receive"]) && !holds("STAFF", [], ["notify.docdue.receive"]))

  // ── 2. Fixture rows ─────────────────────────────────────────────────────────
  const tag = Math.random().toString(36).slice(2, 8)
  const em = (k: string) => `notify14-${k}-${tag}@example.com`
  const now = new Date()
  const today = localDateStr(now, TZ)
  const at = (n: number) => zonedInstant(addDays(today, -n), "12:00", TZ)!
  const civil = (n: number) => new Date(`${addDays(today, -n)}T00:00:00.000Z`)

  const org = await prisma.organization.create({
    data: { clerkOrgId: `notify14-fixture-${tag}`, name: "NOTIFY-14 Fixture Org (safe to delete)", activeModules: ["hr"], timezone: TZ, docDigestEnabled: true },
  })
  const emptyOrg = await prisma.organization.create({
    data: { clerkOrgId: `notify14-fixture-empty-${tag}`, name: "NOTIFY-14 Fixture Org Empty (safe to delete)", activeModules: ["hr"], timezone: TZ, docDigestEnabled: true },
  })
  const orgIds = [org.id, emptyOrg.id]
  console.log(`\nFixture orgs ${org.id} (main), ${emptyOrg.id} (empty) · today ${today} (${TZ})\n`)

  try {
    const [storeA, storeB] = await Promise.all(
      ["A", "B"].map((n) => prisma.store.create({ data: { organizationId: org.id, name: `NOTIFY-14 Store ${n}`, timezone: TZ } }))
    )
    const mkStaff = (name: string, store: { id: string } | null, opts: { status?: string; isCorporate?: boolean } = {}) =>
      prisma.staffMember.create({
        data: {
          organizationId: org.id,
          displayName: `NOTIFY-14 ${name}`,
          fullName: `NOTIFY-14 ${name} Fixture`,
          startDate: civil(200),
          status: opts.status ?? "ACTIVE",
          isCorporate: opts.isCorporate ?? false,
          createdAt: at(300),
          ...(store ? { storeAssignments: { create: { storeId: store.id, isPrimary: true } } } : {}),
        },
      })
    const S = {
      alice: await mkStaff("Alice", storeA),
      bob: await mkStaff("Bob", storeA),
      cara: await mkStaff("Cara", storeB),
      dan: await mkStaff("Dan Terminated", storeA, { status: "TERMINATED" }),
      eve: await mkStaff("Eve RecordMissing", storeA),
      finn: await mkStaff("Finn NoN", storeA),
      gus: await mkStaff("Gus Corporate", storeB, { isCorporate: true }),
      hana: await mkStaff("Hana NoStore", null),
      ivy: await mkStaff("Ivy Signed", storeA),
    }

    // start = the set day (hire 200 ago, grant 100 ago are earlier), so
    // daysUntilDue = N − setDaysAgo.
    const mkDoc = (title: string, n: number | null, setDaysAgo: number | null) =>
      prisma.hrDocument.create({
        data: {
          organizationId: org.id,
          kind: "Acknowledgment",
          title: `NOTIFY-14 ${title}`,
          category: "Other",
          appliesTo: "selected",
          requiresAcknowledgment: true,
          isActive: true,
          signWithinDays: n,
          signWithinDaysSetAt: setDaysAgo === null ? null : at(setDaysAgo),
          createdAt: at(100),
          versions: { create: [{ versionNumber: 1, isCurrent: true, fileHash: `n14-${title}-${tag}`, createdAt: at(100), ...FILE }] },
          checkpoints: { create: [0, 1].map((i) => ({ name: `NOTIFY-14 ${title} ck${i + 1}`, type: "Signature", orderIndex: i })) },
        },
        include: { versions: true, checkpoints: { orderBy: { orderIndex: "asc" } } },
      })
    const D = {
      late: await mkDoc("Late", 5, 20), // −15
      over1: await mkDoc("Over1", 5, 6), // −1
      today: await mkDoc("Today", 5, 5), // 0
      soon3: await mkDoc("Soon3", 5, 2), // 3 — the boundary, in
      due4: await mkDoc("Due4", 5, 1), // 4 — out
      noN: await mkDoc("NoN", null, null), // no due date — out
    }
    const grant = (docId: string, staffId: string) => ({ hrDocumentId: docId, granteeType: "STAFF", staffMemberId: staffId, createdAt: at(100) })
    await prisma.hrDocumentGrant.createMany({
      data: [
        grant(D.late.id, S.alice.id),
        grant(D.soon3.id, S.alice.id),
        grant(D.over1.id, S.alice.id),
        grant(D.today.id, S.bob.id),
        grant(D.due4.id, S.bob.id),
        grant(D.late.id, S.cara.id),
        grant(D.late.id, S.dan.id),
        grant(D.late.id, S.eve.id),
        grant(D.noN.id, S.finn.id),
        grant(D.late.id, S.gus.id),
        grant(D.late.id, S.hana.id),
        grant(D.late.id, S.ivy.id),
      ],
    })
    await prisma.hrSignedRecord.create({
      data: {
        hrDocumentVersionId: D.late.versions[0].id,
        staffMemberId: S.ivy.id,
        completedAt: at(10),
        signedPdfPathname: `hr/fixture/n14-ivy-${tag}.pdf`,
        signedPdfHash: `n14-ivy-${tag}`,
        signingCycle: 1,
      },
    })
    for (const ck of D.late.checkpoints) {
      await prisma.hrDocumentAcknowledgment.create({
        data: {
          checkpointId: ck.id,
          hrDocumentVersionId: D.late.versions[0].id,
          staffMemberId: S.eve.id,
          checkpointName: ck.name,
          checkpointType: "Signature",
          documentTitle: D.late.title,
          documentVersionNumber: 1,
          documentFileHash: D.late.versions[0].fileHash,
          staffName: S.eve.displayName,
          method: "Signature",
          authMethod: "ManagerAttested",
          consentGiven: true,
        },
      })
    }

    const mkUser = (key: string, role: "ADMIN" | "MANAGER" | "STORE", denied: string[] = [], orgId = org.id) =>
      prisma.user.create({ data: { clerkUserId: `notify14-${key}-${tag}`, organizationId: orgId, email: em(key), role, deniedCapabilities: denied } })
    const U = {
      admin: await mkUser("admin", "ADMIN"),
      adminDenied: await mkUser("admin-denied", "ADMIN", ["notify.docdue.receive"]),
      mgrA: await mkUser("mgr-a", "MANAGER"),
      mgrB: await mkUser("mgr-b", "MANAGER"),
      mgrNone: await mkUser("mgr-none", "MANAGER"),
      storeLogin: await mkUser("store", "STORE"),
      emptyAdmin: await mkUser("empty-admin", "ADMIN", [], emptyOrg.id),
    }
    await prisma.storeUserAssignment.createMany({
      data: [
        { userId: U.mgrA.id, storeId: storeA.id },
        { userId: U.mgrB.id, storeId: storeB.id },
        { userId: U.storeLogin.id, storeId: storeA.id },
      ],
    })
    const cCorp = await prisma.notificationContact.create({ data: { organizationId: org.id, name: "NOTIFY-14 Corp contact", email: em("corp") } })
    const cStore = await prisma.notificationContact.create({ data: { organizationId: org.id, name: "NOTIFY-14 Store-login contact", email: U.storeLogin.email } })
    for (const c of [cCorp, cStore]) {
      await prisma.notificationRecipientPick.create({ data: { organizationId: org.id, kind: DOC_DIGEST_KIND, contactId: c.id } })
    }

    // ── 3. The snapshot ──────────────────────────────────────────────────────
    console.log("── 3. the snapshot: views and scopes (F1, F6, F7, F8, F13, F15) ──")
    const snap = await buildDocDigestSnapshot(org.id)
    const viewOf = (addr: string): DocDigestView | undefined => snap.views[snap.scopes[addr.toLowerCase()] ?? ""]
    const all = viewOf(U.admin.email)!
    const a = viewOf(U.mgrA.email)!
    const b = viewOf(U.mgrB.email)!
    const names = (v: DocDigestView | undefined) => (v ? v.groups.flatMap((g) => g.lines.map((l) => `${l.staffName}|${l.title}`)) : [])

    check("ADMIN maps to the org-wide view", snap.scopes[U.admin.email.toLowerCase()] === ALL_VIEW)
    check("a picked contact maps to the org-wide view (F8)", snap.scopes[em("corp")] === ALL_VIEW)
    check(
      "ADMIN groups: stores A–Z, then Unassigned, then Corporate (F6, F13)",
      all.groups.map((g) => g.name).join(" / ") === `NOTIFY-14 Store A / NOTIFY-14 Store B / ${UNASSIGNED_GROUP} / ${CORPORATE_GROUP}`,
      all.groups.map((g) => g.name).join(" / ")
    )
    const storeALines = all.groups[0]?.lines.map((l) => `${l.staffName}|${l.title}|${l.label}`) ?? []
    const was = (n: number) => documentDueLabel({ dueDate: addDays(today, -n), daysUntilDue: -n })!
    check(
      "Store A order: people A–Z; Alice's most overdue first, then due soon (F13)",
      storeALines.join(" ; ") ===
        [
          `NOTIFY-14 Alice|NOTIFY-14 Late|${was(15)}`,
          `NOTIFY-14 Alice|NOTIFY-14 Over1|${was(1)}`,
          `NOTIFY-14 Alice|NOTIFY-14 Soon3|Due in 3 days`,
          `NOTIFY-14 Bob|NOTIFY-14 Today|Due today`,
        ].join(" ; "),
      storeALines.join(" ; ")
    )
    check("day 3 is in, day 4 is out (F7)", names(all).includes("NOTIFY-14 Alice|NOTIFY-14 Soon3") && !names(all).some((n) => n.endsWith("NOTIFY-14 Due4")))
    check("terminated staff are out", !names(all).some((n) => n.startsWith("NOTIFY-14 Dan")))
    check("recordMissing is out", !names(all).some((n) => n.startsWith("NOTIFY-14 Eve")))
    check("a document with no N is out", !names(all).some((n) => n.endsWith("NOTIFY-14 NoN")))
    check("a signed document is out", !names(all).some((n) => n.startsWith("NOTIFY-14 Ivy")))
    check(
      "every label equals DOC-8's documentDueLabel()",
      all.groups.every((g) => g.lines.every((l) => l.label === documentDueLabel({ dueDate: l.dueDate, daysUntilDue: l.daysUntilDue })))
    )
    check("ADMIN counts: 5 overdue (Alice×2, Cara, Gus, Hana), 2 due soon (Alice, Bob)", all.overdue === 5 && all.dueSoon === 2, `overdue=${all.overdue} dueSoon=${all.dueSoon}`)
    check("MANAGER A sees only Store A, no Unassigned / Corporate", a.groups.map((g) => g.name).join() === "NOTIFY-14 Store A")
    check("MANAGER B sees only Store B (Cara), never corporate Gus", a !== b && names(b).join() === "NOTIFY-14 Cara|NOTIFY-14 Late")
    check("a MANAGER with no stores maps to an empty view", (viewOf(U.mgrNone.email)?.overdue ?? -1) === 0 && (viewOf(U.mgrNone.email)?.dueSoon ?? -1) === 0)

    // ── 4. exclude fails closed ──────────────────────────────────────────────
    console.log("\n── 4. exclude (F1): unknown addresses and empty views ──")
    const fakeIntent: KindIntent<DocDigestPayload> = {
      id: "n14-fake",
      organizationId: org.id,
      kind: DOC_DIGEST_KIND,
      dedupeKey: "x",
      entityId: null,
      eventAt: now,
      payload: { asOf: today, frequency: "weekly", ...snap },
    }
    const excl = (email: string) => docDigestKind.exclude!(fakeIntent as KindIntent<unknown>, { email }) as boolean
    check("an address not in the snapshot (a manager added later) is excluded", excl(em("late-manager")) === true)
    check("an address whose view is empty is excluded", excl(U.mgrNone.email) === true)
    check("an ADMIN with rows is kept", excl(U.admin.email) === false)

    // ── 5. A live send through the dispatcher ────────────────────────────────
    console.log("\n── 5. processDocDigest, live, capture sender ──")
    const cap = capture()
    const r1 = await processDocDigest({ sender: cap.sender, mode: LIVE, now, organizationId: org.id, frequency: "weekly", localDate: today })
    const tos = cap.sent.map(toOf)
    check(
      "mailed exactly: admin, manager A, manager B, the corp contact",
      sameSet(tos, [U.admin.email, U.mgrA.email, U.mgrB.email, em("corp")].map((e) => e.toLowerCase())),
      tos.join(", ")
    )
    check("the denied ADMIN is not mailed (F5)", !tos.includes(U.adminDenied.email.toLowerCase()))
    check("the empty-scope MANAGER is not mailed (draft 4)", !tos.includes(U.mgrNone.email.toLowerCase()))
    check("the store-login contact is not mailed (F8)", !tos.includes(U.storeLogin.email.toLowerCase()))
    const mailTo = (e: string) => cap.sent.find((m) => toOf(m) === e.toLowerCase())
    const adminMail = mailTo(U.admin.email)!
    const mgrAMail = mailTo(U.mgrA.email)!
    check(
      "subject: \"{Org}: 5 overdue, 2 due soon — documents to sign\" (F14)",
      adminMail?.subject === `${org.name}: 5 overdue, 2 due soon — documents to sign`,
      adminMail?.subject
    )
    check(
      "manager A's subject counts only their stores: 2 overdue, 2 due soon",
      mgrAMail?.subject === `${org.name}: 2 overdue, 2 due soon — documents to sign`,
      mgrAMail?.subject
    )
    check("heading counts documents (F16)", adminMail?.text.startsWith("7 documents are overdue or due within 3 days.") === true)
    check("text has store headings in capitals and Open compliance", /NOTIFY-14 STORE A/.test(adminMail?.text ?? "") && (adminMail?.text ?? "").includes("Open compliance: https://notify14.example.com/hr/compliance"))
    check("footer follows the weekly schedule", (adminMail?.text ?? "").includes("You get this digest at most once a week."))
    check("manager A's email names no Store B, Unassigned or Corporate staff", !/Cara|Gus|Hana/.test(mgrAMail?.text ?? "x"))
    check("HTML carries the store heading and the CTA", (adminMail?.html ?? "").includes("NOTIFY-14 Store A") && (adminMail?.html ?? "").includes("/hr/compliance"))
    check("result: sent 4, failed 0", r1.sent === 4 && r1.failed === 0, JSON.stringify(r1))

    const intents = await prisma.notificationIntent.findMany({ where: { organizationId: org.id, kind: DOC_DIGEST_KIND } })
    check("one intent for the period (F11)", intents.length === 1 && intents[0].state === "sent", intents.map((i) => `${i.dedupeKey}:${i.state}`).join())
    const msgs = await prisma.notificationMessage.count({ where: { organizationId: org.id, kind: DOC_DIGEST_KIND } })
    const audits = await prisma.auditLog.count({ where: { organizationId: org.id, action: ACTION_SENT, entityType: NOTIFICATION_ENTITY_TYPE } })
    check("one NotificationMessage per recipient attempt", msgs === 4, String(msgs))
    check("one AuditLog email.sent row per recipient attempt (draft 9)", audits === 4, String(audits))

    const cap2 = capture()
    const r2 = await processDocDigest({ sender: cap2.sender, mode: LIVE, now, organizationId: org.id, frequency: "weekly", localDate: today })
    check("a second run in the same period mails nobody (F11)", cap2.sent.length === 0 && r2.intentState === "sent", JSON.stringify(r2))

    // ── 6. Empty org, toggle, HR gate ────────────────────────────────────────
    console.log("\n── 6. empty digest, toggle off, HR off ──")
    const capE = capture()
    const rE = await processDocDigest({ sender: capE.sender, mode: LIVE, now, organizationId: emptyOrg.id, frequency: "weekly", localDate: today })
    const emptyIntents = await prisma.notificationIntent.count({ where: { organizationId: emptyOrg.id } })
    check("an org with nothing to report: skipped empty, no intent, no mail", rE.skipped === "empty" && emptyIntents === 0 && capE.sent.length === 0, JSON.stringify(rE))

    await prisma.organization.update({ where: { id: org.id }, data: { docDigestEnabled: false } })
    const capOff = capture()
    const off = await runScheduledEmails({ sender: capOff.sender, mode: LIVE, now: MON_0830, organizationId: org.id })
    const runsOff = await prisma.notificationScheduleRun.count({ where: { organizationId: org.id, kind: DOC_DIGEST_KIND } })
    check("toggle off: the runner evaluates nothing, claims nothing, mails nothing", Array.isArray(off.docDigest) && off.docDigest.length === 0 && runsOff === 0 && capOff.sent.length === 0)

    await prisma.organization.update({ where: { id: org.id }, data: { docDigestEnabled: true, activeModules: [] } })
    const capHr = capture()
    const hrOff = await runScheduledEmails({ sender: capHr.sender, mode: LIVE, now: MON_0830, organizationId: org.id })
    const runsHr = await prisma.notificationScheduleRun.count({ where: { organizationId: org.id, kind: DOC_DIGEST_KIND } })
    check("HR off: same — nothing evaluated, claimed or mailed (F10)", Array.isArray(hrOff.docDigest) && hrOff.docDigest.length === 0 && runsHr === 0 && capHr.sent.length === 0)
    check("HR off: the kind's switch is false at dispatch too", !docDigestKind.enabled({ ...(org as unknown as NotificationOrg), docDigestEnabled: true, activeModules: [] }, fakeIntent as KindIntent<unknown>))
    await prisma.organization.update({ where: { id: org.id }, data: { activeModules: ["hr"] } })

    // ── 7. The hourly runner on the default slot ─────────────────────────────
    console.log("\n── 7. runScheduledEmails at Monday 08:30 Pacific, no schedule row ──")
    const capRun = capture()
    const run1 = await runScheduledEmails({ sender: capRun.sender, mode: LIVE, now: MON_0830, organizationId: org.id })
    const d = Array.isArray(run1.docDigest) ? run1.docDigest[0] : undefined
    check("the default slot runs the org once and mails the four", d?.sent === 4 && capRun.sent.length === 4, JSON.stringify(run1.docDigest))
    const keys = (await prisma.notificationIntent.findMany({ where: { organizationId: org.id, kind: DOC_DIGEST_KIND }, select: { dedupeKey: true } })).map((i) => i.dedupeKey)
    check("its send lock is the ISO week: {orgId}:2026-W45", keys.includes(`${org.id}:2026-W45`), keys.join())
    const capRun2 = capture()
    const run2 = await runScheduledEmails({ sender: capRun2.sender, mode: LIVE, now: new Date(MON_0830.getTime() + 3_600_000), organizationId: org.id })
    check("the next hour: already run, nothing mailed", run2.docDigestOrgsAlreadyRun === 1 && capRun2.sent.length === 0)
    const capTue = capture()
    const run3 = await runScheduledEmails({ sender: capTue.sender, mode: LIVE, now: TUE_0830, organizationId: org.id })
    check("Tuesday: not due, nothing mailed", run3.docDigestOrgsNotDue === 1 && capTue.sent.length === 0)

    // ── 8. The preview render (F9) ───────────────────────────────────────────
    console.log("\n── 8. the preview renders the real digest through the test kind ──")
    const preview: TestPayload = {
      to: U.admin.email,
      provider: "console",
      stamp: now.toISOString(),
      deployEnv: "local",
      sha: "fixture",
      digestPreview: { view: a, asOf: today, frequency: "weekly" },
    }
    const pr = (testKind as unknown as { render: (p: TestPayload, o: NotificationOrg, to: string) => { subject: string; text?: string } }).render(
      preview,
      org as unknown as NotificationOrg,
      U.admin.email
    )
    check("preview subject is the real one with \"Test — \" in front", pr.subject === `Test — ${org.name}: 2 overdue, 2 due soon — documents to sign`, pr.subject)
    check("a manager-view preview shows only that manager's stores", !!pr.text && !/Cara|Gus|Hana/.test(pr.text) && pr.text.includes("NOTIFY-14 Alice"))
  } finally {
    restoreEnv()
    for (const orgId of orgIds) {
      const ints = await prisma.notificationIntent.findMany({ where: { organizationId: orgId }, select: { id: true } })
      await prisma.notificationDelivery.deleteMany({ where: { intentId: { in: ints.map((i) => i.id) } } })
      await prisma.notificationMessage.deleteMany({ where: { organizationId: orgId } })
      await prisma.notificationIntent.deleteMany({ where: { organizationId: orgId } })
      await prisma.notificationScheduleRun.deleteMany({ where: { organizationId: orgId } })
      await prisma.notificationSchedule.deleteMany({ where: { organizationId: orgId } })
      await prisma.auditLog.deleteMany({ where: { organizationId: orgId } })
      await prisma.notificationRecipientPick.deleteMany({ where: { organizationId: orgId } })
      await prisma.notificationContact.deleteMany({ where: { organizationId: orgId } })
      await prisma.hrSignedRecord.deleteMany({ where: { version: { hrDocument: { organizationId: orgId } } } })
      await prisma.hrDocumentAcknowledgment.deleteMany({ where: { version: { hrDocument: { organizationId: orgId } } } })
      await prisma.hrDocumentGrant.deleteMany({ where: { hrDocument: { organizationId: orgId } } })
      await prisma.hrDocument.deleteMany({ where: { organizationId: orgId } })
      await prisma.storeStaffAssignment.deleteMany({ where: { staffMember: { organizationId: orgId } } })
      await prisma.staffMember.deleteMany({ where: { organizationId: orgId } })
      await prisma.storeUserAssignment.deleteMany({ where: { user: { organizationId: orgId } } })
      await prisma.user.deleteMany({ where: { organizationId: orgId } })
      await prisma.store.deleteMany({ where: { organizationId: orgId } })
      await prisma.organization.delete({ where: { id: orgId } })
    }
    const left = await prisma.organization.count({ where: { id: { in: orgIds } } })
    check("cleanup: both fixture orgs are gone (re-queried)", left === 0)
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
