Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/TAB-1c.md and run it.

# TAB-1c: the tablet overdue chip never appears

**TIER 2.** Declare the tier before writing anything. No schema, no migrations, no new API routes, no new dependencies. Any of those becoming necessary is a STOP.

## 0. Repo gate

1. Confirm the working directory is the git root `/Users/garythomas/Claude_Projects/Froot/froot` (lowercase `froot`).
2. Confirm the branch is `staging`, the tree is clean, and `origin/staging` is at or after `e4cdab2`.
3. Paste `git log --oneline -5`.

If any check fails, STOP and report. `docs/prompts/TAB-1c.md` is expected to be untracked. Leave it unstaged for PRE-PUSH-CHECK.

## 1. The bug

TAB-1 (ruling 7) put an overdue chip in the tablet header: it shows this store's overdue count and opens a bottom sheet with the same items the desktop due banner lists (`/api/calendar/due`, `calendar-due-banner.tsx`). Desktop no longer shows the full-width banner in Tablet mode.

Staging evidence, 2026-11-09 and 2026-11-10:

1. **Tommy (STORE) at Las Brisas.** The desktop banner read "You have 2 items to complete · 2 overdue". In Tablet mode, on the same store, there was no chip.
2. **Controlled repro (Gary, 2026-11-10).** As `indianathomas` (ADMIN), Gary created a calendar reminder for **Las Brisas** dated **yesterday**, switched to Tablet, and selected Las Brisas. There was no chip.

The chip has never been seen rendering. Because the full-width banner is suppressed in Tablet mode, overdue items are currently invisible on the tablet. That is a regression, and it blocks promotion.

## 2. Diagnose first

Read the code paths. Do not run queries against any database. Report a short answer for each point:

1. **Where the chip renders.** Name the component and the condition that hides it. List every early return, for example count 0, loading, error, role, or store not resolved.
2. **How the tablet gets the feed.** When and how it calls `/api/calendar/due`, what the response looks like, and whether any part of it is gated by role or module (for example, the calendar module toggle).
3. **How the store filter compares.** Which field the chip compares against which store id: the feed item field (`storeId`, a nested `store.id`, or a store name?) against the store the tablet reads from `src/lib/dashboard-store.ts`. Check:
   - type mismatches (string vs number)
   - a nested vs flat field
   - all-stores or fan-out reminders whose store field is null or shaped differently
   - a localStorage value that is not set until the desktop dropdown has been touched
4. **How "overdue" is decided.** Whether the chip counts overdue the same way the banner does, given DEBT-101's ruling that overdue is counted in days from the due date. Check for a timezone or date-only comparison that would never count a reminder as overdue.
5. **Root cause.** State it in one or two sentences. If there is more than one cause, list each.

If the root cause needs a new endpoint or a change to the due-feed contract that desktop depends on, STOP and give your lean.

## 3. Fix

1. **The chip.** It renders whenever the current store has at least one overdue item in the due feed. Its count must equal what the desktop banner would show for that store.
2. **The sheet.** It lists the same items, with the same actions the banner offers.
3. **Items due today but not yet overdue.** Match whatever the desktop banner does for them. Don't invent a new rule. If the banner shows due-today items, the chip shows them too, labelled the way the banner labels them.
4. **Store resolution.** If the cause includes the store not resolving, fix the resolution in `dashboard-store.ts` so that the rail, the tablet home, the chip and the desktop dropdown still read one value.
5. **Fixture.** Add a characterization check in the style of `scripts/verify-*.ts`, covering the chip's filter and count with:
   - a store-specific overdue reminder
   - an all-stores (fan-out) reminder
   - another store's reminder, which must not be counted
   - a reminder due today
   - a calendar-generated checklist occurrence

   Run it, and re-run `scripts/verify-tab1-today.ts`, expecting 13/13.
6. **Local check.** Verify on a temporary local page with mocked data, as TAB-1 did, and delete the page before committing:
   - the chip appears with the right count
   - the sheet opens and lists the items
   - another store's item is not counted

## 4. Rules

- No schema, no migrations, no new endpoints, no new dependencies.
- `npm run build` and lint must be green.
- Stage only the files this session touches.
- Commit, never push.

## 5. Commits

1. **Work commit,** citing `adec345`.
2. **Docs commit:**
   - `docs/ROADMAP.yaml`: a TAB-1c row, following the lettered-follow-on convention (as TAB-1b did), with the root cause in its notes. Add a pointer rider on the TAB-1 row. Preserve and mark; delete nothing.
   - `docs/DECISIONS.md`: only if the fix needed a judgement call, such as the due-today rule. Add it as a DRAFT rider on the 2026-11-09 TAB-1 entry for ratification. If no call was needed, write nothing there and say so.

## 6. Report

Include:

- the tier
- both SHAs
- the files touched
- the diagnosis answers and the root cause
- any FIX NOW / RULING NOW / COMMENT / ROW findings
- the staging test list below, unchanged

**Staging test list (Gary, after push):**

1. As `indianathomas`, with the Las Brisas reminder dated yesterday still open, switch to Tablet and select Las Brisas. The chip shows the same overdue count the desktop banner shows for Las Brisas.
2. Tap the chip. The sheet lists the reminder, and its actions work the same as on desktop.
3. Switch the tablet store to one with no overdue items. The chip disappears.
4. As Tommy (STORE) at Las Brisas in Tablet mode, the chip appears with the same count as Tommy's desktop banner.
5. Complete the reminder from the sheet. The chip count drops, or the chip disappears at zero.
