Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/TAB-5.md and run it.

# TAB-5: Tablet mode keeps itself current (all day, and across midnight)

**TIER 2.** Declare the tier before writing anything. No schema, no migrations, no new API routes, no new dependencies. Any of those becoming necessary is a STOP.

## 0. Repo gate

1. Confirm the working directory is the git root `/Users/garythomas/Claude_Projects/Froot/froot` (lowercase `froot`).
2. Confirm the branch is `staging`, the tree is clean, and `origin/staging` includes TAB-3's PRE-PUSH-CHECK commit (`8332266` or later).
3. Paste `git log --oneline -5`.

If any check fails, STOP and report. `docs/prompts/TAB-5.md` is expected to be untracked; leave it unstaged for PRE-PUSH-CHECK.

## 1. Context

Tablet mode (TAB-1 through TAB-3) is on staging and verified. It is not promoted: the series ships together once TAB-5 passes (Gary, 2026-11-10).

The TAB-5 row was filed during TAB-2's fix. Some parts of the tablet go stale on a tablet that's left open, and the header date stays on yesterday after midnight until a reload. These already refresh on a 60-second, visibility-aware timer:

- the Messages column (TAB-2, ruling 8)
- the stat strip (TAB-3)

Both use the shared constant in `src/lib/tablet-messages.ts`. A counter iPad stays on all shift and overnight, so the rest of the tablet home must keep itself current the same way.

**Gary's rulings, 2026-11-10** (he answered "OK. Write TAB-5" to these leans):

1. **Refresh the rest of the screen.** The Tasks panel, the overdue chip and the compliance chip refresh on the same timer as Messages:
   - every 60 seconds while the page is visible
   - immediately when the page becomes visible again
   - never while the page is hidden
