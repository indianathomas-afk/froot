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
