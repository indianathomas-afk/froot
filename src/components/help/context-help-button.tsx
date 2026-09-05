"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { HelpCircle } from "lucide-react"
import type { HelpIndexRow } from "@/lib/help-access"

// HELP-1a — the contextual "?".
//
// ONE EDIT, NOT SEVENTY-EIGHT. Page headers in this app are hand-rolled: there
// are 78 <h1> elements across (app) in 10 distinct className shapes and no
// PageHeader component. The build prompt read that as a reason to defer this to
// HELP-1b, but the audit's §D.4 dissolves the choice — AppShell is a single
// 15-line wrapper that every (app) page renders inside, so a "?" mounted there
// keyed off usePathname() reaches every (app) article without touching a page.
// The trade accepted: it floats at a fixed position in the content area rather
// than sitting inline beside each heading. Inline would require extracting a
// PageHeader across 78 call sites — a refactor phase wearing HELP-1's badge.
//
// IT MUST NOT IMPORT THE GENERATED ARTICLES, and this is the load-bearing
// constraint on the whole component. This is a client component; importing
// GUIDE_ARTICLES here would ship every article BODY — gated sections included —
// into the JS bundle served to every reader, which would undo ruling 6 more
// completely than any rendering mistake could. So it reads the SAME per-request
// index the search box uses: already filtered through helpScope(), so the rows
// that arrive are only ones this reader may see.
//
// The consequence is the correct one by construction: a reader standing on a
// page whose article they may not read gets NO "?", because no row for it ever
// reached their browser.

let cached: Promise<HelpIndexRow[]> | null = null

function loadIndex(surface: "app" | "my"): Promise<HelpIndexRow[]> {
  // Module-scoped, so the index is fetched once per page load rather than on
  // every client-side navigation. 5.5 KB gzipped at the full 44-row set.
  if (!cached) {
    cached = fetch(`/api/help/search?surface=${surface}`)
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((d: { rows?: HelpIndexRow[] }) => d.rows ?? [])
      .catch(() => [])
  }
  return cached
}

/** `/staff/[id]` matches `/staff/abc123`; `/staff` does not. */
function routeMatches(route: string, pathname: string): boolean {
  if (!route.includes("[")) return route === pathname
  const pattern = route
    .split("/")
    .map((segment) =>
      segment.startsWith("[") && segment.endsWith("]")
        ? "[^/]+"
        : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    )
    .join("/")
  return new RegExp(`^${pattern}$`).test(pathname)
}

export function ContextHelpButton({ surface = "app" }: { surface?: "app" | "my" }) {
  const pathname = usePathname()
  const [rows, setRows] = useState<HelpIndexRow[]>([])

  useEffect(() => {
    let live = true
    loadIndex(surface).then((r) => {
      if (live) setRows(r)
    })
    return () => {
      live = false
    }
  }, [surface])

  // The help surface does not need a "?" pointing at itself.
  if (pathname === "/help" || pathname.startsWith("/help/")) return null
  if (pathname === "/my/help" || pathname.startsWith("/my/help/")) return null

  // Longest matching route wins, so /staff/[id] beats /staff when both claim a
  // path — the more specific article is the more useful answer.
  const match = rows
    .filter((row) => row.routes.some((route) => routeMatches(route, pathname)))
    .sort((a, b) => b.entry.length - a.entry.length)[0]

  if (!match) return null

  const base = surface === "my" ? "/my/help" : "/help"
  return (
    <Link
      href={`${base}/${match.id}`}
      title={`Help: ${match.title}`}
      aria-label={`Help: ${match.title}`}
      className="fixed bottom-6 right-6 z-40 flex h-10 w-10 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-muted-foreground)] shadow-sm transition-colors hover:text-[var(--color-primary)]"
    >
      <HelpCircle className="h-5 w-5" />
    </Link>
  )
}
