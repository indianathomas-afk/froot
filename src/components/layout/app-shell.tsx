"use client"

import { useSidebarCollapsed } from "./use-sidebar-collapsed"

export function AppShell({ children }: { children: React.ReactNode }) {
  const collapsed = useSidebarCollapsed()
  const ml = collapsed ? "ml-[60px]" : "ml-[190px]"

  return (
    <main className={`flex-1 min-h-screen bg-[var(--color-background)] transition-all duration-200 ${ml}`}>
      <div className="max-w-6xl mx-auto px-8 py-8">
        {children}
      </div>
    </main>
  )
}
