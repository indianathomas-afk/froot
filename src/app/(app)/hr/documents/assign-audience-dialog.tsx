"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

// DOC-1 B — the assign dialog. Modeled on the HR-22 bulk-assign dialog in
// spirit and different from it in the one way that matters: training
// MATERIALIZES assignments (a row per person, a snapshot of today's roster),
// while this writes GRANTS — standing rules that resolve through the roster at
// read time. So this dialog edits the document's AUDIENCE; it never stamps
// per-person rows, and a new hire at a granted store picks the document up on
// their next page load with nothing re-run.
//
// EVERY RULE ON DISPLAY HERE IS THE SERVER'S. The reach counts arrive from
// GET .../audience, where they are computed by asking the policy predicate
// itself. This component renders numbers; it does not derive them.
//
// AND IT DELIBERATELY SHOWS NO LIVE TOTAL. HR-22's dialog previews a count in
// the browser and calls it advisory, which it can afford because its POST
// reports the server's own figures afterwards. Doing the same here would mean
// this file holding a second copy of the corporate-exclusion rule (R3) — the
// exact drift the phase is built to prevent — so the aggregate is shown only
// after the save, from the response. The pre-commit disclosure HR-22 needs has
// no analogue either: an assignment creates a permanent compliance obligation
// the instant it is written, whereas an audience edit is reversible and
// lossless by ruling.

export type AudienceDocumentRef = {
  id: string
  title: string
}

type AudienceStore = { id: string; name: string; reaches: number }
type AudienceStaff = {
  id: string
  displayName: string
  isCorporate: boolean
  status: string
  storeIds: string[]
}
type AudiencePayload = {
  document: { id: string; title: string; appliesTo: string; isActive: boolean }
  stores: AudienceStore[]
  staff: AudienceStaff[]
  granted: { storeIds: string[]; staffMemberIds: string[] }
}
type SaveResult = { appliesTo: string; added: number; removed: number; reaches: number }

type Mode = "all" | "selected"

