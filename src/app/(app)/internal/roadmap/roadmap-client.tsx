"use client"

import { useMemo, useState } from "react"
import { ChevronDown, ChevronRight, Search, AlertTriangle, GitCommit } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import {
  BOARD_COLUMNS,
  columnForStatus,
  type Bug,
  type DebtItem,
  type LastUpdatedSource,
  type Phase,
  type PhaseStatus,
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
 * DEBT-18 is WITHDRAWN rather than fixed and carries no status, so it buckets
 * OPEN here. That is knowingly imprecise — its title leads with "WITHDRAWN".
 * Giving it a real status means adding `withdrawn` to PhaseStatus, which is
 * shared with phases and which BOARD_COLUMNS claims no column for; that is a
 * separate decision, not a rider on this render fix (Gary, 2026-07-28). The
 * note on DEBT-18's row stands as the record that it is still wanted.
 */
function isResolvedDebt(item: DebtItem) {
  return (
    item.status === "staging" || item.status === "shipped" || item.status === "verified"
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

function formatDate(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

function hasBlockers(phase: Phase) {
  return (phase.blockers?.length ?? 0) > 0
}

interface RoadmapClientProps {
  phases: Phase[]
  bugs: Bug[]
  debt: DebtItem[]
  lastUpdated: string | null
  lastUpdatedSource: LastUpdatedSource
}

export function RoadmapClient({
  phases,
  bugs,
  debt,
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
    const blocked = phases.filter(hasBlockers).length
    return { inProduction, inStaging, planned, blocked }
  }, [phases])

  // Gates first: a blocker on a staging phase is holding a promotion, so it
  // outranks a blocker logged against something already live. No severity is
  // inferred from the text — the YAML stores blockers as plain strings.
  const blockedPhases = useMemo(() => {
    const rank = (phase: Phase) => {
      if (phase.status === "staging") return 0
      if (phase.status === "in_progress") return 1
      if (phase.status === "planned") return 2
      return 3
    }
    return phases
      .filter(hasBlockers)
      .slice()
      .sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id))
  }, [phases])

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
        <SummaryTile
          label="Open blockers"
          value={summary.blocked}
          tone={summary.blocked > 0 ? "warning" : undefined}
        />
      </section>

      <BlockersPanel phases={blockedPhases} />

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

function BlockersPanel({ phases }: { phases: Phase[] }) {
  const total = phases.reduce((sum, p) => sum + (p.blockers?.length ?? 0), 0)

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
        <span className="text-xs text-[var(--color-warning-text)]/80">
          {total} across {phases.length} phase{phases.length === 1 ? "" : "s"}
        </span>
      </div>

      {phases.length === 0 ? (
        <p className="text-sm text-[var(--color-warning-text)]">
          No open blockers.
        </p>
      ) : (
        <ul className="space-y-3">
          {phases.map((phase) => (
            <li
              key={phase.id}
              className="rounded-[var(--radius-md)] border border-[var(--color-warning-border)] bg-[var(--color-card)] p-3"
            >
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
                {phase.blockers?.map((blocker, i) => (
                  <li
                    key={i}
                    className="text-sm text-[var(--color-muted-foreground)] pl-3 border-l-2 border-[var(--color-warning)]"
                  >
                    {blocker}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
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
            {stagingPhases.map((phase) => (
              <li
                key={phase.id}
                className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3"
                style={{ borderLeftWidth: 3, borderLeftColor: accentFor(phase.track) }}
              >
                <p className="text-sm font-medium text-[var(--color-foreground)]">
                  <span className="font-bold">{phase.id}</span> — {phase.title}
                </p>
                {phase.blockers && phase.blockers.length > 0 ? (
                  <ul className="mt-2 space-y-1">
                    {phase.blockers.map((blocker, i) => (
                      <li
                        key={i}
                        className="text-xs text-[var(--color-warning-text)] pl-2 border-l-2 border-[var(--color-warning)]"
                      >
                        {blocker}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-[var(--color-muted-foreground)]">
                    No recorded gate — ready to promote.
                  </p>
                )}
              </li>
            ))}
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
            {blockerCount > 0 && (
              <Badge variant="warning">
                {blockerCount} blocker{blockerCount === 1 ? "" : "s"}
              </Badge>
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

function DetailList({
  label,
  items,
  tone,
}: {
  label: string
  items?: string[]
  tone?: "warning"
}) {
  if (!items || items.length === 0) return null
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)] mb-1">
        {label}
      </p>
      <ul className="space-y-1">
        {items.map((item, i) => (
          <li
            key={i}
            className={cn(
              "text-xs pl-2 border-l-2",
              tone === "warning"
                ? "border-[var(--color-warning)] text-[var(--color-warning-text)]"
                : "border-[var(--color-border)] text-[var(--color-muted-foreground)]",
            )}
          >
            {item}
          </li>
        ))}
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
      {item.notes && (
        <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">{item.notes}</p>
      )}
    </li>
  )
}
