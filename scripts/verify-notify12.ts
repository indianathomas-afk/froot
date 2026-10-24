/**
 * NOTIFY-12 acceptance fixture — per-kind "Also send to" recipients and the
 * org address book.
 *
 *   npx tsx scripts/verify-notify12.ts
 *
 * Runs against the DEV database (local .env), which must already have
 * migration 20261023200000_notify12_recipients. Creates throwaway orgs
 * "NOTIFY-12 Fixture Org A / B / C (safe to delete)" with users, one store and
 * contacts, then checks:
 *   A. NO PICKS → UNCHANGED: a pace dispatch reaches exactly the role default,
 *      in the resolver's order, every message tagged "role" only.
 *   B. EXTRAS MERGED (pace): de-duped against the role default with merged
 *      reasons; a denied user who is picked is not sent (F3); a STORE-login
 *      user pick is refused (F8); a contact holding a denied user's address is
 *      not sent (F9); a contact holding a STORE login's address is not sent
 *      (Gary 2026-10-23); a contact whose address two users share, one of them
 *      denied, is not sent (Gary 2026-10-23); a contact matching an allowed
 *      user is sent. One email per address.
 *   C. ARCHIVED: an archived contact receives nothing and its pick survives;
 *      restoring it restores the email (F5).
 *   D. hr.ack (F12): no active pick → the intent expires as switched off, and
 *      an archived contact's pick does not count; active picks → every picked
 *      address is mailed, a store login's included (hr.ack has no capability).
 *      (The producer's row-less skip is verify-notify6 section I.)
 *   E. extras: false: picks on the test and milestone kinds are never read.
 *   F. THE SAVE PATH (validatePicks / replaceContactPicks): user picks refused
 *      (DEBT-106), more than 10 refused, another org's or an archived contact
 *      refused, milestone/test 404, hr.ack 404 where HR is unavailable; a save
 *      keeps an archived contact's pick.
 *   G. THE F1 BACKFILL, replayed from the migration file on one org: contacts
 *      and hr.ack picks equal the column as a set (trimmed, lower-cased,
 *      de-duplicated, blanks dropped); a second run adds nothing; the column is
 *      untouched.
 *   H. REASONS ARE RECORDED in dry-run and sandbox too: NotificationMessage.
 *      recipientReasons and the parallel AuditLog row's `reasons`.
 *   I. PUT /api/hr/settings is retired: 410, column untouched.
 *   J. Tenant isolation: org B's dispatch reaches none of org A's picks.
 *
 * Nothing reaches Resend: dispatch takes an injected capture transport.
 *
 * NEGATIVE CONTROLS: in dispatch.ts eligibleRecipients, drop the extras
 * (`const extras = []`) — B and D must FAIL; in picks.ts, attach matched[0]
 * instead of the failing match — the shared-address check must FAIL; set
 * USER_PICKS_ENABLED = true — the DEBT-106 check must FAIL.
 */
import "dotenv/config"
import { readFileSync } from "node:fs"
import path from "node:path"
import { prisma } from "../src/lib/prisma"
import type { DeliveryMode, EmailMessage, EmailSender } from "../src/lib/notify"
import { ACTION_SENT, NOTIFICATION_ENTITY_TYPE } from "../src/lib/notification-log"
import {
  dispatchNotifications,
  enqueueNotification,
  type Transport,
} from "../src/lib/notifications/dispatch"
import { getKind } from "../src/lib/notifications/registry"
import { MILESTONE_KIND } from "../src/lib/notifications/kinds/milestone"
import { paceAlertKind } from "../src/lib/notifications/kinds/pace-alert"
import type { HrAckPayload } from "../src/lib/notifications/kinds/hr-ack"
import { replaceContactPicks, validatePicks } from "../src/lib/notifications/contacts"
import { can, grantsFrom, overridesFrom } from "../src/lib/permissions"
import { PUT as retiredHrSettings } from "../src/app/api/hr/settings/route"

