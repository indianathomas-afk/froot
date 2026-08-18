"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Lock, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"

// Full Name (legal identity) control block on the staff detail page: shows the
// value, its lock state, and — when a locked legal name disagrees with Square —
// an escalation banner offering to adopt Square's. Display Name has no
// equivalent (operational, freely editable).
//
// SQ-WB-1 (2026-08-18): the "Write back to Square" half is GONE. Froot is
// read-only toward Square (DECISIONS.md, Gary), so a Froot-side legal name is a
// Froot-side preference and is never pushed. Divergence is now resolved one way
// only — adopt Square's — or left standing and visible.
export function LegalNameControls({
  staffId,
  fullName,
  fullNameLocked,
  squareFullName,
  canManage,
}: {
  staffId: string
  fullName: string | null
  fullNameLocked: boolean
  squareFullName: string | null
  // PERM-5C. The Full Name VALUE is a read surface (staff.view); the adopt
  // button is a write and drives PATCH /api/staff/[id], behind staff.manage.
  // Required and undefaulted for the same reason the sidebar's
  // deniedCapabilities prop is: a default of true would let a caller that
  // forgets it render a button that 403s.
  canManage: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const diverged = fullNameLocked && !!squareFullName && squareFullName !== fullName

  async function adopt() {
    setBusy(true)
    setError("")
    try {
      const res = await fetch(`/api/staff/${staffId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName: squareFullName ?? "", lockFullName: false }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? "Something went wrong")
        return
      }
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <dt className="text-[var(--color-muted-foreground)] flex items-center gap-1.5">
        Full Name
        <span className="text-[10px] uppercase tracking-wide rounded px-1 py-0.5 bg-[var(--color-muted)] text-[var(--color-muted-foreground)]">
          Legal
        </span>
        {fullNameLocked && <Lock className="h-3 w-3 text-[var(--color-muted-foreground)]" aria-label="Locked" />}
      </dt>
      <dd className="text-[var(--color-foreground)] font-medium">
        {fullName ?? (
          <span className="text-[var(--color-warning,#efa201)]">Not set — can&apos;t sign documents</span>
        )}
      </dd>

      {diverged && (
        <div className="mt-2 rounded-md border border-[var(--color-warning,#efa201)]/40 bg-[var(--color-warning,#efa201)]/10 px-3 py-2">
          <p className="text-xs text-[var(--color-foreground)]">
            Square shows <span className="font-medium">{squareFullName}</span> — you&apos;ve locked{" "}
            <span className="font-medium">{fullName}</span> as the legal name in Froot. Froot doesn&apos;t
            change names in Square; update it in Square if the legal name there is wrong.
          </p>
          {/* The divergence itself stays VISIBLE without staff.manage — it is a
              data-integrity fact about signed documents, not an action. Only the
              resolution is withheld. */}
          {canManage && (
            <div className="flex items-center gap-2 mt-2">
              <Button size="sm" variant="outline" disabled={busy} onClick={adopt}>
                <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
                Use Square&apos;s
              </Button>
            </div>
          )}
        </div>
      )}

      {error && <p className="mt-1 text-xs text-[var(--color-destructive)]">{error}</p>}
    </div>
  )
}
