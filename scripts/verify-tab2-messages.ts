/**
 * TAB-2 — the tablet Messages column's pure rules, pinned.
 *
 *   npx tsx scripts/verify-tab2-messages.ts
 *
 * PURE, in the verify-tab1-today.ts style: no database, no browser, a fixed
 * clock where one matters.
 *
 * WHAT THIS CAN DETECT:
 *   - A QUICK REPLY OR TYPED MESSAGE SENT IN A SHAPE POST /api/messages
 *     REFUSES or files under the wrong type — it must be "general" with no
 *     staff name (ruling 4: the logged-in account is the author). Cases 1-3.
 *   - A BLANK MESSAGE SENT. The route refuses it; the column must not try.
 *     Case 4.
 *   - QUICK REPLIES AIMED AT A REPLY TARGET that does not exist. TeamMessage
 *     has no reply field, so ruling 3's fallback applies: the feed. Case 5.
 *   - A JUST-POSTED MESSAGE LANDING AT THE WRONG END of the newest-first
 *     thread, or SHOWN TWICE when a reload raced the post. Cases 6-7.
 *     (2026-11-10, Gary's ruling 6: the thread is now CHAT ORDER — oldest at
 *     the top, newest at the bottom — so cases 6-7 now expect the post at the
 *     BOTTOM. The line above is spent, kept.)
 *   - THE API PAGE NOT TURNED ROUND to chat order, or turned round in place
 *     (mutating the caller's array). Case 6a.
 *   - A REFRESH THAT ERASES A JUST-SENT MESSAGE, duplicates one, or keeps a
 *     stale local copy the server has since returned. Cases 15-17.
 *   - MARK-READ CALLED WITH THE WRONG upTo (anything but the newest RENDERED
 *     message), or called again when nothing new was rendered. Cases 18-20.
 *   - A REFRESH WHILE HIDDEN OR MID-SEND (ruling 8). Case 21.
 *   - A REFRESH YANKING SOMEONE WHO SCROLLED UP to read. Case 22.
 *   - THE UNREAD BADGE drifting from the desktop card's ("99+" cap, nothing at
 *     zero). Case 8.
 *   - THE RAIL BADGE showing another store's count, or showing on /messages,
 *     which marks the feed read as it loads. Cases 9-11.
 *   - THE KEYBOARD INSET reading the wrong side of the viewport, or jittering
 *     on a few pixels of toolbar. Cases 12-14.
 *
 * WHAT IT CANNOT DETECT: anything about the real iPad keyboard. Case 12's
 * numbers are what iPad Safari reports per Apple's visualViewport docs; only a
 * real iPad confirms the composer stays above it.
 */
import {
  QUICK_REPLIES,
  keyboardInset,
  postBody,
  quickReplyTarget,
  railBadge,
  chatOrder,
  mergeRefresh,
  markReadUpTo,
  canRefresh,
  isNearBottom,
  unreadBadge,
  withPosted,
} from "../src/lib/tablet-messages"

let failures = 0

