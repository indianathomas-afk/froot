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

/**
 * One entry in a phase's `blockers` list. P-4, 2026-08-01.
 *
 * A BARE STRING MEANS LIVE. That is DEBT-14's rule one level down — a missing
 * marker reads as outstanding — and it is the safe direction: an entry nobody
 * has classified keeps blocking, so the panel can over-report but never
 * under-report. Every entry in ROADMAP.yaml was a bare string before this
 * landed, so defaulting the other way would have silently closed all nineteen.
 *
 * A resolved entry carries `{ resolved: true, text }`. Its prose is NEVER
 * edited to add the flag: the house preserve-and-mark convention keeps the
 * original text as the record, and several rows say explicitly that the ORDER
 * of the entries is the lesson. The flag is additive metadata sitting over text
 * that stays byte-identical.
 *
 * WHY A FLAG AND NOT PREFIX DETECTION on the existing CLOSED / RESOLVED /
 * WITHDRAWN / GATE CLEARED markers — this was measured against the real data,
 * not assumed. F-5's LIVE blocker opens "VERIFIED STILL TRUE" and F-4's opens
 * "CONFIRMED LIVE", so a marker matcher closes two live blockers; and PERM-6's
 * two closed entries carry no marker at all, because they are closed by a
 * SEPARATE entry prepended above them in the same array. Both directions wrong
 * on the same file. Prose cannot carry this count.
 *
 * `isResolvedBlocker` in roadmap-client.tsx is the single definition of which
 * entries are resolved — read it rather than restating the test here (DEBT-26).
 *
 * NEVER ADD `resolved: false`. Relocated here from DEBT-41 2026-08-02 by
 * DEBT-TRIAGE-2, because this is where the person about to add it is standing.
 * It carries exactly the value the ABSENCE of the flag already carries, and
 * introducing it invites marking entries false wholesale — which destroys the
 * "a missing flag means live" default that makes the whole scheme safe. There
 * is a real gap in this type (no value for a half-closed entry, of which
 * BUILD-1's is the live instance) and `resolved: false` is not it: a third
 * state needs its own name and its own render treatment. DEBT-41 is AWAITING
 * GARY'S RULING and its standing instruction is to watch for one NEW example
 * before designing anything.
 */
export type BlockerEntry = string | { resolved: true; text: string }

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
  /**
   * Mixed by design: bare strings are live, `{ resolved: true, text }` entries
   * are closed and kept in place for the record. See BlockerEntry above.
   */
  blockers?: BlockerEntry[]
  /**
   * STILL BARE STRINGS, and they carry the same defect blockers just had:
   * resolved entries stay in the array forever. Three exist at time of writing
   * — PERM-2's sole `deferred` entry opens "RESOLVED 2026-07-27", and PERM-6,
   * PERM-7 and SEC-1 each carry a closed `open` entry. Left alone by Gary's
   * ruling 2026-08-01: no headline count reads either field, so the cost is a
   * card badge rather than an untrustworthy promotion answer. Filed as DEBT-42.
   */
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
 * A pending ruling's state. DELIBERATELY NOT PhaseStatus — `shipped` and
 * `verified` are meaningless for a decision, and reusing that union would let
 * one be set.
 *
 * `deferred` is NOT a third flavour of open. A deferral IS a decision — just
 * not the final one — so it does not count toward the "awaiting a call" number
 * on the page. That is the whole reason it exists as a value rather than being
 * written as a note on an open entry.
 *
 * `isOpenRuling` in roadmap-client.tsx is the single definition of which
 * rulings are outstanding — read it rather than restating the test here
 * (DEBT-26), exactly as the two comments above do for `isResolvedBlocker` and
 * `isResolvedDebt`.
 */
export type RulingStatus = "open" | "ruled" | "deferred"

/**
 * One open decision awaiting Gary's call. Added 2026-08-05.
 *
 * A DECISION LOG, NOT A SECOND DEBT TABLE — an entry belongs here only when the
 * next step is a decision rather than work. The full convention (including why
 * the source sheet's R8 became a note on DEBT-44 instead of an entry) lives in
 * the header comment above `rulings:` in docs/ROADMAP.yaml, which is where
 * whoever adds the next one is standing.
 *
 * `ruling` AND `ruled` ARE ABSENT UNTIL A CALL IS MADE — never present-and-
 * empty. Absence already carries "not yet decided", and a field duplicating
 * what absence says is the mistake documented on BlockerEntry above for
 * `resolved: false`: it invites being filled in wholesale, which destroys the
 * default that makes the scheme readable.
 *
 * NO `commits` FIELD, deliberately. A ruling is a decision, not work; the SHA
 * belongs on whatever row the ruling creates, and a ruling that produced no
 * commit is the normal case rather than a gap.
 */
export interface Ruling {
  id: string
  title: string
  status?: RulingStatus
  /** ISO date (YYYY-MM-DD) the question was raised. */
  asked?: string
  question?: string
  options?: string[]
  recommendation?: string
  /** Present only once decided. */
  ruling?: string
  /** ISO date (YYYY-MM-DD) the call was made. Present only once decided. */
  ruled?: string
  /** Related row ids — phases, bugs or debt. Rendered as plain text, not links. */
  links?: string[]
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
  rulings: Ruling[]
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
