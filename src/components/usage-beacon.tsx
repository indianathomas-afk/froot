"use client"

import { useEffect, useRef } from "react"
import { usePathname } from "next/navigation"

// ─────────────────────────────────────────────────────────────────────────────
// ENG-1 — the client beacon. Mounted ONCE per shell: src/app/(app)/layout.tsx
// (the admin shell) and src/app/(my)/layout.tsx (the HR staff portal).
//
// TWO MOUNTS, NOT ONE, AND THE SECOND ONE IS THE POINT (Gary, 2026-08-30, D3).
// A STAFF user with a linked StaffMember is redirected out of the admin shell to
// /my ((app)/layout.tsx:72), so a beacon mounted only in (app) would never fire
// for them — and the engagement page would report "never active" for the people
// who use the product most days. Mounting in both shells is what makes B3's
// "every authenticated user of every role" true rather than aspirational.
//
// FIRE AND FORGET, ALWAYS. No await, no error UI, no retries, no state. The
// response is not read — the route answers 204 on success and on every failure
// it swallows, so there is nothing to branch on. If this component throws, a
// user loses a page; that is why it does nothing that can throw.
// ─────────────────────────────────────────────────────────────────────────────

export function UsageBeacon() {
  const pathname = usePathname()
  // usePathname() re-fires on every render, not only on navigation, and React
  // strict mode double-invokes effects in development. Without this the same
  // path can beacon twice for one visit, which would inflate counts in exactly
  // the way a rollup makes hard to spot later.
  const lastSent = useRef<string | null>(null)

  useEffect(() => {
    if (!pathname || lastSent.current === pathname) return
    lastSent.current = pathname

    const body = JSON.stringify({ path: pathname })
    try {
      // sendBeacon survives the page teardown a navigation causes, which fetch
      // does not reliably do. It cannot set Content-Type to application/json —
      // the payload lands as text/plain — which is why the route reads the body
      // as text and parses it by hand rather than calling req.json().
      if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
        if (navigator.sendBeacon("/api/usage", body)) return
      }
      // Fallback for browsers without sendBeacon, and for the case where it
      // refuses (its queue is bounded and it returns false when full).
      void fetch("/api/usage", {
        method: "POST",
        body,
        keepalive: true,
        headers: { "Content-Type": "application/json" },
      }).catch(() => {})
    } catch {
      // Deliberately silent. Engagement tracking is never worth a broken page.
    }
  }, [pathname])

  return null
}
