// ─── Template operational phases (DEBT-1b) ───────────────────────────────────
// The single source of truth for every path that WRITES
// Template.operationalPhase. Deliberately free of Prisma and React imports so
// API routes and client components can both use it — src/lib/messages.ts pulls
// in the Prisma runtime, which is why handoff-notes.tsx had to hand-copy its
// map rather than import one.
//
// This is NOT the I-14b ordering alias. PHASE_ORDER in src/lib/messages.ts and
// its hand-copied twin in handoff-notes.tsx still map legacy "During Hours" for
// READ paths and stay in place as belt-and-braces until DEBT-32 retires them.
// Consolidating all three lists belongs to that row, not this one.

export const OPERATIONAL_PHASES = ["Before Opening", "During the Day", "After Closing"] as const
export type OperationalPhase = (typeof OPERATIONAL_PHASES)[number]

// The one legacy variant, written by the original template import
// (scripts/import-keva-templates.ts, fixed in DEBT-1b). Its meaning is
// unambiguous — I-14b already ordered it identically to the canonical value —
// so it is CORRECTED on the way in rather than rejected: CSV files exported
// before the DEBT-1b backfill still exist on disk and must keep importing.
// Every other unrecognised value is rejected loudly at the entry point.
const LEGACY_ALIASES: Record<string, OperationalPhase> = {
  "During Hours": "During the Day",
}

/**
 * Trim, treat empty as absent, and map the known legacy alias to canonical.
 * Returns null for absent — AllDay templates legitimately store null.
 * Does NOT validate: an unrecognised value comes back unchanged so the caller
 * can reject it and name it in the error.
 */
export function normalizePhase(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return LEGACY_ALIASES[trimmed] ?? trimmed
}

/** True for a canonical phase, or for null (AllDay templates store null). */
export function isOperationalPhase(value: string | null): value is OperationalPhase | null {
  return value === null || (OPERATIONAL_PHASES as readonly string[]).includes(value)
}
