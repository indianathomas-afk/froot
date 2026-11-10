Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/TAB-2.md and run it.

# TAB-2 — Tablet mode: the Messages column

**TIER 2.** Declare the tier before writing anything. No schema, no migrations, no new API routes, no new dependencies. If any of those becomes necessary, STOP.

## 0. Repo gate

1. Confirm the working directory is the git root `/Users/garythomas/Claude_Projects/Froot/froot` (lowercase `froot`).
2. Confirm the branch is `staging`, the tree is clean, and `origin/staging` includes TAB-1c's PRE-PUSH-CHECK commit.
3. Paste `git log --oneline -5`.

If any check fails, STOP and report. `docs/prompts/TAB-2.md` is expected to be untracked; leave it unstaged for PRE-PUSH-CHECK.

## 1. Context

Tablet mode (TAB-1, TAB-1b, TAB-1c) is on staging and verified. **It is not promoted, and it won't be until the whole series through TAB-3 is done (Gary, 2026-11-10).** TAB-1 left the existing desktop Team Messages card in the tablet's right column as a placeholder. This phase replaces it.

**Design reference:** `/Users/garythomas/Claude_Projects/Froot/froot_docs/design/Froot Tablet Mode.pdf`, Direction 1 · Status Stage. Use the right-hand Messages column in its three landscape artboards and the portrait artboard.

**Gary's rulings, 2026-11-10** (he answered "Yes" to these leans):

1. **Scope:** TAB-2 is the Messages column only. The Sales/Goal/Labor strip moves to TAB-3, together with the setting that turns it on.
2. **Layout:** the Corporate Update pinned at the top, the thread below it, and a large composer fixed at the bottom, matching the Status Stage design.
3. **Quick replies:** "On it", "Done" and "Thanks" post as an ordinary message. They reply to the latest message if Froot's messages support replies; otherwise they post to the feed.
4. **Sender:** tablet messages come from the logged-in account, the same as desktop. The "Completing as" chip stays for tasks only.
5. **Unread:** reuse desktop's unread tracking if it exists. If it doesn't, TAB-2 adds none, and a ROW is filed.

## 2. Brief audit

Answer each point in a few lines, then continue unless one hits a STOP.

1. **Messages data:** the source of the Team Messages card and of `/messages` ("Open the feed"): the endpoint, how it is scoped (org, store, audience), ordering, and page size.
2. **Posting:** which existing endpoint posts a message, and whether STORE, STAFF, MANAGER and ADMIN can each post today. No permission changes.
3. **Replies:** whether messages have threads or a reply-to field. This decides ruling 3.
4. **Corporate Update:** where the desktop Corporate Update card gets its content (model, endpoint, how "current" is chosen, video embed) and who can see it.
5. **Unread:** whether desktop tracks unread messages (the count badge on the desktop Team Messages card suggests it might). If it does: how unread is stored, and what marks a message read.
6. **Store context:** whether the feed follows the store selected in `src/lib/dashboard-store.ts` or is org-wide. The tablet must match desktop.

If ruling 3 or ruling 5 can't be met with existing endpoints, STOP and give your lean.

## 3. Build

Replace the placeholder Team Messages card in the tablet home's right column with a dedicated Messages column. Put it in its own file, not inside `tablet-home.tsx`, which is already long.

### A. Corporate Update, pinned at the top

- The current Corporate Update uses the same source and visibility as the desktop card, in a compact touch-sized card. Include the video thumbnail if there is one; tapping it behaves as it does on desktop.
- If there is no current update, the pinned area doesn't render.

### B. The thread

- Show the same messages, in the same order and scope, as the desktop card. Put the newest at the bottom, next to the composer, if that matches how desktop reads. Otherwise match desktop's order and say which order you used.
- Text is at least 18px, with name and time on each message.
- The column scrolls on its own, using `overscroll-behavior: contain` as the Tasks column does. On load and after posting, it scrolls so the newest message is visible.
- Keep an "Open the feed" link to `/messages`.

