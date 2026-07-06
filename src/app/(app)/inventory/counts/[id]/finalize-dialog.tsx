"use client"

import { useState } from "react"
import { format } from "date-fns"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export function FinalizeDialog({
  countId,
  storeName,
  lastEditAt,
  uncountedLines,
  onFinalized,
  onClose,
}: {
  countId: string
  storeName: string
  lastEditAt: Date | null
  uncountedLines: number
  onFinalized: () => void
  onClose: () => void
}) {
  const [name, setName] = useState("")
  const [notes, setNotes] = useState("")
  // The finalized timestamp defines the inventory period boundary — default to
  // the last edit, not "now", so a count keyed in last night stays last night's.
  const [finalizedAt, setFinalizedAt] = useState(format(lastEditAt ?? new Date(), "yyyy-MM-dd'T'HH:mm"))
  const [isPartial, setIsPartial] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  async function finalize() {
    const when = new Date(finalizedAt)
    if (isNaN(when.getTime())) {
      setError("Enter a valid date and time")
      return
    }
    setSaving(true)
    setError("")
    const res = await fetch(`/api/inventory/counts/${countId}/finalize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim() || null,
        notes: notes.trim() || null,
        finalizedAt: when.toISOString(),
        isPartial,
      }),
    })
    setSaving(false)
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      setError(body?.error ?? "Could not finalize the count")
      return
    }
    onFinalized()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Finalize count</DialogTitle>
          <DialogDescription>
            Locks quantities and computes sitting inventory value for {storeName}. After this, changes go through
            corrections with an audit trail.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {uncountedLines > 0 && (
            <p className="text-sm px-3 py-2 rounded-md border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] text-[var(--color-warning-text)]">
              {uncountedLines} line{uncountedLines === 1 ? "" : "s"} left uncounted — they finalize as 0 on hand.
            </p>
          )}
          <div>
            <Label htmlFor="count-name">Count name (optional)</Label>
            <Input
              id="count-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`e.g. ${format(new Date(), "MMMM")} end-of-month`}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="count-finalized-at">Finalized date &amp; time</Label>
            <Input
              id="count-finalized-at"
              type="datetime-local"
              value={finalizedAt}
              onChange={(e) => setFinalizedAt(e.target.value)}
              className="mt-1"
            />
            <p className="text-xs text-[var(--color-muted-foreground)] mt-1">
              This timestamp is the inventory period boundary for usage &amp; COGS reporting.
            </p>
          </div>
          <div>
            <Label htmlFor="count-notes">Notes (optional)</Label>
            <Textarea
              id="count-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="mt-1"
            />
          </div>
          <label className="flex items-start gap-2 cursor-pointer">
            <Checkbox checked={isPartial} onCheckedChange={(v) => setIsPartial(v === true)} className="mt-0.5" />
            <span className="text-sm">
              Partial count
              <span className="block text-xs text-[var(--color-muted-foreground)]">
                Didn&apos;t cover the whole store. Partial counts show in history but are excluded from usage/COGS
                period math and never become the sitting-inventory figure.
              </span>
            </span>
          </label>
          {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={finalize} disabled={saving}>
            {saving ? "Finalizing…" : "Finalize count"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
