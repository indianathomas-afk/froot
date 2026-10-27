// ─── NOTIFY-12: the org address book and the per-kind picks, for the admin UI ─
// Reads and limits shared by /settings/notifications and the /api/notify
// contact and recipient routes. The DISPATCHER does not use this file — it
// reads picks through ./picks.ts — so nothing here can change who is mailed.

import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { hrModuleAvailable } from "@/lib/auth"
import { getKind } from "./registry"

/** F13: picks per kind (users plus contacts), matching HR-16's old MAX_RECIPIENTS. */
export const MAX_PICKS_PER_KIND = 10
/** F13: active contacts per org. Arbitrary; it only stops bulk-mailing through the book. */
export const MAX_ACTIVE_CONTACTS = 100

/**
 * F10 (Gary, 2026-10-23): this step is contacts only, and the save route
 * refuses user picks until DEBT-106 marks departed users. Flip this when it
 * closes; the schema and the dispatcher already handle user picks.
 */
export const USER_PICKS_ENABLED = false

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

export type ContactView = {
  id: string
  name: string
  email: string
  archived: boolean
  /**
   * The address is a STORE login in this org. Gary, 2026-10-23: such a contact
   * is resolved as that login (F9) and so drops from behind-pace alerts, and
   * the UI warns about it.
   */
  matchesStoreLogin: boolean
}

/** Lower-cased emails of this org's STORE logins. */
export async function storeLoginEmails(organizationId: string): Promise<Set<string>> {
  const rows = await prisma.user.findMany({
    where: { organizationId, role: "STORE" },
    select: { email: true },
  })
  return new Set(rows.map((r) => normalizeEmail(r.email)).filter(Boolean))
}

export async function isStoreLoginEmail(organizationId: string, email: string): Promise<boolean> {
  const n = await prisma.user.count({
    where: { organizationId, role: "STORE", email: { equals: normalizeEmail(email), mode: "insensitive" } },
  })
  return n > 0
}

/** Every contact, archived included: active first, then by name. */
export async function listContacts(organizationId: string): Promise<ContactView[]> {
  const [rows, store] = await Promise.all([
    prisma.notificationContact.findMany({
      where: { organizationId },
      orderBy: [{ name: "asc" }, { email: "asc" }],
      select: { id: true, name: true, email: true, archivedAt: true },
    }),
    storeLoginEmails(organizationId),
  ])
  return rows
    .map((c) => ({
      id: c.id,
      name: c.name,
      email: c.email,
      archived: c.archivedAt !== null,
      matchesStoreLogin: store.has(c.email),
    }))
    .sort((a, b) => Number(a.archived) - Number(b.archived))
}

/** Contact ids picked per kind, archived contacts included (their picks survive, F5). */
export async function contactPicksByKind(organizationId: string): Promise<Record<string, string[]>> {
  const rows = await prisma.notificationRecipientPick.findMany({
    where: { organizationId, contactId: { not: null } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { kind: true, contactId: true },
  })
  const out: Record<string, string[]> = {}
  for (const r of rows) (out[r.kind] ??= []).push(r.contactId!)
  return out
}

// ── Saving one kind's "Also send to" list ────────────────────────────────────
// PUT /api/notify/recipients/[kind] is auth → org → these two. They take the
// org as an argument and never read a session, so scripts/verify-notify12.ts
// drives them directly.

const picksBodySchema = z.object({
  contactIds: z.array(z.string().min(1)).max(MAX_PICKS_PER_KIND * 2),
  userIds: z.array(z.string().min(1)).optional(),
})

export type PicksValidation = { ok: true; contactIds: string[] } | { ok: false; status: number; error: string }

/**
 * GATES, IN ORDER: the kind exists and takes extras (404; milestone is
 * `extras: false` by F11 and test never takes them) → hr.ack only where HR
 * exists in this environment (404, as PUT /api/hr/settings was) → the body →
 * NO USER PICKS (Gary, 2026-10-23: "the save route rejects user picks until
 * DEBT-106") → at most 10 (F13) → every contact is this org's and active.
 */
export async function validatePicks(
  org: { id: string; clerkOrgId: string },
  kind: string,
  body: unknown
): Promise<PicksValidation> {
  const def = getKind(kind)
  if (!def || !def.extras) return { ok: false, status: 404, error: "Not found" }
  // NOTIFY-14 (F10): the document digest is HR's too.
  if ((kind === "hr.ack" || kind === "hr.doc.digest") && !hrModuleAvailable(org.clerkOrgId)) {
    return { ok: false, status: 404, error: "Not found" }
  }

  const parsed = picksBodySchema.safeParse(body)
  if (!parsed.success) return { ok: false, status: 400, error: "Invalid body" }
  if (!USER_PICKS_ENABLED && (parsed.data.userIds?.length ?? 0) > 0) {
    return { ok: false, status: 400, error: "Froot users can't be added yet (DEBT-106). Add them as a contact instead." }
  }

  const wanted = [...new Set(parsed.data.contactIds)]
  if (wanted.length > MAX_PICKS_PER_KIND) {
    return { ok: false, status: 400, error: `At most ${MAX_PICKS_PER_KIND} recipients.` }
  }
  const found = await prisma.notificationContact.count({
    where: { id: { in: wanted }, organizationId: org.id, archivedAt: null },
  })
  if (found !== wanted.length) {
    return { ok: false, status: 400, error: "A chosen contact no longer exists or is archived. Reload and try again." }
  }
  return { ok: true, contactIds: wanted }
}

/**
 * Replace the ACTIVE contact picks for (org, kind) with `contactIds`, in that
 * order, and return what is saved. Picks of ARCHIVED contacts are left alone,
 * so un-archiving a contact restores where it was picked (F5). User picks are
 * untouched (none can be saved yet). Validate first.
 */
export async function replaceContactPicks(organizationId: string, kind: string, contactIds: string[]): Promise<string[]> {
  await prisma.$transaction(async (tx) => {
    await tx.notificationRecipientPick.deleteMany({
      where: { organizationId, kind, contactId: { notIn: contactIds }, contact: { archivedAt: null } },
    })
    const have = await tx.notificationRecipientPick.findMany({
      where: { organizationId, kind, contactId: { in: contactIds } },
      select: { contactId: true },
    })
    const haveIds = new Set(have.map((p) => p.contactId))
    // One at a time, in the order sent: picks resolve oldest first.
    for (const contactId of contactIds) {
      if (!haveIds.has(contactId)) {
        await tx.notificationRecipientPick.create({ data: { organizationId, kind, contactId } })
      }
    }
  })
  const picks = await prisma.notificationRecipientPick.findMany({
    where: { organizationId, kind, contact: { archivedAt: null } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { contactId: true },
  })
  return picks.map((p) => p.contactId!)
}
