TIER 2 · TAB-12 · Tablet home — choose a message type (V1: type tag in the composer)

Repo: /Users/garythomas/Claude_Projects/Froot/froot · Branch: staging (stacks on unpromoted TAB-4/8/7/10/11) · Commit only, never push. Confirm TAB-12 is free in docs/ROADMAP.yaml first; if it's taken, stop and say so.

## Goal
Let crews flag a note's type (Shift Note, Shortage, Equipment, etc.) from the Messages column on the Tablet home without cluttering it. Add a small type tag inside the "Message the team…" box. It opens the same type picker TAB-11 built for Team Messages. Reference: Claude Design canvas "Froot Tablet Messages", row "V1 · Type tag inside the composer" (at rest, composing, picker open, posted, portrait).

## Rulings (Gary, 2026-11-11)
- R1 — The tablet home's message box gets a small type tag on the left that starts at General. Tapping it opens the same type picker as Team Messages.
- R2 — Quick replies (On it / Done / Thanks) always post as General.
- R3 — After every post, the tag goes back to General.
- R4 — In the home Messages feed, only messages that aren't General show a type badge, so the home screen looks the same as today until someone flags a note.
- R5 — Type only. Type-specific extras like the Shortage ingredient link or shift phase stay on the Team Messages page. No schema, API or permission changes; Desktop mode is untouched.

## Before building (brief audit — report in 10 lines or fewer, then build)
1. `git status` clean on staging (untracked files in docs/prompts/ are fine). Read CLAUDE.md.
2. Find the home Messages column (tablet-messages.tsx) and how it posts. Does it already use TAB-11's shared composer hook (useComposer)? Find TAB-11's Type button and picker in messages-tablet.tsx, and TABLET_TYPE_ORDER.
3. Confirm from code: what type quick replies post as today; whether any type needs more than `type` to post (for example, Shortage requiring an ingredient, or Shift Note requiring a shift phase); whether any role is limited to certain types.
4. Find where home feed rows render the name and time line (for the badge).

If any type can't be posted with just `type`, or anything else contradicts R1–R5 → STOP as RULING NOW, with your suggested wording.

## Build
- Move TAB-11's Type button and picker into one shared component used by both the Team Messages tablet layout and the home column. Team Messages must look and behave exactly as it does now. Same TYPE_META icons, same General-first order (TAB-11 R3, R6).
- Home composer:
  - Tag inside the message box on the left: 44px tall pill, type icon 18px + type name 15px/650 + chevron 15px. At rest: `--color-secondary` background with a border. Tinted (primary border + light primary tint, like TAB-11's selected type) when the picker is open or the type isn't General.
  - The box keeps its placeholder "Message the team…". When text wraps to more lines, the tag stays top-left and the text wraps beside it.
  - Send posts through the existing path with the chosen type. The tag returns to General after every post (R3). Quick replies always post as General and leave the draft's tag alone (R2).
- Picker on the home:
  - Anchored above the tag, opening upward, and kept inside the Messages column (about 396px wide at 1180 landscape). If the column is too narrow for two columns, use one.
  - Legend "Message type"; 2-column grid of the 7 types (General first), 48px rows, icon + label; current type tinted with a check. Tap a type → set it and close. Tap outside → close.
  - Fully visible with the iPad keyboard up (reuse the existing keyboard measurement).
- Home feed badge (R4): after "Name · time", a pill 26px tall — icon 15px + type name 14px/650, `--color-secondary` background with a border. Only for types other than General.

### Touch and iPad rules
- Everything tappable is at least 44×44.
- Nothing else on the home moves: checklist column, Sales/Labor tiles, overdue and HR chips, quick replies, Open the feed, corporate update.
- No sideways scroll at any tablet width, landscape or portrait.

## Out of scope
Chips that swap in while typing, type suggestions (V2/V3). Shortage ingredient link and shift phase on the home. Desktop. Any change to how Team Messages looks.

## Finish
- `npm run build` must pass — chain it with the commit. Stage only the files you touched (no `git add -A`).
- Commit 1 (work): `TAB-12: tablet home message type tag`.
- Commit 2 (docs): ROADMAP row TAB-12 (read the file for format and placement) and R1–R5 in DECISIONS.md as DRAFT, citing the work SHA.
- Out-of-scope findings classified FIX NOW / RULING NOW / COMMENT / ROW.
- Report: both SHAs, files touched, audit answers, anything you couldn't match to this spec and why, and the staging tests below.

## Staging tests (Gary — iPad, Tablet mode)
1. The home at rest looks like today, plus a small "General ⌄" tag in the message box.
2. Tap the tag → the picker opens above it with the 7 types and General checked. Tap outside → it closes.
3. Choose Equipment, type "TAB-12 test", send → it appears in the home feed with an Equipment badge, and the tag is back to General.
4. Open the feed → the same message shows Equipment there too, and the Equipment filter finds it.
5. Set the tag to Shortage, then tap "Done" → "Done" posts with no badge (General). The tag still says Shortage for your draft.
6. General messages on the home show no badge.
7. Tap the message box: the keyboard opens, and the box and tag stay visible. Open the picker with the keyboard up → it's fully visible.
8. Team Messages (Tablet mode): the Type button and picker look and work exactly as in TAB-11.
9. Desktop mode: home and Team Messages unchanged.
10. Rotate to portrait: the tag and picker fit, with no sideways scroll.
