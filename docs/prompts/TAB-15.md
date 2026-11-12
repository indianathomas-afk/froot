TIER 2 — TAB-15: Training how-tos on tablet checklist tasks (Tablet mode only — desktop unchanged)

Repo: /Users/garythomas/Claude_Projects/Froot/froot
House rules: /Users/garythomas/Claude_Projects/Froot/froot/CLAUDE.md applies in full — evidence standards, build gate, commit only, never push.
Design: the PDF attached to the launch message ("Tablet checklist — training resources"). This phase is A1 (checklist with Watch/Guide pills), A2 (How-to panel), A3 (full-screen video) and B (portrait inline expand). A4, C1 and C2 (Ask a manager) are TAB-16 — not this session.

## Why
On desktop, a task's training (video or document) shows under the task as "Watch Training Video". Tablet mode never got it, so a team member who doesn't know how to do a task has nowhere to look. Add it to the tablet without cluttering the list.

## Step 0 — before writing anything
1. Read /Users/garythomas/Claude_Projects/Froot/froot/docs/ROADMAP.yaml. Confirm TAB-15 is free. If it's taken, STOP and report the next free TAB id.
2. Read the design PDF. Every name, file name, duration and time in it is sample data — never hard-code any of it.

## Step 1 — short audit (report it, then keep going; stop only for a RULING NOW)
Answer each with file:line:
a. Desktop: where /store-view/checklist/[id] renders "Watch Training Video" and the document download. Which fields carry the resources, can a task have more than one, and what happens when each type is tapped (embed, new tab, download)?
b. Tablet Home checklist: does its payload already include those fields? If not, the smallest change that adds them, behind the same permission checks desktop uses.
c. Tablet tick path: how a tick records completion today, including the "Who completed this task?" picker (TAB-1b) and partial submit.
d. How TAB-5's refresh skip ("while a sheet or write is busy") and TAB-9's 5-minute idle collapse detect open UI.
If a schema change looks necessary, that's a RULING NOW — STOP. This phase is TIER 2.

## Step 2 — build (Tablet mode only)
1. How-to pill on task rows (A1). Only on unticked tasks with at least one resource. Video → play icon + "Watch". Document only → file icon + "Guide". More than one resource → "+N" badge. 44px tall, sits left of the tick circle, never replaces it. Tasks with no resources look exactly as they do today. The pill is the only new way in; the tick circle keeps its current behaviour.
2. How-to panel, landscape (A2). Tapping the pill swaps the Messages column for a How-to panel in the same spot, so the checklist stays visible. The row gets a highlighted state and its pill turns solid and reads "Open". Panel content, top to bottom: "HOW-TO" eyebrow, task title, checklist name plus estimated time if the task has one, the video (16:9, play button, full-screen button) when present, each document as a row with an Open button, then a full-width primary "Mark done" pinned to the bottom. Close (X) brings Messages back.
3. Full-screen video (A3). Play or the full-screen button opens a full-screen player: "Back to checklist" top-left (returns to the panel), task title centred, "Open guide" top-right when the task has a document, and a bottom bar with "Watch again" and "Mark done".
4. Mark done — from the panel or the player — goes through the exact tablet tick path from audit (c), including the "Who completed this task?" picker. No new completion path. Afterwards, close the panel/player and return to the list. A1's "done · 25 of 38" toast with Undo: build it only if an un-tick path already exists; otherwise skip it and say so.
5. Portrait (B). Tablet portrait is one column (TAB-11), so no side panel: tapping the pill expands the row in place — video thumbnail on the left, document row and "Mark done" on the right; the pill reads "Hide". One row open at a time.
6. Leave room for TAB-16: in the panel (above Mark done), the player's bottom bar, and B's expanded row, the "Ask a manager" button will go. Don't render it yet.

## Guardrails
- Desktop mode unchanged. List every file touched and confirm none changes desktop behaviour.
- Media: play videos the way desktop does. Use playsinline on <video> so the panel plays inline on iPad. If desktop resources are links (e.g. YouTube), embed only when the URL is embeddable, otherwise open the link — report which you found.
- Home-screen app (PWA-1): Froot runs standalone with no Safari chrome. Opening a document or link must never strand the user with no way back — never navigate the app's own window away. Say how you handled it.
- An open How-to panel, player or expanded row counts as "a sheet is open" for the TAB-5 refresh skip. TAB-9 idle (5 min) closes it and returns the page to the top.
- Froot UI tokens only (var(--color-*)), no raw hex. Touch targets at least 44px.
- Permissions unchanged: the tablet shows exactly the resources desktop shows the same login.
- Planned cleanup carried from PWA-1: remove the stale "DRAFT ruling R1" comment in standalone-tablet-default.tsx.

## Done when
- npm run build passes; two commits per CLAUDE.md (work, then docs citing the work SHA); a TAB-15 row in ROADMAP.yaml.
- Report: audit answers with file:line, files changed, anything skipped and why, out-of-scope findings classified FIX NOW / RULING NOW / COMMENT / ROW.
- Staging test list for Gary's iPad (home-screen app), at minimum:
  1. A task with a video shows "Watch"; a document-only task shows "Guide"; a task with nothing attached is unchanged.
  2. Landscape: the pill opens the panel in place of Messages; X brings Messages back.
  3. The video plays inline in the panel and full screen; Back returns to the panel.
  4. Mark done (panel and player) asks "Who completed this task?" and ticks the task; the progress count updates.
  5. A document opens and there's a way back inside the home-screen app.
  6. Portrait: the row expands in place, one at a time.
  7. The desktop checklist page looks and behaves exactly as before.
