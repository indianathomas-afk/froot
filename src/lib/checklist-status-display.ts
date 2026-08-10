import {
  checklistState,
  isCompletedLate,
  type ChecklistState,
  type ExpectedWindow,
  type LifecycleChecklist,
} from "@/lib/checklist-lifecycle"

// ─── How a lifecycle state LOOKS (CHK-4) ─────────────────────────────────────
// CHK-3 shipped the engine and said in its own header that "NO UI READS ANY OF
// THIS YET. CHK-4 (S4) owns every pixel." This is that file.
//
// IT ADDS NO PREDICATE AND RE-DERIVES NOTHING. src/lib/checklist-lifecycle.ts
// remains the ONLY definition of what overdue/missed/upcoming mean — DEBT-26's
// discipline, and the CHK-4 prompt's standing rule that a second definition is a
// defect. What lives here is the other half nobody owned: the WORDS AND COLOURS
// for those states, in one place, so the admin list, the store view, the
// execution page and the print sheet cannot disagree about what "Missed" looks
// like. Six independent section derivations are what CHK-1 spent a session
// folding into src/lib/sections.ts; five independent status chips would be the
// same mistake in a different column.
//
// React- and Prisma-free, like the two libs it sits beside, because two of its
// four consumers are client components.

/**
 * WHICH WINDOW A SURFACE JUDGES A CHECKLIST AGAINST — one rule, stated once,
 * because this is the only place two answers were available.
 *
 *   A CHECKLIST ROW IS JUDGED AGAINST THE WINDOW FROZEN ON IT.
 *   A TEMPLATE WITH NO ROW YET IS JUDGED AGAINST THE WINDOW COMPUTED FOR TODAY.
 *
 * The first half is what `expectedStartAt` / `expectedEndAt` are FOR (plan
 * §2.2): they record the window this row was materialised under, so an offset
 * edited tomorrow cannot rewrite how today was judged. It also keeps the overdue
 * banner and the completed-late badge from contradicting each other — `submit`
 * judges lateness against this same frozen column
 * (`isLateCompletion(checklist.expectedEndAt, …)`), so reading anything else
 * here would let one surface call a checklist late while the other calls it
 * on-time. And it is the only correct answer for a row from a PAST day, which
 * the execution page and the print sheet both render: recomputing today's store
 * hours against last Tuesday's checklist would judge it against a window it
 * never had.
 *
 * The second half is `expectedWindow()` in the lib, called by the store-view
 * route — a template nobody has started has no row and therefore nothing frozen,
 * which is exactly the DEBT-48 scenario the phase exists for (the 11am employee
 * seeing "Opening — Overdue" for a checklist that does not exist yet).
 *
 * BOTH NULLS IS A REAL ANSWER AND IT IS COMMON — AllDay, blank offsets, a store
 * with no hours, or any row predating Migration B. It means NO EXPECTED WINDOW,
 * which is Gary's R3: such a checklist can never be overdue, only completed or
 * missed at day close. Null is never "on time".
 */
export function frozenWindow(row: {
  expectedStartAt: Date | null
  expectedEndAt: Date | null
}): ExpectedWindow | null {
  if (row.expectedStartAt == null && row.expectedEndAt == null) return null
  return { start: row.expectedStartAt, end: row.expectedEndAt }
}

/** What a surface needs to render one checklist's state. */
export interface StatusBadge {
  label: string
  /** Tailwind classes for a pill. Shared so the four surfaces agree. */
  classes: string
}

/**
 * THE VISUAL SPLIT R1 ASKS FOR, and it is the reason these two are not both
 * red: OVERDUE IS LIVE, NAGGING AND STILL COMPLETABLE — warning amber, the
 * colour this app already uses for "needs attention". MISSED IS A CLOSED FACT —
 * flat, grey-red, past tense, nothing to act on. A crew member must be able to
 * tell at a glance which one is still theirs to fix.
 *
 * UPCOMING is deliberately the quietest thing on the card: it is information,
 * not a state anyone has to do something about, and R3 forbids it from reading
 * as a lock.
 */
export const STATE_BADGES: Record<ChecklistState, StatusBadge | null> = {
  upcoming: {
    label: "Upcoming",
    classes: "bg-[var(--color-muted)] text-[var(--color-muted-foreground)] border border-[var(--color-border)]",
  },
  // "Active" is the ordinary state of a checklist inside its day and gets NO
  // pill — a badge on every card is a badge on none. Null rather than absent so
  // the Record stays exhaustive and a new state cannot be added silently.
  active: null,
  overdue: {
    label: "Overdue",
    classes:
      "bg-[var(--color-warning-bg)] text-[var(--color-warning-text)] border border-[var(--color-warning-border)]",
  },
  completed: {
    label: "Completed",
    classes:
      "bg-[var(--color-success-bg)] text-[var(--color-success-text)] border border-[var(--color-success-border)]",
  },
  missed: {
    label: "Missed",
    classes: "bg-gray-100 text-[var(--color-destructive)] border border-gray-300",
  },
}

/**
 * Completed, but after its expected end. SUBTLE ON PURPOSE (plan §5, CHK-4
 * item 4): it is a fact, not a fault. Neutral, no warning colour, and it sits
 * BESIDE the Completed pill rather than replacing it — the checklist was done,
 * and that is the headline.
 */
export const COMPLETED_LATE_BADGE: StatusBadge = {
  label: "Completed late",
  classes: "bg-[var(--color-muted)] text-[var(--color-muted-foreground)] border border-[var(--color-border)]",
}

/**
 * The badge (or badges) for one checklist, resolved through the lib's
 * `checklistState()` and nothing else. Returns an array because
 * completed + completed-late is two pills, and every other state is one or zero.
 */
export function statusBadges(
  checklist: LifecycleChecklist,
  window: ExpectedWindow | null,
  now: Date
): StatusBadge[] {
  const state = checklistState(checklist, window, now)
  const badge = STATE_BADGES[state]
  const out = badge ? [badge] : []
  if (state === "completed" && isCompletedLate(checklist)) out.push(COMPLETED_LATE_BADGE)
  return out
}

/**
 * "10:00 AM" in the store's own timezone. The expected-window instants are
 * absolute; a banner that renders them in the SERVER's zone would tell a Denver
 * closer their window ended at an hour they were not working. Same reasoning as
 * `businessDayWindow` in src/lib/reports.ts, which exists because Vercel runs
 * UTC.
 */
export function formatWindowTime(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(at)
}
