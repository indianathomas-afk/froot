"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { AlertTriangle, GraduationCap } from "lucide-react"
import { formatInstant } from "@/lib/display-time"
import type { OwedSummary } from "@/lib/hr-compliance"
import { fetchCard } from "./card-fetch"

type Response = { owed: OwedSummary | null; reason: string | null }

// ── SELF-1: the assignment banner ────────────────────────────────────────────
//
// A manager who has been assigned training has no way to find out. The
// assignment lands on their staff record, and their staff record is not where
// they live — they live here. Their own training gets lost underneath
// everyone else's.
//
// NOT BLINKING, and this is a ruling rather than a style preference (Gary,
// 2026-09-07). The original ask was a blinking banner; it fails WCAG 2.2.2, and
// on a page a manager opens every shift a blink becomes wallpaper inside a week
// — which is the exact failure the feature exists to prevent. Solid,
// high-contrast, persistent, with a count and the nearest due date. It clears
// on completion and on nothing else: there is no dismiss control, deliberately.
//
// NO ANIMATION AT ALL. The ruling allows "at most a single pulse on load"; zero
// is inside that, and it is the reading with no way to be mistaken for the
// blink that was ruled out. If a pulse is ever wanted it belongs in globals.css
// as a one-shot keyframe, not as a looping utility class trimmed to one run.
//
// WHO SEES IT: anyone whose login resolves to exactly one ACTIVE staff member
// with something owed, REGARDLESS OF ROLE (R1). There is no role test in this
// file or in the route behind it. A device login resolves to nothing and stays
// silent with no role logic needed, which is the consequence R1 wanted rather
// than tolerated.
//
// APPEARS AFTER PAINT, AND THE SHIFT IS REAL. The rollup is six queries, so it
// is fetched rather than server-rendered (see the route for the full argument).
// The banner therefore mounts a beat after first paint and pushes the dashboard
// down once when it does. Reserving the slot was considered and rejected: most
// people owe nothing, so a reserved slot is a permanent empty gap at the top of
// almost every dashboard in the org to avoid a single shift on a few. Named
// here so it is not later filed as a layout bug.
export function ComplianceBanner() {
  const [owed, setOwed] = useState<OwedSummary | null>(null)

  useEffect(() => {
    let live = true
    fetchCard<Response>("my compliance", "/api/dashboard/my-compliance").then((data) => {
      if (live && data?.owed) setOwed(data.owed)
    })
    return () => {
      live = false
    }
  }, [])

  if (!owed) return null

  const overdue = owed.overdueCount > 0
  const plural = owed.openCount === 1 ? "" : "s"

  return (
    <Link
      href="/my"
      aria-label={`${owed.openCount} outstanding training or document item${plural}. Go to your portal.`}
      className={`mb-6 flex items-center gap-3 rounded-lg border px-5 py-4 transition-opacity hover:opacity-95 ${
        overdue
          ? "bg-[var(--color-destructive)] text-[var(--color-destructive-foreground)] border-transparent"
          : "bg-[var(--color-warning-bg)] text-[var(--color-warning-text)] border-[var(--color-warning-border)]"
      }`}
    >
      {overdue ? (
        <AlertTriangle className="h-5 w-5 shrink-0" />
      ) : (
        <GraduationCap className="h-5 w-5 shrink-0" />
      )}
      <div className="min-w-0">
        <p className="text-sm font-semibold">
          You have {owed.openCount} item{plural} to complete
          {overdue ? ` · ${owed.overdueCount} overdue` : ""}
        </p>
        {/* Ruled 2026-09-07: document-only debt renders a COUNT WITH NO
            DUE-DATE CLAUSE. HrDocument has no due-date column, so a person
            owing only unsigned documents has no date — the clause is absent
            from the sentence rather than filled with an em dash or a blank.
            DEBT-70b: rendered in the zone this person actually lived, never
            the server's, or an item due tomorrow reads as due today. */}
        {owed.nearestDueDate && (
          <p className="text-xs opacity-90">
            Nearest due {formatInstant(owed.nearestDueDate, owed.timeZone, "monthDay")}
          </p>
        )}
      </div>
    </Link>
  )
}
