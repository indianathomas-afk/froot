"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { format } from "date-fns"
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, ChevronDown, ChevronRight, Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { fmtMoney } from "../counts-client"

type SummaryLine = {
  lineId: string
  storageAreaId: string | null
  areaName: string
  quantityCounted: number | null
  costPerReportingUnit: number
  lineValue: number | null
  previousQuantity: number | null
}

type SummaryIngredient = {
  ingredientId: string
  ingredientName: string
  reportingUnit: string
  totalQuantity: number
  totalValue: number
  currentCostPerReportingUnit: number
  snapshotCostPerReportingUnit: number
  costDrift: boolean
  lines: SummaryLine[]
}

type Summary = {
  id: string
  storeName: string
  name: string | null
  notes: string | null
  status: string
  isPartial: boolean
  finalizedAt: string | null
  sittingInventoryVal: number | null
  countedByNames: string[]
  previousCount: { id: string; name: string | null; finalizedAt: string | null } | null
  ingredients: SummaryIngredient[]
  corrections: {
    id: string
    lineId: string
    field: string
    oldValue: number | null
    newValue: number | null
    note: string | null
    userName: string | null
    createdAt: string
  }[]
}

type SortKey = "value" | "name"

// Post-finalize review: rollup sortable by value so $0.00 lines (missing cost)
// and abnormally large lines (unit/case miscounts) jump out; corrections happen
// right here with an audit trail.
export function SummaryView({ countId, canManage }: { countId: string; canManage: boolean }) {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>("value")
  const [sortDesc, setSortDesc] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [correcting, setCorrecting] = useState<{ ingredient: SummaryIngredient; line: SummaryLine } | null>(null)

  const refresh = useCallback(() => {
    return fetch(`/api/inventory/counts/${countId}/summary`)
      .then(async (res) => {
        if (res.ok) setSummary(await res.json())
      })
      .catch(() => {})
  }, [countId])

  useEffect(() => {
    refresh()
  }, [refresh])

  if (!summary) {
    return (
      <div className="space-y-4">
        <div className="h-28 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] animate-pulse" />
        <div className="h-64 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] animate-pulse" />
      </div>
    )
  }

  const rows = [...summary.ingredients].sort((a, b) => {
    const cmp = sortKey === "value" ? a.totalValue - b.totalValue : a.ingredientName.localeCompare(b.ingredientName)
    return sortDesc ? -cmp : cmp
  })

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDesc((d) => !d)
    else {
      setSortKey(key)
      setSortDesc(key === "value")
    }
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-start gap-3 mb-6">
        <Link
          href="/inventory/counts"
          className="p-2 -ml-2 mt-1 rounded-md hover:bg-[var(--color-accent)] text-[var(--color-muted-foreground)]"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-[var(--color-foreground)]">
              {summary.name ?? `${summary.storeName} count`}
            </h1>
            <Badge variant="success">Finalized</Badge>
            {summary.isPartial && <Badge variant="warning">Partial</Badge>}
          </div>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
            {summary.storeName}
            {summary.finalizedAt && <> · finalized {format(new Date(summary.finalizedAt), "MMM d, yyyy h:mm a")}</>}
            {summary.countedByNames.length > 0 && <> · counted by {summary.countedByNames.join(", ")}</>}
          </p>
          {summary.notes && <p className="text-sm text-[var(--color-muted-foreground)] mt-1 italic">{summary.notes}</p>}
        </div>
        <div className="text-right">
          <p className="text-sm text-[var(--color-muted-foreground)]">Sitting inventory</p>
          <p className="text-3xl font-bold text-[var(--color-foreground)]">
            {fmtMoney(summary.sittingInventoryVal ?? 0)}
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] overflow-hidden mb-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-muted-foreground)]">
              <th className="px-4 py-2 font-medium">
                <button onClick={() => toggleSort("name")} className="hover:text-[var(--color-foreground)]">
                  Ingredient <SortIcon active={sortKey === "name"} desc={sortDesc} />
                </button>
              </th>
              <th className="px-4 py-2 font-medium text-right">Qty</th>
              <th className="px-4 py-2 font-medium text-right">Cost</th>
              <th className="px-4 py-2 font-medium text-right">
                <button onClick={() => toggleSort("value")} className="hover:text-[var(--color-foreground)]">
                  Value <SortIcon active={sortKey === "value"} desc={sortDesc} />
                </button>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {rows.map((ing) => (
              <IngredientRows
                key={ing.ingredientId}
                ing={ing}
                expanded={expanded.has(ing.ingredientId)}
                toggle={() => toggleExpand(ing.ingredientId)}
                canManage={canManage}
                previousCount={summary.previousCount}
                onCorrect={(line) => setCorrecting({ ingredient: ing, line })}
              />
            ))}
          </tbody>
        </table>
      </div>

      {summary.corrections.length > 0 && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] overflow-hidden mb-6">
          <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center gap-2">
            <h2 className="text-sm font-semibold text-[var(--color-foreground)]">Corrections</h2>
            <Badge variant="secondary">{summary.corrections.length}</Badge>
          </div>
          <div className="divide-y divide-[var(--color-border)]">
            {summary.corrections.map((c) => (
              <div key={c.id} className="px-4 py-2.5 text-sm">
                <p className="text-[var(--color-foreground)]">
                  <span className="font-medium">{lineName(summary, c.lineId)}</span> —{" "}
                  {c.field === "quantityCounted" ? "quantity" : "cost"} changed from {c.oldValue ?? "—"} to{" "}
                  {c.newValue ?? "—"}
                </p>
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  {c.note && <>&ldquo;{c.note}&rdquo; · </>}
                  {c.userName && <>{c.userName} · </>}
                  {format(new Date(c.createdAt), "MMM d, yyyy h:mm a")}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {correcting && (
        <CorrectionDialog
          countId={countId}
          ingredient={correcting.ingredient}
          line={correcting.line}
          onDone={async () => {
            setCorrecting(null)
            await refresh()
          }}
          onClose={() => setCorrecting(null)}
        />
      )}
    </div>
  )
}

function SortIcon({ active, desc }: { active: boolean; desc: boolean }) {
  if (!active) return null
  return desc ? <ArrowDown className="h-3 w-3 inline" /> : <ArrowUp className="h-3 w-3 inline" />
}

function lineName(summary: Summary, lineId: string) {
  for (const ing of summary.ingredients) {
    const line = ing.lines.find((l) => l.lineId === lineId)
    if (line) return `${ing.ingredientName} (${line.areaName})`
  }
  return "Removed line"
}

function IngredientRows({
  ing,
  expanded,
  toggle,
  canManage,
  previousCount,
  onCorrect,
}: {
  ing: SummaryIngredient
  expanded: boolean
  toggle: () => void
  canManage: boolean
  previousCount: Summary["previousCount"]
  onCorrect: (line: SummaryLine) => void
}) {
  return (
    <>
      <tr className="hover:bg-[var(--color-accent)] cursor-pointer" onClick={toggle}>
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-1.5">
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-[var(--color-muted-foreground)] shrink-0" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-[var(--color-muted-foreground)] shrink-0" />
            )}
            <span className="font-medium text-[var(--color-foreground)]">{ing.ingredientName}</span>
            {ing.costDrift && (
              <span
                className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full bg-[var(--color-destructive)]/10 text-[var(--color-destructive)]"
                title={`Current cost ${fmtMoney(ing.currentCostPerReportingUnit)}/${ing.reportingUnit} differs >50% from the count snapshot — correct this line?`}
              >
                <AlertTriangle className="h-3 w-3" />
                cost changed since count
              </span>
            )}
          </div>
        </td>
        <td className="px-4 py-2.5 text-right whitespace-nowrap">
          {round2(ing.totalQuantity)} {ing.reportingUnit}
        </td>
        <td className="px-4 py-2.5 text-right whitespace-nowrap text-[var(--color-muted-foreground)]">
          {fmtMoney(ing.snapshotCostPerReportingUnit)}/{ing.reportingUnit}
        </td>
        <td className="px-4 py-2.5 text-right font-semibold whitespace-nowrap">{fmtMoney(ing.totalValue)}</td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={4} className="px-4 pb-3 pt-0 bg-[var(--color-muted)]/30">
            <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-card)] divide-y divide-[var(--color-border)] mt-1">
              {ing.lines.map((line) => (
                <div key={line.lineId} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm">
                  <span className="flex-1 min-w-32 text-[var(--color-muted-foreground)]">{line.areaName}</span>
                  <span>
                    {line.quantityCounted ?? 0} {ing.reportingUnit}
                  </span>
                  {previousCount && (
                    <span
                      className="text-xs text-[var(--color-muted-foreground)]"
                      title={`Previous finalized count${previousCount.finalizedAt ? ` (${format(new Date(previousCount.finalizedAt), "MMM d")})` : ""}`}
                    >
                      prev: {line.previousQuantity ?? "—"}
                    </span>
                  )}
                  <span className="w-20 text-right">{fmtMoney(line.lineValue ?? 0)}</span>
                  {canManage && (
                    <Button variant="ghost" size="sm" onClick={() => onCorrect(line)}>
                      <Pencil className="h-3.5 w-3.5" />
                      Correct
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}

function CorrectionDialog({
  countId,
  ingredient,
  line,
  onDone,
  onClose,
}: {
  countId: string
  ingredient: SummaryIngredient
  line: SummaryLine
  onDone: () => Promise<void>
  onClose: () => void
}) {
  const [qty, setQty] = useState(line.quantityCounted != null ? String(line.quantityCounted) : "")
  const [cost, setCost] = useState(String(line.costPerReportingUnit))
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  async function save() {
    const qtyNum = qty.trim() === "" ? null : parseFloat(qty)
    const costNum = parseFloat(cost)
    if (qtyNum !== null && (isNaN(qtyNum) || qtyNum < 0)) {
      setError("Quantity must be a non-negative number")
      return
    }
    if (isNaN(costNum) || costNum < 0) {
      setError("Cost must be a non-negative number")
      return
    }
    if (!note.trim()) {
      setError("A note explaining the correction is required")
      return
    }
    setBusy(true)
    setError("")
    const res = await fetch(`/api/inventory/counts/${countId}/corrections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lineId: line.lineId,
        ...(qtyNum !== null && qtyNum !== line.quantityCounted ? { quantityCounted: qtyNum } : {}),
        ...(costNum !== line.costPerReportingUnit ? { costPerReportingUnit: costNum } : {}),
        note: note.trim(),
      }),
    })
    setBusy(false)
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      setError(body?.error ?? "Could not save the correction")
      return
    }
    await onDone()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Correct {ingredient.ingredientName}</DialogTitle>
          <DialogDescription>
            {line.areaName} — recomputes the line value and count total, and records an audit entry.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-3">
            <div className="flex-1">
              <Label htmlFor="corr-qty">Quantity ({ingredient.reportingUnit})</Label>
              <Input
                id="corr-qty"
                type="text"
                inputMode="decimal"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                className="mt-1"
              />
            </div>
            <div className="flex-1">
              <Label htmlFor="corr-cost">Cost per {ingredient.reportingUnit}</Label>
              <Input
                id="corr-cost"
                type="text"
                inputMode="decimal"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="corr-note">Why the correction?</Label>
            <Textarea
              id="corr-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="mt-1"
              placeholder="e.g. counted cases instead of lbs"
            />
          </div>
          {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save correction"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
