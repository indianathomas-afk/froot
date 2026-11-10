// TAB-2 — the tablet Messages column's rules, as pure functions so
// scripts/verify-tab2-messages.ts can pin them without a database or a browser.
//
// NOTHING HERE IS A NEW RULE. Each function restates what an existing surface
// already does, so the tablet column cannot drift from it:
//
//   - QUICK REPLIES (Gary's ruling 3, 2026-11-10). A TeamMessage has no
//     reply-to or thread field (prisma/schema.prisma, model TeamMessage), so a
//     quick reply cannot reply to anything. It posts to the store feed as an
//     ordinary "general" message, the same body shape the /messages composer
//     sends for a "General" post (src/app/(app)/messages/messages-client.tsx,
//     Composer.post).
//   - ORDER. The desktop Team Messages card and the /messages feed both read
//     NEWEST FIRST (GET /api/messages and /api/dashboard/comms both
//     `orderBy: { createdAt: "desc" }`), so the tablet thread does too: the
//     newest message at the top, under the pinned Corporate Update.
//     ── SUPERSEDED 2026-11-10 (Gary's TAB-2 ruling 6): the tablet column reads
//     in CHAT ORDER — oldest at the top, newest at the bottom beside the
//     composer. Desktop is unchanged. The API still answers newest first;
//     chatOrder() turns the page round. The paragraph above is spent, kept.
//   - UNREAD. The count is the desktop card's count, from /api/dashboard/comms
//     (`teamMessagesPreview.unreadCount`), rendered with the desktop card's own
//     "99+" cap. The tablet never marks anything read; desktop marks read only
//     when /messages loads (POST /api/messages/mark-read), and "Open the feed"
//     is how the tablet gets there.
//     ── SUPERSEDED 2026-11-10 (Gary's TAB-2 ruling 7): messages count as read
//     once the tablet column has rendered them, through the SAME
//     POST /api/messages/mark-read /messages uses. upTo is the newest RENDERED
//     message's createdAt (markReadUpTo), not "now", so a message that arrives
//     between the read and the render is never marked. The route marks every
//     message at or before upTo, the older pages included, exactly as /messages
//     marks everything when only its first page has loaded. The "never marks
//     anything read" sentence above is spent, kept.
//   - LIVE REFRESH (Gary's TAB-2 ruling 8, 2026-11-10). Every 60s while the
//     page is visible, at once when it becomes visible again, never while
//     hidden, never while a send is in flight (canRefresh).

export const QUICK_REPLIES = ["On it", "Done", "Thanks"] as const
export type QuickReply = (typeof QUICK_REPLIES)[number]

/** The body POST /api/messages receives for a typed or quick-reply message.
 *  `null` means there is nothing to send (blank after trimming), which the
 *  route would refuse anyway (`body: z.string().trim().min(1)`). */
export function postBody(storeId: string, text: string): { storeId: string; type: "general"; body: string } | null {
  const body = text.trim()
  if (!storeId || body.length === 0) return null
  return { storeId, type: "general", body }
}

/** Where a quick reply goes. Always the feed: there is no reply field to
 *  target (ruling 3's fallback). Kept as a function so the day a reply field
 *  exists, this is the one place that changes and the fixture fails first. */
export function quickReplyTarget(): "feed" {
  return "feed"
}

/** The API's newest-first page, turned round to chat order: oldest at the
 *  top, newest at the bottom beside the composer (ruling 6). A copy; the
 *  input is not mutated. */
export function chatOrder<T>(newestFirst: T[]): T[] {
  return [...newestFirst].reverse()
}

/** A just-posted message lands at the BOTTOM of the chat-order thread
 *  (ruling 6; it landed at the top until then). A message already present (a
 *  refresh raced the post) is not shown twice. */
export function withPosted<T extends { id: string }>(thread: T[], posted: T): T[] {
  return [...thread.filter((m) => m.id !== posted.id), posted]
}

type Stamped = { id: string; createdAt: string }

/** A refresh's chat-order page replaces the thread, except that a message
 *  this device posted AFTER the refresh's read began (newer than anything in
 *  the page, and not in it) is kept at the bottom, so a refresh landing just
 *  after a send never makes the sent message vanish. */
export function mergeRefresh<T extends Stamped>(fetched: T[], current: T[]): T[] {
  const ids = new Set(fetched.map((m) => m.id))
  const newest = fetched.length > 0 ? Date.parse(fetched[fetched.length - 1].createdAt) : -Infinity
  const kept = current.filter((m) => !ids.has(m.id) && Date.parse(m.createdAt) > newest)
  return [...fetched, ...kept]
}

/** The `upTo` for POST /api/messages/mark-read after a render: the newest
 *  rendered message's createdAt, or null when there is nothing newer than what
 *  was already marked (no request at all). Ruling 7. */
export function markReadUpTo(thread: Stamped[], lastMarked: string | null): string | null {
  let newest: string | null = null
  for (const m of thread) if (newest === null || Date.parse(m.createdAt) > Date.parse(newest)) newest = m.createdAt
  if (newest === null) return null
  if (lastMarked !== null && Date.parse(newest) <= Date.parse(lastMarked)) return null
  return newest
}

/** Ruling 8: the live-refresh cadence. TAB-3: shared by the Messages column
 *  and the stat strip, so both refresh on the same visibility-aware timer. */
export const TABLET_REFRESH_MS = 60_000

/** Ruling 8: refetch only while the page is visible and no send is in flight. */
export function canRefresh(visibilityState: string, sending: boolean): boolean {
  return visibilityState === "visible" && !sending
}

/** Whether the reader is at the bottom of the thread (within a message's
 *  height), so a refresh that brings new messages may follow them down
 *  without yanking someone who scrolled up to read older ones. */
export function isNearBottom(scrollTop: number, clientHeight: number, scrollHeight: number): boolean {
  return scrollHeight - (scrollTop + clientHeight) <= 80
}

/** The desktop card's badge text: nothing at zero, the number, or "99+". */
export function unreadBadge(count: number | null | undefined): string | null {
  if (!count || count <= 0) return null
  return count > 99 ? "99+" : String(count)
}

/** The rail's Messages badge. Hidden on /messages itself: that page marks the
 *  whole feed read as soon as it loads, so a count there is already stale.
 *  Hidden too when the count belongs to a different store than the one the
 *  rail is showing (the store was switched since it was read). */
export function railBadge(
  unread: { storeId: string; count: number } | null,
  storeId: string | null | undefined,
  pathname: string
): string | null {
  if (!unread || !storeId || unread.storeId !== storeId) return null
  if (pathname === "/messages" || pathname.startsWith("/messages/")) return null
  return unreadBadge(unread.count)
}

/** How far the on-screen keyboard covers the bottom of the layout viewport,
 *  from window.visualViewport (iPad Safari and the Home Screen app both report
 *  it). 0 when there is no keyboard or no visualViewport. Small differences
 *  (the Safari toolbar settling) are ignored so the composer does not jitter. */
export function keyboardInset(
  innerHeight: number,
  viewport: { height: number; offsetTop: number } | null | undefined
): number {
  if (!viewport) return 0
  const covered = Math.round(innerHeight - viewport.height - viewport.offsetTop)
  return covered > 40 ? covered : 0
}
