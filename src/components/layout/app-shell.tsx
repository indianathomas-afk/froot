"use client"

import { usePathname } from "next/navigation"
import { useSidebarCollapsed } from "./use-sidebar-collapsed"
import { ContextHelpButton } from "@/components/help/context-help-button"

// N-1d (N1D-F4a, Gary 2026-11-02): "A single-entry list of wide routes in
// app-shell.tsx, matched exactly, max-w-screen-2xl". Exact match, so the
// page's own sub-routes (/deleted, /duplicates) keep the normal width.
const WIDE_ROUTES: ReadonlySet<string> = new Set(["/inventory/ingredients"])

export function AppShell({ children }: { children: React.ReactNode }) {
  const collapsed = useSidebarCollapsed()
  const pathname = usePathname()
  const ml = collapsed ? "ml-[60px]" : "ml-[190px]"
  const maxW = WIDE_ROUTES.has(pathname) ? "max-w-screen-2xl" : "max-w-6xl"

  return (
    <main className={`flex-1 min-h-screen bg-[var(--color-background)] transition-all duration-200 ${ml}`}>
      <div className={`${maxW} mx-auto px-8 py-8`}>
        {children}
      </div>
      {/* HELP-1a — the contextual "?" for every (app) page, mounted ONCE here
          rather than inline in 78 hand-rolled page headers (audit §D.4). It
          renders nothing on a page with no article the reader may see. */}
      <ContextHelpButton surface="app" />
    </main>
  )
}
