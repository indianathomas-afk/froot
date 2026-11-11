TIER 2 · TAB-11 · Team Messages — tablet two-pane (Option 2)

Repo: /Users/garythomas/Claude_Projects/Froot/froot · Branch: staging (stacks on unpromoted TAB-4/8/7/10) · Commit only, never push.

## Goal
In Tablet mode, rebuild the Team Messages page as a touch-first two-pane layout (Claude Design canvas "Froot Tablet Messages" → frames "A · Option 2"). Same features, same data — bigger targets, nothing wraps, composer always in view. Desktop mode is untouched.

## Rulings (Gary, 2026-11-11)
- R1 — Tablet mode only. The desktop Team Messages page stays exactly as it is.
- R2 — Landscape (1024px wide and up) is two panes. Narrower (iPad portrait) is one column: header band, then the feed, then the composer pinned at the bottom.
- R3 — On the tablet, General is listed first in every type list (filters and picker) because it's the default. Desktop order doesn't change.
- R4 — On the tablet, the message type goes back to General after every post.
- R5 — No new features. No schema, API or permission changes. Same feed order, status options, reactions and delete rules as desktop, and only controls desktop already has.

## Before building (brief audit — report in 10 lines or fewer, then build)
1. `git status` clean on staging (untracked files in docs/prompts/ are fine). Read CLAUDE.md.
2. Find the Team Messages page and its components/hooks. Find how Tablet mode is detected (TAB-1's per-device switch) and how other screens branch on it.
3. Confirm from code: the 7 types and their icons; the status filter's options; whether desktop resets the type after posting; whether corporate updates can be hidden beyond "Show 1 more"; how reaction counts display; who can delete.
4. Find the existing Popover / Select primitives (Froot UI is Radix-based).

If anything contradicts R1–R5 → STOP as RULING NOW, with your suggested wording.

## Build
Branch the page on Tablet mode and render a new layout over the same state and hooks — no duplicated fetch or post logic. Use existing Froot tokens (`var(--color-*)`); no new colors beyond the corporate-card gradient Tablet mode already uses.

### Landscape (1024px and up)
- Rail (existing) | left panel 372px wide, own scroll | feed pane fills the rest, own scroll. Composer pinned to the bottom of the feed pane.
- Left panel, top to bottom:
  - "Team Messages" 28px/700, existing subtitle 15px muted.
  - Corporate updates card (same look as the tablet home's pinned update): label, title 18px/700, body 15px, "Posted <date>" 14px/600. "Show 1 more" as a full-width 44px pill. Add a 44×44 collapse chevron only if desktop already supports hiding updates (audit item 3).
  - TYPE: legend 13px caps muted; 2-column grid of 8 chips — All types, then the 7 types in R3 order — 48px pills, icon 18px + label 15px. Selected = dark fill (`--color-foreground` background, white text). Same filter behavior as desktop.
  - STATUS: legend, then a full-width 48px button "Any status ⌄" opening the existing options as 48px rows.
- Feed — message cards, 12px gap, pane padding 20px top / 24px sides:
  - Avatar 44px circle (existing colors) · name 18px/700 · time 15px muted · type badge pill 30px tall (icon 16px + label 14px/600, `--color-secondary` background + border) · trash 44×44 at the right, only where allowed today.
  - Body 18px, line-height 1.4.
  - The six reactions (👍 🎉 ❤️ 😂 👀 🙏) as pills 44px tall, at least 56px wide, emoji 22px, 8px gap. Reacted = tinted with count; otherwise as desktop.
- Composer (card background, top border + soft shadow, padding 12px / 24px / 16px):
  - Row 1: message box, full width, 52px pill, placeholder "Share with the team…", grows to about 4 lines while typing.
  - Row 2: Type button (48px pill: "Type" muted + type icon + type name + chevron) · Photo / File / Video (48px pills, icon + label) · spacer · Post (48px, primary, 19px/700, disabled state as desktop shown at 50% opacity).
  - Type picker: popover anchored above the Type button, about 440px wide. Legend "Message type"; 2-column grid of the 7 types (R3 order), 52px rows, icon + label; current type tinted with a check. Tap a type → select and close. Tap outside → close.

### Portrait / narrow (under 1024px)
- One column: header band (title, subtitle, corporate card, then one row of type chips that scrolls sideways with a fade at the right edge, plus the status button fixed at the row's end) → feed with full-width cards → the same composer pinned at the bottom.

### Touch and iPad rules
- Everything tappable is at least 44×44. Body text at least 17px (meta and labels excepted).
- When the iPad keyboard opens, the composer stays visible directly above it (handle visualViewport / dvh — nothing pinned ends up behind the keyboard).
- Only the panes scroll; the page itself doesn't. No sideways page scroll in either orientation.

## Out of scope
Choosing a message type on the tablet home composer (its own phase). Desktop Team Messages. Notifications, unread logic, schema, APIs.

## Finish
- `npm run build` must pass — chain it with the commit. Stage only the files you touched (no `git add -A`).
- Commit 1 (work): `TAB-11: Team Messages tablet two-pane`.
- Commit 2 (docs): ROADMAP row TAB-11 (read the file for format and placement — never assume the next free id) and R1–R5 in DECISIONS.md, citing the work SHA.
- Out-of-scope findings classified FIX NOW / RULING NOW / COMMENT / ROW.
- Report: both SHAs, files touched, audit answers, anything you couldn't match to this spec and why, and the staging tests below.

## Staging tests (Gary — iPad, Tablet mode)
1. Switch to Desktop mode → Team Messages looks exactly as before.
2. Landscape: two panes; the feed scrolls on its own; the composer never scrolls away.
3. Tap the Shortage chip → only Shortage messages. The status button filters too. All types resets.
4. Type → Shortage → post "TAB-11 test" → it appears with a Shortage badge, and Type is back to General.
5. Photo, File and Video each attach and post.
6. Reactions are easy to hit with a fingertip; tapping one updates its count.
7. "Show 1 more" works; the trash icon appears only where it did on desktop.
8. Rotate to portrait: one column, type chips scroll sideways, status button visible, composer pinned.
9. Tap the message box: the keyboard opens and the composer stays visible above it.
