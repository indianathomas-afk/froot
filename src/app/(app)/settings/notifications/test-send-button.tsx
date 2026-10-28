"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

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
  /** NOTIFY-14: the digest preview had nothing to show — no email was sent. */
  empty?: boolean
  message?: string
}

/** One line: where it went, the mode, and the provider id or the error. */
function describe(r: TestResult): { text: string; failed: boolean } {
  if (r.ok && r.empty) return { text: r.message ?? "Nothing to send — no email sent.", failed: false }
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
//
// NOTIFY-14 (F9): `previewAs` adds a "Preview as" choice of the org's managers
// (&asUser=…). It picks whose VIEW is rendered; the email still goes only to
// the admin pressing the button.
const ME = "__me__"

export function TestSendButton({
  kind,
  label = "Send a test to me",
  previewAs,
}: { kind?: string; label?: string; previewAs?: { id: string; name: string }[] } = {}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [asUser, setAsUser] = useState(ME)
  const [result, setResult] = useState<{ text: string; failed: boolean } | null>(null)

  async function send() {
    setBusy(true)
    setResult(null)
    const qs = new URLSearchParams()
    if (kind) qs.set("kind", kind)
    if (previewAs && asUser !== ME) qs.set("asUser", asUser)
    const url = qs.size ? `/api/notify/test?${qs.toString()}` : "/api/notify/test"
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
      {previewAs && previewAs.length > 0 && (
        <Select value={asUser} onValueChange={setAsUser}>
          <SelectTrigger className="w-56" aria-label="Preview as">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ME}>Preview as: me (all stores)</SelectItem>
            {previewAs.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                Preview as: {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
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
