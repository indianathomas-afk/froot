// ─── TAB-16: "Ask a manager" — help requests from tablet checklist tasks ─────
// Rulings: docs/DECISIONS.md 2026-11-12 TAB-16, R1–R10 (Gary). Audit:
// docs/prompts/TAB-16_AUDIT.md.
//
// A HELP REQUEST IS A TeamMessage of type "help_request" (R1): it always posts,
// whatever happens to the email. It carries the task (TeamMessage.taskId), the
// checklist (sourceChecklistId — no postedForDate, so it is never read as a
// handoff note), the asker (authorStaffId; null = R4's "Not listed", shown as
// "Team member"), the quick reason (helpReason, R6) and the note (body). After
// the inline email dispatch the outcome is written to helpEmail (HelpEmail
// below), which is all any Messages surface reads to say "Emailed to …".
//
// THE EMAIL is the notification kind "help.request"
// (src/lib/notifications/kinds/help-request.ts). Its switch and "Team members
// can add more contacts" live on the org's NotificationKindSettings row for
// that kind — no row = off (R7). Its default contacts are the kind's NOTIFY-12
// "Also send to" picks.
//
// This file is server-only (Prisma). The client-safe constants and the label
// helper are in ./help-request-shared.ts.

import { prisma } from "@/lib/prisma"
import {
  HELP_REQUEST_KIND,
  HELP_WINDOW_MS,
  helpEmailAllSent,
  helpEmailLabel,
  parseHelpEmail,
  type HelpEmail,
  type TabletHelp,
  type TabletHelpRecent,
} from "@/lib/help-request-shared"

export * from "@/lib/help-request-shared"

/** The org's switch and tablet setting. No row = off, add-more on (the column default). */
export async function loadHelpSettings(
  organizationId: string
): Promise<{ enabled: boolean; tabletAddContacts: boolean }> {
  const row = await prisma.notificationKindSettings.findUnique({
    where: { organizationId_kind: { organizationId, kind: HELP_REQUEST_KIND } },
    select: { enabled: true, tabletAddContacts: true },
  })
  return { enabled: row?.enabled ?? false, tabletAddContacts: row?.tabletAddContacts ?? true }
}

/**
 * "Everyone with the Manager role at this store" (R2): MANAGER logins with a
 * StoreUserAssignment for the store — pace-alert.ts's shape. NOT
 * StoreStaffAssignment, which is the roster table and carries no role (audit
 * § 3). Logins with no email are dropped, as pace does.
 */
export async function storeManagers(organizationId: string, storeId: string) {
  const users = await prisma.user.findMany({
    where: { organizationId, role: "MANAGER", storeAssignments: { some: { storeId } } },
    select: { id: true, email: true, role: true, deniedCapabilities: true, grantedCapabilities: true },
    orderBy: { createdAt: "asc" },
  })
  return users.filter((u) => u.email.trim() !== "")
}

/** This kind's default contacts (its "Also send to" picks), active only, oldest pick first. */
export async function defaultContactIds(organizationId: string): Promise<string[]> {
  const picks = await prisma.notificationRecipientPick.findMany({
    where: { organizationId, kind: HELP_REQUEST_KIND, contactId: { not: null }, contact: { archivedAt: null } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { contactId: true },
  })
  return picks.map((p) => p.contactId!)
}

// ── The tablet's view ────────────────────────────────────────────────────────

/** One read per org plus one per store set; called from loadTabletData. */
export async function loadTabletHelp(
  organizationId: string,
  storeIds: string[],
  now: Date = new Date()
): Promise<Map<string, TabletHelp>> {
  const out = new Map<string, TabletHelp>()
  if (storeIds.length === 0) return out
  const [settings, defaults, contacts, managers, recent] = await Promise.all([
    loadHelpSettings(organizationId),
    defaultContactIds(organizationId),
    prisma.notificationContact.findMany({
      where: { organizationId, archivedAt: null },
      orderBy: [{ name: "asc" }, { email: "asc" }],
      select: { id: true, name: true, email: true },
    }),
    prisma.user.findMany({
      where: { organizationId, role: "MANAGER", storeAssignments: { some: { storeId: { in: storeIds } } } },
      select: { email: true, storeAssignments: { select: { storeId: true } } },
    }),
    prisma.teamMessage.findMany({
      where: {
        organizationId,
        storeId: { in: storeIds },
        type: "help_request",
        deletedAt: null,
        taskId: { not: null },
        createdAt: { gt: new Date(now.getTime() - HELP_WINDOW_MS) },
      },
      orderBy: { createdAt: "desc" },
      select: { storeId: true, taskId: true, createdAt: true, helpEmail: true, authorStaff: { select: { displayName: true } } },
    }),
  ])

  const defaultSet = new Set(defaults)
  const shown = settings.enabled
    ? contacts
        .filter((c) => settings.tabletAddContacts || defaultSet.has(c.id))
        .map((c) => ({ id: c.id, name: c.name, email: c.email, isDefault: defaultSet.has(c.id) }))
        // Defaults first (they start ticked), then the rest by name.
        .sort((a, b) => Number(b.isDefault) - Number(a.isDefault))
    : []

  for (const storeId of storeIds) {
    const seen = new Set<string>()
    const recentHere: TabletHelpRecent[] = []
    for (const m of recent) {
      if (m.storeId !== storeId || !m.taskId || seen.has(m.taskId)) continue
      seen.add(m.taskId)
      const e = parseHelpEmail(m.helpEmail)
      recentHere.push({
        taskId: m.taskId,
        createdAt: m.createdAt.toISOString(),
        label: helpEmailLabel(e),
        askerName: m.authorStaff?.displayName ?? "Team member",
        warn: !helpEmailAllSent(e),
      })
    }
    out.set(storeId, {
      emailsOn: settings.enabled,
      managerCount: managers.filter((u) => u.email.trim() !== "" && u.storeAssignments.some((a) => a.storeId === storeId)).length,
      contacts: shown,
      recent: recentHere,
    })
  }
  return out
}

/** The newest undeleted help request for (store, task) inside R5's window, or null. */
export async function recentHelpRequest(
  db: Pick<typeof prisma, "teamMessage">,
  storeId: string,
  taskId: string,
  now: Date
) {
  return db.teamMessage.findFirst({
    where: {
      storeId,
      taskId,
      type: "help_request",
      deletedAt: null,
      createdAt: { gt: new Date(now.getTime() - HELP_WINDOW_MS) },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true, helpEmail: true, authorStaff: { select: { displayName: true } } },
  })
}

export type { HelpEmail }
