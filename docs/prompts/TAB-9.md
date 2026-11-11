Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/TAB-9.md and run it.

# TAB-9 — A Tablet home that scrolls, cards that expand, and an overdue list that opens in place

**TIER 2.** Declare the tier before writing anything. This phase is display-side only and works over payloads that already exist. No schema, no migrations, no new API routes, no new dependencies. If any of those becomes necessary, STOP and give your lean.

**Gary has ruled (see §1).** Run the audit in §2. **STOP only if the audit finds that a ruling can't be built as written.** In that case, report the conflict and give your lean. Otherwise go straight to the build.

**Do not push.** TAB-5's overnight staging test runs against the build currently on staging. Commit only. Gary pushes after he has checked that test.

## 0. Repo gate

1. Confirm the working directory is the git root `/Users/garythomas/Claude_Projects/Froot/froot` (lowercase `froot`).
2. Confirm the branch is `staging`, the tree is clean, and `origin/staging` includes TAB-5's PRE-PUSH-CHECK commit `446d085`.
3. Paste `git log --oneline -5`.

If any check fails, STOP and report. `docs/prompts/TAB-9.md` is expected to be untracked. Leave it unstaged for PRE-PUSH-CHECK.

## 1. Context and Gary's rulings

Tablet mode (TAB-1 through TAB-5) is on staging, verified, and not yet promoted.

**Gary's feedback, 2026-11-10, verbatim:**

> "I think the cards should be more flexible. For example, when you click the 3 overdue items, the iPad screen is locked. Also sales and labor or any other card could be technically larger. Keeping key data at the top, however, allowing you to flick (scroll down) to see more information. If you made the cards larger, you could make the expandable. For example. Leave sales as it is, however, if you expanded the window it would show more details. Then you could scroll down to see that ino [info]."

**What "locked" means, in Gary's words, 2026-11-10, verbatim:**

> "What locked means is that the entire main screen is static. Becuase each card is predevined, there is no data to scroll through. I think this is a wasted opportunity and that the Tablet view mode is forcing everything onto one screen that is locked. Data should be expansive if needed."

**The rulings.** Gary answered "yes to all" to these seven leans. The wording below is the planning chat's; his agreement is what makes them rulings.

1. **The overdue list opens in place.** Tapping the overdue chip expands the "Due at this store" list right on the page, under the header. There is no overlay, nothing is frozen, and the page scrolls past it like any other content. Tapping the chip again closes it. Item actions work the same as they do today.
2. **Cards keep their headline and expand on tap, one at a time.** Each strip tile looks exactly as it does today until it is tapped. Tapping expands it in place. Tapping again, or tapping a "Show less" control, collapses it. Opening one card closes any other.
3. **The home always scrolls.**
   - The first screen opens exactly as it does today: header, then Tasks and Messages, so the crew sees their work first.
   - The page no longer ends at one screen. Below the columns, cards can be as large as their data needs, and you flick down to see more.
   - Collapsing a card returns the page to where it was before that card expanded.
4. **Idle auto-collapse.** An expanded card or the open overdue list collapses after **5 minutes with no touch**, and at the TAB-5 day rollover. It never collapses because of the 60-second refresh. Use TAB-5's busy registration so a refresh never closes or jumps an open card or list.
5. **What expanded cards show.** Only data already in the existing payloads:
   - **Sales:** today hour by hour against last year hour by hour, plus transactions and average sale if the payload carries them. **The ▲/▼ headline calculation does not change; that is TAB-7.**
   - **Monthly goal:** month-to-date amount, the goal, and the amount needed per remaining day.
   - **Labor:** month-to-date %, the target, and the rest of the labor block the payload already carries.
   - Anything that would need new data is filed as its own ROW, not built.
6. **The two chips stop clashing.** The personal HR chip (ComplianceChip, from SELF-1) gets its own **amber or neutral** look, labelled along the lines of **"My HR · 2"**. Only the store's overdue chip (DueChip) stays red and uses the word "overdue". The audit also checks what the HR chip shows for a shared **STORE** login (see §2 point 5).
7. **Expansion is never saved.** Expanded and collapsed state lives in the screen session only. It is not stored in settings, a cookie or localStorage, and it is not synced to other devices.

**Related rows. Read them; don't absorb them:**

- **TAB-3:** the card picker sets which tiles show and in what order. Unchanged.
- **TAB-6:** layout live preview.
- **TAB-7:** same-time-of-day Sales comparison.
- **TAB-8:** checklist-items endpoint.

## 2. Audit

Answer each point in a few lines. STOP only if one of them makes a ruling unbuildable as written.

1. **The current one-screen layout.** Explain how these produce the fixed, non-scrolling home:
   - `tablet-home.tsx` (`grid h-full grid-rows-[auto_minmax(0,1fr)]`)
   - `src/components/layout/tablet-shell.tsx`

   Then say exactly what changes to let the page scroll while the first screen still opens as it does today.
