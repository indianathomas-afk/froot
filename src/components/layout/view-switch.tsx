"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { Monitor, Tablet } from "lucide-react"
import { cn } from "@/lib/utils"
import { VIEW_COOKIE, VIEW_COOKIE_MAX_AGE, type ViewMode } from "@/lib/view-mode"

// TAB-1 — the Tablet/Desktop switch. Every role sees it (it changes how this
// device draws Froot, never what anyone may see or do). A tap writes the
// per-device cookie and refreshes, and the (app) layout renders the other shell.
// This is the ONLY writer of the cookie: nothing switches automatically.
function setView(mode: ViewMode) {
  document.cookie = `${VIEW_COOKIE}=${mode}; path=/; max-age=${VIEW_COOKIE_MAX_AGE}; samesite=lax`
}

export function ViewSwitch({
  current,
  layout,
}: {
  current: ViewMode
  // "row" for the desktop sidebar footer, "stack" for the tablet rail.
  layout: "row" | "stack" | "icon"
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function choose(mode: ViewMode) {
    if (mode === current || pending) return
    setView(mode)
    startTransition(() => router.refresh())
  }

  const options: { mode: ViewMode; label: string; Icon: typeof Tablet }[] = [
    { mode: "tablet", label: "Tablet", Icon: Tablet },
    { mode: "desktop", label: "Desktop", Icon: Monitor },
  ]

  if (layout === "icon") {
    // The collapsed 60px sidebar: one button that goes to the other mode.
    const next = options.find((o) => o.mode !== current)!
    return (
      <button
        type="button"
        onClick={() => choose(next.mode)}
        title={`Switch to ${next.label} view`}
        aria-label={`Switch to ${next.label} view`}
        className="flex w-full items-center justify-center text-[var(--color-muted-foreground)] hover:text-[var(--color-primary)] transition-colors"
      >
        <next.Icon className="h-4 w-4" />
      </button>
    )
  }

  return (
    <div
      role="radiogroup"
      aria-label="View"
      className={cn(
        "rounded-xl bg-[var(--color-muted)] p-1",
        layout === "row" ? "flex gap-1" : "flex flex-col gap-1"
      )}
    >
      {options.map(({ mode, label, Icon }) => {
        const active = mode === current
        return (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => choose(mode)}
            disabled={pending}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-colors",
              layout === "row" ? "flex-1 py-1 text-xs" : "min-h-14 flex-col py-2 text-xs",
              active
                ? "bg-[var(--color-card)] text-[var(--color-foreground)] shadow-sm"
                : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            )}
          >
            <Icon className={layout === "row" ? "h-3.5 w-3.5" : "h-5 w-5"} />
            {label}
          </button>
        )
      })}
    </div>
  )
}
