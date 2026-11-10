/**
 * TAB-1 — the tablet's today's-checklist rule, pinned.
 *
 *   npx tsx scripts/verify-tab1-today.ts
 *
 * PURE, in the verify-cal1-projection.ts style: what this checks is a choice
 * among rows, not a query. A database-backed fixture would be green on a store
 * with no checklists and prove nothing.
 *
 * WHAT THIS CAN DETECT:
 *   - CURRENT PICKING THE WRONG ROW — overdue before active, earliest
 *     expectedEndAt first, a windowless checklist after every windowed one,
 *     name as the tie-break. Cases 1-5.
 *   - AN UPCOMING CHECKLIST HOLDING THE PANEL OPEN after the current one is
 *     finished, which would make the Done state unreachable. Cases 6-7.
 *   - DONE PICKING THE WRONG HEADLINE or the wrong "up next". Cases 6-9.
 *   - THE EARLY-CREW CASE — nothing completed, only upcoming → that is current.
 *     Case 10.
 *   - MISSED LEAKING IN. The source route already drops Missed rows; the rule
 *     must not treat one as current if it ever arrives. Case 11.
 *
 * WHAT IT CANNOT DETECT: whether /api/stores/[id]/templates returns the right
 * SET of checklists for a store, or the right lifecycle state for each. Those
 * are that route's and src/lib/checklist-lifecycle.ts's
 * (scripts/verify-store-hours-engine.ts).
 */
import { pickTodayChecklist, type TodayEntry } from "../src/lib/tablet-today"

let failures = 0

function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  const ok = a === e
  if (!ok) failures++
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}`)
  if (!ok) console.log(`      expected ${e}\n      actual   ${a}`)
}

function e(name: string, lifecycleState: TodayEntry["lifecycleState"], expectedEndAt: string | null): TodayEntry {
  return { id: name, name, existingChecklistId: null, lifecycleState, expectedEndAt }
}

/** The pick, reduced to names so a failure prints readably. */
function names(entries: TodayEntry[]) {
  const p = pickTodayChecklist(entries)
  if (p.mode === "current") return { mode: p.mode, current: p.current.name }
  if (p.mode === "done") return { mode: p.mode, lastDone: p.lastDone.name, upNext: p.upNext?.name ?? null }
  return { mode: p.mode }
}

const OPEN_END = "2026-11-09T15:00:00.000Z" // 7:00 AM PST
const MID_END = "2026-11-09T21:00:00.000Z" //   1:00 PM PST
const CLOSE_END = "2026-11-10T06:00:00.000Z" // 10:00 PM PST

console.log("\n1 · Current — earliest-due among checklists due now")
check(
  "1. opening active, mid-day + closing upcoming → opening",
  names([e("Closing", "upcoming", CLOSE_END), e("Opening", "active", OPEN_END), e("Mid-day", "upcoming", MID_END)]),
  { mode: "current", current: "Opening" }
)
check(
  "2. overdue opening and active mid-day → the overdue one (earlier due)",
  names([e("Mid-day", "active", MID_END), e("Opening", "overdue", OPEN_END)]),
  { mode: "current", current: "Opening" }
)
check(
  "3. a windowless checklist sorts after a windowed one",
  names([e("All day", "active", null), e("Mid-day", "active", MID_END)]),
  { mode: "current", current: "Mid-day" }
)
check(
  "4. only windowless checklists → name order",
  names([e("Weekly deep clean", "active", null), e("Bar restock", "active", null)]),
  { mode: "current", current: "Bar restock" }
)
check(
  "5. same due time → name breaks the tie",
  names([e("Opening B", "active", OPEN_END), e("Opening A", "active", OPEN_END)]),
  { mode: "current", current: "Opening A" }
)

console.log("\n2 · Done — nothing due now, something completed")
check(
  "6. opening completed, mid-day upcoming → Done, up next mid-day (the design's state)",
  names([e("Opening", "completed", OPEN_END), e("Mid-day", "upcoming", MID_END), e("Closing", "upcoming", CLOSE_END)]),
  { mode: "done", lastDone: "Opening", upNext: "Mid-day" }
)
check(
  "7. an upcoming checklist does NOT hold the panel open",
  names([e("Opening", "completed", OPEN_END), e("Closing", "upcoming", CLOSE_END)]).mode,
  "done"
)
check(
  "8. two completed → the latest-due one is the headline",
  names([e("Mid-day", "completed", MID_END), e("Opening", "completed", OPEN_END)]),
  { mode: "done", lastDone: "Mid-day", upNext: null }
)
check(
  "9. everything completed → Done with no up next",
  names([e("Opening", "completed", OPEN_END), e("Mid-day", "completed", MID_END), e("Closing", "completed", CLOSE_END)]),
  { mode: "done", lastDone: "Closing", upNext: null }
)

console.log("\n3 · Edges")
check(
  "10. early crew: nothing completed, only upcoming → earliest upcoming is current",
  names([e("Mid-day", "upcoming", MID_END), e("Opening", "upcoming", OPEN_END)]),
  { mode: "current", current: "Opening" }
)
check(
  "11. a missed row is never current",
  names([e("Opening", "missed", OPEN_END), e("Mid-day", "upcoming", MID_END)]),
  { mode: "current", current: "Mid-day" }
)
check("12. no checklists → none", names([]), { mode: "none" })
check(
  "13. active beats completed even when the completed one is due later",
  names([e("Closing", "completed", CLOSE_END), e("Opening", "active", OPEN_END)]),
  { mode: "current", current: "Opening" }
)

console.log(failures === 0 ? "\n✓ ALL PASS\n" : `\n✗ ${failures} CHECK(S) FAILED\n`)
process.exit(failures === 0 ? 0 : 1)
