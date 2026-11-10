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
//   - UNREAD. The count is the desktop card's count, from /api/dashboard/comms
//     (`teamMessagesPreview.unreadCount`), rendered with the desktop card's own
//     "99+" cap. The tablet never marks anything read; desktop marks read only
//     when /messages loads (POST /api/messages/mark-read), and "Open the feed"
//     is how the tablet gets there.

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

/** A just-posted message lands at the top of a newest-first thread. A message
 *  already present (a reload raced the post) is not shown twice. */
export function withPosted<T extends { id: string }>(thread: T[], posted: T): T[] {
  return [posted, ...thread.filter((m) => m.id !== posted.id)]
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
