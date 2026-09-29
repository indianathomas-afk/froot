"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import { KeyRound, Undo2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

// DOC-6: the one control that appends an HrReturnEvent, shared by the Key
// Register on /hr/compliance and the staff profile. It only POSTs; there is no
// edit or undo, by ruling (F3) — a mistaken Returned is fixed with Reissue.
// The server re-decides everything (scope, duplicates, archived), so the
// button's visibility is a convenience, not the guard.
export function ReturnEventButton({
  type,
  documentId,
  staffId,
  staffName,
  itemLabel,
  documentTitle,
}: {
  type: "Returned" | "Reissued"
  documentId: string
  staffId: string
  staffName: string
  itemLabel: string
  documentTitle: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  // The browser's today: the manager is recording a day they lived.
  const [occurredOn, setOccurredOn] = useState(() => format(new Date(), "yyyy-MM-dd"))
  const [note, setNote] = useState("")
  const isReturn = type === "Returned"
  const item = itemLabel.toLowerCase()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError("")
    try {
      const res = await fetch("/api/hr/returns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hrDocumentId: documentId,
          staffMemberId: staffId,
          type,
          occurredOn,
          note: note.trim() || null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? "Failed to record")
        return
      }
      setOpen(false)
      setNote("")
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setError("")
          setOpen(true)
        }}
        className="shrink-0"
      >
        {isReturn ? <Undo2 className="h-4 w-4 mr-1.5" /> : <KeyRound className="h-4 w-4 mr-1.5" />}
        {isReturn ? "Mark returned" : "Reissue"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {isReturn ? `${staffName} returned their ${item}` : `Reissue ${item} to ${staffName}`}
            </DialogTitle>
            <DialogDescription>
              {documentTitle}.{" "}
              {isReturn
                ? "This is added to their record and can't be edited — if it's a mistake, reissue."
                : "This puts them back on the register as holding. It can't be edited — if it's a mistake, mark it returned."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>{isReturn ? "Date returned" : "Date reissued"}</Label>
              <Input type="date" required value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Note</Label>
              <Textarea
                value={note}
                maxLength={500}
                onChange={(e) => setNote(e.target.value)}
                placeholder={isReturn ? "e.g. Returned to Will, key #14" : "e.g. Replacement for lost key"}
              />
            </div>
            {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving..." : isReturn ? "Mark returned" : "Reissue"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
