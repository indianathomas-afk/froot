"use client"

import { useSidebarCollapsed } from "./use-sidebar-collapsed"
import { ContextHelpButton } from "@/components/help/context-help-button"

export function AppShell({ children }: { children: React.ReactNode }) {
  const collapsed = useSidebarCollapsed()
  const ml = collapsed ? "ml-[60px]" : "ml-[190px]"

  return (
    <main className={`flex-1 min-h-screen bg-[var(--color-background)] transition-all duration-200 ${ml}`}>
      <div className="max-w-6xl mx-auto px-8 py-8">
        {children}
      </div>
      {/* HELP-1a — the contextual "?" for every (app) page, mounted ONCE here
          rather than inline in 78 hand-rolled page headers (audit §D.4). It
          renders nothing on a page with no article the reader may see. */}
      <ContextHelpButton surface="app" />
    </main>
  )
}