2. **New day, new screen.** When the **store's local date** changes, the next refresh reloads the tablet home: the header date, today's checklist (re-chosen by the TAB-1 today's-checklist rule), the chips, the strip and Messages. In the morning the tablet shows today, not last night.
3. **Never interrupt someone mid-task.** If any sheet is open (the name picker, the number pad, the partial-submit confirm, or the overdue or compliance sheet), or a tick, submit or send is in flight, that refresh is skipped. It runs on the next cycle instead. A refresh must never close a sheet, clear typed text, or move a scrolled list.
4. **Other devices show up.** Items ticked on another device (a desktop, or a second tablet) appear on this tablet at the next refresh. The "N done", "n of N" and progress bar follow.
5. **File the Sales-comparison ROW.** Desktop's Sales Performance headline, and the tablet Sales tile that mirrors it, compare today-so-far against **last year's full day**. Every morning it reads as a large drop even when the store is on pace. File it as a planned ROW: "compare today-so-far against last year at the same time of day", affecting both desktop and tablet. **Do not change the calculation in this phase.**

## 2. Brief audit

Answer each point in a few lines, then continue, unless one hits a STOP.

1. **Load path.** How the tablet home loads its data today. What is server-rendered (for example `tablet-data.ts` and the today's-checklist pick) versus fetched on the client. What would re-fetch the Tasks panel and the chips without a full page reload.
2. **Store-local date.** Where Froot gets a store's timezone, and how the TAB-1 today's-checklist rule decides "today". The rollover must use the same source, not the browser's clock or UTC.
3. **Busy state.** Which state already tells you that a sheet is open or a write is in flight, in `tablet-home.tsx`, `tablet-messages.tsx` and `tablet-strip.tsx`.
4. **Timer.** The existing visibility-aware timer and the shared constant. Lean: one shared tablet refresh controller, used by every part of the tablet home, so the parts can't drift apart or fire multiple overlapping timers.

If a reliable store-local date isn't available on the client without a new endpoint, STOP and give your lean.

## 3. Build

1. **One refresh controller** for the tablet home, built on the existing constant and visibility rule.
   - On each cycle it refreshes the Tasks panel, both chips, Messages and the strip.
   - It skips the whole cycle while the page is busy (ruling 3).
   - It never runs two refreshes at once.
2. **Pure logic in a module** (extend `src/lib/tablet-messages.ts` or add `src/lib/tablet-refresh.ts`, your choice, and say which you chose):
   - "should this cycle run?" (visible, not busy, not already refreshing)
   - "has the store-local date changed since the page loaded?"
3. **Day rollover.** When the store-local date has changed, do a full reload of the tablet home data, so the header date, today's checklist, the chips, the strip and Messages all reflect the new day.
   - Use whatever the audit finds is cleanest. A full `router.refresh()` is acceptable if the today's-checklist pick is server-side.
   - If the page was busy at the moment of rollover, the reload waits until it isn't.
4. **Tasks panel refresh.**
   - Re-fetch the current checklist's state so ticks made elsewhere appear.
   - Keep the expanded or collapsed state of "N done" and the scroll position.
   - Keep the "Completing as …" chip. It clears only on submit, reload or a change of checklist, as TAB-1b ruled. A day-rollover reload clears it.
   - If the checklist was submitted on another device, the panel moves to the matching done or partial state.
5. **Chips.** Both re-fetch on the cycle. If a sheet for one of them is open, ruling 3 applies.
6. **Fixture.** Add `scripts/verify-tab5-refresh.ts`, covering:
   - visible and idle → runs
   - hidden → skips
   - busy because a sheet is open → skips
   - busy because a write is in flight → skips
   - already refreshing → skips
   - store-local date unchanged → no rollover
   - store-local date changed → rollover
   - a timezone case where UTC has rolled over but the store's local date hasn't (for example, 5:30 PM Pacific) → no rollover
   - a daylight-saving-change day handled correctly

   Re-run every existing fixture and expect each one to pass with its current count: `verify-tab1-today` 13/13, `verify-tab1c-due-chip` 11/11, `verify-tab2-messages` 23/23, `verify-tab3-layout` 28/28. `verify-tab3-layout` includes the database part on dev, which rolls back.
7. **Local check** on a temporary mocked page, using a shortened interval as TAB-2's fix did. Delete the page before committing. Show that:
   - a tick made "elsewhere" (a change to the mocked data) appears after one cycle
   - an open name sheet survives several cycles untouched
   - typed composer text survives a cycle
   - a scrolled task list stays put
   - a mocked date change triggers the rollover reload
   - nothing refetches while the page is hidden

## 4. Rules

- No schema, no migrations, no new endpoints and no new dependencies.
- `npm run build` and scoped eslint must be green.
- Stage only the files this session touches.
- Commit, never push.

## 5. Commits

1. **Work commit.**
2. **Docs commit.**
   - **`docs/ROADMAP.yaml`:**
     - Move the TAB-5 row to the status the file's conventions give a phase that's built but not yet checked.
     - Add the Sales-comparison ROW (ruling 5).
     - Preserve and mark; delete nothing.
   - **`docs/DECISIONS.md`:** add a DRAFT TAB-5 entry. It records:
     - rulings 1–5, citing Gary's words
     - the controller design
     - any judgement calls

     It is for ratification at PRE-PUSH-CHECK.

## 6. Report

Include:

- the tier
- both SHAs
- the files touched
- the audit answers
- any FIX NOW / RULING NOW / COMMENT / ROW findings
- the staging test list below, unchanged

**Staging test list (Gary, after push):**

1. Safari as `indianathomas` in Tablet mode on Las Brisas, with today's checklist started. In Chrome, tick two items on the same checklist from desktop. Without touching Safari, both appear ticked within about a minute.
2. In Safari, tick an item so the name sheet opens, and leave it open for 2 minutes. It stays open and nothing resets. Pick a name; the tick saves.
3. Type a message in the composer without sending, and wait 2 minutes. The text is still there.
4. Scroll the task list down, and wait 2 minutes. It stays where you left it.
5. Overdue chip. As `indianathomas`, create a Las Brisas reminder dated yesterday, then run the calendar-materialize curl against staging. Without reloading Safari, the chip appears within about a minute.
6. Overnight. Leave Safari open in Tablet mode on Las Brisas tonight. Tomorrow morning, without touching it, the header shows tomorrow's date and today's checklist ("Not started" for the Opener).
