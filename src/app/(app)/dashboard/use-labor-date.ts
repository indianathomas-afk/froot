"use client"

import { useSyncExternalStore } from "react"

// Shared "labor viewed date" (yyyy-mm-dd) so the Budget card (its week) and the
// Coverage card (that day) navigate together — including into future weeks for
// writing schedules. Session-scoped; defaults to today.

const KEY = "froot.labor.viewedDate"
const EVT = "froot-labor-date"

function pad(n: number) {
  return String(n).padStart(2, "0")
}
export function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
export function shiftDateStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + days)
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
}

function subscribe(cb: () => void) {
  window.addEventListener("storage", cb)
  window.addEventListener(EVT, cb)
  return () => {
    window.removeEventListener("storage", cb)
    window.removeEventListener(EVT, cb)
  }
}

export function useLaborViewedDate(): [string, (d: string) => void] {
  const raw = useSyncExternalStore(
    subscribe,
    () => sessionStorage.getItem(KEY),
    () => null
  )
  const date = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : todayStr()
  const setDate = (d: string) => {
    sessionStorage.setItem(KEY, d)
    window.dispatchEvent(new Event(EVT))
  }
  return [date, setDate]
}
