// ─── NOTIFY-12: "Also send to" — the extras a kind's role default is merged with ─
// docs/prompts/NOTIFY-RCPT_AUDIT.md. A kind's own resolveRecipients() is its
// ROLE DEFAULT; the rows here are the per-org, per-kind extras an ADMIN picked.
// The dispatcher (./dispatch.ts eligibleRecipients) is the only caller that
// turns them into recipients, and it runs can() AFTER the merge — so a picked
// user who is denied the kind's capability is still dropped (F3), and a
// notify.* key still only ever removes a person.
//
// ACTIVE = a user pick, or a contact pick whose contact is not archived (F5).
// An archived contact's picks are kept, so un-archiving restores them, but they
// neither enable a kind nor receive anything.
//
// F9: A CONTACT WHOSE ADDRESS IS A FROOT USER'S IS RESOLVED AS THAT USER, so the
// address book cannot re-add someone their Users-page row took off. The reason
// stays "extra-contact". User.email is not unique within an org, so when more
// than one row matches, a row that FAILS the capability is the one attached —
// any matching denial wins. A kind with no capability (hr.ack) is unaffected,
// which keeps the F1 backfill exact.

import { prisma } from "@/lib/prisma"
import { can, grantsFrom, overridesFrom, type Capability } from "@/lib/permissions"
import type { ResolvedRecipient } from "./define"

const ACTIVE_PICK = { OR: [{ userId: { not: null } }, { contact: { archivedAt: null } }] }

const USER_SELECT = {
  id: true,
  email: true,
  role: true,
  organizationId: true,
  deniedCapabilities: true,
  grantedCapabilities: true,
} as const

type PickUser = { id: string; email: string; role: string; deniedCapabilities: string[]; grantedCapabilities: string[] }

function asRecipientUser(u: PickUser): NonNullable<ResolvedRecipient["user"]> {
  return { id: u.id, role: u.role, deniedCapabilities: u.deniedCapabilities, grantedCapabilities: u.grantedCapabilities }
}

function holds(u: PickUser, capability: Capability): boolean {
  return can(
    { role: u.role, overrides: overridesFrom(u.deniedCapabilities), grants: grantsFrom(u.grantedCapabilities) },
    capability
  )
}

/** Active picks per kind for one org — what F12's hr.ack switch reads. */
export async function countActivePicks(organizationId: string): Promise<Record<string, number>> {
  const rows = await prisma.notificationRecipientPick.groupBy({
    by: ["kind"],
    where: { organizationId, ...ACTIVE_PICK },
    _count: { _all: true },
  })
  return Object.fromEntries(rows.map((r) => [r.kind, r._count._all]))
}

/**
 * The extras for (org, kind), each stamped with its reason. Oldest pick first,
 * so the order is stable. NOT filtered by can() or exclude — the dispatcher
 * does both after the merge, exactly as it does for the role default.
 */
export async function resolveExtras(
  organizationId: string,
  kind: string,
  capability?: Capability
): Promise<ResolvedRecipient[]> {
  const picks = await prisma.notificationRecipientPick.findMany({
    where: { organizationId, kind, ...ACTIVE_PICK },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      user: { select: USER_SELECT },
      contact: { select: { email: true } },
    },
  })
  if (picks.length === 0) return []

  // F9: every Froot user in this org holding a picked contact's address.
  const contactEmails = [...new Set(picks.flatMap((p) => (p.contact ? [p.contact.email.trim().toLowerCase()] : [])))].filter(Boolean)
  const usersByEmail = new Map<string, PickUser[]>()
  if (contactEmails.length > 0) {
    const matches = await prisma.user.findMany({
      where: { organizationId, OR: contactEmails.map((e) => ({ email: { equals: e, mode: "insensitive" as const } })) },
      orderBy: { createdAt: "asc" },
      select: USER_SELECT,
    })
    for (const u of matches) {
      const key = u.email.trim().toLowerCase()
      usersByEmail.set(key, [...(usersByEmail.get(key) ?? []), u])
    }
  }

  const out: ResolvedRecipient[] = []
  for (const p of picks) {
    if (p.user) {
      // Org-scoped: a pick can only ever name this org's user, but the read
      // does not rely on the write having checked.
      if (p.user.organizationId !== organizationId || !p.user.email.trim()) continue
      out.push({ email: p.user.email, user: asRecipientUser(p.user), reasons: ["extra-user"] })
    } else if (p.contact) {
      const email = p.contact.email.trim().toLowerCase()
      if (!email) continue
      const matched = usersByEmail.get(email) ?? []
      const attach = (capability && matched.find((u) => !holds(u, capability))) || matched[0]
      out.push({ email, ...(attach ? { user: asRecipientUser(attach) } : {}), reasons: ["extra-contact"] })
    }
  }
  return out
}