function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  const ok = a === e
  if (!ok) failures++
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${ok ? "" : `\n      expected ${e}\n      actual   ${a}`}`)
}

const LB = "cm_store_las_brisas"
const OT = "cm_store_old_town"

console.log("\n1 · What POST /api/messages receives")
check("1. the three quick replies, in the design's order", QUICK_REPLIES, ["On it", "Done", "Thanks"])
check(
  "2. each quick reply posts as a general message to this store, no staff name",
  QUICK_REPLIES.map((q) => postBody(LB, q)),
  [
    { storeId: LB, type: "general", body: "On it" },
    { storeId: LB, type: "general", body: "Done" },
    { storeId: LB, type: "general", body: "Thanks" },
  ]
)
check(
  "3. a typed message is trimmed, as the route trims it",
  postBody(LB, "  Blender 2 is grinding again  \n"),
  { storeId: LB, type: "general", body: "Blender 2 is grinding again" }
)
check("4. blank, whitespace-only, or no store → nothing to send", [postBody(LB, ""), postBody(LB, "  \n "), postBody("", "Hi")], [null, null, null])
check("5. quick replies go to the feed (no reply field exists)", quickReplyTarget(), "feed")
// TAB-12 (2026-11-11): the home composer posts the type its tag shows (R1);
// a shift note carries its phase (R6); a General body is unchanged.
check("5a. TAB-12 — a typed post carries the tag's type, no phase", postBody(LB, " Fryer 2 is down ", "equipment"), {
  storeId: LB,
  type: "equipment",
  body: "Fryer 2 is down",
})
check("5b. TAB-12 R6 — a shift note carries its phase", postBody(LB, "Walk-in restocked", "shift_note", "mid"), {
  storeId: LB,
  type: "shift_note",
  body: "Walk-in restocked",
  shiftPhase: "mid",
})
check(
  "5c. TAB-12 R6 — a shift note with no phase is never sent; a phase on any other type is dropped",
  [postBody(LB, "Walk-in restocked", "shift_note", null), postBody(LB, "Out of oat milk", "shortage", "mid")],
  [null, { storeId: LB, type: "shortage", body: "Out of oat milk" }]
)

console.log("\n2 · The chat-order thread (ruling 6: oldest top, newest bottom)")
const older = { id: "m1", body: "Truck is late", createdAt: "2026-11-10T14:00:00.000Z" }
const newer = { id: "m2", body: "Truck is here", createdAt: "2026-11-10T15:00:00.000Z" }
const posted = { id: "m3", body: "On it", createdAt: "2026-11-10T15:05:00.000Z" }
const apiPage = [newer, older] // GET /api/messages answers newest first
check("6a. the API page turned round, input untouched", [chatOrder(apiPage).map((m) => m.id), apiPage.map((m) => m.id)], [
  ["m1", "m2"],
  ["m2", "m1"],
])
check("6. a post lands at the bottom, below the newest", withPosted([older, newer], posted).map((m) => m.id), ["m1", "m2", "m3"])
check(
  "7. a post already in the thread (a refresh raced it) shows once, at the bottom",
  withPosted([older, posted, newer], posted).map((m) => m.id),
  ["m1", "m2", "m3"]
)

console.log("\n3 · Unread — desktop's count, desktop's badge")
check("8. 0 / null → none; 1 → \"1\"; 99 → \"99\"; 100 → \"99+\"", [unreadBadge(0), unreadBadge(null), unreadBadge(1), unreadBadge(99), unreadBadge(100)], [
  null,
  null,
  "1",
  "99",
  "99+",
])
check("9. the rail shows this store's count off /messages", railBadge({ storeId: LB, count: 3 }, LB, "/checklists"), "3")
check(
  "10. another store's count never shows (store switched since it was read)",
  [railBadge({ storeId: OT, count: 3 }, LB, "/dashboard"), railBadge(null, LB, "/dashboard"), railBadge({ storeId: LB, count: 3 }, null, "/dashboard")],
  [null, null, null]
)
check("11. hidden on /messages, which marks the feed read as it loads", [railBadge({ storeId: LB, count: 3 }, LB, "/messages")], [null])

console.log("\n4 · The iPad keyboard")
// iPad 1180×820 landscape, keyboard up: visual viewport ~ 820 − 398.
check("12. keyboard up → the covered height", keyboardInset(820, { height: 422, offsetTop: 0 }), 398)
check("13. Safari panned the page up 120px → only the still-covered part", keyboardInset(820, { height: 422, offsetTop: 120 }), 278)
check(
  "14. no keyboard, a toolbar's few pixels, or no visualViewport → 0",
  [keyboardInset(820, { height: 820, offsetTop: 0 }), keyboardInset(820, { height: 790, offsetTop: 0 }), keyboardInset(820, null)],
  [0, 0, 0]
)

console.log("\n5 · Live refresh (ruling 8)")
const fromOther = { id: "m4", body: "New from Old Town", createdAt: "2026-11-10T15:10:00.000Z" }
check(
  "15. the refresh page replaces the thread and brings the new message",
  mergeRefresh([older, newer, posted, fromOther], [older, newer, posted]).map((m) => m.id),
  ["m1", "m2", "m3", "m4"]
)
const sentAfter = { id: "m5", body: "Thanks", createdAt: "2026-11-10T15:20:00.000Z" }
check(
  "16. a message sent after the refresh's read began stays, at the bottom",
  mergeRefresh([older, newer], [older, newer, sentAfter]).map((m) => m.id),
  ["m1", "m2", "m5"]
)
check(
  "17. an older local message the page no longer holds is dropped, not kept (deleted elsewhere)",
  mergeRefresh([newer, posted], [older, newer, posted]).map((m) => m.id),
  ["m2", "m3"]
)

console.log("\n6 · Mark read once rendered (ruling 7, the /messages mark-read)")
check("18. upTo is the newest rendered message", markReadUpTo([older, newer, posted], null), posted.createdAt)
check("19. nothing newer than last marked → no request", markReadUpTo([older, newer, posted], posted.createdAt), null)
check(
  "20. a newer message rendered → upTo moves to it; empty thread → no request",
  [markReadUpTo([older, newer, posted, fromOther], posted.createdAt), markReadUpTo([], null)],
  [fromOther.createdAt, null]
)
check(
  "21. refresh only when visible and not sending",
  [canRefresh("visible", false), canRefresh("hidden", false), canRefresh("visible", true), canRefresh("prerender", false)],
  [true, false, false, false]
)
check(
  "22. at the bottom (or within 80px) follows new messages; scrolled up does not",
  [isNearBottom(600, 400, 1000), isNearBottom(540, 400, 1000), isNearBottom(200, 400, 1000)],
  [true, true, false]
)

console.log(failures === 0 ? "\n✓ ALL PASS\n" : `\n✗ ${failures} CHECK(S) FAILED\n`)
process.exit(failures === 0 ? 0 : 1)
