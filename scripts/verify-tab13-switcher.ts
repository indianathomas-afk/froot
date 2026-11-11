/**
 * TAB-13 — the tablet Home checklist switcher, pinned.
 *
 *   npx tsx scripts/verify-tab13-switcher.ts
 *
 * PURE, in the verify-tab1-today.ts style: tab order, which tab the card shows,
 * and the type key are choices among values, not queries.
 *
 * WHAT THIS CAN DETECT:
 *   - THE R3 ORDER (as amended by RN-3) BROKEN — in progress first, then not
 *     started and due now, then upcoming, then completed; earliest due first in
 *     each group, windowless last, name as the tie-break. Cases 1-6.
 *   - MISSED LEAKING INTO THE TABS (Gary's addition 2: Home's current behaviour
 *     is that Missed never shows). Case 7.
 *   - THE CARSON CASE under each of the three audit hypotheses: whatever the
 *     windows were, a started checklist now leads and every checklist has a
 *     tab. Cases 8-10.
 *   - THE CARD SWAPPING UNDER AN OPEN TICK LIST OR DONE SCREEN when a re-read
 *     reorders the list (Gary's addition 1). Cases 11-15.
 *   - THE AUTO-PICK NOT FOLLOWING LIVE DATA when nothing is tapped or open, or
 *     a tapped tab being overridden by it. Cases 16-18.
 *   - THE TYPE KEY matching on the wrong thing — case, punctuation, the Closer
 *     alias, unmapped → OTHER (grey, clipboard-check). Cases 19-24.
 *
 * WHAT IT CANNOT DETECT: whether the route returns the right SET of
 * checklists or the right lifecycle state, whether the tablet renders these
 * classes, or what "in progress" is computed from (tablet-home.tsx owns that).
 */
import { ClipboardCheck, Moon, Sun } from "lucide-react"
import {
  initialSwitcher,
  orderTodayChecklists,
  shownChecklist,
  switcherReducer,
  type SwitcherState,
  type TodayEntry,
} from "../src/lib/tablet-today"
import { CHECKLIST_TYPE_STYLES, checklistTypeKey, checklistTypeStyle } from "../src/lib/checklist-types"

let failures = 0

