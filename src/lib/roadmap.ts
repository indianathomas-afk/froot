// Types for the roadmap board at /internal/roadmap.
//
// The shape mirrors docs/ROADMAP.yaml — the single source of truth for phase
// status. Nothing here is read at runtime: scripts/generate-roadmap.mjs parses
// the YAML at build time and emits src/generated/roadmap.ts against these
// types. That keeps the serverless bundle free of both the YAML file and a
// runtime parser, and it's the only way the git commit date can be captured at
// all (there is no .git directory inside a lambda).
//
// Every field except `id` and `title` is optional because the YAML omits what
// doesn't apply — a planned phase has no `shipped` date or `commits`.

export type PhaseStatus =
  | "planned"
  | "in_progress"
  | "staging"
  | "shipped"
  | "verified"

export interface Phase {
  id: string
  title: string
  track?: string
  size?: string
  status?: PhaseStatus
  /** ISO date (YYYY-MM-DD) the work reached main/prod. */
  shipped?: string
  commits?: string[]
  notes?: string
  /** Free-text strings, not structured records — see ROADMAP.yaml. */
  blockers?: string[]
  deferred?: string[]
  open?: string[]
  tags?: string[]
  /** Not currently used by any phase; searched if it ever appears. */
  keywords?: string[]
}

export interface Bug {
  id: string
  title: string
  status?: PhaseStatus
  shipped?: string
  commits?: string[]
  notes?: string
}

export interface DebtItem {
  id: string
  title: string
  notes?: string
  /**
   * Optional, and OMITTED on every row that is still outstanding. Added
   * 2026-07-28 when DEBT-8 became the first debt item ever resolved; it borrows
   * the phase vocabulary (`staging` -> `shipped`).
   *
   * NOTHING RENDERS THIS YET — the debt list is still unconditional, under a
   * heading that asserts "not yet fixed". That is DEBT-14. A missing status
   * must be read as OPEN, since every other row omits it.
   */
  status?: PhaseStatus
}

/**
 * Where the "last updated" timestamp on the page actually came from. Rendered
 * verbatim next to the date so a fallback can never masquerade as the real git
 * commit date.
 */
export type LastUpdatedSource = "git" | "meta" | "unknown"

export interface RoadmapData {
  phases: Phase[]
  bugs: Bug[]
  debt: DebtItem[]
  /** ISO 8601 instant, or null when neither git nor meta.updated resolved. */
  lastUpdated: string | null
  lastUpdatedSource: LastUpdatedSource
  /** ISO 8601 instant the generator ran — the build time, not the edit time. */
  generatedAt: string
}

/** Board columns. `in_progress` folds into Planned; the card carries a badge. */
export const BOARD_COLUMNS = [
  { key: "planned", label: "Planned", statuses: ["planned", "in_progress"] },
  { key: "staging", label: "In staging", statuses: ["staging"] },
  { key: "production", label: "In production", statuses: ["shipped", "verified"] },
] as const satisfies ReadonlyArray<{
  key: string
  label: string
  statuses: ReadonlyArray<PhaseStatus>
}>

export type BoardColumnKey = (typeof BOARD_COLUMNS)[number]["key"]

export function columnForStatus(status?: PhaseStatus): BoardColumnKey {
  for (const column of BOARD_COLUMNS) {
    if (status && (column.statuses as ReadonlyArray<string>).includes(status)) {
      return column.key
    }
  }
  return "planned"
}
