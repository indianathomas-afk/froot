"use client"

import { useEffect, useState } from "react"

const STORAGE_KEY = "froot-sidebar-collapsed"

export function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === "true") setCollapsed(true)
    setMounted(true)

    // Listen for storage events so sidebar toggle updates the margin
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) setCollapsed(e.newValue === "true")
    }
    window.addEventListener("storage", onStorage)

    // Also poll localStorage since same-tab storage events don't fire
    const interval = setInterval(() => {
      setCollapsed(localStorage.getItem(STORAGE_KEY) === "true")
    }, 100)

    return () => {
      window.removeEventListener("storage", onStorage)
      clearInterval(interval)
    }
  }, [])

  const ml = !mounted ? "ml-[190px]" : collapsed ? "ml-[60px]" : "ml-[190px]"

  return (
    <main className={`flex-1 min-h-screen bg-[var(--color-background)] transition-all duration-200 ${ml}`}>
      <div className="max-w-6xl mx-auto px-8 py-8">
        {children}
      </div>
    </main>
  )
}
