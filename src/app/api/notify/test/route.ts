import { auth } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"
import { getOrganization, requireAdmin } from "@/lib/auth"
import { getClerkPrimaryEmail } from "@/lib/clerk"
import { emailProviderName, getEmailSender } from "@/lib/notify"
import { renderEmail } from "@/lib/email-template"
import { ACTION_FAILED, ACTION_SENT, recordEmailAttempt } from "@/lib/notification-log"

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
// CONSOLE MODE RETURNS ok: true AND THAT IS CORRECT. The console sender did
// exactly what it is for — the response names the provider, so a "success"
// with provider: "console" reads as "nothing left the building", which is the
// honest answer and not a bug to fix.
export async function POST() {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 })
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

  // NOTIFY-2b: the text is UNCHANGED and passed through the template verbatim.
  // What the branded HTML adds here is a second job this route now does — it is
  // the one email an admin can fire on demand, so it is also the only way to
  // look at the template without waiting for a store to fall behind pace or for
  // someone to sign a document.
  const subject = `USE Froot test — ${stamp}`
  const text = [
    `This is a USE Froot email delivery test.`,
    ``,
    `Provider:   ${provider}`,
    `Deployment: ${deployEnv} @ ${sha}`,
    `Sent at:    ${stamp}`,
    ``,
    `If you are reading this in an inbox, real email delivery works in this`,
    `environment. Nothing else was sent — this route only ever writes to the`,
    `address on the requesting admin's own Clerk account.`,
  ].join("\n")

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim()
  const { html } = renderEmail({
    orgName: org.name,
    heading: "This is a USE Froot email delivery test.",
    intro:
      "If you are reading this in an inbox, real email delivery works in this environment. " +
      "Nothing else was sent — this route only ever writes to the address on the requesting " +
      "admin's own Clerk account.",
    rows: [
      { label: "Provider", value: provider },
      { label: "Deployment", value: `${deployEnv} @ ${sha}` },
      { label: "Sent at", value: stamp },
    ],
    // No host, no button. The CTA is the only part of this email that needs an
    // absolute URL, and a test message is exactly the wrong place to fail over
    // a missing variable — see the fallback in email-template.ts.
    cta: appUrl ? { label: "Email notification settings", url: `${appUrl}/settings/notifications` } : undefined,
    footer: `Sent by USE Froot on behalf of ${org.name}. This address does not accept replies.`,
    appUrl,
    text,
  })

  try {
    const sender = getEmailSender()
    const { id } = await sender.send({ to, subject, text, html })
    await recordEmailAttempt({
      organizationId: org.id,
      entityId: null,
      kind: "test",
      action: ACTION_SENT,
      recipients: [to],
      subject,
      resendId: id ?? null,
    })
    return NextResponse.json({ provider, to, ok: true, ...(id ? { id } : {}) })
  } catch (e) {
    const message = e instanceof Error ? e.message : "email send failed"
    console.error(`[notify:test] provider=${provider}: ${message}`)
    await recordEmailAttempt({
      organizationId: org.id,
      entityId: null,
      kind: "test",
      action: ACTION_FAILED,
      recipients: [to],
      subject,
      error: message,
    })
    return NextResponse.json({ provider, to, ok: false, error: message }, { status: 502 })
  }
}
