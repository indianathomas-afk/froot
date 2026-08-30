# NAV-1-CHECK — pre-push ratification and sanity check — TIER 1

TIER 1: no code changes. At most one small docs commit (reworded ruling).
This session verifies NAV-1 is ready for Gary to push. It does not push.

## Repo gate (one command at a time, paste results)

```
pwd
```
Must end in `Froot/froot`.

```
git status
```
Must be on `staging`, tree clean.

## Step 1 — ruling ratification (hard STOP)

Print the NAV-1 entry from `docs/DECISIONS.md` verbatim, then STOP and ask
Gary exactly this:

  "Ratify as written, or give me your wording."

- If Gary replies with ratification: record his exact reply in the session
  output and proceed to Step 2. No commit needed.
- If Gary replies with new wording: replace the entry with his words
  verbatim, run `npm run build`, and make one docs commit:
  `docs(decisions): NAV-1 ruling reworded by Gary`. Then proceed.
- Any other reply: STOP and wait.

## Step 2 — pre-push sanity

Run each, paste output:

```
git log --oneline @{u}..
```
Expect exactly the unpushed commits reported at NAV-1 close (16f6f6b,
a005cba, 10439b3, e4c8c69) plus the rewording commit if Step 1 made one.
Anything unexpected in the list: STOP and report.

```
npm run build
```
Must pass.

```
git status
```
Tree clean.

## Step 3 — report and stop

State: "Ready to push. N commits: <list>. Gary runs the push."
Do NOT push. Do not suggest further work.

## Out of scope

Staging verification. That happens after Gary pushes and Vercel deploys —
per-role sidebar capture is browser evidence gathered in chat, not here.
