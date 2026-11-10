"use client"

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react"
import { isBusy, shouldRunCycle, TABLET_REFRESH_MS } from "@/lib/tablet-refresh"

// TAB-5 — THE ONE REFRESH CONTROLLER FOR THE TABLET HOME (the rules are pure,
// in src/lib/tablet-refresh.ts). Until TAB-5 the Messages column (TAB-2) and
// the stat strip (TAB-3) each ran their own 60s timer and the Tasks panel and
// the chips ran none. Now there is one timer, owned by TabletHome:
//
//   - every part REGISTERS its re-read (useRefreshLoader) and the controller
//     runs them together, once per cycle — so the parts cannot drift apart or
//     overlap;
//   - every part REPORTS what makes it busy (useBusyFlag for an open sheet,
//     track() for a write in flight) and a busy page skips the WHOLE cycle
//     (Gary's ruling 3), which runs again on the next one;
//   - a cycle never starts while the previous one is still running.
//
// The visibility rule is TAB-2 ruling 8's, unchanged: every TABLET_REFRESH_MS
// while visible, at once on becoming visible again (visibilitychange / focus,
// which usually fire together, so a second call within 1s is dropped), never
// while hidden.

type Loader = () => Promise<unknown>
export type RefreshCycle = (loaders: Loader[]) => Promise<void>

export type TabletRefresh = {
  /** Add a part's re-read to every cycle. Returns the unregister. */
  register(loader: Loader): () => void
  /** Turn a named busy flag on or off (a sheet open, a send in flight). */
  setBusy(key: string, on: boolean): void
  /** Count a write as in flight until it settles. Returns the same outcome. */
  track<T>(p: Promise<T>): Promise<T>
  /** Whether anything on the tablet home is busy right now. */
  busy(): boolean
}

const Ctx = createContext<TabletRefresh | null>(null)
export const TabletRefreshProvider = Ctx.Provider

/** The controller, or null outside the tablet home (every caller tolerates
 *  null: no timer, nothing to report busy to). */
export function useTabletRefresh(): TabletRefresh | null {
  return useContext(Ctx)
}

/** Run `loader` on every refresh cycle while this component is mounted. Pass a
 *  stable function (useCallback), or it re-registers on every render. */
export function useRefreshLoader(loader: Loader) {
  const ctl = useContext(Ctx)
  useEffect(() => ctl?.register(loader), [ctl, loader])
}

/** Report `on` as a busy flag under `key`. A layout effect, so the flag is set
 *  before the browser can run a timer tick after the render that opened the
 *  sheet. Cleared on unmount. */
export function useBusyFlag(key: string, on: boolean) {
  const ctl = useContext(Ctx)
  useLayoutEffect(() => {
    ctl?.setBusy(key, on)
    return () => ctl?.setBusy(key, false)
  }, [ctl, key, on])
}

/** The controller itself, for TabletHome. `cycle.current` receives every
 *  registered loader and does the cycle's work; it runs only when
 *  shouldRunCycle() says so, and never twice at once. A ref, so TabletHome can
 *  build the cycle from the controller it gets back. */
export function useTabletRefreshController(cycle: RefObject<RefreshCycle | null>): TabletRefresh {
  const loaders = useRef(new Set<Loader>())
  const flags = useRef(new Map<string, boolean>())
  const writes = useRef(0)
  const refreshing = useRef(false)
  const lastRun = useRef(0)

  const ctl = useMemo<TabletRefresh>(
    () => ({
      register(loader) {
        loaders.current.add(loader)
        return () => {
          loaders.current.delete(loader)
        }
      },
      setBusy(key, on) {
        if (on) flags.current.set(key, true)
        else flags.current.delete(key)
      },
      track(p) {
        writes.current++
        return p.finally(() => {
          writes.current--
        })
      },
      busy() {
        return isBusy(flags.current.values(), writes.current)
      },
    }),
    []
  )

  useEffect(() => {
    const run = () => {
      const state = { visibilityState: document.visibilityState, busy: ctl.busy(), refreshing: refreshing.current }
      const work = cycle.current
      if (!work || !shouldRunCycle(state)) return
      if (Date.now() - lastRun.current < 1_000) return
      refreshing.current = true
      lastRun.current = Date.now()
      void work([...loaders.current])
        .catch((err) => console.error("[tablet refresh] cycle failed:", err))
        .finally(() => {
          refreshing.current = false
        })
    }
    const onBack = () => {
      if (document.visibilityState === "visible") run()
    }
    const id = window.setInterval(run, TABLET_REFRESH_MS)
    document.addEventListener("visibilitychange", onBack)
    window.addEventListener("focus", onBack)
    return () => {
      window.clearInterval(id)
      document.removeEventListener("visibilitychange", onBack)
      window.removeEventListener("focus", onBack)
    }
  }, [ctl, cycle])

  return ctl
}
