Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/TAB-2b.md and run it.

# TAB-2b: the floating help button covers the tablet Send button

**TIER 2.** Declare the tier before writing anything. No schema, no migrations, no new routes, no new dependencies.

## 0. Repo gate

1. Confirm the working directory is the git root `/Users/garythomas/Claude_Projects/Froot/froot` (lowercase `froot`).
2. Confirm you are on branch `staging` with a clean tree, and that `origin/staging` includes TAB-2's PRE-PUSH-CHECK commit.
3. Paste the output of `git log --oneline -5`.

If any check fails, STOP and report what failed. `docs/prompts/TAB-2b.md` is expected to be untracked, so leave it unstaged for PRE-PUSH-CHECK.

## 1. The bug

TAB-2 is staging-verified (Gary, 2026-11-10). One defect remains. The floating round **?** help button (HELP-1, bottom-right of every page) sits on top of the Messages column's Send button in Tablet mode, in both landscape and portrait. On a counter iPad, a tap meant for Send can open Help instead.

Ignore the dark round button on the right edge, mid-height. That is Vercel's preview toolbar. It only exists on staging deployments, not in production.

## 2. Fix (planning-chat lean, for Gary to ratify)

1. **Tablet mode only:** the floating help button does not render.
2. **Help moves into the tablet rail:** add a **Help** icon to the rail, above Settings. It is visible to every role, the same as the floating button is today, and tapping it does exactly what the floating button does.
3. **Desktop mode is unchanged.** The floating button stays where it is.

Audit first, in a few lines each:

- which component renders the floating help button
- where it is mounted
- what tapping it does (opens a panel, or navigates)

If the panel it opens can't be triggered from the rail without new plumbing beyond a shared open handler, STOP and give your lean.

## 3. Rules

- `npm run build` and scoped eslint must be green.
- Re-run all three fixtures and expect these counts: `verify-tab1-today` 13/13, `verify-tab1c-due-chip` 11/11, `verify-tab2-messages` 23/23.
- Check the fix on a temporary local page, then delete the page before committing. At 1180×820 and 820×1180, confirm:
  - nothing overlaps Send
  - the rail Help icon opens Help
  - Desktop mode still shows the floating button
- Stage only the files this session touches.
- Commit, never push.

## 4. Commits

1. **Work commit.**
2. **Docs commit:**
   - `docs/ROADMAP.yaml`: add a TAB-2b row, following the lettered-follow-on convention.
   - `docs/DECISIONS.md`: add a DRAFT rider on the TAB-2 entry recording the help-in-rail lean, for ratification.

   Preserve and mark; delete nothing.

## 5. Report

Include:

- the tier
- both SHAs
- the files touched
- the audit answers
- any findings
- the staging test list below, unchanged

**Staging test list (Gary, after push):**

1. In Tablet mode, landscape and portrait: there is no floating **?** button, and nothing covers Send.
2. Tap **Help** in the rail. Help opens, the same as the floating button did.
3. Switch to Desktop mode. The floating **?** button is back in its usual place and works.
