Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/TAB-1b.md and run it.

# TAB-1b — Tablet mode: "who completed this" parity + partial submit

**TIER 2.** Declare the tier before writing anything. No schema, no migrations, no new API routes, no new dependencies. Any of those becoming necessary is a STOP.

## 0. Repo gate

1. Confirm the working directory is the git root `/Users/garythomas/Claude_Projects/Froot/froot` (lowercase `froot`).
2. Confirm the branch is `staging`, the tree is clean, and `origin/staging` is at or after `9a4d607`.
3. Paste `git log --oneline -5`.

If any check fails, STOP and report. `docs/prompts/TAB-1b.md` is expected to be untracked; leave it unstaged for PRE-PUSH-CHECK.

## 1. Context

TAB-1 (`adec345`, `d5a9094`, `c83a5c3`, check `9a4d607`) is on staging. Staging testing on 2026-11-09 found two gaps between the tablet and desktop checklist (`/store-view/checklist/[id]`):

1. **Attribution.** Desktop asks **"Who completed this task?"** on each task, with a list of names (generic "Team Member" and "Manager" options, then staff). Tablet ticks skip this, so they record no person.
   - TAB-1's ruling 6 said tablet attribution was "same as today". That premise was wrong, because today desktop already records a person.
   - Gary, 2026-11-09: "Agreed, fix it."
2. **Partial submit.** Desktop offers **Submit Partial (n/N)**. Tablet only offers Submit once every item is ticked, so a crew that can't finish has no way to file from the tablet, and day close marks the checklist Missed.

Out of scope: the overdue chip. Gary paused it on 2026-11-09 because he couldn't reproduce it. Don't touch it.

Design reference, unchanged: `/Users/garythomas/Claude_Projects/Froot/froot_docs/design/Froot Tablet Mode.pdf` (Direction 1 · Status Stage).

## 2. Brief audit

Answer each point in a few lines, then continue unless one hits a STOP.

1. **Desktop picker:**
   - which component renders "Who completed this task?"
   - where its name list comes from, including the generic options and how it is scoped to the store
   - whether a pick is required before a tick, optional, or depends on a template or task setting
   - whether the picker opens before the tick or after it
   - which field of the existing task-log request carries the pick
2. **Tablet today:** confirm from the code that TAB-1's tablet ticks send no attribution. Say what value they leave in that field (null, or something else).
3. **Partial submit:** which request desktop's Submit Partial sends, any confirmation it shows, and what status it leaves the checklist in.
4. **Temperature tasks:** how a pick combines with the TAB-1 number-pad sheet on desktop, so the tablet can match it.

If the desktop rule can't be reproduced with existing endpoints, STOP and give your lean.

## 3. Build

### A. Attribution on the tablet

The rule (required, optional, or per task) is **exactly desktop's**, with the same list and the same field. The only difference is how the tablet asks:

1. **First tick of a checklist.** A bottom sheet opens titled "Who's completing these?", showing desktop's list as a two-column grid of touch-size buttons in the same order. If the list is long enough to scroll, add a search box at the top. Tapping a name ticks the item as that person, in one tap with no extra confirm.
2. **After that.** A sticky chip sits under the dark banner: **"Completing as Adam Solin · Change"**. Following ticks use that person without opening the sheet. **Change** reopens the sheet.
3. **The chip clears** on submit, on a page reload, and when the panel moves to a different checklist. It lives in React state only, not in a cookie or localStorage, so it never carries across days or devices.
4. **Temperature tasks:**
   - With a person already chosen, the number pad opens as in TAB-1.
   - With nobody chosen yet, the name sheet comes first, then the number pad.
5. **Unticking** follows desktop's behaviour for the attribution field.

This sticky-person design is a planning-chat lean. It goes in the DECISIONS draft for Gary to ratify.

### B. Partial submit

1. **The link.** A small secondary text link, **"Submit partial (n of N)"**, sits under the task list while at least one item is ticked and not every item is ticked. The big orange Submit from `c83a5c3` stays reserved for the all-ticked case.
2. **Confirmation.** Tapping the link opens a bottom sheet: "Submit with M tasks unfinished?", with a touch-size **Submit partial** button and a **Keep going** button. It sends the same request desktop's Submit Partial sends.
3. **On success.** The panel shows a calm done state labelled **"Submitted partial · n of N"**, not the green all-done state.
4. **On failure.** It shows the error and keeps the sheet open, using the same failure handling as `c83a5c3` for a response that doesn't land in the expected status.

## 4. Rules

- No schema, no migrations, no new endpoints, and no new dependencies. Any of those is a STOP.
- `npm run build` and lint must be green.
- Run `scripts/verify-tab1-today.ts` and expect 13/13.
- Stage only the files this session touches, and commit without pushing.
- Check the flows on a temporary local page with mocked data, as TAB-1 did, and delete the page before committing:
  - the first tick opens the sheet
  - picking a name ticks the item
  - the chip appears
  - a second tick doesn't open the sheet
  - Change reopens the sheet
  - a temperature task with no person chosen shows the sheet, then the pad
  - partial submit confirms, then shows the partial done state
  - a forced partial-submit failure keeps the sheet open

## 5. Commits

1. **Work commit**, citing `adec345`.
2. **Docs commit:**
   - `docs/ROADMAP.yaml`: read the file's conventions. Add TAB-1b, or a rider on the TAB-1 row, whichever the file's conventions say. Add a dated rider to the TAB-4 row saying that the per-task attribution mechanism already exists on desktop and TAB-1b brings the tablet to parity, so TAB-4 is narrowed to anything beyond parity (for example, a per-person PIN). Preserve and mark; delete nothing.
   - `docs/DECISIONS.md`: a DRAFT rider on the 2026-11-09 TAB-1 entry. It must:
     - correct ruling 6's premise and quote Gary's "Agreed, fix it."
     - record the sticky-person design
     - record partial submit, with Gary's words to be added at PRE-PUSH-CHECK
     - note that the overdue chip is paused per Gary, 2026-11-09

## 6. Report

Include:

- the tier
- both SHAs
- the files touched
- the audit answers
- any FIX NOW / RULING NOW / COMMENT / ROW findings
- the staging test list below, unchanged

**Staging test list (Gary, after push):**

1. As Tommy in Tablet mode, open a checklist that hasn't been started and tick one item. The name sheet opens. Pick a name. The item ticks, and the "Completing as …" chip appears.
2. Tick two more items. No sheet appears. On desktop, open the same checklist and confirm all three items show that name.
3. Tap Change, pick a different name, and tick one more item. Desktop shows the new name on that item only.
4. If there's a temperature task, tick it. The number pad opens. Enter a value, and desktop shows the value and the name.
5. With some items unticked, tap "Submit partial" → Keep going: nothing is sent. Tap it again → Submit partial: the panel shows "Submitted partial · n of N", and desktop shows the checklist submitted as partial.
6. Reload. The chip is gone, and the next tick on a new checklist asks again.
