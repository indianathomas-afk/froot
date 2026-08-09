// ─── Template operational phases (DEBT-1b) ───────────────────────────────────
// The single source of truth for every path that WRITES
// Template.operationalPhase. Deliberately free of Prisma and React imports so
// API routes and client components can both use it — src/lib/messages.ts pulls
// in the Prisma runtime, which is why handoff-notes.tsx had to hand-copy its
// map rather than import one.
//
// DEBT-32 IS DONE (CHK-2, 2026-08-09) and the paragraph that stood here is
// replaced rather than left to mislead: the READ ordering now lives at the
// bottom of this file, both former copies import it, and the I-14b alias is
// gone from both. The comment above is kept because it still explains WHY this
// file is the one that can hold it — no Prisma, no React, so both sides of the
// client boundary can import it.

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

// ─── Day sequence, for READ paths (DEBT-32, folded here by CHK-2) ─────────────
// Template.operationalPhase orders a store's checklists within the day. This
// used to be THREE lists: OPERATIONAL_PHASES above, PHASE_ORDER in
// src/lib/messages.ts, and a hand-copied twin in handoff-notes.tsx that could
// not import the messages.ts one because that module pulls in the Prisma
// runtime. It is now one, and it is DERIVED from OPERATIONAL_PHASES rather than
// restated — a second list cannot drift from the canonical one if it IS the
// canonical one. CHK-3's expectedWindow() is the fourth reader this was folded
// ahead of; it reads the same list.
//
// THE I-14b LEGACY ALIAS IS RETIRED HERE, and deleting it changes no output.
// Both former maps carried `"During Hours": 1` and both fell back to `?? 1` for
// anything they did not recognise, so the alias only ever restated the default.
// Every input returns exactly what it returned before: the three canonical
// phases their index, and the legacy string, null, empty and any unrecognised
// value MID.
//
// normalizePhase() is deliberately NOT called here. It trims, and the old maps
// did not — a whitespace-padded "  Before Opening  " ordered as MID before this
// fold, and it must keep ordering as MID. Correcting that would be a behaviour
// change wearing a cleanup's clothes; the WRITE paths already normalize, which
// is where the trimming belongs.

// Unrecognised phases sort to the middle of the day rather than to either end:
// a note posted to an unknown slot must not silently become an opener or a
// closer. Preserved from the `?? 1` this replaces.
const MID_PHASE_ORDER = 1

export function phaseOrder(operationalPhase: string | null): number {
  const i = (OPERATIONAL_PHASES as readonly string[]).indexOf(operationalPhase ?? "")
  return i === -1 ? MID_PHASE_ORDER : i
}
