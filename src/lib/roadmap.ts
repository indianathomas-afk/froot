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
  /**
   * Filed rather than fixed, and kept for the record — the work was retracted,
   * not completed. Added 2026-08-01 by Gary's ruling for DEBT-18 and DEBT-23,
   * which had both been sitting open with "WITHDRAWN" as the first word of
   * their titles because no status value fit.
   *
   * Counts as RESOLVED in isResolvedDebt (roadmap-client.tsx) — a withdrawn row
   * is not outstanding work. It carries NO `commits`, deliberately: nothing was
   * fixed, so there is no SHA to cite.
   *
   * BOARD_COLUMNS claims no column for it — see DEBT-37.
   */
  | "withdrawn"

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
   * `status` and `commits` are OMITTED on every row that is still outstanding.
   * Added 2026-07-28 when DEBT-8 became the first debt item ever resolved,
   * mirroring `Bug` above rather than inventing a third shape.
   *
   * RENDERED since DEBT-14 shipped (46e1b64): roadmap-client.tsx splits the
   * debt list on this field. `isResolvedDebt` there is the single definition
   * of which statuses count as resolved — read it rather than assuming a set.
   * A missing status must be read as OPEN, since every outstanding row omits
   * it.
   */
  status?: PhaseStatus
  commits?: string[]
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
