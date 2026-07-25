"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Lock, RefreshCw, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"

// Full Name (legal identity) control block on the staff detail page: shows the
// value, its lock state, and — when a locked legal name disagrees with Square —
// an escalation banner offering to write Froot's value back to Square or adopt
// Square's. Display Name has no equivalent (operational, freely editable).
export function LegalNameControls({
  staffId,
  fullName,
  fullNameLocked,
  squareFullName,
  squareLinked,
}: {
  staffId: string
  fullName: string | null
  fullNameLocked: boolean
  squareFullName: string | null
  squareLinked: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<null | "adopt" | "writeback">(null)
  const [error, setError] = useState("")

  const diverged = fullNameLocked && !!squareFullName && squareFullName !== fullName

  async function call(kind: "adopt" | "writeback") {
    setBusy(kind)
    setError("")
    try {
      const res =
        kind === "adopt"
          ? await fetch(`/api/staff/${staffId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ fullName: squareFullName ?? "", lockFullName: false }),
            })
          : await fetch(`/api/staff/${staffId}/square-writeback`, { method: "POST" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? "Something went wrong")
        return
      }
      router.refresh()
    } finally {
      setBusy(null)
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
            <span className="font-medium">{fullName}</span> as the legal name.
          </p>
          <div className="flex items-center gap-2 mt-2">
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => call("adopt")}>
              <RefreshCw className={`h-3.5 w-3.5 ${busy === "adopt" ? "animate-spin" : ""}`} />
              Use Square&apos;s
            </Button>
            {squareLinked && (
              <Button size="sm" disabled={busy !== null} onClick={() => call("writeback")}>
                <Upload className={`h-3.5 w-3.5 ${busy === "writeback" ? "animate-spin" : ""}`} />
                Write back to Square
              </Button>
            )}
          </div>
        </div>
      )}

      {!diverged && squareLinked && fullName && (
        <button
          className="mt-1 inline-flex items-center gap-1 text-xs text-[var(--color-primary)] hover:opacity-80 disabled:opacity-50"
          disabled={busy !== null}
          onClick={() => call("writeback")}
        >
          <Upload className={`h-3 w-3 ${busy === "writeback" ? "animate-spin" : ""}`} />
          Write this name back to Square
        </button>
      )}

      {error && <p className="mt-1 text-xs text-[var(--color-destructive)]">{error}</p>}
    </div>
  )
}
