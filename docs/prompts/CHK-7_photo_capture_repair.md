# CHK-6 — Take Photo repair — TIER 2

TIER 2: contained. A checklist photo capture that does not work on the floor.
Diagnose first, then fix within the client/route layer. Do NOT push.

## ESCALATION STOP — read before anything
If the root cause turns out to be a PERMISSION check or a SCHEMA/data-write
problem, this is TIER 3, not TIER 2. STOP, report the finding, and wait for
Gary. Do not fix it under this prompt.

## Repo gate (one command at a time, paste each result)
pwd            -> must end in Froot/froot
git status     -> on staging, tree clean
Read docs/ROADMAP.yaml. Report the actual next free phase ID. Do not assume
CHK-6 is free — the file wins over this prompt's header.

## Step 1 — map the path (read-only, no edits)
Find and print, with file paths and line numbers:
  a. The store-view execution client component that renders the Take Photo
     button (/store-view/checklist/[id]).
  b. The input element behind it — type, accept, capture attributes.
  c. The upload route it calls. Print the route handler in full.
  d. The MIME allow-list and any size cap, client-side and server-side.
  e. Where TaskLog.photoUrl is written, and what gates that write.
Report as a table: layer / file:line / what it does.

## Step 2 — name the failure
Against the map, evaluate these four in order and say which one it is,
with the line that proves it:
  1. HEIC rejection — does the allow-list include image/heic and image/heif?
     iPhone default capture is HEIC. If not, every phone photo fails.
  2. Body size — does the route accept a FormData POST server-side? If so it
     is subject to the ~4.5 MB request cap and a phone photo can exceed it.
     Is there a client-side downscale or a presigned direct-to-blob path?
  3. Silent failure — is there a catch that swallows the error without
     surfacing it to the user?
  4. Blob token — which env var does this route resolve, and by what
     function? Name it. Do NOT run `vercel env pull` (banned, CLAUDE.md).
If it is none of these, say so and state what it actually is.
If the answer is (permission) or (schema), hit the ESCALATION STOP above.

## Step 3 — fix, minimally
Fix only the named cause. No refactor, no drive-by improvements, no touching
the template attachment route or the HR blob paths.
Two requirements on any fix:
  - The failure must become VISIBLE. A rejected or failed upload shows the
    staff member why, at the task, in plain words. Silent refusal is half
    the bug.
  - If the cause is HEIC or size: state in the report whether you converted,
    widened the allow-list, or downscaled client-side, and why. If that
    choice has a tradeoff, name it — do not just pick.

## Step 4 — prove it
Do not claim deployed verification. State the exact evidence Gary should
capture on staging after push, per the browser-evidence standard (org ID +
Clerk instance named), including the device to shoot it on: a real iPhone
photo through a real photo-required task, not a desktop file picker.

## Step 5 — commits
Two-commit pattern.
  Commit 1 — code. `npm run build` must pass. Lint is not a gate (DEBT-33).
  Commit 2 — docs. Roadmap row with commit 1's short SHA quoted,
             preserve-and-mark intact, no meta.updated key. DEPLOY_LOG entry
             drafted as a pasteable heredoc, sized to blast radius — this is
             a small fix, keep the entry small. Commit this prompt to
             docs/prompts/.
Stage only files this session touched — no `git add -A`.
Committed, NOT pushed.

## Step 6 — report
SHAs, the named root cause with its proving line, what changed, what you
deliberately did not change, and the staging evidence recipe from Step 4.
