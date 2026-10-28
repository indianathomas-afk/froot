import { auth } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"
import { getOrganization, requireAdmin } from "@/lib/auth"
import { getClerkPrimaryEmail } from "@/lib/clerk"
import { randomUUID } from "node:crypto"
import { emailProviderName, type DeliveryMode } from "@/lib/notify"
import {
  dispatchNotifications,
  enqueueNotification,
  recordUndispatchable,
  resolveTransport,
} from "@/lib/notifications/dispatch"
import { sampleableKinds, type TestPayload } from "@/lib/notifications/kinds/test"
import { savedScheduleFrequency } from "@/lib/notifications/schedule-settings"
import { prisma } from "@/lib/prisma"
import { DEFAULT_TIME_ZONE } from "@/lib/hr"
import { localDateStr } from "@/lib/reports"
import { docDigestView, digestIsEmpty } from "@/lib/hr-doc-digest"
import { DOC_DIGEST_KIND, docDigestHrActive } from "@/lib/notifications/kinds/doc-digest"
import type { ScheduleFrequency } from "@/lib/notifications/define"

// POST /api/notify/test — NOTIFY-1. Proves real delivery from a deployed
// environment without giving anyone a way to email arbitrary people.
//
// THE RECIPIENT IS NEVER SUPPLIED BY THE CALLER. There is no request body;
// the address is the caller's OWN Clerk primary email, resolved server-side.
// That is the whole security model of this route: an ADMIN can prove the
// provider works, and cannot turn it into a send-to-anyone endpoint.
//
// Primary email via getClerkPrimaryEmail(), not User.email — BUG-2's rule.
// The DB column is a copy maintained by the Clerk webhook, and this route's
// entire job is to answer "did an email reach the human sitting here", so it
// asks Clerk rather than a cache of Clerk.
//
// NOTIFY-5: every response carries `mode` (live | sandbox | dry-run; null when
// the provider value itself is invalid). In SANDBOX the caller is mailed
// WHETHER OR NOT they are on NOTIFY_SANDBOX_ALLOWLIST — the caller is always
// the only recipient, which is this route's whole security model, so the
// allowlist has nothing to protect here. In DRY-RUN the row is `email.dryrun`.
// The "Send a test to me" button on /settings/notifications is the first UI
// caller.
//
// NOTIFY-6: THE ROUTE IS NOW A PRODUCER. Every press enqueues a fresh "test"
// intent (a random dedupeKey, never deduplicated) carrying the caller's
// address, and dispatches it inline; the response the button reads is mapped
// from that one recipient's result and keeps its shape (ok, mode, provider,
// to, id). The email text lives in src/lib/notifications/kinds/test.ts.
//
// MS-4b: `?kind=milestone.reached` sends that kind's sample() instead of the
// delivery test — STILL NO BODY, and the query names only WHAT to render,
// never who to send it to. It is still a `test` intent with the caller as its
// one recipient, so nothing about the security model above changes. Only kinds
// that define sample() are accepted; anything else is a 400.
//
// NOTIFY-14 (F9, Gary 2026-10-27: "agreed."): `?kind=hr.doc.digest` sends a
// REAL-DATA preview of the document digest — built by the cron's own builder
// for the caller's view (ADMIN: the whole org), or, with `&asUser=<userId>`
// naming a MANAGER of THIS org, for that manager's stores. `asUser` chooses
// whose VIEW is rendered and never who receives it: the recipient is still
// only the caller, so the security model above is unchanged. An ADMIN already
// sees the whole org on /hr/compliance, so nothing new is exposed. An empty
// view sends nothing (draft ruling 4) and says so. HR available + active
// (F10) or 404.
//
// CONSOLE MODE RETURNS ok: true AND THAT IS CORRECT. The console sender did
// exactly what it is for — the response names the provider, so a "success"
// with provider: "console" reads as "nothing left the building", which is the
// honest answer and not a bug to fix.
export async function POST(req: Request) {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 })
  }

  const params = new URL(req.url).searchParams
  const sampleOf = params.get("kind") ?? undefined
  const isDigest = sampleOf === DOC_DIGEST_KIND
  if (sampleOf !== undefined && !isDigest && !sampleableKinds().includes(sampleOf)) {
    return NextResponse.json({ error: `No sample for kind "${sampleOf}"` }, { status: 400 })
  }

  // NOTIFY-2b: the org, for the audit row and the template header. Resolved
  // before the send so a failure is still attributable to a tenant — a failed
  // row with no organizationId cannot appear on anybody's page.
  let org: Awaited<ReturnType<typeof getOrganization>>
  try {
    org = await getOrganization()
  } catch {
    return NextResponse.json({ error: "Org not found" }, { status: 404 })
  }

  // NOTIFY-14: the digest preview's view, resolved before anything is sent.
  let digestPreview: TestPayload["digestPreview"]
  if (isDigest) {
    if (!docDigestHrActive(org)) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const asUser = params.get("asUser")
    let storeIds: string[] | null = null
    if (asUser) {
      const manager = await prisma.user.findFirst({
        where: { id: asUser, organizationId: org.id, role: "MANAGER" },
        select: { storeAssignments: { select: { storeId: true } } },
      })
      if (!manager) return NextResponse.json({ error: "No such manager in this organization" }, { status: 400 })
      storeIds = manager.storeAssignments.map((a) => a.storeId)
    }
    const view = await docDigestView(org.id, storeIds)
    if (digestIsEmpty(view)) {
      return NextResponse.json({ ok: true, empty: true, message: "Nothing overdue or due soon for this view — no email sent." })
    }
    const row = await prisma.notificationSchedule.findUnique({
      where: { organizationId_kind: { organizationId: org.id, kind: DOC_DIGEST_KIND } },
      select: { frequency: true, timeZone: true },
    })
    digestPreview = {
      view,
      asOf: localDateStr(new Date(), row?.timeZone ?? DEFAULT_TIME_ZONE),
      frequency: (row?.frequency as ScheduleFrequency | undefined) ?? "weekly",
    }
  }

  const to = await getClerkPrimaryEmail(userId)
  if (!to) {
    return NextResponse.json(
      { error: "Your Clerk account has no primary email address to send to" },
      { status: 400 }
    )
  }

  // Resolved without validating, so a bad NOTIFY_EMAIL_PROVIDER is NAMED in
  // the failure response rather than swallowed by the throw it causes below.
  const provider = emailProviderName()
  const stamp = new Date().toISOString()
  const deployEnv = process.env.VERCEL_ENV ?? "local"
  const sha = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "unknown"

  // NOTIFY-13a: a sample follows the org's SAVED schedule wording (C5), like
  // the real emails. Still no body: the org is the caller's own.
  const sampleFrequency = sampleOf && !isDigest ? await savedScheduleFrequency(org.id, sampleOf) : undefined
  const payload: TestPayload = {
    to,
    provider,
    stamp,
    deployEnv,
    sha,
    ...(sampleOf && !isDigest ? { sampleOf } : {}),
    ...(digestPreview ? { digestPreview } : {}),
    ...(sampleFrequency ? { sampleFrequency } : {}),
  }
  const enq = await enqueueNotification({
    organizationId: org.id,
    kind: "test",
    dedupeKey: randomUUID(),
    entityId: null,
    eventAt: new Date(),
    payload,
  })
  if (!enq) {
    return NextResponse.json(
      { provider, to, mode: null, ok: false, error: "could not record the test email" },
      { status: 502 }
    )
  }

  let mode: DeliveryMode | null = null
  try {
    // Inside the try: deliveryMode() throws on an unknown provider, and that
    // must come back as the 502 below naming the value, not as an unhandled 500.
    const transport = resolveTransport()
    mode = transport.mode
    const [r] = await dispatchNotifications({ transport, trigger: "producer", intentIds: [enq.intentId] })
    const result = r?.recipients.find((x) => x.to === to.trim().toLowerCase()) ?? r?.recipients[0]
    if (!result) throw new Error(r?.reason || "the test was not dispatched")
    if (result.status === "failed") throw new Error(result.error ?? "email send failed")
    if (result.status === "sent") {
      return NextResponse.json({ provider, to, mode, ok: true, ...(result.providerMessageId ? { id: result.providerMessageId } : {}) })
    }
    // dry-run (logged through the console sender, recorded "Dry run — not sent").
    return NextResponse.json({ provider, to, mode, ok: true })
  } catch (e) {
    const message = e instanceof Error ? e.message : "email send failed"
    console.error(`[notify:test] provider=${provider}: ${message}`)
    // The dispatcher already recorded a failed send. Only an unresolvable
    // provider (mode still null) reaches here with nothing on the log.
    if (mode === null) await recordUndispatchable(enq.intentId, message)
    return NextResponse.json({ provider, to, mode, ok: false, error: message }, { status: 502 })
  }
}
