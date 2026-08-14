// BUG-6: bounds for the deferred-refresh poll, shared by every card that
// re-fetches after a route reports `salesRefreshing`. ONE definition on
// purpose — the summary card and the sales card must not drift apart, and two
// hand-copied constants is the shape DEBT-32 was raised about.
//
// Bounded three ways: at most POLL_ATTEMPTS requests per sequence, one
// sequence per (request key, baseline syncedAt), and an early return the
// moment syncedAt advances. It cannot become a polling loop.
export const POLL_ATTEMPTS = 3
export const POLL_INTERVAL_MS = 2000

// Shared fetch for dashboard cards (BUG-1): a 12s timeout so a hanging API
// route settles into a visible failure instead of an eternal skeleton, and a
// console breadcrumb on every failure path — the card UI can't say WHY a load
// failed, but the console always names the call and the HTTP status.
export async function fetchCard<T>(label: string, url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000) })
    if (!res.ok) {
      console.error(`[dashboard] ${label} failed: HTTP ${res.status}`)
      return null
    }
    return (await res.json()) as T
  } catch (err) {
    console.error(`[dashboard] ${label} fetch error:`, err)
    return null
  }
}
