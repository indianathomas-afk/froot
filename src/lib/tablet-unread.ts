"use client"

import { useSyncExternalStore } from "react"

// TAB-2 — the desktop Team Messages unread count, shared between the tablet
// Messages column and the tablet rail's Messages icon so both show the SAME
// number from the SAME read of /api/dashboard/comms. React state in memory
// only: nothing is stored, and nothing here marks a message read.
//
// Same shape as src/lib/dashboard-store.ts (one value, one event), minus the
// localStorage: a count that outlived a reload would be a stale count.

type Unread = { storeId: string; count: number } | null

let current: Unread = null
const listeners = new Set<() => void>()

function subscribe(callback: () => void) {
  listeners.add(callback)
  return () => {
    listeners.delete(callback)
  }
}

export function publishUnread(storeId: string, count: number) {
  if (current && current.storeId === storeId && current.count === count) return
  current = { storeId, count }
  for (const l of listeners) l()
}

export function useTabletUnread(): Unread {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null
  )
}