2. **Nested scrolling on iPad.** This is the hard part. The Tasks list and the Messages thread scroll inside themselves today (`overscroll-contain`, plus scroll-snap on section headers). Inside a scrolling page, a flick that starts in a column can get stuck.
   - **Lean:** keep each column at one screen's height with its own scroll, but let a flick carry on into the page once the column reaches its end. In practice that means removing `overscroll-contain` from the columns, or an equivalent.
   - Say what you chose and why.
   - Test it at 1180×820 and 820×1180, including a flick that starts inside each column.
   - If iPad Safari can't be made to chain scrolls reliably, STOP and give your lean.
3. **The overdue list in place.** Where `DueChip` and `BottomSheet` are used, and how the list becomes an in-page panel. The bottom sheet stays available for the name picker, the number pad and partial submit, which are unchanged.
4. **Detail available without a new endpoint.** For each tile, list what `GET /api/dashboard/summary` already returns beyond the one number shown. Name any desktop card components (`sales-performance-card.tsx`, Monthly Goal, Labor) whose detail rendering can be reused.
5. **The HR chip on a STORE login.** What ComplianceChip counts and for whom. On a shared STORE account, does it show the store account's own items, or a person's? If it isn't meaningful on a counter tablet, say so as a RULING NOW item for Gary. Don't remove it yourself.
6. **Busy and idle.**
   - How an expanded card, the open overdue list and a page scrolled away from the top register with the TAB-5 refresh controller.
   - How the 5-minute idle timer resets on touch.

## 3. Build

Build exactly the seven rulings. Keep these regardless of design:

- **Touch sizes** follow TAB-1: targets of at least 56px, body text of at least 18px.
- **Permissions stay the payload's.** An expanded card never shows a field the collapsed tile's gate would hide. If `labor` is absent, there is no Labor card at all, collapsed or expanded.
- **A failed refresh keeps what is on screen.** A refresh that fails never blanks or collapses anything.
- **Desktop is untouched.**
- **Fixture.** Add `scripts/verify-tab9-cards.ts` covering:
  - one-expanded-at-a-time
  - the detail rows built from a payload
  - the labor gate, so an expanded card never exposes a hidden field
  - idle collapse after 5 minutes
  - no collapse on a refresh cycle
  - collapse at day rollover
  - the chip labels and styles

  Re-run every existing tablet fixture and expect each one to pass with its current count:
  - `verify-tab1-today` 13/13
  - `verify-tab1c-due-chip` 11/11
  - `verify-tab2-messages` 23/23
  - `verify-tab3-layout` 28/28, including its database part on dev, which rolls back
  - `verify-tab5-refresh` 32/32
- **Local check.** Use a temporary mocked page and delete it before committing. At iPad landscape and portrait, show that:
  - the first screen looks as it does today
  - the page flicks down to the cards and back
  - flicks starting inside the Tasks and Messages columns don't get stuck
  - each card expands and collapses, one at a time
  - the overdue list with 15 or more rows opens in place and scrolls with the page
  - an expanded card survives several refresh cycles, using a shortened interval
  - an expanded card collapses after the idle time, using a shortened timer
  - the chips look distinct

## 4. Rules

- No schema, no migrations, no new endpoints, no new dependencies.
- `npm run build` and scoped eslint must be green.
- Stage only the files this session touches.
- Commit, never push. Report it as "committed, NOT pushed".

## 5. Commits

1. **Work commit.**
2. **Docs commit:**
   - **`docs/ROADMAP.yaml`:**
     - Add the TAB-9 row after TAB-8, using the status the file's conventions give a phase that's built but not yet checked.
     - Its notes quote both of Gary's statements above verbatim, plus his "yes to all".
     - Preserve and mark; delete nothing.
     - ROADMAP.yaml is typechecked at prebuild, so build after this commit.
   - **`docs/DECISIONS.md`:** add a DRAFT TAB-9 entry with:
     - rulings 1–7, with Gary's quoted words, labelling the lean wording as the planning chat's
     - the nested-scroll approach
     - any judgement calls

     It's for ratification at PRE-PUSH-CHECK.

## 6. Report

Include:

- the tier
- both SHAs
- the files touched
- the audit answers
- any FIX NOW / RULING NOW / COMMENT / ROW findings
- the staging test list below, unchanged

**Staging test list (Gary, after push).** Use Safari as `indianathomas` in Tablet mode on Las Brisas, with Sales, Monthly goal and Labor turned on in Display settings.

1. The first screen looks exactly as before: header, Tasks and Messages.
2. Flick down. The page scrolls to the cards below. Flick back up.
3. Start a flick inside the Tasks list and inside the Messages thread. When each reaches its end, the page keeps scrolling and nothing gets stuck.
4. Tap Sales. It expands in place with hourly detail. Tap Monthly goal, and Sales collapses as Goal expands. Tap again to collapse.
5. Tap the overdue chip. The list opens in place under the header, with nothing frozen, and you can scroll past it. Tap the chip again to close it.
6. Expand a card and wait 2 minutes. It stays open and nothing jumps. Wait 5 minutes without touching. It collapses by itself.
7. The HR chip is amber or neutral and reads something like "My HR · 2". Only the store overdue chip is red.
8. As Tommy (STORE): check what the HR chip shows and whether it makes sense on a shared counter tablet. Confirm the Labor card doesn't appear for any login that can't see labor on desktop.
