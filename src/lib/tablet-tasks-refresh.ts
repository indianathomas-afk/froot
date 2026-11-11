// TAB-8 — the tablet Tasks panel's re-read, through a read-only route instead
// of router.refresh(). Client-safe and pure apart from readTabletTasks(), so
// scripts/verify-tab8.ts can pin every rule without a browser.
//
// Read by src/app/(app)/dashboard/tablet-home.tsx on TAB-5's refresh cycle, on
// the date-change reload (the same cycle: the route's `store.day` is what moves
// the page to the new day) and after this device's own writes. The writes
// themselves (Start, tick, untick, submit) keep their own routes.
//
// THREE OUTCOMES, AND ONLY ONE OF THEM CHANGES WHAT IS SHOWING:
//   ok       the slice replaces this store's stores entry and checklists;
//   failed   (a thrown fetch, a timeout, a non-2xx, a body of the wrong shape)
//            keeps the last good list — it never blanks the panel;
//   expired  (the proxy answered with a redirect to /sign-in) keeps the list
//            too, and says so in TAB-4's words.
//
// `redirect: "manual"` IS LOAD-BEARING (CHK-8's defect class). With fetch's
// default, an expired Clerk session turns this GET into a 307 to /sign-in that
// fetch follows, and the sign-in PAGE answers 200 with HTML. In manual mode the
// browser hands back an OPAQUE REDIRECT — `type === "opaqueredirect"`,
// `status === 0` — so the check must test those, not `status >= 300` alone.

import type { TabletChecklist, TabletStore } from "@/app/(app)/dashboard/tablet-data"

/** TAB-4's message for a signed-out device (src/lib/tablet-pin-options.ts,
 *  verifyPin), word for word. verify-tab8 checks the two agree. */
export const SESSION_EXPIRED_MESSAGE =
  "This device's sign-in has expired. Reload the page, sign in again, and try once more."

/** Lean 6: the quiet "Not updated since …" line shows after this many
 *  consecutive refreshes that did not land, and clears on the next success. */
export const STALE_AFTER_FAILURES = 2

export function tabletTasksUrl(storeId: string): string {
  return `/api/stores/${encodeURIComponent(storeId)}/tablet-tasks`
}

export type TabletSlice = { store: TabletStore; checklists: TabletChecklist[] }
export type TabletServerData = { stores: TabletStore[]; checklists: TabletChecklist[] }

export type ItemsOutcome = { kind: "ok"; slice: TabletSlice } | { kind: "expired" } | { kind: "failed" }

/** What a response means before its body is read. A redirect of any kind, or
 *  a 401, is a signed-out device. A 2xx that is not JSON is the sign-in page
 *  served some other way (TAB-4's rule in verifyPin). Anything else non-2xx is
 *  a failure that keeps what is showing. */
export function classifyItemsResponse(r: {
  type: string
  status: number
  ok: boolean
  contentType: string | null
}): "ok" | "expired" | "failed" {
  if (r.type === "opaqueredirect" || r.status === 0 || (r.status >= 300 && r.status < 400)) return "expired"
  if (r.status === 401) return "expired"
  if (!r.ok) return "failed"
  if (!(r.contentType ?? "").includes("application/json")) return "expired"
  return "ok"
}

/** The body must be the route's shape before it may replace anything. */
export function isTabletSlice(x: unknown): x is TabletSlice {
  if (!x || typeof x !== "object") return false
  const o = x as { store?: unknown; checklists?: unknown }
  const s = o.store as Partial<TabletStore> | null | undefined
  return (
    !!s &&
    typeof s === "object" &&
    typeof s.id === "string" &&
    typeof s.day === "string" &&
    typeof s.headerDate === "string" &&
    Array.isArray(s.staff) &&
    Array.isArray(o.checklists)
  )
}

/** The one fetch. Never throws. */
export async function readTabletTasks(storeId: string, fetchImpl: typeof fetch = fetch): Promise<ItemsOutcome> {
  try {
    const res = await fetchImpl(tabletTasksUrl(storeId), {
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    })
    const kind = classifyItemsResponse({
      type: res.type,
      status: res.status,
      ok: res.ok,
      contentType: res.headers.get("content-type"),
    })
    if (kind !== "ok") return { kind }
    const body: unknown = await res.json()
    return isTabletSlice(body) ? { kind: "ok", slice: body } : { kind: "failed" }
  } catch {
    return { kind: "failed" }
  }
}

/** An answered read replaces this store's entry and this store's checklists,
 *  and nothing else. A store the page does not list is ignored (the page's
 *  list is the scope it rendered with). */
export function mergeStoreSlice(prev: TabletServerData, slice: TabletSlice): TabletServerData {
  if (!prev.stores.some((s) => s.id === slice.store.id)) return prev
  return {
    stores: prev.stores.map((s) => (s.id === slice.store.id ? { ...s, ...slice.store } : s)),
    checklists: [...prev.checklists.filter((c) => c.storeId !== slice.store.id), ...slice.checklists],
  }
}

/** The data on screen after a refresh: the merge on `ok`, the SAME object
 *  otherwise — a failed or expired refresh never blanks or changes the list. */
export function applyItemsOutcome(prev: TabletServerData, outcome: ItemsOutcome): TabletServerData {
  return outcome.kind === "ok" ? mergeStoreSlice(prev, outcome.slice) : prev
}

/** How the re-read is doing. `lastOkAt` starts at the page render (its props
 *  are a fresh read). `missed` is a cycle the controller skipped only because
 *  the browser reports itself offline — a refresh that did not land, too. */
export type ItemsHealth = { failures: number; lastOkAt: number; expired: boolean }

export function initialItemsHealth(at: number): ItemsHealth {
  return { failures: 0, lastOkAt: at, expired: false }
}

export function nextItemsHealth(prev: ItemsHealth, event: "ok" | "failed" | "expired" | "missed", at: number): ItemsHealth {
  if (event === "ok") return { failures: 0, lastOkAt: at, expired: false }
  return { ...prev, failures: prev.failures + 1, expired: prev.expired || event === "expired" }
}

/** The one quiet line under the header, or null. `formatTime` renders
 *  lastOkAt in the store's zone. */
export function itemsNotice(h: ItemsHealth, formatTime: (at: Date) => string): string | null {
  if (h.expired) return SESSION_EXPIRED_MESSAGE
  if (h.failures >= STALE_AFTER_FAILURES) return `Not updated since ${formatTime(new Date(h.lastOkAt))}`
  return null
}
