/**
 * TAB-1c — the tablet overdue chip's filter and count, pinned.
 *
 *   npx tsx scripts/verify-tab1c-due-chip.ts
 *
 * PURE, in the verify-tab1-today.ts style. The items below are shaped exactly
 * as GET /api/calendar/due returns them (src/app/api/calendar/due/route.ts,
 * the `items` map), with a fixed clock, so a failure is about the rule and not
 * about whatever rows a database happens to hold.
 *
 * WHAT THIS CAN DETECT:
 *   - ANOTHER STORE'S ITEM COUNTED on this store's chip. Cases 1, 3.
 *   - A FAN-OUT ("all stores") REMINDER MISHANDLED. The materialise cron writes
 *     one occurrence per store with that store's own storeId, so it must count
 *     once here and once at the other store, never twice and never zero.
 *     Cases 2-3.
 *   - OVERDUE COUNTED BY DAYS INSTEAD OF dueAt (CAL-1 ruling 8, CAL-2b /
 *     DEBT-101). An item past close on its own due date is overdue at 0 days.
 *     Case 5.
 *   - DUE TODAY, NOT YET OVERDUE, dropped or counted as overdue. It is listed
 *     and counted in "N due", as the desktop banner does. Cases 4, 7.
 *   - A CALENDAR-GENERATED CHECKLIST OCCURRENCE (templateId set) treated
 *     differently from a reminder in the count. Case 6.
 *   - THE CHIP RENDERING ON AN EMPTY STORE. Case 8.
 *   - The sheet's per-row wording. Case 9.
 *
 * WHAT IT CANNOT DETECT: whether the due feed holds a row at all. On staging a
 * new reminder has NO occurrence row until /api/cron/calendar-materialize runs,
 * and Vercel never fires crons on preview deployments (docs/WORKFLOW.md), so an
 * empty chip after creating a reminder is the feed, not this rule.
 */
import { dueChipFor, dueRowSuffix } from "../src/lib/tablet-due"

let failures = 0

function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  const ok = a === e
  if (!ok) failures++
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}`)
  if (!ok) console.log(`      expected ${e}\n      actual   ${a}`)
}

const LB = "cm_store_las_brisas"
const OT = "cm_store_other"
// 2026-11-10 12:00 PST.
const NOW = "2026-11-10T20:00:00.000Z"

type Item = {
  id: string
  title: string
  categoryLabel: string
  storeId: string
  dueAt: string
  daysOverdue: number
  templateId: string | null
  checklistId: string | null
}

function item(id: string, storeId: string, dueAt: string, daysOverdue: number, templateId: string | null = null): Item {
  return {
    id,
    title: id,
    categoryLabel: "Operations",
    storeId,
    dueAt,
    daysOverdue,
    templateId,
    checklistId: templateId ? `chk_${id}` : null,
  }
}

// The feed, ordered by dueAt as the route orders it.
const storeOverdue = item("store-overdue", LB, "2026-11-10T06:00:00.000Z", 1) // yesterday, past close
const fanOutLB = item("fanout@LB", LB, "2026-11-10T06:00:00.000Z", 1) // all-stores reminder, LB's row
const fanOutOT = item("fanout@OT", OT, "2026-11-10T06:00:00.000Z", 1) // all-stores reminder, OT's row
const otherStore = item("other-store", OT, "2026-11-09T06:00:00.000Z", 2)
const lateToday = item("late-today", LB, "2026-11-10T18:00:00.000Z", 0) // due 10 AM today, now past
const scheduledChecklist = item("cal-checklist", LB, "2026-11-10T06:00:00.000Z", 1, "tpl_weekly_deep_clean")
const dueToday = item("due-today", LB, "2026-11-11T06:00:00.000Z", 0) // due at tonight's close
const feed = [otherStore, storeOverdue, fanOutLB, fanOutOT, scheduledChecklist, lateToday, dueToday]

const ids = (r: { items: Item[] }) => r.items.map((i) => i.id)
const lb = dueChipFor(feed, LB, NOW)
const ot = dueChipFor(feed, OT, NOW)

console.log("\n1 · Which items belong to the selected store")
check("1. Las Brisas lists its own five, never another store's", ids(lb), [
  "store-overdue",
  "fanout@LB",
  "cal-checklist",
  "late-today",
  "due-today",
])
check("2. the fan-out reminder counts once at Las Brisas", ids(lb).filter((i) => i.startsWith("fanout")), ["fanout@LB"])
check("3. the other store sees its own row of the fan-out plus its own reminder", ids(ot), ["other-store", "fanout@OT"])

console.log("\n2 · The count")
check("4. Las Brisas: 4 overdue (due-today not yet overdue is not counted)", lb.overdue, 4)
check("5. past close today at 0 days is overdue (dueAt, not daysOverdue)", dueChipFor([lateToday], LB, NOW).overdue, 1)
check("6. a calendar-generated checklist counts like a reminder", dueChipFor([scheduledChecklist], LB, NOW).overdue, 1)
check("4b. the chip reads the overdue count", lb.label, "4 overdue")
check("4c. the other store reads its own count, not Las Brisas's", ot.label, "2 overdue")

console.log("\n3 · Due today, not yet overdue — as the banner does")
check("7. only a due-today item → chip shows, amber wording", dueChipFor([dueToday], LB, NOW), {
  items: [dueToday],
  overdue: 0,
  label: "1 due",
})
check("8. a store with nothing in the feed → no chip", dueChipFor(feed, "cm_store_empty", NOW).label, null)

console.log("\n4 · Sheet row wording")
check(
  "9. row suffixes: days overdue / overdue at 0 days / due today",
  [dueRowSuffix(otherStore, NOW), dueRowSuffix(storeOverdue, NOW), dueRowSuffix(lateToday, NOW), dueRowSuffix(dueToday, NOW)],
  [" · 2 days overdue", " · 1 day overdue", " · overdue", " · due today"]
)

console.log(failures === 0 ? "\n✓ ALL PASS\n" : `\n✗ ${failures} CHECK(S) FAILED\n`)
process.exit(failures === 0 ? 0 : 1)