function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  const ok = a === e
  if (!ok) failures++
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}`)
  if (!ok) console.log(`      expected ${e}\n      actual   ${a}`)
}

type E = TodayEntry & { started: boolean }

function e(name: string, lifecycleState: TodayEntry["lifecycleState"], expectedEndAt: string | null, started = false): E {
  return { id: name, name, existingChecklistId: started ? `row-${name}` : null, lifecycleState, expectedEndAt, started }
}
const order = (entries: E[]) => orderTodayChecklists(entries, (x) => x.started).map((x) => x.id)

const T = (hh: string) => `2026-11-11T${hh}:00:00.000Z`

console.log("R3 order (RN-3)")
check(
  "1. in progress leads, even when due later than a not-started one",
  order([e("Opener", "overdue", T("16"), false), e("Mid-Shift", "active", T("23"), true)]),
  ["Mid-Shift", "Opener"]
)
check(
  "2. not started and due now: earliest due first",
  order([e("B", "active", T("22")), e("A", "overdue", T("18"))]),
  ["A", "B"]
)
check(
  "3. windowless after windowed in its group; name breaks the tie",
  order([e("Zeta", "active", null), e("Beta", "active", null), e("Alpha", "active", T("20"))]),
  ["Alpha", "Beta", "Zeta"]
)
check(
  "4. upcoming (window not open) after every due-now one, even if due earlier",
  order([e("Closing", "upcoming", T("05")), e("Cleaning", "active", null)]),
  ["Cleaning", "Closing"]
)
check(
  "5. completed last",
  order([e("Opener", "completed", T("16")), e("Closing", "upcoming", T("23"))]),
  ["Closing", "Opener"]
)
check(
  "6. the mock's row: Mid-Shift in progress, Cleaning not started, Opener done",
  order([e("Opener", "completed", T("16"), true), e("Cleaning", "active", null), e("Mid-Shift", "active", T("03"), true)]),
  ["Mid-Shift", "Cleaning", "Opener"]
)
check("7. missed never gets a tab", order([e("Old", "missed", T("10"), true), e("Cleaning", "active", null)]), ["Cleaning"])

console.log("The Carson case — every hypothesis now shows Mid-Shift in the row")
// H1: Mid-Shift upcoming, Cleaning active.
check("8. H1 (Mid-Shift upcoming): both tabs, Cleaning first", order([e("Cleaning", "active", null), e("Mid-Shift", "upcoming", T("03"))]), [
  "Cleaning",
  "Mid-Shift",
])
// H2: both due now, Cleaning's end earlier.
check("9. H2 (Cleaning due earlier): both tabs", order([e("Mid-Shift", "active", T("03")), e("Cleaning", "active", T("01"))]), [
  "Cleaning",
  "Mid-Shift",
])
// H3: both windowless; name tie-break — and once Mid-Shift is started it leads.
check(
  "10. H3 (both windowless): name order, until Mid-Shift is started, then it leads",
  [order([e("Mid-Shift", "active", null), e("Cleaning", "active", null)]), order([e("Mid-Shift", "active", null, true), e("Cleaning", "active", null)])],
  [
    ["Cleaning", "Mid-Shift"],
    ["Mid-Shift", "Cleaning"],
  ]
)

console.log("Opening is a manual pick; the auto-pick never swaps an open card (addition 1)")
const run = (actions: Parameters<typeof switcherReducer>[1][], from: SwitcherState = initialSwitcher) => actions.reduce(switcherReducer, from)
{
  // Cleaning is the auto-pick; the crew starts it.
  const s = run([{ type: "open", id: "Cleaning", view: "list" }])
  check("11. Start/Continue = open list + manual pick", s, { manual: "Cleaning", open: { id: "Cleaning", view: "list" } })
  // A re-read lands and Mid-Shift is now first (started elsewhere).
  check("12. re-read reorders the list: the open tick list stays", shownChecklist(s, ["Mid-Shift", "Cleaning"]), { id: "Cleaning", view: "list" })
  const done = run([{ type: "open", id: "Opener", view: "done" }])
  check("13. View = open Done + manual pick; a re-read does not swap it", shownChecklist(done, ["Mid-Shift", "Cleaning", "Opener"]), {
    id: "Opener",
    view: "done",
  })
  check("14. tapping another tab closes the open card onto that tab's summary", shownChecklist(run([{ type: "tap", id: "Mid-Shift" }], s), ["Mid-Shift", "Cleaning"]), {
    id: "Mid-Shift",
    view: null,
  })
  check("15. tapping the open tab's own tab returns to its summary", shownChecklist(run([{ type: "tap", id: "Cleaning" }], s), ["Mid-Shift", "Cleaning"]), {
    id: "Cleaning",
    view: null,
  })
}

console.log("The auto-pick with nothing open")
check("16. nothing tapped: follows the first in order", shownChecklist(initialSwitcher, ["Cleaning", "Mid-Shift"]), { id: "Cleaning", view: null })
check("17. nothing tapped, re-read reorders: follows it", shownChecklist(initialSwitcher, ["Mid-Shift", "Cleaning"]), { id: "Mid-Shift", view: null })
check(
  "18. a tapped tab holds over the auto-pick; one that left the list falls back",
  [
    shownChecklist(run([{ type: "tap", id: "Cleaning" }]), ["Mid-Shift", "Cleaning"]),
    shownChecklist(run([{ type: "open", id: "Gone", view: "list" }]), ["Mid-Shift", "Cleaning"]),
  ],
  [
    { id: "Cleaning", view: null },
    { id: "Mid-Shift", view: null },
  ]
)

console.log("Type key (R4 + RN-2)")
check("19. case and punctuation: Mid-Shift / mid shift / MIDSHIFT", ["Mid-Shift", "mid shift", "MIDSHIFT"].map(checklistTypeKey), ["midshift", "midshift", "midshift"])
check("20. Closer (the starter name) reads as Closing", [checklistTypeKey("Closer"), checklistTypeKey("Closing")], ["closing", "closing"])
check("21. the five design types", ["Opener", "Mid-Shift", "Cleaning", "Closing", "Management"].map(checklistTypeKey), [
  "opener",
  "midshift",
  "cleaning",
  "closing",
  "management",
])
check("22. unmapped, empty and null → other", ["Audit", "", null].map(checklistTypeKey), ["other", "other", "other"])
check("23. other is grey with clipboard-check", [checklistTypeStyle("Audit").fill, checklistTypeStyle("Audit").Icon === ClipboardCheck], [
  "bg-[var(--color-cal-other)]",
  true,
])
check(
  "24. icons and fills per the key",
  [
    checklistTypeStyle("Mid-Shift").Icon === Sun,
    checklistTypeStyle("Closer").Icon === Moon,
    CHECKLIST_TYPE_STYLES.opener.fill,
    CHECKLIST_TYPE_STYLES.opener.ink,
    CHECKLIST_TYPE_STYLES.management.fill,
  ],
  [true, true, "bg-amber-400", "text-amber-950", "bg-slate-800"]
)

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