let failures = 0
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${label}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures += 1
}
const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])
const sameSet = (a: string[], b: string[]) => same([...a].sort(), [...b].sort())

// ── env, set in-process and always restored ──────────────────────────────────
const ENV_KEYS = ["VERCEL_ENV", "NOTIFY_EMAIL_PROVIDER", "NOTIFY_SANDBOX_ALLOWLIST", "NEXT_PUBLIC_APP_URL", "HR_MODULE_AVAILABLE", "HR_INTERNAL_ORG_IDS"] as const
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
function setEnv(vals: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>) {
  for (const k of ENV_KEYS) {
    if (!(k in vals)) continue
    const v = vals[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
}
function restoreEnv() {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
}

// ── capture transport ────────────────────────────────────────────────────────
type Capture = { sent: EmailMessage[]; sender: EmailSender }
function capture(): Capture {
  const sent: EmailMessage[] = []
  return {
    sent,
    sender: {
      async send(m) {
        sent.push(m)
        return { id: `n12-cap-${Math.random().toString(36).slice(2, 10)}` }
      },
    },
  }
}
const transport = (mode: DeliveryMode, cap: Capture): Transport => ({ mode, sender: () => cap.sender })
const toOf = (m: EmailMessage) => (Array.isArray(m.to) ? m.to.join(",") : m.to)

async function main() {
  const tag = Date.now().toString(36)
  const em = (k: string) => `notify12-${k}-${tag}@example.com`
  const asOf = new Date().toISOString().slice(0, 10)

  const [orgA, orgB, orgC] = await Promise.all(
    ["A", "B", "C"].map((x) =>
      prisma.organization.create({
        data: {
          clerkOrgId: `notify12-fixture-${x.toLowerCase()}-${tag}`,
          name: `NOTIFY-12 Fixture Org ${x} (safe to delete)`,
          activeModules: ["hr"],
          paceAlertsEnabled: true,
        },
      })
    )
  )
  const orgIds = [orgA.id, orgB.id, orgC.id]
  const [{ branch }] = await prisma.$queryRaw<{ branch: string | null }[]>`SELECT current_setting('neon.branch_id', true) AS branch`
  console.log(`\nFixture orgs ${orgA.id} (A), ${orgB.id} (B), ${orgC.id} (C) — NOTIFY-12 · neon.branch_id=${branch ?? "(null)"}\n`)

  try {
    setEnv({ NEXT_PUBLIC_APP_URL: "https://notify12.example.com", NOTIFY_EMAIL_PROVIDER: "console", VERCEL_ENV: undefined, HR_MODULE_AVAILABLE: "true" })

    // ── Fixture rows ─────────────────────────────────────────────────────────
    const store = await prisma.store.create({ data: { organizationId: orgA.id, name: "NOTIFY-12 Store", timezone: "America/Los_Angeles" } })
    const storeB = await prisma.store.create({ data: { organizationId: orgB.id, name: "NOTIFY-12 Store B", timezone: "America/Los_Angeles" } })
    const mk = (orgId: string, key: string, role: "ADMIN" | "MANAGER" | "STORE", email = em(key), denied: string[] = []) =>
      prisma.user.create({
        data: { clerkUserId: `notify12-${key}-${tag}`, organizationId: orgId, email, role, deniedCapabilities: denied },
      })
    const admin = await mk(orgA.id, "admin", "ADMIN")
    const adminDenied = await mk(orgA.id, "admin-denied", "ADMIN", em("admin-denied"), ["notify.pace.receive"])
    const mgr = await mk(orgA.id, "mgr", "MANAGER")
    const mgrDenied = await mk(orgA.id, "mgr-denied", "MANAGER", em("mgr-denied"), ["notify.pace.receive"])
    const storeLogin = await mk(orgA.id, "store", "STORE")
    // Not on the store, so not in pace's role default: reachable only as extras.
    const mgrOther = await mk(orgA.id, "mgr-other", "MANAGER")
    await mk(orgA.id, "shared-ok", "MANAGER", em("shared"))
    await mk(orgA.id, "shared-denied", "MANAGER", em("shared"), ["notify.pace.receive"])
    for (const u of [mgr, mgrDenied, storeLogin]) {
      await prisma.storeUserAssignment.create({ data: { userId: u.id, storeId: store.id } })
    }
    const adminB = await mk(orgB.id, "admin-b", "ADMIN")

    const contact = (orgId: string, key: string, email = em(key)) =>
      prisma.notificationContact.create({ data: { organizationId: orgId, name: `NOTIFY-12 ${key}`, email } })
    const cCorp = await contact(orgA.id, "corp")
    const cAdmin = await contact(orgA.id, "c-admin", admin.email)
    const cDenied = await contact(orgA.id, "c-mgr-denied", mgrDenied.email)
    const cStore = await contact(orgA.id, "c-store", storeLogin.email)
    const cShared = await contact(orgA.id, "c-shared", em("shared"))
    const cOther = await contact(orgA.id, "c-mgr-other", mgrOther.email)
    const cOld = await contact(orgA.id, "old")
    const cB = await contact(orgB.id, "corp-b")

    let seq = 0
    const paceIntent = async (orgId = orgA.id, storeId = store.id) => {
      seq += 1
      // Each section sends a fresh store-month alert; pace's onSent writes one
      // PaceAlertLog per (store, month), so clear it rather than log a P2002.
      await prisma.paceAlertLog.deleteMany({ where: { storeId } })
      const r = await enqueueNotification({
        organizationId: orgId,
        kind: "pace.alert",
        dedupeKey: `notify12-pace-${tag}-${seq}`,
        entityId: null,
        eventAt: new Date(),
        payload: { storeId, storeName: "NOTIFY-12 Store", monthStart: `${asOf.slice(0, 7)}-01`, asOf, mtdActual: 1, mtdGoal: 2, goalAmount: null, projected: 1, pacePct: 50, thresholdPct: 90 },
      })
      if (!r) throw new Error("fixture: enqueue failed")
      return r.intentId
    }
    const ackIntent = async () => {
      seq += 1
      const p: HrAckPayload = {
        signedRecordId: `notify12-record-${tag}-${seq}`, title: "NOTIFY-12 Handbook", versionNumber: 1,
        nameOnRecord: "NOTIFY-12 Staff", executedName: "NOTIFY-12 Staff", storeName: null, completedAt: new Date().toISOString(),
      }
      const r = await enqueueNotification({ organizationId: orgA.id, kind: "hr.ack", dedupeKey: `notify12-ack-${tag}-${seq}`, entityId: null, eventAt: new Date(), payload: p })
      if (!r) throw new Error("fixture: enqueue failed")
      return r.intentId
    }
    const dispatch = (intentId: string, t: Transport) =>
      dispatchNotifications({ transport: t, trigger: "producer", intentIds: [intentId] })
    const messagesOf = (intentId: string) =>
      prisma.notificationMessage.findMany({ where: { intentId }, orderBy: { createdAt: "asc" } })
    const reasonsBy = async (intentId: string) =>
      Object.fromEntries((await messagesOf(intentId)).map((m) => [m.to, m.recipientReasons.join("+")]))

    // ── A. no picks → unchanged ──────────────────────────────────────────────
    {
      const id = await paceIntent()
      const intent = await prisma.notificationIntent.findUniqueOrThrow({ where: { id } })
      // What the role default resolves to today, filtered exactly as before NOTIFY-12.
      const role = await paceAlertKind.resolveRecipients(
        { ...intent, payload: intent.payload } as Parameters<typeof paceAlertKind.resolveRecipients>[0],
        {} as Parameters<typeof paceAlertKind.resolveRecipients>[1]
      )
      const expected = role
        .filter((r) => !r.user || can({ role: r.user.role, overrides: overridesFrom(r.user.deniedCapabilities), grants: grantsFrom(r.user.grantedCapabilities) }, "notify.pace.receive"))
        .map((r) => r.email.toLowerCase())
      const cap = capture()
      const [r] = await dispatch(id, transport("live", cap))
      const msgs = await messagesOf(id)
      check("A no picks: candidates = the role default only", r.candidates === role.length, `${r.candidates} vs ${role.length}`)
      check("A no picks: sent to exactly the role default, in the resolver's order", same(cap.sent.map(toOf), expected), cap.sent.map(toOf).join(" "))
      check("A no picks: the role default is admin + mgr (denied admin/manager dropped)", sameSet(expected, [admin.email, mgr.email]))
      check("A no picks: every message tagged role only", msgs.length === expected.length && msgs.every((m) => same(m.recipientReasons, ["role"])))
    }

    // ── B. extras merged (pace) ──────────────────────────────────────────────
    {
      const v = await validatePicks(orgA, "pace.alert", { contactIds: [cCorp.id, cAdmin.id, cDenied.id, cStore.id, cShared.id, cOther.id] })
      check("B save: six contacts on pace validate", v.ok)
      if (v.ok) await replaceContactPicks(orgA.id, "pace.alert", v.contactIds)
      // User picks cannot be saved through the route yet (DEBT-106); the
      // dispatcher still has to be right about them, so they are written here.
      for (const u of [mgr, adminDenied, storeLogin]) {
        await prisma.notificationRecipientPick.create({ data: { organizationId: orgA.id, kind: "pace.alert", userId: u.id } })
      }
      const id = await paceIntent()
      const cap = capture()
      const [r] = await dispatch(id, transport("live", cap))
      const sentTo = cap.sent.map(toOf)
      const reasons = await reasonsBy(id)
      check("B one email per address", new Set(sentTo).size === sentTo.length, sentTo.join(" "))
      check(
        "B sent to exactly: admin, mgr, corp contact, allowed-manager contact",
        sameSet(sentTo, [admin.email, mgr.email, cCorp.email, cOther.email]),
        sentTo.join(" ")
      )
      check("B role first, extras after, extras in pick order", same(sentTo.slice(2), [cCorp.email, cOther.email]) && sameSet(sentTo.slice(0, 2), [admin.email, mgr.email]))
      check("B de-dup merges reasons: admin = role + extra-contact", reasons[admin.email] === "role+extra-contact", reasons[admin.email])
      check("B de-dup merges reasons: mgr = role + extra-user", reasons[mgr.email] === "role+extra-user", reasons[mgr.email])
      check("B plain contact = extra-contact", reasons[cCorp.email] === "extra-contact" && reasons[cOther.email] === "extra-contact")
      check("B F3: a denied ADMIN picked as a user is not sent", !sentTo.includes(adminDenied.email))
      check("B F8: a STORE login picked as a user is not sent", !sentTo.includes(storeLogin.email))
      check("B F9: a contact holding a denied manager's address is not sent", !sentTo.includes(cDenied.email))
      check("B a contact holding a STORE login's address is not sent", !sentTo.includes(cStore.email))
      check("B shared address, one of two users denied → not sent", !sentTo.includes(cShared.email))
      check("B candidates count the extras", r.candidates === 4 + 9, String(r.candidates))
      check("B the intent is sent", r.outcome === "sent")
    }

    // ── C. archived contact ──────────────────────────────────────────────────
    {
      await prisma.notificationContact.update({ where: { id: cCorp.id }, data: { archivedAt: new Date() } })
      const id = await paceIntent()
      const cap = capture()
      await dispatch(id, transport("live", cap))
      const pick = await prisma.notificationRecipientPick.findFirst({ where: { organizationId: orgA.id, kind: "pace.alert", contactId: cCorp.id } })
      check("C archived contact receives nothing", !cap.sent.map(toOf).includes(cCorp.email))
      check("C its pick survives", !!pick)
      await prisma.notificationContact.update({ where: { id: cCorp.id }, data: { archivedAt: null } })
      const id2 = await paceIntent()
      const cap2 = capture()
      await dispatch(id2, transport("live", cap2))
      check("C restored contact receives it again", cap2.sent.map(toOf).includes(cCorp.email))
    }

    // ── D. hr.ack (F12) ──────────────────────────────────────────────────────
    {
      const none = await ackIntent()
      const [r0] = await dispatch(none, transport("live", capture()))
      check("D no hr.ack picks → expired as switched off", r0.outcome === "expired" && r0.reason === "switched off for this organization", r0.reason)

      await prisma.notificationContact.update({ where: { id: cOld.id }, data: { archivedAt: new Date() } })
      await prisma.notificationRecipientPick.create({ data: { organizationId: orgA.id, kind: "hr.ack", contactId: cOld.id } })
      const archivedOnly = await ackIntent()
      const [r1] = await dispatch(archivedOnly, transport("live", capture()))
      check("D only an archived contact picked → still switched off", r1.outcome === "expired", r1.reason)

      const v = await validatePicks(orgA, "hr.ack", { contactIds: [cCorp.id, cStore.id] })
      check("D save: two contacts on hr.ack validate", v.ok)
      if (v.ok) await replaceContactPicks(orgA.id, "hr.ack", v.contactIds)
      const live = await ackIntent()
      const cap = capture()
      const [r2] = await dispatch(live, transport("live", cap))
      check("D active picks → sent to exactly the picked addresses", r2.outcome === "sent" && sameSet(cap.sent.map(toOf), [cCorp.email, cStore.email]), cap.sent.map(toOf).join(" "))
      check("D a store login's address still gets hr.ack (no capability)", cap.sent.map(toOf).includes(cStore.email))
      check("D hr.ack reasons are extra-contact", Object.values(await reasonsBy(live)).every((x) => x === "extra-contact"))
      // The producer's row-less skip with no picks needs a signed record; it is
      // verify-notify6 section I ("empty list → skipped, and NO intent written"),
      // which seeds through picks since NOTIFY-12.
    }

    // ── E. extras: false ─────────────────────────────────────────────────────
    {
      check("E registry: milestone takes no extras (F11)", getKind(MILESTONE_KIND)?.extras === false)
      check("E registry: test takes no extras", getKind("test")?.extras === false)
      check("E registry: pace and hr.ack take extras", getKind("pace.alert")?.extras === true && getKind("hr.ack")?.extras === true)
      for (const k of ["test", MILESTONE_KIND]) {
        await prisma.notificationRecipientPick.create({ data: { organizationId: orgA.id, kind: k, contactId: cCorp.id } })
      }
      const t = await enqueueNotification({
        organizationId: orgA.id, kind: "test", dedupeKey: `notify12-test-${tag}`, entityId: null, eventAt: new Date(),
        payload: { to: admin.email, provider: "console", stamp: "x", deployEnv: "fixture", sha: "notify12" },
      })
      const cap = capture()
      await dispatch(t!.intentId, transport("live", cap))
      check("E a test send ignores a test pick row: only its caller", same(cap.sent.map(toOf), [admin.email]), cap.sent.map(toOf).join(" "))
    }

    // ── F. the save path ─────────────────────────────────────────────────────
    {
      const u = await validatePicks(orgA, "pace.alert", { contactIds: [], userIds: [mgr.id] })
      check("F user picks refused until DEBT-106", !u.ok && u.status === 400 && u.error.includes("DEBT-106"), u.ok ? "accepted" : u.error)
      const extra = await Promise.all(Array.from({ length: 11 }, (_, i) => contact(orgA.id, `bulk-${i}`)))
      const many = await validatePicks(orgA, "pace.alert", { contactIds: extra.map((c) => c.id) })
      check("F more than 10 refused", !many.ok && many.status === 400)
      const foreign = await validatePicks(orgA, "pace.alert", { contactIds: [cB.id] })
      check("F another org's contact refused", !foreign.ok && foreign.status === 400)
      const archived = await validatePicks(orgA, "pace.alert", { contactIds: [cOld.id] })
      check("F an archived contact refused", !archived.ok && archived.status === 400)
      const ms = await validatePicks(orgA, MILESTONE_KIND, { contactIds: [cCorp.id] })
      const tst = await validatePicks(orgA, "test", { contactIds: [cCorp.id] })
      const nope = await validatePicks(orgA, "no.such.kind", { contactIds: [] })
      check("F milestone, test and unknown kinds 404", !ms.ok && ms.status === 404 && !tst.ok && tst.status === 404 && !nope.ok && nope.status === 404)
      setEnv({ HR_MODULE_AVAILABLE: undefined, HR_INTERNAL_ORG_IDS: undefined })
      const hrOff = await validatePicks(orgA, "hr.ack", { contactIds: [cCorp.id] })
      setEnv({ HR_MODULE_AVAILABLE: "true" })
      check("F hr.ack 404 where HR is unavailable", !hrOff.ok && hrOff.status === 404)
      const bad = await validatePicks(orgA, "pace.alert", { contactIds: "nope" })
      check("F malformed body 400", !bad.ok && bad.status === 400)

      // hr.ack holds cCorp, cStore (active) and cOld (archived). Saving [cCorp] keeps cOld's pick.
      const saved = await replaceContactPicks(orgA.id, "hr.ack", [cCorp.id])
      const rows = await prisma.notificationRecipientPick.findMany({ where: { organizationId: orgA.id, kind: "hr.ack" }, select: { contactId: true } })
      check("F save returns the active picks", same(saved, [cCorp.id]))
      check("F save keeps an archived contact's pick and drops the unticked one", sameSet(rows.map((p) => p.contactId!), [cCorp.id, cOld.id]))
    }

    // ── G. the F1 backfill, replayed from the migration file ─────────────────
    {
      const column = ["  Notify12-X@Example.com", "notify12-x@example.com", "notify12-y@example.com", " ", "NOTIFY12-Y@EXAMPLE.COM"]
      await prisma.organization.update({ where: { id: orgC.id }, data: { hrAckRecipients: column } })
      const sql = readFileSync(path.join(__dirname, "../prisma/migrations/20261023200000_notify12_recipients/migration.sql"), "utf8")
      const backfill = sql.slice(sql.indexOf("-- F1 BACKFILL, step 1"))
      const statements = backfill
        .split(/;\s*\n/)
        .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
        .filter((s) => s.startsWith("INSERT"))
      check("G the migration holds exactly two backfill INSERTs", statements.length === 2, String(statements.length))
      // Scope each statement to org C only — the same text, with its one
      // "Organization" o narrowed — so every other org on dev is untouched.
      const scoped = statements.map((s) => {
        const n = s.split(`"Organization" o`).length - 1
        if (n !== 1) throw new Error(`fixture: expected one "Organization" o per statement, found ${n}`)
        return s.replace(`"Organization" o`, `(SELECT * FROM "Organization" WHERE "id" = '${orgC.id}') o`)
      })
      for (const s of scoped) await prisma.$executeRawUnsafe(s)
      const expected = ["notify12-x@example.com", "notify12-y@example.com"]
      const contacts = await prisma.notificationContact.findMany({ where: { organizationId: orgC.id } })
      const picks = await prisma.notificationRecipientPick.findMany({ where: { organizationId: orgC.id, kind: "hr.ack" }, include: { contact: true } })
      check("G contacts = the column as a set (trim, lower, de-dup, no blanks)", sameSet(contacts.map((c) => c.email), expected), contacts.map((c) => c.email).join(" "))
      check("G contact name is the address", contacts.every((c) => c.name === c.email))
      check("G hr.ack picks = the column as a set", sameSet(picks.map((p) => p.contact!.email), expected))
      for (const s of scoped) await prisma.$executeRawUnsafe(s)
      const again = await prisma.notificationRecipientPick.count({ where: { organizationId: orgC.id } })
      check("G a second run adds nothing", again === 2 && (await prisma.notificationContact.count({ where: { organizationId: orgC.id } })) === 2)
      const after = await prisma.organization.findUniqueOrThrow({ where: { id: orgC.id }, select: { hrAckRecipients: true } })
      check("G the column is untouched", same(after.hrAckRecipients, column))
    }

    // ── H. reasons recorded in dry-run and sandbox ───────────────────────────
    {
      const dry = await paceIntent()
      await dispatch(dry, transport("dry-run", capture()))
      const dm = await messagesOf(dry)
      check("H dry-run messages carry reasons", dm.length > 0 && dm.every((m) => m.mode === "dry-run" && m.recipientReasons.length > 0))
      check("H dry-run: the plain contact is extra-contact", dm.find((m) => m.to === cCorp.email)?.recipientReasons.join("+") === "extra-contact")

      setEnv({ NOTIFY_SANDBOX_ALLOWLIST: cCorp.email })
      const sb = await paceIntent()
      const cap = capture()
      await dispatch(sb, transport("sandbox", cap))
      const sm = (await messagesOf(sb)).find((m) => m.mode === "sandbox")
      check("H sandbox: only the allow-listed contact is mailed", same(cap.sent.map(toOf), [cCorp.email]))
      check("H sandbox message carries reasons", sm?.recipientReasons.join("+") === "extra-contact")
      const audit = sm
        ? await prisma.auditLog.findFirst({
            where: { organizationId: orgA.id, action: ACTION_SENT, entityType: NOTIFICATION_ENTITY_TYPE, metadata: { path: ["notificationMessageId"], equals: sm.id } },
          })
        : null
      const meta = (audit?.metadata ?? {}) as { reasons?: string[] }
      check("H the parallel AuditLog row carries reasons", same(meta.reasons ?? [], ["extra-contact"]), JSON.stringify(meta.reasons))
      setEnv({ NOTIFY_SANDBOX_ALLOWLIST: undefined })
    }

    // ── I. PUT /api/hr/settings retired ──────────────────────────────────────
    {
      const before = await prisma.organization.findUniqueOrThrow({ where: { id: orgC.id }, select: { hrAckRecipients: true } })
      const res = await retiredHrSettings()
      const after = await prisma.organization.findUniqueOrThrow({ where: { id: orgC.id }, select: { hrAckRecipients: true } })
      check("I PUT /api/hr/settings → 410", res.status === 410)
      check("I it writes nothing", same(before.hrAckRecipients, after.hrAckRecipients))
    }

    // ── J. tenant isolation ──────────────────────────────────────────────────
    {
      await replaceContactPicks(orgB.id, "pace.alert", [cB.id])
      const id = await paceIntent(orgB.id, storeB.id)
      const cap = capture()
      await dispatch(id, transport("live", cap))
      check("J org B reaches its admin and its own contact only", sameSet(cap.sent.map(toOf), [adminB.email, cB.email]), cap.sent.map(toOf).join(" "))
    }
  } finally {
    restoreEnv()
    for (const orgId of orgIds) {
      const intents = await prisma.notificationIntent.findMany({ where: { organizationId: orgId }, select: { id: true } })
      await prisma.notificationDelivery.deleteMany({ where: { intentId: { in: intents.map((i) => i.id) } } })
      await prisma.notificationMessage.deleteMany({ where: { organizationId: orgId } })
      await prisma.notificationIntent.deleteMany({ where: { organizationId: orgId } })
      await prisma.auditLog.deleteMany({ where: { organizationId: orgId } })
      await prisma.notificationRecipientPick.deleteMany({ where: { organizationId: orgId } })
      await prisma.notificationContact.deleteMany({ where: { organizationId: orgId } })
      await prisma.storeUserAssignment.deleteMany({ where: { user: { organizationId: orgId } } })
      await prisma.user.deleteMany({ where: { organizationId: orgId } })
      await prisma.store.deleteMany({ where: { organizationId: orgId } })
      await prisma.organization.delete({ where: { id: orgId } })
    }
    console.log(`\nFixture orgs ${orgIds.join(", ")} (NOTIFY-12) and everything under them deleted.`)
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED`)
    process.exit(1)
  }
  console.log("\nAll NOTIFY-12 checks passed.")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
