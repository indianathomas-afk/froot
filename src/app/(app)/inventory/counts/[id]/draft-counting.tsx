"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  CloudOff,
  ListOrdered,
  Loader2,
  Minus,
  Plus,
  Scale,
  Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { fmtMoney } from "../counts-client"
import type { ActiveIngredient, CountDetail, CountLine } from "./count-client"
import { WeighDialog } from "./weigh-dialog"
import { FinalizeDialog } from "./finalize-dialog"

type SaveState = "saved" | "saving" | "pending"

export function DraftCounting({
  detail,
  refresh,
  canManage,
}: {
  detail: CountDetail
  refresh: () => Promise<void>
  canManage: boolean
}) {
  const router = useRouter()
  const [quantities, setQuantities] = useState<Record<string, number | null>>({})

  // Offline-tolerant save queue: edits land in pendingRef and flush with
  // backoff. A dead walk-in wi-fi loses nothing — counts stay queued client-side
  // until a PATCH succeeds.
  const pendingRef = useRef(new Map<string, number | null>())
  const inflightRef = useRef(false)
  const backoffRef = useRef(2000)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const retryRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // Retries and debounced saves go through this ref so timers always call the
  // latest flush without flush depending on itself.
  const flushRef = useRef<() => void>(() => {})
  const [pendingCount, setPendingCount] = useState(0)
  const [saveState, setSaveState] = useState<SaveState>("saved")

  // Local first-entry order — drives the sheet-to-shelf re-sort preview for
  // lines counted this session (server countedAt covers earlier sessions).
  const [entryOrder, setEntryOrder] = useState<Map<string, number>>(new Map())

  const [weighLine, setWeighLine] = useState<CountLine | null>(null)
  const [finalizeOpen, setFinalizeOpen] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [resortArea, setResortArea] = useState<{ id: string; name: string } | null>(null)
  const [triageDismissed, setTriageDismissed] = useState(false)

  // Merge server lines into local state (render-phase adjustment), but never
  // clobber unsaved local edits.
  const [prevDetail, setPrevDetail] = useState<CountDetail | null>(null)
  if (prevDetail !== detail) {
    setPrevDetail(detail)
    setQuantities((prev) => {
      const next: Record<string, number | null> = {}
      for (const area of detail.areas) {
        for (const line of area.lines) {
          next[line.id] = pendingRef.current.has(line.id) ? prev[line.id] ?? null : line.quantityCounted
        }
      }
      return next
    })
  }

  const flush = useCallback(async () => {
    if (inflightRef.current) return
    if (pendingRef.current.size === 0) {
      setSaveState("saved")
      return
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setSaveState("pending")
      clearTimeout(retryRef.current)
      retryRef.current = setTimeout(() => flushRef.current(), backoffRef.current)
      backoffRef.current = Math.min(backoffRef.current * 2, 30000)
      return
    }
    const batch = [...pendingRef.current.entries()].map(([lineId, quantityCounted]) => ({ lineId, quantityCounted }))
    inflightRef.current = true
    setSaveState("saving")
    try {
      const res = await fetch(`/api/inventory/counts/${detail.id}/lines`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines: batch }),
      })
      if (!res.ok) throw new Error("save failed")
      inflightRef.current = false
      for (const b of batch) {
        if (pendingRef.current.get(b.lineId) === b.quantityCounted) pendingRef.current.delete(b.lineId)
      }
      backoffRef.current = 2000
      setPendingCount(pendingRef.current.size)
      if (pendingRef.current.size > 0) flushRef.current()
      else setSaveState("saved")
    } catch {
      inflightRef.current = false
      setPendingCount(pendingRef.current.size)
      setSaveState("pending")
      clearTimeout(retryRef.current)
      retryRef.current = setTimeout(() => flushRef.current(), backoffRef.current)
      backoffRef.current = Math.min(backoffRef.current * 2, 30000)
    }
  }, [detail.id])

  useEffect(() => {
    flushRef.current = () => void flush()
  }, [flush])

  useEffect(() => {
    const onOnline = () => {
      backoffRef.current = 2000
      flushRef.current()
    }
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (pendingRef.current.size > 0 || inflightRef.current) e.preventDefault()
    }
    window.addEventListener("online", onOnline)
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => {
      window.removeEventListener("online", onOnline)
      window.removeEventListener("beforeunload", onBeforeUnload)
      clearTimeout(debounceRef.current)
      clearTimeout(retryRef.current)
    }
  }, [flush])

  const setQty = useCallback((lineId: string, qty: number | null) => {
    setQuantities((prev) => ({ ...prev, [lineId]: qty }))
    if (qty !== null) {
      setEntryOrder((prev) => (prev.has(lineId) ? prev : new Map(prev).set(lineId, prev.size + 1)))
    }
    pendingRef.current.set(lineId, qty)
    setPendingCount(pendingRef.current.size)
    setSaveState((s) => (s === "pending" ? "pending" : "saving"))
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => flushRef.current(), 700)
  }, [])

  const allLines = useMemo(() => detail.areas.flatMap((a) => a.lines), [detail])
  const countedCount = allLines.filter((l) => quantities[l.id] != null).length
  const runningTotal = allLines.reduce((sum, l) => sum + (quantities[l.id] ?? 0) * l.costPerReportingUnit, 0)
  const lastEditAt = useMemo(() => {
    const times = allLines.map((l) => (l.countedAt ? new Date(l.countedAt).getTime() : 0))
    const max = Math.max(0, ...times)
    return max > 0 ? new Date(max) : null
  }, [allLines])

  const assignedIngredientIds = useMemo(() => new Set(allLines.map((l) => l.ingredientId)), [allLines])
  const unassigned = detail.activeIngredients.filter((i) => !assignedIngredientIds.has(i.id))
  const showTriage = unassigned.length > 0 && !triageDismissed

  async function discardDraft() {
    const res = await fetch(`/api/inventory/counts/${detail.id}`, { method: "DELETE" })
    if (res.ok) router.push("/inventory/counts")
  }

  return (
    <div className="max-w-3xl mx-auto pb-32">
      {/* Sticky header: progress, running total, save indicator */}
      <div className="sticky top-0 z-30 -mx-4 px-4 pt-2 pb-3 bg-[var(--color-background)] border-b border-[var(--color-border)] mb-4">
        <div className="flex items-center gap-3 mb-2">
          <Link
            href="/inventory/counts"
            className="p-2 -ml-2 rounded-md hover:bg-[var(--color-accent)] text-[var(--color-muted-foreground)]"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-[var(--color-foreground)] truncate">{detail.storeName} count</h1>
            <p className="text-xs text-[var(--color-muted-foreground)]">
              {countedCount} of {allLines.length} counted · {fmtMoney(runningTotal)}
            </p>
          </div>
          <SaveIndicator state={saveState} pending={pendingCount} />
          <button
            onClick={() => setDiscardOpen(true)}
            title="Discard draft"
            className="p-2 rounded-md hover:bg-[var(--color-accent)] text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)]"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
        <div className="h-1.5 rounded-full bg-[var(--color-muted)] overflow-hidden">
          <div
            className="h-full bg-[var(--color-primary)] transition-all"
            style={{ width: allLines.length > 0 ? `${(countedCount / allLines.length) * 100}%` : "0%" }}
          />
        </div>
      </div>

      {showTriage && (
        <TriagePanel
          countId={detail.id}
          unassigned={unassigned}
          areas={detail.areas.filter((a) => a.id !== "unareaed").map((a) => ({ id: a.id, name: a.name }))}
          canManage={canManage}
          onDone={refresh}
          onSkip={() => setTriageDismissed(true)}
        />
      )}

      <div className="space-y-4">
        {detail.areas.map((area) => (
          <AreaSection
            key={area.id}
            countId={detail.id}
            area={area}
            quantities={quantities}
            setQty={setQty}
            onWeigh={setWeighLine}
            activeIngredients={detail.activeIngredients}
            onLinesAdded={refresh}
            onResort={() => setResortArea({ id: area.id, name: area.name })}
          />
        ))}
        {detail.areas.every((a) => a.lines.length === 0) && (
          <div className="p-10 text-center text-sm text-[var(--color-muted-foreground)] rounded-lg border border-[var(--color-border)] bg-[var(--color-card)]">
            No ingredients on this count sheet yet. Set up{" "}
            <Link href="/inventory/storage-areas" className="text-[var(--color-primary)] underline">
              storage areas
            </Link>{" "}
            for this store, or use the panel above to assign ingredients.
          </div>
        )}
      </div>

      {/* Bottom action bar */}
      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center gap-4">
          <div className="flex-1">
            <p className="text-xs text-[var(--color-muted-foreground)]">Running total</p>
            <p className="text-lg font-bold text-[var(--color-foreground)]">{fmtMoney(runningTotal)}</p>
          </div>
          {canManage ? (
            <Button
              size="lg"
              className="min-h-11"
              onClick={async () => {
                clearTimeout(debounceRef.current)
                await flush()
                setFinalizeOpen(true)
              }}
            >
              Finalize…
            </Button>
          ) : (
            <p className="text-xs text-[var(--color-muted-foreground)] max-w-44 text-right">
              A manager or admin finalizes the count when every area is done.
            </p>
          )}
        </div>
      </div>

      {weighLine && (
        <WeighDialog
          line={weighLine}
          onApply={(qty) => {
            setQty(weighLine.id, qty)
            setWeighLine(null)
          }}
          onWeightsSaved={async () => {
            await refresh()
            setWeighLine(null)
          }}
          onClose={() => setWeighLine(null)}
        />
      )}

      {finalizeOpen && (
        <FinalizeDialog
          countId={detail.id}
          storeName={detail.storeName}
          lastEditAt={lastEditAt}
          uncountedLines={allLines.length - countedCount}
          onFinalized={async () => {
            setFinalizeOpen(false)
            await refresh()
          }}
          onClose={() => setFinalizeOpen(false)}
        />
      )}

      {resortArea && (
        <ResortDialog
          countId={detail.id}
          area={resortArea}
          lines={(detail.areas.find((a) => a.id === resortArea.id)?.lines ?? []).map((l) => ({
            ...l,
            quantityCounted: quantities[l.id] ?? null,
          }))}
          entryOrder={entryOrder}
          onDone={async () => {
            setResortArea(null)
            await refresh()
          }}
          onClose={() => setResortArea(null)}
        />
      )}

      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this draft?</AlertDialogTitle>
            <AlertDialogDescription>
              All quantities entered on this count sheet will be lost. Finalized counts are never affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep counting</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[var(--color-destructive)] text-[var(--color-destructive-foreground)] hover:opacity-90"
              onClick={discardDraft}
            >
              Discard draft
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function SaveIndicator({ state, pending }: { state: SaveState; pending: number }) {
  if (state === "saved") {
    return (
      <span className="flex items-center gap-1 text-xs text-[var(--color-success-text)]">
        <Check className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">All changes saved</span>
      </span>
    )
  }
  if (state === "saving") {
    return (
      <span className="flex items-center gap-1 text-xs text-[var(--color-muted-foreground)]">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span className="hidden sm:inline">Saving…</span>
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1 text-xs text-[var(--color-warning-text)]" title="Retrying automatically — don't close this page">
      <CloudOff className="h-3.5 w-3.5" />
      Offline — {pending} count{pending === 1 ? "" : "s"} pending
    </span>
  )
}

function AreaSection({
  countId,
  area,
  quantities,
  setQty,
  onWeigh,
  activeIngredients,
  onLinesAdded,
  onResort,
}: {
  countId: string
  area: CountDetail["areas"][number]
  quantities: Record<string, number | null>
  setQty: (lineId: string, qty: number | null) => void
  onWeigh: (line: CountLine) => void
  activeIngredients: ActiveIngredient[]
  onLinesAdded: () => Promise<void>
  onResort: () => void
}) {
  const [open, setOpen] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const counted = area.lines.filter((l) => quantities[l.id] != null).length
  const complete = area.lines.length > 0 && counted === area.lines.length
  const subtotal = area.lines.reduce((sum, l) => sum + (quantities[l.id] ?? 0) * l.costPerReportingUnit, 0)

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[var(--color-accent)] transition-colors min-h-[52px]"
      >
        <span
          className={
            complete
              ? "w-6 h-6 rounded-full bg-[var(--color-success-bg)] border border-[var(--color-success-border)] flex items-center justify-center shrink-0"
              : "w-6 h-6 rounded-full border border-[var(--color-border)] shrink-0"
          }
        >
          {complete && <Check className="h-4 w-4 text-[var(--color-success-text)]" />}
        </span>
        <span className="flex-1 font-semibold text-[var(--color-foreground)]">{area.name}</span>
        <span className="text-xs text-[var(--color-muted-foreground)]">
          {counted}/{area.lines.length} · {fmtMoney(subtotal)}
        </span>
        {open ? (
          <ChevronUp className="h-4 w-4 text-[var(--color-muted-foreground)]" />
        ) : (
          <ChevronDown className="h-4 w-4 text-[var(--color-muted-foreground)]" />
        )}
      </button>

      {open && (
        <div className="border-t border-[var(--color-border)] divide-y divide-[var(--color-border)]">
          {area.lines.map((line) => (
            <LineRow key={line.id} line={line} qty={quantities[line.id] ?? null} setQty={setQty} onWeigh={onWeigh} />
          ))}
          {area.lines.length === 0 && (
            <p className="px-4 py-4 text-sm text-[var(--color-muted-foreground)]">Nothing assigned to this area.</p>
          )}

          <div className="px-4 py-3 flex flex-wrap items-center gap-2">
            {area.id !== "unareaed" && (
              <Button variant="outline" size="sm" className="min-h-10" onClick={() => setAddOpen((o) => !o)}>
                <Plus className="h-4 w-4" />
                Add ingredient
              </Button>
            )}
            {complete && area.lines.length > 1 && (
              <Button variant="ghost" size="sm" className="min-h-10 text-[var(--color-muted-foreground)]" onClick={onResort}>
                <ListOrdered className="h-4 w-4" />
                Re-sort by count order
              </Button>
            )}
          </div>
          {addOpen && area.id !== "unareaed" && (
            <MidCountAdd
              countId={countId}
              areaId={area.id}
              existingIngredientIds={new Set(area.lines.map((l) => l.ingredientId))}
              activeIngredients={activeIngredients}
              onAdded={async () => {
                await onLinesAdded()
              }}
            />
          )}
        </div>
      )}
    </div>
  )
}

function LineRow({
  line,
  qty,
  setQty,
  onWeigh,
}: {
  line: CountLine
  qty: number | null
  setQty: (lineId: string, qty: number | null) => void
  onWeigh: (line: CountLine) => void
}) {
  const isEachType = line.reportingUnit === "each" || line.reportingUnit === "serving"
  const caseable = line.unitsPerPurchase > 1
  const [caseMode, setCaseMode] = useState(false)
  const [text, setText] = useState(qty != null ? String(caseMode ? qty / line.unitsPerPurchase : qty) : "")

  // Reflect external updates (weigh dialog, "+1 case") without fighting typing —
  // render-phase adjustment keyed on the displayed value.
  const displayValue = qty == null ? null : caseMode ? round3(qty / line.unitsPerPurchase) : qty
  const parsed = parseFloat(text)
  const textValue = isNaN(parsed) ? null : parsed
  const [prevDisplay, setPrevDisplay] = useState<number | null>(displayValue)
  if (prevDisplay !== displayValue) {
    setPrevDisplay(displayValue)
    if (textValue !== displayValue) setText(displayValue == null ? "" : String(displayValue))
  }

  function handleText(v: string) {
    setText(v)
    const num = parseFloat(v)
    if (v.trim() === "") {
      setQty(line.id, null)
    } else if (!isNaN(num) && num >= 0) {
      setQty(line.id, caseMode ? round3(num * line.unitsPerPurchase) : num)
    }
  }

  function toggleCaseMode() {
    const next = !caseMode
    setCaseMode(next)
    setText(qty == null ? "" : String(next ? round3(qty / line.unitsPerPurchase) : qty))
  }

  return (
    <div className="px-4 py-3 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--color-foreground)] truncate">{line.ingredientName}</p>
        <p className="text-xs text-[var(--color-muted-foreground)]">
          {caseMode ? (
            <>
              {line.purchaseUnitLabel}s of {line.unitsPerPurchase} {line.reportingUnit}
              {qty != null && <> · = {round3(qty)} {line.reportingUnit}</>}
            </>
          ) : (
            line.reportingUnit
          )}
        </p>
        <div className="flex gap-1 mt-1">
          {caseable && (
            <button
              onClick={toggleCaseMode}
              className={
                "text-[11px] px-1.5 py-0.5 rounded border transition-colors " +
                (caseMode
                  ? "border-[var(--color-primary)] text-[var(--color-primary)] bg-[var(--color-primary)]/10"
                  : "border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]")
              }
            >
              by {line.purchaseUnitLabel}
            </button>
          )}
          {caseable && !caseMode && (
            <button
              onClick={() => setQty(line.id, round3((qty ?? 0) + line.unitsPerPurchase))}
              className="text-[11px] px-1.5 py-0.5 rounded border border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] transition-colors"
            >
              +1 {line.purchaseUnitLabel}
            </button>
          )}
        </div>
      </div>

      <button
        onClick={() => onWeigh(line)}
        title={line.tareWeightOz != null ? "Count by weighing" : "Set up count-by-weighing"}
        className="p-2.5 rounded-md border border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] transition-colors min-h-11 min-w-11"
      >
        <Scale className="h-4 w-4" />
      </button>

      {isEachType && (
        <button
          onClick={() => setQty(line.id, Math.max(0, (qty ?? 0) - 1))}
          className="p-2.5 rounded-md border border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] transition-colors min-h-11 min-w-11"
        >
          <Minus className="h-4 w-4" />
        </button>
      )}
      <Input
        type="text"
        inputMode="decimal"
        value={text}
        onChange={(e) => handleText(e.target.value)}
        placeholder="—"
        className="w-24 min-h-11 text-center text-lg font-semibold"
      />
      {isEachType && (
        <button
          onClick={() => setQty(line.id, (qty ?? 0) + 1)}
          className="p-2.5 rounded-md border border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] transition-colors min-h-11 min-w-11"
        >
          <Plus className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}

function round3(n: number) {
  return Math.round(n * 1000) / 1000
}

// Mid-count add: fix setup without leaving the draft — assigns the ingredient
// to this area (mapping persists for future counts) and snapshots a line now.
function MidCountAdd({
  countId,
  areaId,
  existingIngredientIds,
  activeIngredients,
  onAdded,
}: {
  countId: string
  areaId: string
  existingIngredientIds: Set<string>
  activeIngredients: ActiveIngredient[]
  onAdded: () => Promise<void>
}) {
  const [q, setQ] = useState("")
  const [busyId, setBusyId] = useState<string | null>(null)

  const candidates = activeIngredients
    .filter((i) => !existingIngredientIds.has(i.id))
    .filter((i) => i.name.toLowerCase().includes(q.trim().toLowerCase()))
    .slice(0, 8)

  async function add(ingredientId: string) {
    setBusyId(ingredientId)
    const res = await fetch(`/api/inventory/counts/${countId}/lines`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ additions: [{ storageAreaId: areaId, ingredientId }] }),
    })
    if (res.ok) await onAdded()
    setBusyId(null)
  }

  return (
    <div className="px-4 py-3 bg-[var(--color-muted)]/40">
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search ingredients to add & count…"
        className="min-h-11 mb-2"
        autoFocus
      />
      <div className="divide-y divide-[var(--color-border)] rounded-md border border-[var(--color-border)] bg-[var(--color-card)]">
        {candidates.length === 0 ? (
          <p className="px-3 py-3 text-sm text-[var(--color-muted-foreground)]">No matching active ingredients.</p>
        ) : (
          candidates.map((i) => (
            <button
              key={i.id}
              disabled={busyId !== null}
              onClick={() => add(i.id)}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-[var(--color-accent)] transition-colors min-h-11"
            >
              <span className="flex-1 text-sm">{i.name}</span>
              {i.categoryName && (
                <span className="text-xs text-[var(--color-muted-foreground)]">{i.categoryName}</span>
              )}
              <span className="text-xs font-medium text-[var(--color-primary)]">
                {busyId === i.id ? "Adding…" : "Add & count"}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}

// Opening triage: active ingredients with no storage-area assignment in this
// store can't be counted — assign them (or archive, for managers) before walking.
function TriagePanel({
  countId,
  unassigned,
  areas,
  canManage,
  onDone,
  onSkip,
}: {
  countId: string
  unassigned: ActiveIngredient[]
  areas: { id: string; name: string }[]
  canManage: boolean
  onDone: () => Promise<void>
  onSkip: () => void
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [areaId, setAreaId] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function assign() {
    if (!areaId || selected.size === 0) return
    setBusy(true)
    setError("")
    const res = await fetch(`/api/inventory/counts/${countId}/lines`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ additions: [...selected].map((ingredientId) => ({ storageAreaId: areaId, ingredientId })) }),
    })
    setBusy(false)
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      setError(body?.error ?? "Could not assign ingredients")
      return
    }
    setSelected(new Set())
    await onDone()
  }

  async function archive() {
    if (selected.size === 0) return
    setBusy(true)
    setError("")
    const results = await Promise.all(
      [...selected].map((id) =>
        fetch(`/api/inventory/ingredients/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isArchived: true }),
        })
      )
    )
    setBusy(false)
    if (results.some((r) => !r.ok)) setError("Some ingredients could not be archived")
    setSelected(new Set())
    await onDone()
  }

  return (
    <div className="mb-4 rounded-lg border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] p-4">
      <div className="flex items-start gap-3 mb-3">
        <AlertTriangle className="h-5 w-5 text-[var(--color-warning-text)] shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-medium text-[var(--color-warning-text)]">
            {unassigned.length} ingredient{unassigned.length === 1 ? "" : "s"} can&apos;t be counted yet
          </p>
          <p className="text-xs text-[var(--color-warning-text)]/80">
            They have no storage area at this store. Assign them below{canManage ? " (or archive what you no longer stock)" : ""} —
            or skip and fix it later.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onSkip} className="text-[var(--color-warning-text)]">
          Skip for now
        </Button>
      </div>

      <div className="max-h-48 overflow-y-auto rounded-md border border-[var(--color-border)] bg-[var(--color-card)] divide-y divide-[var(--color-border)] mb-3">
        {unassigned.map((i) => (
          <label key={i.id} className="flex items-center gap-3 px-3 py-2.5 cursor-pointer min-h-11">
            <Checkbox checked={selected.has(i.id)} onCheckedChange={() => toggle(i.id)} />
            <span className="flex-1 text-sm">{i.name}</span>
            {i.categoryName && <span className="text-xs text-[var(--color-muted-foreground)]">{i.categoryName}</span>}
          </label>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={areaId} onValueChange={setAreaId}>
          <SelectTrigger className="w-44 min-h-11 bg-[var(--color-card)]">
            <SelectValue placeholder="Assign to area…" />
          </SelectTrigger>
          <SelectContent>
            {areas.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={assign} disabled={busy || !areaId || selected.size === 0} className="min-h-11">
          Assign &amp; count ({selected.size})
        </Button>
        {canManage && (
          <Button variant="outline" onClick={archive} disabled={busy || selected.size === 0} className="min-h-11">
            Archive ({selected.size})
          </Button>
        )}
      </div>
      {error && <p className="text-sm text-[var(--color-destructive)] mt-2">{error}</p>}
    </div>
  )
}

// Sheet-to-shelf re-sort: preview the order this area was actually counted in,
// confirm, and it becomes the area's saved default order for the next count.
function ResortDialog({
  countId,
  area,
  lines,
  entryOrder,
  onDone,
  onClose,
}: {
  countId: string
  area: { id: string; name: string }
  lines: CountLine[]
  entryOrder: Map<string, number>
  onDone: () => Promise<void>
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const ordered = [...lines].sort((a, b) => effectiveTime(a, entryOrder) - effectiveTime(b, entryOrder))

  async function confirm() {
    setBusy(true)
    setError("")
    const res = await fetch(`/api/inventory/counts/${countId}/resort-area`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storageAreaId: area.id }),
    })
    setBusy(false)
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      setError(body?.error ?? "Could not re-sort the area")
      return
    }
    await onDone()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Re-sort {area.name}</DialogTitle>
          <DialogDescription>
            The order you just counted becomes this area&apos;s saved sheet order for future counts.
          </DialogDescription>
        </DialogHeader>
        <ol className="max-h-64 overflow-y-auto rounded-md border border-[var(--color-border)] divide-y divide-[var(--color-border)] text-sm">
          {ordered.map((l, idx) => (
            <li key={l.id} className="flex items-center gap-2 px-3 py-2">
              <span className="w-5 text-xs text-[var(--color-muted-foreground)]">{idx + 1}.</span>
              {l.ingredientName}
            </li>
          ))}
        </ol>
        {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={busy}>
            {busy ? "Saving…" : "Save as default order"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function effectiveTime(line: CountLine, entryOrder: Map<string, number>) {
  if (line.countedAt) return new Date(line.countedAt).getTime()
  const seq = entryOrder.get(line.id)
  // Local entries from this session sort after anything already saved.
  if (seq !== undefined) return 8.64e15 + seq
  return 8.64e15 + 1e6 + line.sortOrder
}
