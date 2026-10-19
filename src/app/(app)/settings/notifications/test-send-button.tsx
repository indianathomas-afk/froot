"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"

// NOTIFY-5 — "Send a test to me". The first UI caller of POST /api/notify/test;
// until now the only way to prove delivery was the browser console.
//
// NO BODY, AND THERE MUST NEVER BE ONE. The route mails the caller's own Clerk
// primary email, resolved server-side; that is its whole security model. This
// island only presses the button and reads back what happened.
//
// The page is ADMIN_ONLY (settings.access) and the route re-checks
// requireAdmin() independently, so a gate on this page is not the only gate.

type TestResult = {
  ok?: boolean
  to?: string
  mode?: "live" | "sandbox" | "dry-run" | null
  provider?: string
  id?: string
  error?: string
}

/** One line: where it went, the mode, and the provider id or the error. */
function describe(r: TestResult): { text: string; failed: boolean } {
  if (!r.ok) {
    const where = r.to ? ` to ${r.to}` : ""
    const mode = r.mode ? ` (${r.mode})` : ""
    return { text: `Not sent${where}${mode}: ${r.error ?? "unknown error"}`, failed: true }
  }
  if (r.mode === "dry-run") {
    return {
      text: `Dry run — nothing left this environment. The test for ${r.to} was logged only (provider: ${r.provider}).`,
      failed: false,
    }
  }
  const id = r.id ? ` id ${r.id}` : ""
  if (r.mode === "sandbox") {
    return {
      text: `Sent to ${r.to} from a non-production deployment (sandbox, ${r.provider}${id}). Check Junk if it does not arrive.`,
      failed: false,
    }
  }
  return { text: `Sent to ${r.to} (live, ${r.provider}${id}). Check Junk if it does not arrive.`, failed: false }
}

// MS-4b: `kind` sends that kind's sample() through the same route
// (?kind=…, still no body — the caller is still the only recipient). The
// milestone card renders one with label "Send a sample to me".
export function TestSendButton({ kind, label = "Send a test to me" }: { kind?: string; label?: string } = {}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ text: string; failed: boolean } | null>(null)

  async function send() {
    setBusy(true)
    setResult(null)
    const url = kind ? `/api/notify/test?kind=${encodeURIComponent(kind)}` : "/api/notify/test"
    const res = await fetch(url, { method: "POST" }).catch(() => null)
    let body: TestResult = { ok: false, error: "network error" }
    if (res) {
      // A non-JSON answer means the route never ran — most often an expired
      // session redirected to sign-in. Say that instead of "unknown error".
      body = await res.json().catch(() => ({
        ok: false,
        error: `no result from the server (HTTP ${res.status}${res.redirected ? ", redirected — are you still signed in?" : ""})`,
      }))
    }
    setResult(describe(body))
    setBusy(false)
    // The attempt row is written on every path, including a failure, so the new
    // row belongs in Recent emails below either way.
    router.refresh()
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <Button variant="outline" onClick={send} disabled={busy}>
        {busy ? "Sending…" : label}
      </Button>
      {result && (
        <p
          className={`text-sm min-w-0 break-words ${
            result.failed ? "text-[var(--color-destructive)]" : "text-[var(--color-muted-foreground)]"
          }`}
          role="status"
        >
          {result.text}
        </p>
      )}
    </div>
  )
}
