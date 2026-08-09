"use client"

import { useMemo, useState } from "react"
import { ChevronDown, ChevronRight, Search, AlertTriangle, GitCommit } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import {
  BOARD_COLUMNS,
  columnForStatus,
  type BlockerEntry,
  type Bug,
  type DebtItem,
  type LastUpdatedSource,
  type Phase,
  type PhaseStatus,
  type Ruling,
} from "@/lib/roadmap"

// Track accents, drawn from the app's own tokens where a semantic one fits and
// filled in from the same oklch family where it doesn't — deliberately NOT the
// standalone HTML's inline palette.
const TRACK_ACCENT: Record<string, string> = {
  platform: "var(--color-primary)",
  hr: "var(--color-info)",
  inventory: "var(--color-success)",
  forecasting: "var(--color-warning)",
  security: "var(--color-destructive)",
  labor: "oklch(55% .15 300)",
  permissions: "oklch(52% .13 250)",
  nutrition: "oklch(58% .14 150)",
  migration: "var(--color-muted-foreground)",
}

const FALLBACK_ACCENT = "var(--color-muted-foreground)"

function accentFor(track?: string) {
  return (track && TRACK_ACCENT[track]) || FALLBACK_ACCENT
}

const STATUS_LABEL: Record<PhaseStatus, string> = {
  planned: "Planned",
  in_progress: "In progress",
  staging: "In staging",
  shipped: "Shipped",
  verified: "Verified",
  withdrawn: "Withdrawn",
}

/**
 * DEBT-14. A debt row is RESOLVED only when it EXPLICITLY says so.
 *
 * A MISSING status means OPEN — every outstanding row omits the field (see
 * DebtItem in lib/roadmap.ts), so defaulting the other way would hide all
 * eighteen of them, which is worse than the bug this fixes. `planned` and
 * `in_progress` are open too: the fix is scoped or underway, not landed. Only a
 * landed status moves a row out of "not yet fixed".
 *
 * WITHDRAWN counts as resolved too. A retracted row is not outstanding work,
 * even though nothing was fixed and it carries no `commits`. The value was
 * added to PhaseStatus 2026-08-01 by Gary's ruling — the decision DEBT-18 and
 * DEBT-23 had been waiting on since 2026-07-28, both sitting in the OPEN bucket
 * with "WITHDRAWN" as the first word of their titles. BOARD_COLUMNS still
 * claims no column for the value; that is unreachable today and filed as
 * DEBT-37 rather than fixed here.
 *
 * THIS FUNCTION IS THE SINGLE DEFINITION of which statuses count as resolved —
 * src/lib/roadmap.ts points here rather than restating the set, so the two
 * cannot drift apart again (DEBT-26).
 */
function isResolvedDebt(item: DebtItem) {
  return (
    item.status === "staging" ||
    item.status === "shipped" ||
    item.status === "verified" ||
    item.status === "withdrawn"
  )
}

/**
 * "2 days ago" / "5 hours ago". Computed on the client from the build-captured
 * timestamp, so it stays honest as the tab sits open.
 */
