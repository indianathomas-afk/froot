"use client"

import { useState } from "react"
import { Check, Copy } from "lucide-react"
import { Button } from "@/components/ui/button"

// MS-4a — the Copy button beside an achieved milestone's suggested message
// (ruling 3, Gary 2026-10-15: the manager pastes it into their own email
// system; Froot never emails employees). F8 (Gary, 2026-10-17): copies the
// message AS WRITTEN — no placeholder substitution.
//
// The first clipboard use in Froot (MS-4 audit A7). The clipboard can be
// refused — an insecure context, an older iPad Safari, a denied permission — so
// failure says what to do instead of failing silently. ≥ 44 px tap target:
// managers use this on phones.

type State = "idle" | "copied" | "failed"

export function CopyMessageButton({ message }: { message: string }) {
  const [state, setState] = useState<State>("idle")

  async function copy() {
    try {
      if (!navigator.clipboard) throw new Error("no clipboard")
      await navigator.clipboard.writeText(message)
      setState("copied")
    } catch {
      setState("failed")
    }
    setTimeout(() => setState("idle"), 2500)
  }

  return (
    <div className="flex flex-wrap items-center gap-2 mt-2">
      <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={copy}>
        {state === "copied" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        {state === "copied" ? "Copied" : "Copy message"}
      </Button>
      {state === "failed" && (
        <span role="status" className="text-xs text-[var(--color-destructive)]">
          Couldn&apos;t copy — select the message text and copy it instead.
        </span>
      )}
    </div>
  )
}
