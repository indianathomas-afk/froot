// TAB-14 — STARTING TODAY'S CHECKLIST FROM A TABLET, shared by tablet Home
// (src/app/(app)/dashboard/tablet-home.tsx, TasksPanel's start()) and the
// tablet Checklists page (src/app/(app)/checklists/checklists-tablet.tsx).
//
// MOVED, NOT CHANGED (TAB-14 RN-2, Gary 2026-11-11: a no-behaviour-change
// refactor). This is the POST and the error sentences tablet Home's start()
// ran inline since TAB-1: the same request Start Daily Checklist sends
// (store-view-client.tsx), the same 403 sentence, the same fallbacks. What
// the CALLER does next stays the caller's: Home opens the tick list in its
// card and re-reads; the Checklists page navigates to the returned row.
//
// POST /api/checklists answers { id } — 201 for a new row, 200 when today's
// row already exists (api/checklists/route.ts) — so `id` is the row either
// way. A login without checklists.create is refused there (403) and here alike.
// No permission changes.

/** The route's `error`, or null when the body has none. Moved from
 *  tablet-home.tsx (also used there by Submit and Submit Partial). */
export async function readError(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { error?: unknown }
    return typeof body.error === "string" ? body.error : null
  } catch {
    return null
  }
}

export const START_OFFLINE_MESSAGE = "Couldn't start — no connection. Check the store's wifi and try again."
export const START_FORBIDDEN_MESSAGE =
  "This login can't start a checklist that hasn't been started today. Ask a manager to start it."

export type StartResult = { ok: true; id: string | null } | { ok: false; error: string }

/** Instantiate today's checklist for `templateId` at `storeId`. Never throws. */
export async function startTodayChecklist(
  templateId: string,
  storeId: string,
  fetchImpl: typeof fetch = fetch
): Promise<StartResult> {
  let res: Response
  try {
    res = await fetchImpl("/api/checklists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId, storeId }),
    })
  } catch {
    return { ok: false, error: START_OFFLINE_MESSAGE }
  }
  if (!res.ok) {
    return {
      ok: false,
      error: res.status === 403 ? START_FORBIDDEN_MESSAGE : ((await readError(res)) ?? `Couldn't start (error ${res.status}).`),
    }
  }
  const body = (await res.json().catch(() => null)) as { id?: unknown } | null
  return { ok: true, id: typeof body?.id === "string" ? body.id : null }
}
