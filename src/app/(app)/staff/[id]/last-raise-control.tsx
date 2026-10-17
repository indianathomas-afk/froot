"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

// MS-3b (F6, F15) — the ADMIN's "Last raise date" on the Milestones tab, for a
// raise Froot did not see in Square. THE PAGE RENDERS THIS ONLY FOR AN ADMIN
// WHO MAY SEE THIS MEMBER'S PAY, so `current` is never handed to anyone else;
// PUT/DELETE /api/staff/[id]/last-raise re-checks both on the server. No
// amount, ever — a date only.
export function LastRaiseControl({
  staffId,
  current,
  today,
}: {
  staffId: string
  /** "YYYY-MM-DD" or null — the manual date only, not a detected raise. */
  current: string | null
  /** The member's store-local today: the latest date the server accepts. */
  today: string
}) {
  const router = useRouter()
  const [date, setDate] = useState(current ?? "")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send(method: "PUT" | "DELETE") {
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/staff/${staffId}/last-raise`, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(method === "PUT" ? { body: JSON.stringify({ date }) } : {}),
    }).catch(() => null)
    setBusy(false)
    if (!res || !res.ok) {
      const body = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null
      setError(body?.error ?? "Couldn't save. Try again.")
      return
    }
    if (method === "DELETE") setDate("")
    router.refresh()
  }

  return (
    <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-4 sm:p-5 space-y-2">
      <Label htmlFor="last-raise-date">Last raise date (admin)</Label>
      <p className="text-xs text-[var(--color-muted-foreground)]">
        For a raise given before Froot was watching Square. The cooldown counts from this date or the latest raise
        Froot detected, whichever is later.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id="last-raise-date"
          type="date"
          max={today}
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-auto min-h-11"
        />
        <Button className="min-h-11" disabled={busy || date === "" || date === current} onClick={() => send("PUT")}>
          Save
        </Button>
        {current && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" className="min-h-11" disabled={busy}>
                Clear
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Clear the last raise date?</AlertDialogTitle>
                <AlertDialogDescription>
                  The cooldown will count only from raises Froot detects in Square. You can enter a date again later.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => send("DELETE")}>Clear date</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
      {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}
    </div>
  )
}
