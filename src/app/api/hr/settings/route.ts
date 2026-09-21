import { auth } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireAdmin, hrModuleAvailable } from "@/lib/auth"

// HR-16: org-level HR settings. Today it carries one field —
// Organization.hrAckRecipients, the addresses that hear about a completed
// acknowledgment.
//
// SAME SHAPE AS /api/hr/toggle, deliberately: availability gate first (where HR
// doesn't exist, this endpoint doesn't either), then requireAdmin(), then Zod,
// then the org lookup. F1 (Gary, 2026-09-20) ruled ADMIN ONLY — "who at
// corporate hears about signatures" is a corporate choice, not a store-level
// one — and the surface is /settings, which is ADMIN_ONLY at the page
// (settings.access, src/lib/permissions.ts:273) and cannot be granted down.
// The check here is independent of that page's, per PERM-2: a gate on a page is
// not a gate on an endpoint.

const MAX_RECIPIENTS = 10

// The field is free text — "one or more addresses, comma or newline separated"
// — so the SPLIT LIVES HERE rather than in the client. One parser, server-side,
// means the stored value cannot depend on which client wrote it, and the client
// renders whatever this returns.
const bodySchema = z.object({ recipients: z.string().max(2000) })

const emailSchema = z.string().email()

export type ParsedRecipients =
  | { ok: true; recipients: string[] }
  | { ok: false; error: string }

export function parseRecipients(raw: string): ParsedRecipients {
  const entries = raw
    .split(/[\n,;]+/)
    .map((e) => e.trim())
    .filter((e) => e.length > 0)

  const invalid = entries.filter((e) => !emailSchema.safeParse(e).success)
  if (invalid.length > 0) {
    return { ok: false, error: `Not a valid email address: ${invalid.slice(0, 3).join(", ")}` }
  }

  // Lowercased before the dedupe, so Gary@ and gary@ are one recipient rather
  // than two copies of the same email. Addresses are case-insensitive in the
  // domain and in practice in the local part too; storing one canonical form
  // also keeps the AuditLog recipient lists comparable.
  const deduped = [...new Set(entries.map((e) => e.toLowerCase()))]
  if (deduped.length > MAX_RECIPIENTS) {
    return { ok: false, error: `At most ${MAX_RECIPIENTS} addresses (found ${deduped.length})` }
  }
  return { ok: true, recipients: deduped }
}

export async function PUT(req: Request) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  if (!hrModuleAvailable(orgId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 })
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 })

  const recipients = parseRecipients(parsed.data.recipients)
  if (!recipients.ok) return NextResponse.json({ error: recipients.error }, { status: 400 })

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  // EMPTY IS A LEGITIMATE VALUE AND THE WAY TO TURN SENDING OFF (F3). Clearing
  // the field stores [], and the next mint logs a named skip instead of
  // emailing. There is no separate enable switch, on purpose: two controls that
  // can disagree about whether mail goes out is one more than this needs.
  const updated = await prisma.organization.update({
    where: { id: org.id },
    data: { hrAckRecipients: recipients.recipients },
  })

  return NextResponse.json({ recipients: updated.hrAckRecipients })
}
