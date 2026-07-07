"use client"

import { useSyncExternalStore } from "react"

const STORAGE_KEY = "froot-sidebar-collapsed"
// Same-tab "storage" events don't fire, so the toggle dispatches this custom
// event to keep Sidebar and AppShell (separate components) in sync.
const TOGGLE_EVENT = "froot-sidebar-toggle"

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback)
  window.addEventListener(TOGGLE_EVENT, callback)
  return () => {
    window.removeEventListener("storage", callback)
    window.removeEventListener(TOGGLE_EVENT, callback)
  }
}

export function useSidebarCollapsed() {
  return useSyncExternalStore(
    subscribe,
    () => localStorage.getItem(STORAGE_KEY) === "true",
    () => false
  )
}

export function setSidebarCollapsed(collapsed: boolean) {
  localStorage.setItem(STORAGE_KEY, String(collapsed))
  window.dispatchEvent(new Event(TOGGLE_EVENT))
}
