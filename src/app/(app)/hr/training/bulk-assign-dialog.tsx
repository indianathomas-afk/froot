"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { badgePreset } from "@/lib/badge-presets"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

// HR-22 Bulk Assign — one module × many recipients, the inverse of the
// /staff/[id] dialog. Opened from the shared ModuleActions cluster, so it is
// reachable from card and list views at once.
//
// EVERY RULE ON DISPLAY HERE IS THE SERVER'S. Eligibility arrives decided from
// GET .../bulk/recipients and the counts in the result panel are the POST's own
// — this component never computes who is reachable, it renders what it is told
// (R-d: server-side, never UI-only).

export type BulkAssignModule = {
  id: string
  title: string
  category: { name: string; colorKey: string } | null
}

type RecipientStore = { id: string; name: string; expandsTo: number }
type RecipientStaff = {
  id: string
  displayName: string
  storeIds: string[]
  isCorporate: boolean
  hasLogin: boolean
  eligibility: "eligible" | "already-assigned" | "not-applicable"
}
type RecipientsPayload = {
  caller: { isAdmin: boolean }
  stores: RecipientStore[]
  staff: RecipientStaff[]
  trainers: { id: string; name: string }[]
}

type BulkResult = {
  requested: number
  assigned: number
  alreadyAssigned: number
  terminated: number
  notApplicable: number
  corporateExcluded: number
  concurrentlyAssigned: number
}

type Mode = "selection" | "all-in-scope"

const OUTCOME_LABELS: { key: keyof BulkResult; label: string }[] = [
  { key: "assigned", label: "assigned" },
  { key: "alreadyAssigned", label: "already had it" },
  { key: "terminated", label: "terminated" },
  { key: "notApplicable", label: "not applicable to their store" },
  { key: "corporateExcluded", label: "corporate, excluded from store selection" },
]