export function AssignAudienceDialog({
  doc,
  onClose,
  onSaved,
}: {
  doc: AudienceDocumentRef | null
  onClose: () => void
  onSaved: () => void
}) {
  const [data, setData] = useState<AudiencePayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>("selected")
  const [stores, setStores] = useState<Set<string>>(new Set())
  const [staff, setStaff] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<SaveResult | null>(null)

  const docId = doc?.id ?? null

  // No reset block: the parent keys this component by document id, so a
  // different document gets a fresh mount and fresh state. Resetting inside the
  // effect body would be a synchronous setState in an effect, which
  // react-hooks/set-state-in-effect rejects (HR-21's constraint, and HR-22's).
  useEffect(() => {
    if (!docId) return
    fetch(`/api/hr/documents/${docId}/audience`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => null)
          throw new Error(body?.error ?? "Could not load this document's audience")
        }
        return r.json()
      })
      .then((payload: AudiencePayload) => {
        setData(payload)
        // Pre-populated with the CURRENT state, including the dormant rows a
        // company-wide document may be carrying — which is what lets the admin
        // see what narrowing would restore before they narrow.
        setMode(payload.document.appliesTo === "all" ? "all" : "selected")
        setStores(new Set(payload.granted.storeIds))
        setStaff(new Set(payload.granted.staffMemberIds))
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [docId])

  function toggle(set: Set<string>, id: string, apply: (next: Set<string>) => void) {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    apply(next)
  }

  async function save() {
    if (!docId) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/hr/documents/${docId}/audience`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // The "all" branch sends NO selection arrays — the route's schema is a
        // discriminated union that refuses them there, so this shape is what
        // makes narrow-then-restore lossless rather than a promise that it is.
        body: JSON.stringify(
          mode === "all"
            ? { appliesTo: "all" }
            : { appliesTo: "selected", storeIds: [...stores], staffMemberIds: [...staff] }
        ),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setError(body?.error ?? "Failed to save the audience")
        return
      }
      setResult(body as SaveResult)
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  const dormantCount = data
    ? data.granted.storeIds.length + data.granted.staffMemberIds.length
    : 0

  return (
    <Dialog open={!!doc} onOpenChange={(open) => !open && onClose()}>
      {/* Same three-band shape as the bulk-assign dialog (UX-1): pinned header,
          scrolling body, pinned footer. A full store list and a full roster
          otherwise push Cancel/Save below the fold with no way to reach them. */}
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Who is this document for?</DialogTitle>
        </DialogHeader>

        {doc && (
          <p className="font-medium text-[var(--color-foreground)]">{doc.title}</p>
        )}

        {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}

        <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1">
          {result ? (
            <div className="space-y-2">
              <p className="text-sm text-[var(--color-foreground)]">
                {result.appliesTo === "all"
                  ? "This document now applies to everyone in your company."
                  : "This document's audience has been updated."}
              </p>
              <p className="text-sm text-[var(--color-muted-foreground)]">
                It reaches{" "}
                <span className="font-medium text-[var(--color-foreground)]">{result.reaches}</span>{" "}
                active {result.reaches === 1 ? "person" : "people"} today.
              </p>
              {(result.added > 0 || result.removed > 0) && (
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  {result.added} added, {result.removed} removed.
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
                <Label>Audience</Label>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant={mode === "all" ? "default" : "outline"}
                    onClick={() => setMode("all")}
                  >
                    Everyone in my company
                  </Button>
                  <Button
                    size="sm"
                    variant={mode === "selected" ? "default" : "outline"}
                    onClick={() => setMode("selected")}
                  >
                    Choose stores or people
                  </Button>
                </div>
              </div>

              {/* The losslessness disclosure, shown only when there is something
                  to be lossless ABOUT. Without it, switching to Everyone looks
                  like it discards the selection below — the picks stay visible
                  but disabled, and an operator reasonably reads a greyed-out
                  checkbox as "about to be thrown away". */}
              {mode === "all" && dormantCount > 0 && (
                <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-muted)] px-3 py-2.5">
                  <p className="text-sm text-[var(--color-foreground)]">
                    The store and individual picks below are kept while this document applies to
                    everyone. Switch back to &ldquo;Choose stores or people&rdquo; and they take
                    effect again exactly as they are — nothing is discarded.
                  </p>
                </div>
              )}

              <div className="space-y-1.5">
                <Label>Stores</Label>
                <div className="max-h-32 overflow-y-auto border border-[var(--color-border)] rounded-md divide-y divide-[var(--color-border)]">
                  {data.stores.length === 0 ? (
                    <p className="px-3 py-2 text-sm text-[var(--color-muted-foreground)]">
                      No stores yet.
                    </p>
                  ) : (
                    data.stores.map((s) => (
                      <label
                        key={s.id}
                        className={`flex items-center gap-2 px-3 py-2 text-sm ${mode === "all" ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
                      >
                        <input
                          type="checkbox"
                          disabled={mode === "all"}
                          checked={stores.has(s.id)}
                          onChange={() => toggle(stores, s.id, setStores)}
                        />
                        <span className="flex-1">{s.name}</span>
                        <span className="text-xs text-[var(--color-muted-foreground)]">
                          reaches {s.reaches}
                        </span>
                      </label>
                    ))
                  )}
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
                  {data.staff.length === 0 ? (
                    <p className="px-3 py-2 text-sm text-[var(--color-muted-foreground)]">
                      No team members yet.
                    </p>
                  ) : (
                    data.staff.map((m) => (
                      <label
                        key={m.id}
                        className={`flex items-center gap-2 px-3 py-2 text-sm ${mode === "all" ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
                      >
                        <input
                          type="checkbox"
                          disabled={mode === "all"}
                          checked={staff.has(m.id)}
                          onChange={() => toggle(staff, m.id, setStaff)}
                        />
                        <span className="flex-1">{m.displayName}</span>
                        {m.isCorporate && (
                          <span className="text-xs text-[var(--color-muted-foreground)]">
                            Corporate
                          </span>
                        )}
                        {/* Terminated people appear ONLY when they already hold
                            a grant on this document. They are listed so that
                            saving does not silently revoke them — the write is a
                            delta against what this dialog submits, so anyone the
                            picker omits would be dropped. */}
                        {m.status !== "ACTIVE" && (
                          <span className="text-xs text-[var(--color-muted-foreground)]">
                            Terminated
                          </span>
                        )}
                      </label>
                    ))
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          {result ? (
            <Button onClick={onClose}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={save} disabled={saving || !data}>
                {saving ? "Saving..." : "Save audience"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