### C. Unread

- **If desktop tracks unread** (audit point 5): show the same count on the column header and on the rail's Messages icon, and mark messages read exactly the way desktop does. No new read rules.
- **If desktop doesn't:** add nothing, and file the ROW.

### D. The composer, fixed at the bottom

- A large text field with a touch-size Send button. Above it, a row of three quick-reply buttons: **On it**, **Done**, **Thanks**.
- Quick replies follow ruling 3. Each one posts as soon as it's tapped, with no confirmation step.
- Every message goes through the existing posting endpoint as the logged-in account (ruling 4).
- **While sending**, disable Send and the quick replies so one tap can't post twice.
- **On failure**, keep the typed text and show an error.
- **The iPad keyboard:** when it opens, the composer must stay visible above it, not hidden underneath. Use the `visualViewport` API, or an equivalent that works in iPad Safari and in the Add-to-Home-Screen standalone app. Check it in Safari's Responsive Design Mode, and say plainly that this needs confirming on a real iPad.

### E. Portrait

- Messages stack below Tasks, as on the portrait artboard, with the composer still reachable.

### F. Out of scope

- The stat strip (TAB-3).
- Message editing or deleting, attachments, @mentions, and push notifications.
- The calendar and compliance chips (TAB-1c), which stay as they are.

## 4. Rules

- No schema, no migrations, no new endpoints, no new dependencies.
- `npm run build` and lint must be green.
- Re-run `scripts/verify-tab1-today.ts` (13/13) and `scripts/verify-tab1c-due-chip.ts` (11/11).
- If you write new pure logic, for example choosing the quick-reply target, add a `scripts/verify-*.ts` characterization fixture for it and run it.
- Verify on a temporary local page with mocked data, as TAB-1 did, and delete it before committing. Check:
  - the pinned update renders, and is absent when there's none
  - the thread scrolls to the newest message
  - a typed message posts
  - each quick reply posts once, even when double-tapped
  - a forced failure keeps the text
  - portrait stacks correctly
  - the composer stays visible with a simulated small viewport
- Stage only the files this session touches. Commit; never push.

## 5. Commits

1. **Work commit.**
2. **Docs commit:**
   - **`docs/ROADMAP.yaml`:** the TAB-2 row, with the status the file's conventions give a phase that is built but not yet checked. Add a dated rider on the TAB-2 and TAB-3 rows saying the stat strip moved to TAB-3 per Gary's 2026-11-10 ruling. Add an unread ROW if audit point 5 found none. Preserve and mark; delete nothing.
   - **`docs/DECISIONS.md`:** a new DRAFT entry for TAB-2 with rulings 1–5 as listed in section 1, citing Gary's "Yes", plus any judgement calls you made (for example, the thread order). Mark it as awaiting ratification at PRE-PUSH-CHECK.

## 6. Report

Include:

- the tier
- both SHAs
- the files touched
- the audit answers
- any FIX NOW / RULING NOW / COMMENT / ROW findings
- the staging test list below, unchanged

**Staging test list (Gary, after push):**

1. Tablet mode, as `indianathomas`: the Corporate Update is pinned at the top of the Messages column, the thread shows the same messages as the desktop card, and the newest message is visible.
2. Type a message and tap Send. It appears in the thread, and on desktop's Team Messages card from the same account.
3. Tap **On it**, then double-tap **Thanks**. Each one posts exactly once, as a reply or to the feed as the report says.
4. As Tommy (STORE), post from the tablet. The message shows Tommy's account as the sender on desktop.
5. Unread: if the report says desktop tracks unread, a new message from another account raises the count on the column and the rail icon, and reading it clears the count the way desktop does.
6. Safari Responsive Design Mode, at iPad 1180×820 and 820×1180: the column fits, portrait stacks it under Tasks, and the composer is reachable.
7. On a real iPad, if you have one: tap the composer. The keyboard opens, and the composer stays visible above it.