export function BulkAssignDialog({
  module,
  onClose,
  onAssigned,
}: {
  module: BulkAssignModule | null
  onClose: () => void
  onAssigned: () => void
}) {
  const [data, setData] = useState<RecipientsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>("selection")
  const [stores, setStores] = useState<Set<string>>(new Set())
  const [staff, setStaff] = useState<Set<string>>(new Set())
  const [trainerUserId, setTrainerUserId] = useState("")
  const [dueDate, setDueDate] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<BulkResult | null>(null)

  const moduleId = module?.id ?? null

  // No reset block here: the parent keys this component by module id, so a
  // different module gets a fresh mount and fresh state. Resetting in the
  // effect instead would be a synchronous setState inside an effect body,
  // which react-hooks/set-state-in-effect rejects — the same constraint HR-21
  // met in training-client.tsx.
  useEffect(() => {
    if (!moduleId) return
    fetch(`/api/hr/training/assignments/bulk/recipients?moduleId=${encodeURIComponent(moduleId)}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => null)
          throw new Error(body?.error ?? "Could not load recipients")
        }
        return r.json()
      })
      .then((payload: RecipientsPayload) => setData(payload))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [moduleId])

  function toggle(set: Set<string>, id: string, apply: (next: Set<string>) => void) {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    apply(next)
  }

  // The preview N for the disclosure. ADVISORY — it is this browser's reading of
  // a population that can change under it, which is why the result panel below
  // reports the server's counts rather than echoing this one back.
  const previewIds = new Set<string>()
  if (data) {
    for (const m of data.staff) {
      if (m.eligibility !== "eligible") continue
      if (mode === "all-in-scope") {
        // Corporate staff are in ADMIN's everything-in-scope and out of a
        // MANAGER's, because a MANAGER's scope is itself a store expansion.
        if (data.caller.isAdmin || !m.isCorporate) previewIds.add(m.id)
      } else if (staff.has(m.id)) {
        previewIds.add(m.id)
      } else if (!m.isCorporate && m.storeIds.some((id) => stores.has(id))) {
        previewIds.add(m.id)
      }
    }
  }
  const previewCount = previewIds.size
  const previewNoLogin = data
    ? data.staff.filter((m) => previewIds.has(m.id) && !m.hasLogin).length
    : 0
  const canSubmit =
    !submitting && (mode === "all-in-scope" || stores.size > 0 || staff.size > 0)

  async function submit() {
    if (!moduleId) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch("/api/hr/training/assignments/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trainingModuleId: moduleId,
          recipients:
            mode === "all-in-scope"
              ? { mode }
              : { mode, staffMemberIds: [...staff], storeIds: [...stores] },
          trainerUserId: trainerUserId || null,
          // Noon-normalized exactly as staff-training.tsx:156 does it — a date
          // must mean the same thing on both assign paths.
          dueDate: dueDate ? new Date(`${dueDate}T12:00:00`).toISOString() : null,
        }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setError(body?.error ?? "Failed to assign")
        return
      }
      setResult(body as BulkResult)
      onAssigned()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={!!module} onOpenChange={(open) => !open && onClose()}>
      {/* Bounded to the viewport and split into three bands — pinned header,
          scrolling body, pinned footer. Twelve stores and a full roster used to
          push Cancel/Assign below the fold with no way to reach them: the two
          recipient lists scroll internally, but their max-heights stack, and
          nothing above them was bounded. Same fix and same shape as UX-1
          (users/user-actions.tsx:288) — DialogContent defaults to `grid`, so
          flex-col is what lets the body take the remaining space. The error
          line stays pinned with the header rather than scrolling away with the
          body that produced it. Scoped to this modal, not dialog.tsx. */}
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Bulk assign training</DialogTitle>
        </DialogHeader>

        {module && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-[var(--color-foreground)]">{module.title}</span>
            {module.category && (
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${badgePreset(module.category.colorKey).badge}`}
              >
                {module.category.name}
              </span>
            )}
          </div>
        )}

        {error && (
          <p className="text-sm text-[var(--color-destructive)]">{error}</p>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1">
          {result ? (
            /* The named counts, not a bare success toast — the response reports
               its own blast radius and these are its numbers verbatim. */
            <div className="space-y-3">
              <p className="text-sm text-[var(--color-foreground)]">
                {result.requested} {result.requested === 1 ? "person" : "people"} in this request:
              </p>
              <ul className="text-sm space-y-1">
                {OUTCOME_LABELS.filter(({ key }) => result[key] > 0).map(({ key, label }) => (
                  <li key={key} className="text-[var(--color-muted-foreground)]">
                    <span className="font-medium text-[var(--color-foreground)]">{result[key]}</span> {label}
                  </li>
                ))}
              </ul>
              {result.concurrentlyAssigned > 0 && (
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  {result.concurrentlyAssigned} of those were assigned by someone else while this
                  request was running.
                </p>
              )}
            </div>
          ) : loading ? (
            <div className="space-y-2">
              <div className="h-9 bg-[var(--color-muted)] rounded animate-pulse" />
              <div className="h-32 bg-[var(--color-muted)] rounded animate-pulse" />
            </div>
          ) : data ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Recipients</Label>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant={mode === "selection" ? "default" : "outline"}
                    onClick={() => setMode("selection")}
                  >
                    Choose stores or people
                  </Button>
                  <Button
                    size="sm"
                    variant={mode === "all-in-scope" ? "default" : "outline"}
                    onClick={() => setMode("all-in-scope")}
                  >
                    Everyone in my scope
                  </Button>
                </div>
              </div>

              {mode === "selection" && (
                <>
                  <div className="space-y-1.5">
                    <Label>Stores</Label>
                    <div className="max-h-32 overflow-y-auto border border-[var(--color-border)] rounded-md divide-y divide-[var(--color-border)]">
                      {data.stores.map((s) => (
                        <label key={s.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer">
                          <input
                            type="checkbox"
                            checked={stores.has(s.id)}
                            onChange={() => toggle(stores, s.id, setStores)}
                          />
                          <span className="flex-1">{s.name}</span>
                          <span className="text-xs text-[var(--color-muted-foreground)]">
                            reaches {s.expandsTo}
                          </span>
                        </label>
                      ))}
                    </div>
                    <p className="text-xs text-[var(--color-muted-foreground)]">
                      Selecting a store reaches its active, store-based team. Corporate staff are
                      assigned to every store, so they are never swept in this way — pick them
                      individually below.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Individuals</Label>
                    <div className="max-h-48 overflow-y-auto border border-[var(--color-border)] rounded-md divide-y divide-[var(--color-border)]">
                      {data.staff.map((m) => (
                        <label
                          key={m.id}
                          className={`flex items-center gap-2 px-3 py-2 text-sm ${m.eligibility === "eligible" ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}
                        >
                          <input
                            type="checkbox"
                            disabled={m.eligibility !== "eligible"}
                            checked={staff.has(m.id)}
                            onChange={() => toggle(staff, m.id, setStaff)}
                          />
                          <span className="flex-1">{m.displayName}</span>
                          {m.isCorporate && (
                            <span className="text-xs text-[var(--color-muted-foreground)]">Corporate</span>
                          )}
                          {m.eligibility === "already-assigned" && (
                            <span className="text-xs text-[var(--color-muted-foreground)]">already assigned</span>
                          )}
                          {m.eligibility === "not-applicable" && (
                            <span className="text-xs text-[var(--color-muted-foreground)]">not at this module&rsquo;s stores</span>
                          )}
                        </label>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <div className="space-y-1.5">
                <Label>Trainer (optional)</Label>
                <Select value={trainerUserId} onValueChange={setTrainerUserId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a trainer" />
                  </SelectTrigger>
                  <SelectContent>
                    {data.trainers.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Due date (optional)</Label>
                <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
            </div>
          ) : null}
        </div>

        {/* DISCLOSURE GUARDRAIL (ruling 6, wording ruled by Gary 2026-08-11 —
            option B). Compliance counts an assignment from the instant it is
            created; dueDate drives `overdue` but never gates membership in
            the denominator (hr-compliance.ts:317-318). HR-13 owns changing
            that; this line makes sure the dip is never a surprise if it
            slips.

            It sits in the pinned footer band rather than at the end of the
            scrolling body: a disclosure the operator has to scroll to find is
            one they can miss, and it belongs beside the button it is about.
            `!result` replaces the enclosing `data ?` branch it used to sit in —
            previewCount is still >0 after a submit, and the result panel
            reports the server's own counts instead. */}
        {!result && previewCount > 0 && (
          <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-muted)] px-3 py-2.5 space-y-1">
            <p className="text-sm text-[var(--color-foreground)]">
              Assigning now adds {previewCount} required{" "}
              {previewCount === 1 ? "item" : "items"} to compliance. Compliance percentages for
              {previewCount === 1 ? " this person" : ` these ${previewCount} people`}, and their
              store rollups, drop immediately — a due date does not hold that back.
            </p>
            {previewNoLogin > 0 && (
              <p className="text-sm text-[var(--color-muted-foreground)]">
                {previewNoLogin} of them {previewNoLogin === 1 ? "has" : "have"} no self-service
                login — a manager records their completions.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {result ? (
            <Button onClick={onClose}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={!canSubmit || !data}>
                {submitting ? "Assigning..." : "Assign"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
