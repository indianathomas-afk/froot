"use client"

import { useSyncExternalStore } from "react"

// The dashboard's store dropdown, persisted per browser. Lifted out of
// dashboard-client.tsx unchanged by TAB-1 so the tablet rail and tablet home
// read the SAME source as the desktop dropdown (audit point 7) — one key, one
// event, so switching store in either view is the store in both.

export const STORE_KEY = "froot.dashboard.store"
const STORE_EVENT = "froot-dashboard-store"

// Sentinel picker value for the all-locations rollup (Phase F-4) — only
// offered when the user can see more than one store.
export const ALL_STORES = "all"

function subscribeStoreKey(callback: () => void) {
  window.addEventListener("storage", callback)
  window.addEventListener(STORE_EVENT, callback)
  return () => {
    window.removeEventListener("storage", callback)
    window.removeEventListener(STORE_EVENT, callback)
  }
}

export function useSavedStoreId(): string | null {
  return useSyncExternalStore(
    subscribeStoreKey,
    () => localStorage.getItem(STORE_KEY),
    () => null
  )
}

export function saveStoreId(id: string) {
  localStorage.setItem(STORE_KEY, id)
  window.dispatchEvent(new Event(STORE_EVENT))
}

/**
 * The single store a store-scoped surface shows. The rollup sentinel has no
 * meaning there (tablet mode is one store's counter), so "all" — or a saved id
 * the viewer can no longer see — falls back to the first store, exactly as the
 * desktop dropdown falls back.
 */
export function resolveSingleStore<T extends { id: string }>(stores: T[], saved: string | null): T | undefined {
  return stores.find((s) => s.id === saved) ?? stores[0]
}
