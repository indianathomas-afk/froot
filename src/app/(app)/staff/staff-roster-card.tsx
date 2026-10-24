"use client"

import { useState, type ReactNode } from "react"
import { ArrowDown, ArrowUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

/**
 * STAFF-3. One roster card: the header, the "Show terminated" toggle, the sort
 * control, and the rows in the chosen order.
 *
 * SAME SHAPE AS StaffLocationFilter: every row arrives as an ALREADY-RENDERED
 * SERVER NODE, so no Prisma model and no wage object crosses the client
 * boundary. The only data that does is each row's sort key, and each key is a
 * value its own row already renders — `pay` is null wherever the cell shows a
 * dash (masked, unlinked, not set in Square), so sorting can never order by a
 * number the viewer cannot read (ruling 6).
 *
 * Toggle and sort are plain component state, deliberately not remembered:
 * reload returns to active-only, sorted by name (rulings 2 and 5).
 */
export type RosterRow = {
  key: string
  node: ReactNode
  /// "visiting" = the DEBT-13 "Also works here" block. Kept apart so that block
  /// still reads as its own section after sorting.
  section: "home" | "visiting"
  /// The same `status === "TERMINATED"` test that renders the red badge, so
  /// the toggle and the badge cannot disagree.
  terminated: boolean
  isSelf: boolean
  name: string
  pay: number | null
  pct: number | null
}

type SortKey = "name" | "pay" | "compliance"
type Dir = "asc" | "desc"

// Choosing an option applies its default direction (ruling 5): Name A→Z, Pay
// high→low, Compliance worst first.
const DEFAULT_DIR: Record<SortKey, Dir> = { name: "asc", pay: "desc", compliance: "asc" }
const LABEL: Record<SortKey, string> = { name: "Name", pay: "Pay", compliance: "Compliance" }

const byName = (a: RosterRow, b: RosterRow) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" })

function compare(key: SortKey, dir: Dir) {
  const flip = dir === "asc" ? 1 : -1
  if (key === "name") return (a: RosterRow, b: RosterRow) => flip * byName(a, b)
  const value = (r: RosterRow) => (key === "pay" ? r.pay : r.pct)
  return (a: RosterRow, b: RosterRow) => {
    const va = value(a)
    const vb = value(b)
    // Blanks last in EITHER direction, so the flip never applies to them.
    if (va === null && vb === null) return byName(a, b)
    if (va === null) return 1
    if (vb === null) return -1
    return flip * (va - vb) || byName(a, b)
  }
}

// SELF-1's pin, kept as a partition over whatever order the sort produced: the
// viewer's own row first, everyone else untouched (ruling 7).
function ordered(rows: RosterRow[], cmp: (a: RosterRow, b: RosterRow) => number) {
  const sorted = [...rows].sort(cmp)
  const at = sorted.findIndex((r) => r.isSelf)
  if (at > 0) sorted.unshift(sorted.splice(at, 1)[0])
  return sorted
}

export function StaffRosterCard({
  title,
  summary,
  head,
  colSpan,
  rows,
  canToggleTerminated,
  canSortByPay,
  canSortByCompliance,
}: {
  /// Icon + heading, server-rendered.
  title: ReactNode
  /// The count line under the heading — active counts only (ruling 4), built
  /// on the server, so it does not move when the toggle does.
  summary: ReactNode
  /// The table's <thead>, or null for a group that has none (Unassigned).
  head: ReactNode
  colSpan: number
  rows: RosterRow[]
  /// ADMIN or MANAGER. The button additionally needs a terminated row to show.
  canToggleTerminated: boolean
  canSortByPay: boolean
  canSortByCompliance: boolean
}) {
  const [showTerminated, setShowTerminated] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>("name")
  const [dir, setDir] = useState<Dir>("asc")

  const cmp = compare(sortKey, dir)
  const activeHome = ordered(rows.filter((r) => !r.terminated && r.section === "home"), cmp)
  const activeVisiting = ordered(rows.filter((r) => !r.terminated && r.section === "visiting"), cmp)
  // Terminated sort among themselves by the same key, below every active row
  // (ruling 8). A visiting row still carries its "Home store:" line.
  const terminated = ordered(rows.filter((r) => r.terminated), cmp)
  const showToggle = canToggleTerminated && terminated.length > 0

  const options: SortKey[] = ["name", ...(canSortByPay ? ["pay" as const] : []), ...(canSortByCompliance ? ["compliance" as const] : [])]

  return (
    <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] overflow-hidden">
      <div className="px-6 py-4 border-b border-[var(--color-border)] flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {title}
          {summary}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {showToggle && (
            <Button variant="outline" size="sm" onClick={() => setShowTerminated((v) => !v)}>
              {showTerminated ? "Hide terminated" : `Show terminated (${terminated.length})`}
            </Button>
          )}
          {/* Select and arrow wrap as one unit, so the arrow never strands on
              its own line at phone width. */}
          <div className="flex items-center gap-1">
          <Select
            value={sortKey}
            onValueChange={(v) => {
              const key = v as SortKey
              setSortKey(key)
              setDir(DEFAULT_DIR[key])
            }}
          >
            <SelectTrigger className="h-8 w-40 text-xs" aria-label="Sort roster">
              <SelectValue>Sort: {LABEL[sortKey]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {options.map((k) => (
                <SelectItem key={k} value={k}>
                  {LABEL[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            className="w-8 px-0"
            onClick={() => setDir((d) => (d === "asc" ? "desc" : "asc"))}
            aria-label={dir === "asc" ? "Sorted ascending — reverse" : "Sorted descending — reverse"}
            title="Reverse order"
          >
            {dir === "asc" ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
          </Button>
          </div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          {head}
          <tbody>
            {activeHome.length === 0 && activeVisiting.length === 0 && (
              <tr className="border-b border-[var(--color-border)] last:border-0">
                <td colSpan={colSpan} className="px-6 py-6 text-center text-sm text-[var(--color-muted-foreground)]">
                  No active team members
                </td>
              </tr>
            )}
            {activeHome.map((r) => r.node)}
            {activeVisiting.length > 0 && (
              <tr className="border-b border-[var(--color-border)] bg-[var(--color-muted)]">
                <td colSpan={colSpan} className="px-6 py-2">
                  <p className="text-xs font-medium text-[var(--color-foreground)]">
                    Also works here — {activeVisiting.length} member{activeVisiting.length !== 1 ? "s" : ""} based at another store
                  </p>
                </td>
              </tr>
            )}
            {activeVisiting.map((r) => r.node)}
            {showTerminated && terminated.map((r) => r.node)}
          </tbody>
        </table>
      </div>
    </div>
  )
}
