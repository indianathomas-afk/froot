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

console.log("\n2 · The newest-first thread")
const older = { id: "m1", body: "Truck is late" }
const newer = { id: "m2", body: "Truck is here" }
const posted = { id: "m3", body: "On it" }
check("6. a post lands at the top, above the newest", withPosted([newer, older], posted).map((m) => m.id), ["m3", "m2", "m1"])
check(
  "7. a post already in the thread (a reload raced it) shows once, at the top",
  withPosted([newer, posted, older], posted).map((m) => m.id),
  ["m3", "m2", "m1"]
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

console.log(failures === 0 ? "\n✓ ALL PASS\n" : `\n✗ ${failures} CHECK(S) FAILED\n`)
process.exit(failures === 0 ? 0 : 1)
