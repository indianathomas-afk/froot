/**
 * CAL-2 — the generation gates, pinned.
 *
 *   npx tsx scripts/verify-cal2-generation.ts
 *
 * PURE, AND DELIBERATELY SO — the same shape as verify-cal1-projection.ts and
 * verify-perm8-grants.ts, for the same reason. What this checks is not a query:
 * it is three predicates. A database-backed fixture would be green on an empty
 * CalendarEvent table and would prove nothing at all.
 *
 * WHAT THIS CAN DETECT, stated so a green run means something:
 *   - THE DAY-CLOSE GATE LOSING ITS DAILY HALF. If dayCloseJudgesChecklist()
 *     ever reduces to "has a link", every Daily checklist in the product stops
 *     being closed and the operations report empties out. Cases 1-2 are the
 *     byte-identical-to-today assertions and are the most important in the file.
 *   - THE GATE LOSING ITS LINK HALF. If it reduces to the frequency test, CAL-2
 *     has shipped a column nothing reads and DEBT-61 is not closed. Case 4.
 *   - isSchedulableTemplate() ASKING ONLY ONE ARCHIVE FLAG. DEBT-65 measured
 *     that Keva archives with DEACTIVATE — five templates isActive=false, zero
 *     isArchived=true — so a predicate asking only isArchived would be correct
 *     and INERT, which is the exact mistake that row's first fix made. Cases
 *     6-9 fail if either flag stops being consulted.
 *   - THE PRESET DRIFTING FROM Template.frequency. Cases 10-13.
 *
 * WHAT IT CANNOT DETECT, and this half matters as much: it does not prove the
 * cron writes a linked pair, that the transaction rolls an occurrence back when
 * the checklist fails, that adoptedExisting adopts a real litter row, that
 * submit propagates Completed, or that day close marks an occurrence Missed.
 * THOSE ARE THE STAGING PROTOCOL'S, and the session report carries them unrun.
 */
import {
  CALENDAR_STATUSES,
  dayCloseJudgesChecklist,
  isSchedulableTemplate,
  recurrenceForFrequency,
} from "../src/lib/calendar"
import { dayCloseAppliesTo } from "../src/lib/checklist-lifecycle"

let failures = 0

function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    console.log(`  ✓ ${label}`)
  } else {
    failures++
    console.log(`  ✗ ${label}\n      expected ${e}\n      actual   ${a}`)
  }
}

/** The gate as the two call sites compose it: the frequency predicate, then the
 *  link. Written here exactly as day close and the report write it, so a change
 *  at either site that stops matching this is a red run. */
const judges = (frequency: string | null, link: string | null) =>
  dayCloseJudgesChecklist(dayCloseAppliesTo(frequency), link)

console.log("\n1 · The day-close gate — ruling 4")

// TODAY'S BEHAVIOUR, BYTE FOR BYTE. If these two ever move, CAL-2 has changed
// the lifecycle of every checklist in the product rather than extending it.
check("1. Daily, no link → judged (unchanged from before CAL-2)", judges("Daily", null), true)
check("2. Weekly, no link → left open (pre-CAL-2 litter, untouched)", judges("Weekly", null), false)
check("3. Monthly, no link → left open", judges("Monthly", null), false)

// THE WHOLE POINT OF THE PHASE.
check("4. Weekly, LINKED → judged (DEBT-61's exit condition)", judges("Weekly", "occ_1"), true)
check("5. Monthly, LINKED → judged", judges("Monthly", "occ_2"), true)
check("6. Daily, LINKED → judged", judges("Daily", "occ_3"), true)

// The frequency half keeps dayCloseAppliesTo's own tolerance for scruffy data.
check("7. null frequency reads as Daily → judged", judges(null, null), true)
check("8. padded ' Daily ' → judged", judges(" Daily ", null), true)
check("9. undefined link is the same as null", dayCloseJudgesChecklist(false, undefined), false)

console.log("\n2 · isSchedulableTemplate — ruling 1 and R4's two flags")

const tpl = (over: Partial<{ frequency: string; isActive: boolean; isArchived: boolean }> = {}) => ({
  frequency: "Weekly",
  isActive: true,
  isArchived: false,
  ...over,
})
const schedulable = (t: ReturnType<typeof tpl>) => isSchedulableTemplate(t, dayCloseAppliesTo(t.frequency))

check("10. Weekly, active, not archived → schedulable", schedulable(tpl()), true)
check("11. Monthly, active, not archived → schedulable", schedulable(tpl({ frequency: "Monthly" })), true)
check("12. Daily → NEVER schedulable, however active", schedulable(tpl({ frequency: "Daily" })), false)
// R4: Deactivate is the control Keva actually uses (DEBT-65, measured 2026-08-10).
check("13. Weekly but DEACTIVATED → not schedulable", schedulable(tpl({ isActive: false })), false)
check("14. Weekly but ARCHIVED → not schedulable", schedulable(tpl({ isArchived: true })), false)
// The normal state of an archived template: archive does not clear isActive.
check("15. archived AND still active → not schedulable", schedulable(tpl({ isArchived: true, isActive: true })), false)

console.log("\n3 · recurrenceForFrequency — the ruling-2 preset")

check("16. Weekly → Weekly", recurrenceForFrequency("Weekly"), "Weekly")
check("17. Monthly → Monthly", recurrenceForFrequency("Monthly"), "Monthly")
check("18. Daily → null (never offered)", recurrenceForFrequency("Daily"), null)
check("19. null → null", recurrenceForFrequency(null), null)
check("20. an unknown value → null, never a guess", recurrenceForFrequency("Fortnightly"), null)

console.log("\n4 · CALENDAR_STATUSES — Missed exists and is third")

check("21. the tuple is Open | Completed | Missed", [...CALENDAR_STATUSES], ["Open", "Completed", "Missed"])
// CAL-1's two values must keep their spelling: the cron filters on "Open" and
// the complete route writes "Completed" as string literals.
check("22. Open is still spelled Open", CALENDAR_STATUSES[0], "Open")
check("23. Completed is still spelled Completed", CALENDAR_STATUSES[1], "Completed")

console.log(failures === 0 ? "\n✓ ALL PASS\n" : `\n✗ ${failures} CHECK(S) FAILED\n`)
process.exit(failures === 0 ? 0 : 1)
