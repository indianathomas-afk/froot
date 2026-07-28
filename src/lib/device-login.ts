// ─────────────────────────────────────────────────────────────────────────────
// PERM-7 — store device logins.
//
// PURE MODULE, NO SERVER IMPORTS. It is pulled into client components (the
// provisioning dialog, the /stores and /users badges) as well as API routes, so
// it must never reach for prisma, Clerk's server SDK, or anything in
// src/lib/clerk.ts — that file imports @clerk/nextjs/server and would poison a
// client bundle.
//
// A "device login" is a normal User with role STORE and exactly one
// StoreUserAssignment. It is NOT a second permission principal — see the PERM-7
// row in ROADMAP.yaml for why Store-as-principal was rejected. Everything here
// is a predicate over ordinary User/assignment shapes.
// ─────────────────────────────────────────────────────────────────────────────

import type { PermissionRole } from "@/lib/permissions"

/**
 * Role choices offered at provisioning, in the order the dialog renders them.
 * Default is STORE; MANAGER is marked recommended per DECISIONS.md 2026-07-27
 * (d) — it keeps store scoping, so the device stays pinned to its own location
 * while still granting operational reach. Most "keep it simple" operators want
 * no friction, not no boundaries; they have just never been offered the middle
 * option in terms they care about.
 */
export const DEVICE_ROLE_OPTIONS: {
  value: "STORE" | "MANAGER" | "ADMIN"
  label: string
  description: string
  recommended?: boolean
}[] = [
  {
    value: "STORE",
    label: "Store device",
    description: "Runs this location only. Checklists, counts, store view — no financial or personal data.",
  },
  {
    value: "MANAGER",
    label: "Manager",
    description: "Everything the store device can do, plus reports and forecasting — still limited to this location.",
    recommended: true,
  },
  {
    value: "ADMIN",
    label: "Admin",
    description: "Full access to the whole organization, not just this location.",
  },
]

/**
 * Whether a chosen role gives a device account reach beyond its own store.
 * ADMIN is the sharp case: the store picker is hidden for ADMIN
 * (users/user-actions.tsx:104), so an ADMIN device account sees EVERY store.
 */
export function isAboveStore(role: string): boolean {
  return role === "ADMIN" || role === "MANAGER"
}

/**
 * A device login is role STORE with exactly one store. Used by the /stores and
 * /users badges to tell a device apart from a human — the thing the old
 * "Has Account" badge could not do, because it was `userAssignments.length > 0`,
 * a COUNT rather than a concept (a MANAGER on three stores lit it up on all
 * three).
 */
export function isDeviceLogin(user: { role: string; assignmentCount: number }): boolean {
  return user.role === "STORE" && user.assignmentCount === 1
}

/**
 * The blast radius sentence for the count-aware warning (PERM-7 Task 3).
 *
 * Deliberately states the REAL exposure computed from the org's store count, so
 * it is unalarming for a single-location operator and stopping for a
 * twelve-store one — same control, calibrated by real exposure, with the product
 * making no judgement about who is sophisticated (DECISIONS.md 2026-07-27 (a)).
 */
export function blastRadius(role: string, storeName: string, orgStoreCount: number): string | null {
  if (!isAboveStore(role)) return null
  if (role === "MANAGER") {
    return `This gives the shared device at ${storeName} manager-level access to ${storeName} — including reports and forecasting for this location.`
  }
  const n = orgStoreCount
  if (n <= 1) {
    return `This gives the shared device at ${storeName} full administrative access to your whole organization.`
  }
  return `This gives the shared device at ${storeName} access to all ${n} of your locations, including financial data for stores this device isn't at.`
}

/**
 * Concrete consequences of an ADMIN device account, never the phrase "elevated
 * access" (DECISIONS.md 2026-07-27 (b)). Ordered sharpest-first.
 */
export const ADMIN_DEVICE_CONSEQUENCES = [
  "Disconnecting Square is admin-only and drops the live org-wide token — a tap on this shared device breaks sales sync for the entire business.",
  "Dashboard sales goals can be overwritten from this device.",
  "The goal-edit audit log records this device's address, not a person — you learn the building, not who.",
  "The credential is shared, so it cannot be revoked for one person.",
] as const

/** Same list, trimmed to what actually applies at MANAGER. */
export const MANAGER_DEVICE_CONSEQUENCES = [
  "Reports and forecasting for this location are visible to whoever is standing at the counter.",
  "The credential is shared, so it cannot be revoked for one person.",
] as const

export function deviceConsequences(role: string): readonly string[] {
  if (role === "ADMIN") return ADMIN_DEVICE_CONSEQUENCES
  if (role === "MANAGER") return MANAGER_DEVICE_CONSEQUENCES
  return []
}

/**
 * One real mailbox, N distinct identities. See DECISIONS.md 2026-07-28 for the
 * verification that Clerk preserves subaddresses (it blocks rather than
 * normalises, and the block is off on both instances) and for the standing
 * dependency on that dashboard setting.
 *
 * `tag` is slugified because Square location names are free text.
 */
export function plusAddress(email: string, tag?: string): string {
  const at = email.lastIndexOf("@")
  if (at <= 0) return email
  const local = email.slice(0, at)
  const domain = email.slice(at + 1)
  // Don't stack tags — re-tagging an already-plus-addressed address replaces.
  const base = local.split("+")[0]
  const slug =
    (tag ?? "store")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "store"
  return `${base}+${slug}@${domain}`
}

/** Narrow a free-form role string to the permission layer's union. */
export function asPermissionRole(role: string): PermissionRole | null {
  return role === "ADMIN" || role === "MANAGER" || role === "STORE" || role === "STAFF" ? role : null
}
