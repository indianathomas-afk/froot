"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { ChevronDown, ChevronUp } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"

// HR-8: per-employee compliance ranking. The server does all the math
// (src/lib/hr-compliance.ts) — this component only sorts, filters, and
// formats. Default sort is percentage ascending so the gaps float to the top;
// staff with nothing required always sink to the bottom.

export type ComplianceStaffRow = {
  staffId: string
  name: string
  storeName: string | null
  docsDone: number
  docsTotal: number
  trainingDone: number
  trainingTotal: number
  pct: number | null
  overdueCount: number
  needsResignCount: number
  inProgressCount: number
}

type SortKey = "name" | "store" | "pct"

export function ComplianceStaffTable({ rows }: { rows: ComplianceStaffRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("pct")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const [gapsOnly, setGapsOnly] = useState(false)

  const visible = useMemo(() => {
    const filtered = gapsOnly
      ? rows.filter((r) => r.pct !== null && r.pct < 100)
      : rows
    return [...filtered].sort((a, b) => {
      if (sortKey === "name")
        return sortDir === "asc" ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name)
      if (sortKey === "store") {
        // Unassigned members always sink to the bottom.
        if (a.storeName === null && b.storeName === null) return 0
        if (a.storeName === null) return 1
        if (b.storeName === null) return -1
        return sortDir === "asc"
          ? a.storeName.localeCompare(b.storeName)
          : b.storeName.localeCompare(a.storeName)
      }
      // pct — staff with no requirements always sink to the bottom.
      if (a.pct === null && b.pct === null) return 0
      if (a.pct === null) return 1
      if (b.pct === null) return -1
      return sortDir === "asc" ? a.pct - b.pct : b.pct - a.pct
    })
  }, [rows, sortKey, sortDir, gapsOnly])

  const header = (key: SortKey, label: string, align: "left" | "right" = "left") => (
    <th
      className={`text-xs font-medium text-[var(--color-muted-foreground)] px-6 py-3 ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      <button
        className="inline-flex items-center gap-0.5 hover:text-[var(--color-primary)]"
        onClick={() => {
          if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
          else {
            setSortKey(key)
            setSortDir(key === "pct" ? "asc" : "asc")
          }
        }}
      >
        {label}
        {sortKey === key &&
          (sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
      </button>
    </th>
  )

  return (
    <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] overflow-hidden">
      <div className="px-6 py-4 border-b border-[var(--color-border)] flex items-center justify-between gap-4">
        <div>
          <h2 className="font-semibold text-[var(--color-foreground)]">Team Members</h2>
          <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">
            Required items and gaps per employee — click a name for the full detail
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)] cursor-pointer shrink-0">
          Only staff with gaps
          <Switch checked={gapsOnly} onCheckedChange={setGapsOnly} />
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[var(--color-border)]">
              {header("name", "Employee")}
              {header("store", "Store")}
              <th className="text-center text-xs font-medium text-[var(--color-muted-foreground)] px-6 py-3">
                Documents
              </th>
              <th className="text-center text-xs font-medium text-[var(--color-muted-foreground)] px-6 py-3">
                Training
              </th>
              {header("pct", "Overall", "right")}
              <th className="text-right text-xs font-medium text-[var(--color-muted-foreground)] px-6 py-3">
                Gaps
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.staffId} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-accent)]/30">
                <td className="px-6 py-3 text-sm font-medium text-[var(--color-foreground)]">
                  <Link href={`/staff/${r.staffId}`} className="hover:text-[var(--color-primary)] hover:underline">
                    {r.name}
                  </Link>
                </td>
                <td className="px-6 py-3 text-sm text-[var(--color-muted-foreground)]">
                  {r.storeName ?? "—"}
                </td>
                <td className="px-6 py-3 text-sm text-center text-[var(--color-muted-foreground)]">
                  {r.docsTotal > 0 ? `${r.docsDone}/${r.docsTotal}` : "—"}
                </td>
                <td className="px-6 py-3 text-sm text-center text-[var(--color-muted-foreground)]">
                  {r.trainingTotal > 0 ? `${r.trainingDone}/${r.trainingTotal}` : "—"}
                </td>
                <td className="px-6 py-3 text-sm text-right font-medium text-[var(--color-foreground)]">
                  {r.pct === null ? (
                    <span
                      className="text-[var(--color-muted-foreground)] cursor-help font-normal"
                      title="Nothing required yet — no documents apply and no training is assigned."
                    >
                      —
                    </span>
                  ) : (
                    `${r.pct}%`
                  )}
                </td>
                <td className="px-6 py-3 text-right space-x-1.5 whitespace-nowrap">
                  {r.overdueCount > 0 && <Badge variant="destructive">{r.overdueCount} overdue</Badge>}
                  {r.needsResignCount > 0 && <Badge variant="warning">{r.needsResignCount} re-sign</Badge>}
                  {r.inProgressCount > 0 && <Badge variant="info">{r.inProgressCount} in progress</Badge>}
                  {r.pct === 100 && <Badge variant="success">Compliant</Badge>}
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-sm text-[var(--color-muted-foreground)]">
                  {gapsOnly ? "No gaps — every tracked team member is fully compliant." : "No active staff in scope."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
