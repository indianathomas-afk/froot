// ─────────────────────────────────────────────────────────────────────────────
// MS-1 — THE ONE GATE every milestone route and page asks first. Shape copied
// from src/lib/calendar-access.ts (requireCalendar); read that header for why
// OFF IS 404, NOT 403 — a 403 tells an unauthorised caller the feature exists.
//
// THREE CONDITIONS MAKE MILESTONES "ON", AND ALL THREE ARE REQUIRED (F5, Gary
// 2026-10-15: "Milestones is part of HR; HR off means Milestones off
// everywhere"):
//   1. hrModuleAvailable(clerkOrgId) — HR exists in this environment;
//   2. activeModules includes "hr"   — this org has HR;
//   3. Organization.milestonesEnabled — the admin toggle on /settings.
// /staff/[id] already 404s without (1) and (2), so a Milestones tab could
// never render there anyway; putting all three here is what makes every OTHER
// surface — /staff/milestones, the /staff link, the APIs, the /settings card —
// agree with the tab about whether Milestones exists.
//
// milestonesActive() is the same predicate for callers that already hold the
// org row (pages), so the rule is written once.
// ─────────────────────────────────────────────────────────────────────────────

import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hrModuleAvailable } from "@/lib/auth"
import { can, type Capability, type PermissionUser } from "@/lib/permissions"

export type MilestonesAccessDenied = "unauthenticated" | "no-org" | "disabled" | "forbidden"

export type MilestonesAccess =
  | {
      ok: true
      org: { id: string; clerkOrgId: string; timezone: string }
      actor: PermissionUser
      isAdmin: boolean
      /** EMPTY FOR AN ADMIN — `isAdmin` is the unrestricted flag. */
      storeIds: string[]
    }
  | { ok: false; reason: MilestonesAccessDenied }

/** HR available here, HR on for this org, and the milestones toggle on. */
export function milestonesActive(org: {
  clerkOrgId: string
  activeModules: string[]
  milestonesEnabled: boolean
}): boolean {
  return hrModuleAvailable(org.clerkOrgId) && org.activeModules.includes("hr") && org.milestonesEnabled
}

/**
 * session → org → MODULE (all three conditions) → (optionally) a capability.
 * The module gate sits ahead of the capability so a disabled org answers 404 to
 * everyone, ADMIN included.
 */
export async function requireMilestones(capability?: Capability): Promise<MilestonesAccess> {
  const { orgId } = await auth()
  if (!orgId) return { ok: false, reason: "unauthenticated" }

  const org = await prisma.organization.findUnique({
    where: { clerkOrgId: orgId },
    select: { id: true, clerkOrgId: true, timezone: true, activeModules: true, milestonesEnabled: true },
  })
  if (!org) return { ok: false, reason: "no-org" }
  if (!milestonesActive(org)) return { ok: false, reason: "disabled" }

  // getCurrentUser(), never a bare clerkUserId lookup (CLAUDE.md § Page
  // Conventions — DEBT-53/F1).
  const { dbUser, actor } = await getCurrentUser()
  if (capability && !can(actor, capability)) return { ok: false, reason: "forbidden" }

  return {
    ok: true,
    org: { id: org.id, clerkOrgId: org.clerkOrgId, timezone: org.timezone },
    actor,
    isAdmin: dbUser?.role === "ADMIN",
    storeIds: dbUser?.storeAssignments.map((a) => a.storeId) ?? [],
  }
}

export function milestonesDenialStatus(reason: MilestonesAccessDenied): number {
  switch (reason) {
    case "unauthenticated":
      return 401
    case "no-org":
    case "disabled":
      return 404
    case "forbidden":
      return 403
  }
}

export function milestonesDenialBody(reason: MilestonesAccessDenied): { error: string } {
  switch (reason) {
    case "unauthenticated":
      return { error: "Unauthorized" }
    case "no-org":
      return { error: "Org not found" }
    case "disabled":
      return { error: "Not found" }
    case "forbidden":
      return { error: "Forbidden" }
  }
}