function relativeAge(iso: string) {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null
  const minutes = Math.round((Date.now() - then) / 60000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? "" : "s"} ago`
}

/**
 * A date from the YAML, rendered as the day it says.
 *
 * FIXED 2026-08-05 (Gary's ruling), and it was wrong for every date on the
 * board, not just the new ones. `new Date("2026-06-26")` is parsed as UTC
 * MIDNIGHT by spec, so `toLocaleDateString` rendered it a day EARLY in every
 * timezone west of UTC: P-0's `shipped: 2026-06-26` displayed as "Jun 25, 2026"
 * in America/Los_Angeles, and so did every other shipped badge.
 *
 * The fix is to read a bare `YYYY-MM-DD` as a CALENDAR DAY and build a LOCAL
 * date from its parts. That is what these fields are — `shipped`, `asked` and
 * `ruled` name a day, not an instant. The `new Date(iso)` path stays for real
 * timestamps, which is what `lastUpdated` carries.
 */
function formatDate(iso: string) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  const date = parts
    ? new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]))
    : new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

/**
 * P-4. A blocker entry is RESOLVED only when it EXPLICITLY says so — exactly
 * isResolvedDebt's rule, one level down, and filed for the same reason: the
 * panel asserted "what's stopping promotion" over entries that were closed
 * months earlier, so the failure direction was OVERSTATING and real gates hid
 * among resolved ones.
 *
 * A BARE STRING IS LIVE. Every entry was a bare string before P-4, so
 * defaulting the other way would silently close all nineteen. An unclassified
 * entry keeps blocking; that way a real gate can never vanish behind a default.
 *
 * NOT PREFIX DETECTION, and that is not a style preference — it was measured
 * against the file. F-5's live blocker opens "VERIFIED STILL TRUE" and F-4's
 * opens "CONFIRMED LIVE", so a marker matcher closes two LIVE blockers; PERM-6's
 * two closed entries carry no marker at all and would stay counted. Both
 * directions wrong on the same data, and the false-negative direction is worse
 * than the bug being fixed.
 *
 * THIS FUNCTION IS THE SINGLE DEFINITION of which entries count as resolved —
 * src/lib/roadmap.ts points here rather than restating the test, so the two
 * cannot drift apart (DEBT-26).
 *
 * RESOLVED IS NOT THE ONLY NON-LIVE STATE any more: see isNarrowedBlocker
 * below, added by DEBT-41 2026-08-08. This test is unchanged by it — a narrowed
 * entry carries no `resolved` key and answers false here — but "not resolved"
 * therefore no longer means "live", which is why `liveBlockers` and
 * `blockingBlockers` are now two different functions.
 */
function isResolvedBlocker(entry: BlockerEntry) {
  return typeof entry !== "string" && "resolved" in entry && entry.resolved === true
}

/**
 * DEBT-41's third state, 2026-08-08. A NARROWED entry STILL BLOCKS — it is
 * counted separately, never excluded, and its phase stays in the live list and
 * in the "Phases blocked" tile. What it records is that the entry now asserts
 * strictly LESS than it did: part of it is answered and a named remainder is
 * live. BUILD-1's sole entry and IG-1's `blockers[2]` are the two instances.
 *
 * WHY ITS OWN NUMBER rather than folding into live: the row this closes spent a
 * week recording that the panel read "11 live when the honest answer is 9 live
 * and 2 half-closed". Folding it in keeps the count safe and keeps it dishonest.
 * Excluding it would be the one thing this whole scheme exists to prevent.
 *
 * `"narrowed" in entry` is the discriminant, so a resolved entry can never
 * answer true here and vice versa — they are separate union members, which is
 * also why neither flag can ever be `false` (see src/lib/roadmap.ts).
 *
 * THIS FUNCTION IS THE SINGLE DEFINITION of which entries are narrowed, the
 * sibling of isResolvedBlocker above; src/lib/roadmap.ts points here rather
 * than restating the test (DEBT-26).
 */
function isNarrowedBlocker(entry: BlockerEntry) {
  return typeof entry !== "string" && "narrowed" in entry && entry.narrowed === true
}

/** The entry's prose, whichever of the three shapes it is in. */
function blockerText(entry: BlockerEntry) {
  return typeof entry === "string" ? entry : entry.text
}

/**
 * The three states as one value, so the FOUR places that render a BlockerEntry
 * cannot drift into disagreeing about what an entry is. Built on the two
 * predicates above rather than re-testing the flags (DEBT-26).
 */
type BlockerState = "live" | "narrowed" | "resolved"

function blockerStateOf(entry: BlockerEntry): BlockerState {
  if (isResolvedBlocker(entry)) return "resolved"
  if (isNarrowedBlocker(entry)) return "narrowed"
  return "live"
}

/**
 * MARKED, NOT MERELY TONED — P-4's rule, and it is why a narrowed entry gets a
 * word and not just a dashed border. Two of the closed entries (PERM-6's last
 * two) say "STAYS OPEN" in their own leading text, and both narrowed entries
 * open with prose about being half-closed, so the prose can never be left to
 * tell the reader which state this is. Live entries carry no marker: the
 * absence is the default, exactly as it is in the data.
 */
function BlockerMarker({
  state,
  className,
}: {
  state: BlockerState
  className?: string
}) {
  if (state === "live") return null
  return (
    <span
      className={cn(
        "mr-1.5 font-semibold uppercase tracking-wide",
        state === "narrowed"
          ? "text-[var(--color-warning-text)]"
          : "text-[var(--color-muted-foreground)]",
        className,
      )}
    >
      {state}
    </span>
  )
}

/**
 * A ruling is AWAITING A CALL only while it is `open`, and a MISSING status
 * counts as open — the same direction isResolvedDebt and isResolvedBlocker take,
 * for the same reason: an unclassified entry keeps demanding attention, so the
 * headline count can over-report but never under-report.
 *
 * `deferred` is NOT open. A deferral is a decision — just not the final one —
 * and folding it back into the awaiting count would mean the number never falls
 * when Gary consciously decides to wait, which is exactly the call the value
 * exists to record.
 *
 * THIS FUNCTION IS THE SINGLE DEFINITION of which rulings are outstanding;
 * src/lib/roadmap.ts points here rather than restating it (DEBT-26).
 */
function isOpenRuling(item: Ruling) {
  return (item.status ?? "open") === "open"
}

/**
 * EVERYTHING STILL BLOCKING — live entries AND narrowed ones. This is the set
 * that answers "what is stopping promotion", and it is the body `liveBlockers`
 * had before DEBT-41 split the two apart.
 *
 * The rename is the point. A narrowed entry still blocks, so this set had to
 * keep including it; leaving it called `liveBlockers` would have handed the
 * next reader a function whose NAME says one thing and whose contents say
 * another, and the under-report would arrive the first time someone trusted
 * the name.
 */
function blockingBlockers(phase: Phase) {
  return (phase.blockers ?? []).filter((entry) => !isResolvedBlocker(entry))
}

/** STRICTLY live — neither flag. Feeds the panel's "N live" number only. */
function liveBlockers(phase: Phase) {
  return (phase.blockers ?? []).filter(
    (entry) => !isResolvedBlocker(entry) && !isNarrowedBlocker(entry),
  )
}

function narrowedBlockers(phase: Phase) {
  return (phase.blockers ?? []).filter(isNarrowedBlocker)
}

function resolvedBlockers(phase: Phase) {
  return (phase.blockers ?? []).filter(isResolvedBlocker)
}

/**
 * STILL-BLOCKING blockers — live or narrowed. One predicate feeds both the
 * "Phases blocked" tile and the panel's phase list, so the two can never
 * disagree about what counts — the same single-source discipline isResolvedDebt
 * has. A phase whose only entry is NARROWED is still a blocked phase.
 */
function hasOpenBlockers(phase: Phase) {
  return blockingBlockers(phase).length > 0
}

interface RoadmapClientProps {
  phases: Phase[]
  bugs: Bug[]
  debt: DebtItem[]
  rulings: Ruling[]
  lastUpdated: string | null
  lastUpdatedSource: LastUpdatedSource
}

export function RoadmapClient({
  phases,
  bugs,
  debt,
  rulings,
  lastUpdated,
  lastUpdatedSource,
}: RoadmapClientProps) {
  const [query, setQuery] = useState("")
  const [activeTracks, setActiveTracks] = useState<string[]>([])
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const tracks = useMemo(
    () =>
      Array.from(new Set(phases.map((p) => p.track).filter(Boolean) as string[])).sort(),
    [phases],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return phases.filter((phase) => {
      if (activeTracks.length > 0 && !activeTracks.includes(phase.track ?? "")) {
        return false
      }
      if (!q) return true
      const haystack = [
        phase.id,
        phase.title,
        phase.track,
        phase.notes,
        ...(phase.keywords ?? []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [phases, query, activeTracks])

  // Summary counts describe the WHOLE roadmap, not the filtered view — a search
  // shouldn't make it look like work disappeared.
  const summary = useMemo(() => {
    const inProduction = phases.filter(
      (p) => p.status === "shipped" || p.status === "verified",
    ).length
    const inStaging = phases.filter((p) => p.status === "staging").length
    const planned = phases.filter(
      (p) => p.status === "planned" || p.status === "in_progress",
    ).length
    const blocked = phases.filter(hasOpenBlockers).length
    return { inProduction, inStaging, planned, blocked }
  }, [phases])

  // Gates first: a blocker on a staging phase is holding a promotion, so it
  // outranks a blocker logged against something already live. No severity is
  // inferred from the text — only the `resolved` flag is read, never the prose.
  const livePhases = useMemo(() => {
    const rank = (phase: Phase) => {
      if (phase.status === "staging") return 0
      if (phase.status === "in_progress") return 1
      if (phase.status === "planned") return 2
      return 3
    }
    return phases
      .filter(hasOpenBlockers)
      .slice()
      .sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id))
  }, [phases])

  // Phases whose every blocker is closed. They leave the live list — that IS
  // the fix — but they never leave the page: the entries, and their order, are
  // the record. They render below, behind a disclosure.
  const resolvedOnlyPhases = useMemo(
    () =>
      phases
        .filter((p) => !hasOpenBlockers(p) && resolvedBlockers(p).length > 0)
        .slice()
        .sort((a, b) => a.id.localeCompare(b.id)),
    [phases],
  )

  const stagingPhases = useMemo(
    () => phases.filter((p) => p.status === "staging"),
    [phases],
  )

  const toggleTrack = (track: string) =>
    setActiveTracks((current) =>
      current.includes(track)
        ? current.filter((t) => t !== track)
        : [...current, track],
    )

  const toggleExpanded = (id: string) =>
    setExpanded((current) => ({ ...current, [id]: !current[id] }))

  const isFiltering = query.trim().length > 0 || activeTracks.length > 0

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <Header lastUpdated={lastUpdated} lastUpdatedSource={lastUpdatedSource} />

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryTile label="In production" value={summary.inProduction} />
        <SummaryTile label="In staging" value={summary.inStaging} />
        <SummaryTile label="Planned" value={summary.planned} />
        {/* The unit is in the label, deliberately. This tile counts PHASES and
            the panel below counts ENTRIES; two bare numbers that looked like
            the same quantity is where the confusion started (P-4). */}
        <SummaryTile
          label="Phases blocked"
          value={summary.blocked}
          tone={summary.blocked > 0 ? "warning" : undefined}
        />
      </section>

      <BlockersPanel
        livePhases={livePhases}
        resolvedOnlyPhases={resolvedOnlyPhases}
      />

      {/* Above the search box, and DELIBERATELY NOT WIRED TO IT (Gary's ruling
          2026-08-05). The box sits below this section, is labelled "Search
          phases", and counts phases — filtering this list from a control
          underneath it would mislead. Revisit only if the list outgrows a
          screenful. */}
      <RulingsPanel rulings={rulings} />

      <PipelinePanel stagingPhases={stagingPhases} totalPhases={phases.length} />

      <section className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-muted-foreground)]"
              aria-hidden
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search id, title, track, notes…"
              className="pl-9"
              aria-label="Search phases"
            />
          </div>
          <p className="text-sm text-[var(--color-muted-foreground)]" role="status">
            {isFiltering
              ? `${filtered.length} of ${phases.length} phases`
              : `${phases.length} phases`}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {tracks.map((track) => {
            const active = activeTracks.includes(track)
            return (
              <button
                key={track}
                type="button"
                onClick={() => toggleTrack(track)}
                aria-pressed={active}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  active
                    ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)]"
                    : "border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]",
                )}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: active ? "currentColor" : accentFor(track) }}
                  aria-hidden
                />
                {track}
              </button>
            )
          })}
          {activeTracks.length > 0 && (
            <button
              type="button"
              onClick={() => setActiveTracks([])}
              className="text-xs font-medium text-[var(--color-muted-foreground)] underline underline-offset-2 px-1"
            >
              Clear
            </button>
          )}
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        {BOARD_COLUMNS.map((column) => {
          const cards = filtered.filter(
            (phase) => columnForStatus(phase.status) === column.key,
          )
          return (
            <div key={column.key} className="space-y-3">
              <div className="flex items-baseline justify-between px-1">
                <h2 className="text-sm font-semibold text-[var(--color-foreground)]">
                  {column.label}
                </h2>
                <span className="text-xs text-[var(--color-muted-foreground)]">
                  {cards.length}
                </span>
              </div>
              <div className="space-y-2">
                {cards.map((phase) => (
                  <PhaseCard
                    key={phase.id}
                    phase={phase}
                    expanded={!!expanded[phase.id]}
                    onToggle={() => toggleExpanded(phase.id)}
                  />
                ))}
                {cards.length === 0 && (
                  <p className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] px-3 py-6 text-center text-xs text-[var(--color-muted-foreground)]">
                    {isFiltering ? "Nothing matches the filter" : "Nothing here"}
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </section>

      <BugsAndDebt bugs={bugs} debt={debt} />
    </div>
  )
}

function Header({
  lastUpdated,
  lastUpdatedSource,
}: {
  lastUpdated: string | null
  lastUpdatedSource: LastUpdatedSource
}) {
  const age = lastUpdated ? relativeAge(lastUpdated) : null

  // The source is always stated. A fallback must never read as the real git
  // commit date — that silent staleness is the whole reason this page exists.
  const sourceNote =
    lastUpdatedSource === "git"
      ? "from the git commit date of docs/ROADMAP.yaml"
      : lastUpdatedSource === "meta"
        ? "from meta.updated in docs/ROADMAP.yaml — git commit date unavailable at build"
        : "source unavailable — neither the git commit date nor meta.updated resolved at build"

  return (
    <header className="space-y-1">
      <h1 className="text-2xl font-bold text-[var(--color-foreground)]">
        Development Status
      </h1>
      <p className="text-sm text-[var(--color-muted-foreground)]">
        {lastUpdated ? (
          <>
            <span className="font-medium text-[var(--color-foreground)]">
              Roadmap last updated {formatDate(lastUpdated)}
            </span>
            {age && <> · {age}</>}
          </>
        ) : (
          <span className="font-medium text-[var(--color-foreground)]">
            Roadmap last updated: unknown
          </span>
        )}
      </p>
      <p
        className={cn(
          "text-xs",
          lastUpdatedSource === "git"
            ? "text-[var(--color-muted-foreground)]"
            : "text-[var(--color-warning-text)]",
        )}
      >
        {sourceNote}
      </p>
    </header>
  )
}

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone?: "warning"
}) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3">
      <p
        className={cn(
          "text-2xl font-bold tabular-nums",
          tone === "warning"
            ? "text-[var(--color-warning-text)]"
            : "text-[var(--color-foreground)]",
        )}
      >
        {value}
      </p>
      <p className="text-xs text-[var(--color-muted-foreground)]">{label}</p>
    </div>
  )
}

/**
 * One phase in the blockers panel, with EVERY entry it carries rendered in
 * ARRAY ORDER — live and resolved together, never filtered.
 *
 * The order is deliberate and is the whole reason resolved entries are not
 * dropped. On PERM-6 and PERM-7 the resolution and the original text it closes
 * are adjacent entries, and several of those rows say in as many words that the
 * order is the lesson. What P-4 changed is how they are COUNTED and TONED, not
 * whether they appear.
 */
function BlockedPhaseCard({ phase }: { phase: Phase }) {
  return (
    <li className="rounded-[var(--radius-md)] border border-[var(--color-warning-border)] bg-[var(--color-card)] p-3">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span
          className="text-xs font-bold px-1.5 py-0.5 rounded text-[var(--color-primary-foreground)]"
          style={{ background: accentFor(phase.track) }}
        >
          {phase.id}
        </span>
        {phase.status && (
          <Badge variant="secondary">{STATUS_LABEL[phase.status]}</Badge>
        )}
        <span className="text-sm font-medium text-[var(--color-foreground)]">
          {phase.title}
        </span>
      </div>
      <ul className="space-y-1.5">
        {phase.blockers?.map((entry, i) => {
          const state = blockerStateOf(entry)
          return (
            <li
              key={i}
              className={cn(
                "text-sm pl-3 border-l-2",
                // Three treatments, distinguishable by BORDER alone and by WORD
                // alone. Narrowed stays in the live family — same warning
                // colour, full-strength text — because it still blocks; the
                // DASH is the "this one shrank" signal. Resolved is the only
                // one that goes muted and faded, because it is the only one
                // that stopped mattering.
                state === "resolved" &&
                  "border-[var(--color-border)] text-[var(--color-muted-foreground)]/70",
                state === "narrowed" &&
                  "border-dashed border-[var(--color-warning)] text-[var(--color-muted-foreground)]",
                state === "live" &&
                  "border-[var(--color-warning)] text-[var(--color-muted-foreground)]",
              )}
            >
              <BlockerMarker state={state} className="text-[10px]" />
              {blockerText(entry)}
            </li>
          )
        })}
      </ul>
    </li>
  )
}

function BlockersPanel({
  livePhases,
  resolvedOnlyPhases,
}: {
  livePhases: Phase[]
  resolvedOnlyPhases: Phase[]
}) {
  const liveTotal = livePhases.reduce((sum, p) => sum + liveBlockers(p).length, 0)
  const narrowedTotal = livePhases.reduce(
    (sum, p) => sum + narrowedBlockers(p).length,
    0,
  )
  const resolvedTotal = [...livePhases, ...resolvedOnlyPhases].reduce(
    (sum, p) => sum + resolvedBlockers(p).length,
    0,
  )

  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] p-4">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle
          className="h-4 w-4 text-[var(--color-warning-text)]"
          aria-hidden
        />
        <h2 className="text-sm font-semibold text-[var(--color-warning-text)]">
          Blockers &amp; gates — what&apos;s stopping promotion
        </h2>
        {/* Both units named. These counts are ENTRIES; the tile above is
            PHASES — hence "blocked phases" rather than a second bare number.
            DEBT-41: live and narrowed are reported SEPARATELY and both are
            still blocking, so liveTotal + narrowedTotal is the honest "what is
            stopping promotion" figure and neither half is hidden inside the
            other. narrowedTotal sums livePhases alone because a narrowed entry
            makes hasOpenBlockers true, so its phase can never be in
            resolvedOnlyPhases. */}
        <span className="text-xs text-[var(--color-warning-text)]/80">
          {liveTotal} live
          {narrowedTotal > 0 && ` · ${narrowedTotal} narrowed`} across{" "}
          {livePhases.length} blocked phase{livePhases.length === 1 ? "" : "s"}
          {resolvedTotal > 0 && ` · ${resolvedTotal} resolved`}
        </span>
      </div>

      {livePhases.length === 0 ? (
        <p className="text-sm text-[var(--color-warning-text)]">
          No live blockers.
        </p>
      ) : (
        <ul className="space-y-3">
          {livePhases.map((phase) => (
            <BlockedPhaseCard key={phase.id} phase={phase} />
          ))}
        </ul>
      )}

      {resolvedOnlyPhases.length > 0 && (
        // Native <details>, same choice as the "Resolved debt" panel: collapsed
        // by default, keyboard-accessible, no extra state to keep in sync.
        <details className="mt-3">
          <summary className="text-sm font-semibold cursor-pointer text-[var(--color-warning-text)]">
            Resolved gates ({resolvedOnlyPhases.length} phase
            {resolvedOnlyPhases.length === 1 ? "" : "s"} with every blocker
            closed)
          </summary>
          <ul className="space-y-3 mt-3">
            {resolvedOnlyPhases.map((phase) => (
              <BlockedPhaseCard key={phase.id} phase={phase} />
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

/**
 * Open decisions, on the same page as the phases, bugs and debt they attach to.
 *
 * PLAIN CARD TREATMENT, not the warning tones the blockers panel uses. Two
 * alarm-coloured panels stacked would flatten the distinction the top of this
 * page exists to make: a blocker is stopping a promotion right now, a ruling is
 * waiting on a person. Same components and tokens as PipelinePanel — no new
 * design language.
 *
 * The count lives in the header rather than as a fifth summary tile: the tile
 * grid is lg:grid-cols-4 and a fifth would relayout it, and BlockersPanel
 * already sets the precedent of carrying its count beside its heading.
 */
function RulingsPanel({ rulings }: { rulings: Ruling[] }) {
  // Split once, render twice — the BugsAndDebt pattern. Ruled and deferred
  // entries never leave the page: a ruling that is recorded and then hidden is
  // the loss this section was built to stop.
  const open = rulings.filter(isOpenRuling)
  const settled = rulings.filter((item) => !isOpenRuling(item))

  if (rulings.length === 0) return null
  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <h2 className="text-sm font-semibold text-[var(--color-foreground)]">
          Pending rulings — decisions, not work
        </h2>
        <span className="text-xs text-[var(--color-muted-foreground)]">
          {open.length} awaiting a call
          {settled.length > 0 && ` · ${settled.length} settled`}
        </span>
      </div>

      {open.length === 0 ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Nothing is awaiting a call.
        </p>
      ) : (
        <ul className="space-y-3">
          {open.map((item) => (
            <RulingCard key={item.id} item={item} />
          ))}
        </ul>
      )}

      {settled.length > 0 && (
        // Native <details>, same choice as "Resolved debt" and "Resolved gates".
        <details className="mt-3">
          <summary className="text-sm font-semibold cursor-pointer text-[var(--color-foreground)]">
            Ruled &amp; deferred ({settled.length})
          </summary>
          <ul className="space-y-3 mt-3">
            {settled.map((item) => (
              <RulingCard key={item.id} item={item} />
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

/** One ruling, shared by both groups so they cannot drift apart. */
function RulingCard({ item }: { item: Ruling }) {
  const status = item.status ?? "open"
  return (
    <li className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
      <div className="flex flex-wrap items-center gap-2 mb-1.5">
        <span className="text-xs font-bold text-[var(--color-foreground)]">
          {item.id}
        </span>
        {status === "open" && <Badge variant="warning">awaiting a call</Badge>}
        {status === "ruled" && <Badge variant="success">ruled</Badge>}
        {status === "deferred" && <Badge variant="outline">deferred</Badge>}
        {item.asked && (
          <span className="text-[10px] text-[var(--color-muted-foreground)]">
            asked {formatDate(item.asked)}
          </span>
        )}
      </div>

      <p className="text-sm font-medium text-[var(--color-foreground)]">
        {item.title}
      </p>

      {item.question && (
        <p className="text-xs leading-relaxed text-[var(--color-muted-foreground)] mt-1.5">
          {item.question}
        </p>
      )}

      <div className="mt-3 space-y-3">
        <DetailList label="Options" items={item.options} />
        {item.recommendation && (
          <LabelledProse label="Recommendation" text={item.recommendation} />
        )}
        {/* The ruling renders LAST and in the foreground colour — once a call is
            made it is the part of the entry that matters, and the options above
            it become the record of what was considered rather than a live
            choice. */}
        {item.ruling && (
          <LabelledProse
            label={item.ruled ? `Ruling — ${formatDate(item.ruled)}` : "Ruling"}
            text={item.ruling}
            tone="foreground"
          />
        )}
        {item.links && item.links.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)] mb-1">
              Related
            </p>
            <div className="flex flex-wrap gap-1.5">
              {item.links.map((id) => (
                <span
                  key={id}
                  className="inline-flex items-center rounded bg-[var(--color-muted)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-foreground)]"
                >
                  {id}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </li>
  )
}

/**
 * A labelled block of prose, in DetailList's visual language — same label
 * treatment, same left rule — for the fields that carry one paragraph rather
 * than a list.
 */
function LabelledProse({
  label,
  text,
  tone,
}: {
  label: string
  text: string
  tone?: "foreground"
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)] mb-1">
        {label}
      </p>
      <p
        className={cn(
          "text-xs leading-relaxed pl-2 border-l-2 border-[var(--color-border)]",
          tone === "foreground"
            ? "text-[var(--color-foreground)]"
            : "text-[var(--color-muted-foreground)]",
        )}
      >
        {text}
      </p>
    </div>
  )
}

function PipelinePanel({
  stagingPhases,
  totalPhases,
}: {
  stagingPhases: Phase[]
  totalPhases: number
}) {
  return (
    <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4">
        <h2 className="text-sm font-semibold mb-3 text-[var(--color-foreground)]">
          Staging → Production
        </h2>
        {stagingPhases.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Nothing is staging-only — staging and main are level.
          </p>
        ) : (
          <ul className="space-y-3">
            {stagingPhases.map((phase) => {
              // P-4 fixed this alongside the panel even though it renders
              // nothing today — there are zero staging phases, so the defect was
              // dormant rather than absent. It re-arms the moment anything sits
              // in staging, which is exactly when this panel is read.
              // blockingBlockers, NOT liveBlockers — DEBT-41. A phase whose
              // only entry is NARROWED still has a gate, and this panel is read
              // at promotion time: reading strictly-live here would print
              // "ready to promote" over a live gate, which is the one direction
              // the whole scheme forbids.
              const blocking = blockingBlockers(phase)
              const resolvedCount = resolvedBlockers(phase).length
              return (
                <li
                  key={phase.id}
                  className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3"
                  style={{ borderLeftWidth: 3, borderLeftColor: accentFor(phase.track) }}
                >
                  <p className="text-sm font-medium text-[var(--color-foreground)]">
                    <span className="font-bold">{phase.id}</span> — {phase.title}
                  </p>
                  {blocking.length > 0 ? (
                    <ul className="mt-2 space-y-1">
                      {blocking.map((entry, i) => {
                        const state = blockerStateOf(entry)
                        return (
                          <li
                            key={i}
                            className={cn(
                              "text-xs text-[var(--color-warning-text)] pl-2 border-l-2 border-[var(--color-warning)]",
                              state === "narrowed" && "border-dashed",
                            )}
                          >
                            <BlockerMarker state={state} />
                            {blockerText(entry)}
                          </li>
                        )
                      })}
                    </ul>
                  ) : (
                    <p className="mt-2 text-xs text-[var(--color-muted-foreground)]">
                      {/* "No gate" and "no gate ever recorded" are different
                          claims, and this panel is read at promotion time. */}
                      {resolvedCount > 0
                        ? `No live gate — ${resolvedCount} resolved, see Blockers & gates.`
                        : "No recorded gate — ready to promote."}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4">
        <h2 className="text-sm font-semibold mb-3 text-[var(--color-foreground)]">
          Everything else
        </h2>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          {stagingPhases.length === 0
            ? `All ${totalPhases} phases are either live in production or still planned — nothing is waiting in staging.`
            : `The other ${totalPhases - stagingPhases.length} phases are either live in production or still planned. Only the ${stagingPhases.length} listed here are merged to staging and not yet in prod.`}
        </p>
      </div>
    </section>
  )
}

function PhaseCard({
  phase,
  expanded,
  onToggle,
}: {
  phase: Phase
  expanded: boolean
  onToggle: () => void
}) {
  const liveCount = liveBlockers(phase).length
  // Its own badge, not folded into liveCount and not dropped — DEBT-41. A
  // narrowed entry counted nowhere would disappear from the collapsed card
  // entirely, which is an under-report on the densest surface of the board.
  const narrowedCount = narrowedBlockers(phase).length
  const resolvedCount = resolvedBlockers(phase).length
  // hasDetail counts ALL entries, not just live ones: a card whose blockers are
  // every one of them closed must still expand, or the record becomes
  // unreachable from the board.
  const blockerCount = phase.blockers?.length ?? 0
  const deferredCount = phase.deferred?.length ?? 0
  const accent = accentFor(phase.track)
  const hasDetail =
    !!phase.notes ||
    blockerCount > 0 ||
    deferredCount > 0 ||
    (phase.open?.length ?? 0) > 0 ||
    (phase.commits?.length ?? 0) > 0 ||
    (phase.keywords?.length ?? 0) > 0

  return (
    <div
      className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)]"
      style={{ borderLeftWidth: 3, borderLeftColor: accent }}
    >
      <button
        type="button"
        onClick={onToggle}
        disabled={!hasDetail}
        aria-expanded={hasDetail ? expanded : undefined}
        className={cn(
          "w-full text-left px-3 py-2.5 flex items-start gap-2",
          hasDetail && "hover:bg-[var(--color-accent)] transition-colors",
        )}
      >
        <span className="mt-0.5 shrink-0 text-[var(--color-muted-foreground)]">
          {hasDetail ? (
            expanded ? (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            )
          ) : (
            <span className="block h-3.5 w-3.5" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-bold" style={{ color: accent }}>
              {phase.id}
            </span>
            {phase.track && (
              <span className="text-[10px] uppercase tracking-wide text-[var(--color-muted-foreground)]">
                {phase.track}
              </span>
            )}
            {phase.size && (
              <span className="text-[10px] text-[var(--color-muted-foreground)]">
                · {phase.size}
              </span>
            )}
          </span>
          <span className="block text-sm text-[var(--color-foreground)] mt-0.5">
            {phase.title}
          </span>
          <span className="flex flex-wrap items-center gap-1.5 mt-1.5">
            {phase.status === "in_progress" && (
              <Badge variant="info">in progress</Badge>
            )}
            {phase.status === "verified" && <Badge variant="success">verified</Badge>}
            {phase.shipped && (
              <Badge variant="secondary">shipped {formatDate(phase.shipped)}</Badge>
            )}
            {liveCount > 0 && (
              <Badge variant="warning">
                {liveCount} blocker{liveCount === 1 ? "" : "s"}
              </Badge>
            )}
            {narrowedCount > 0 && (
              <Badge variant="warning">{narrowedCount} narrowed</Badge>
            )}
            {resolvedCount > 0 && (
              <Badge variant="outline">{resolvedCount} resolved</Badge>
            )}
            {deferredCount > 0 && (
              <Badge variant="outline">{deferredCount} deferred</Badge>
            )}
          </span>
        </span>
      </button>

      {expanded && hasDetail && (
        <div className="px-3 pb-3 pt-0 space-y-3 border-t border-[var(--color-border)] mt-1">
          {phase.notes && (
            <p className="text-xs leading-relaxed text-[var(--color-muted-foreground)] pt-3">
              {phase.notes}
            </p>
          )}
          <DetailList label="Blockers" items={phase.blockers} tone="warning" />
          <DetailList label="Open questions" items={phase.open} />
          <DetailList label="Deferred" items={phase.deferred} />
          <DetailList label="Keywords" items={phase.keywords} />
          {phase.commits && phase.commits.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)] mb-1">
                Commits
              </p>
              <div className="flex flex-wrap gap-1.5">
                {phase.commits.map((sha) => (
                  <span
                    key={sha}
                    className="inline-flex items-center gap-1 rounded bg-[var(--color-muted)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-foreground)]"
                  >
                    <GitCommit className="h-3 w-3" aria-hidden />
                    {sha}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Takes BlockerEntry[] so the one component serves blockers, open questions,
 * deferred scope and keywords alike — `string[]` is assignable to it, and only
 * `blockers` ever carries the object form today.
 */
function DetailList({
  label,
  items,
  tone,
}: {
  label: string
  items?: BlockerEntry[]
  tone?: "warning"
}) {
  if (!items || items.length === 0) return null
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)] mb-1">
        {label}
      </p>
      <ul className="space-y-1">
        {items.map((item, i) => {
          const state = blockerStateOf(item)
          return (
            <li
              key={i}
              className={cn(
                "text-xs pl-2 border-l-2",
                tone === "warning" && state !== "resolved"
                  ? "border-[var(--color-warning)] text-[var(--color-warning-text)]"
                  : "border-[var(--color-border)] text-[var(--color-muted-foreground)]",
                // The third treatment, same as the panel's: a narrowed entry
                // keeps the live colour because it still blocks, and the dash
                // is what separates it at a glance.
                state === "narrowed" && "border-dashed",
              )}
            >
              <BlockerMarker state={state} />
              {blockerText(item)}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function BugsAndDebt({ bugs, debt }: { bugs: Bug[]; debt: DebtItem[] }) {
  // DEBT-14: split once, render twice. Resolved rows are kept on the page under
  // their own collapsed heading rather than dropped, so the record stays visible
  // and the "not yet fixed" heading becomes true for its section.
  const openDebt = debt.filter((item) => !isResolvedDebt(item))
  const resolvedDebt = debt.filter(isResolvedDebt)

  if (bugs.length === 0 && debt.length === 0) return null
  return (
    <section className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
      {bugs.length > 0 && (
        <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4">
          <h2 className="text-sm font-semibold mb-3 text-[var(--color-foreground)]">
            Bugs
          </h2>
          <ul className="space-y-2">
            {bugs.map((bug) => (
              <li key={bug.id} className="text-sm">
                <span className="font-bold text-[var(--color-foreground)]">
                  {bug.id}
                </span>{" "}
                <span className="text-[var(--color-foreground)]">{bug.title}</span>
                {bug.status && (
                  <span className="ml-1.5 text-xs text-[var(--color-muted-foreground)]">
                    ({STATUS_LABEL[bug.status]})
                  </span>
                )}
                {bug.notes && (
                  <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">
                    {bug.notes}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {openDebt.length > 0 && (
        <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4">
          <h2 className="text-sm font-semibold mb-3 text-[var(--color-foreground)]">
            Known debt — recorded, not yet fixed ({openDebt.length})
          </h2>
          <ul className="space-y-2">
            {openDebt.map((item) => (
              <DebtRow key={item.id} item={item} />
            ))}
          </ul>
        </div>
      )}

      {resolvedDebt.length > 0 && (
        <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4">
          {/* Native <details>: collapsed by default, keyboard-accessible, and no
              extra component state to keep in sync. */}
          <details>
            <summary className="text-sm font-semibold cursor-pointer text-[var(--color-foreground)]">
              Resolved debt ({resolvedDebt.length})
            </summary>
            <ul className="space-y-2 mt-3">
              {resolvedDebt.map((item) => (
                <DebtRow key={item.id} item={item} />
              ))}
            </ul>
          </details>
        </div>
      )}
    </section>
  )
}

/**
 * One debt row, shared by both sections so they cannot drift apart. The commit
 * SHA renders only when the row carries one — in practice only resolved rows do,
 * and it is the evidence the row is closed rather than merely marked closed.
 */
function DebtRow({ item }: { item: DebtItem }) {
  return (
    <li className="text-sm">
      <span className="font-bold text-[var(--color-foreground)]">{item.id}</span>
      {item.commits?.length ? (
        <span className="text-[var(--color-muted-foreground)]">
          {" · "}
          <span className="font-mono text-xs">{item.commits.join(", ")}</span>
        </span>
      ) : null}{" "}
      <span className="text-[var(--color-foreground)]">{item.title}</span>
      {/* A word, deliberately — the ruling that added `withdrawn` scoped the UI
          to exactly this and no further. Withdrawn rows carry no commits, so
          without it they read as resolved-with-the-SHA-missing. */}
      {item.status === "withdrawn" && (
        <span className="ml-1.5 text-xs text-[var(--color-muted-foreground)]">(withdrawn)</span>
      )}
      {item.notes && (
        <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">{item.notes}</p>
      )}
    </li>
  )
}
