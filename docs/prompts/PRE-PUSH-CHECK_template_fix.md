TIER 1 session. Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/PRE-PUSH-CHECK_template_fix.md and execute it. Repo gate first, one command at a time. Stop where it says stop.

# PRE-PUSH-CHECK template fix — TIER 1

TIER 1: docs only. No code, no schema, no ROADMAP row. One docs commit.
Fixes two gaps the L-4-0 check hit on 2026-10-30 (commit 9d5f209), so the
next check doesn't have to stop and ask about them again.

## Repo gate (one command at a time, paste results)

```
pwd
```
→ If it ends in `Froot/froot`, continue.
→ If it ends in capital-F `Froot` (the parent folder — the desktop app
  starts sessions there), run:
```
cd /Users/garythomas/Claude_Projects/Froot/froot
```
  then run `pwd` again. Anything else: STOP.

```
git status
```
→ on `staging`, tree clean except this prompt file (untracked is expected).
Anything else: STOP.

```
git log --oneline -1
```
→ expect `9d5f209`. If different, say so out loud before continuing.

## Read first

Read `/Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/PRE-PUSH-CHECK.md`
in full. Also grep `/Users/garythomas/Claude_Projects/Froot/froot/CLAUDE.md`
for any repo-gate wording (`Froot/froot`, `capital`, `pwd`). Report what you
find with line numbers. If CLAUDE.md states the gate in a way that contradicts
Fix 1 below: STOP and show me both. Do not edit CLAUDE.md in this session.

## Fix 1 — repo gate handles the parent folder

In the template's "Repo gate" section, replace the `pwd` line so it reads:

```
pwd                → must end in Froot/froot. If it ends in capital-F
                     Froot (the parent folder), run
                     cd /Users/garythomas/Claude_Projects/Froot/froot
                     and run pwd again. Anything else: STOP.
```

## Fix 2 — docs-only phases in Step 2

Add this paragraph at the end of Step 2, before "Any DRIFT":

```
DOCS-ONLY PHASES (no work commit, no code — e.g. a -0 scoping phase):
- Row status does NOT flip to staging. It stays what the phase set
  (usually planned), because status says where the code is and there
  is none. Record the phase's docs SHA(s) on the row it edited.
- DEPLOY_LOG gets a short UNPROMOTED entry (a few lines: docs only,
  no code, no migration), not a full promotion entry.
- Precedent: L-4-0, check commit 9d5f209.
```

## Show, then STOP

Print the diff of PRE-PUSH-CHECK.md. STOP and ask: "Commit as shown, or
change it?" Write nothing further until Gary replies.

## After Gary's go

```
npm run build
```
→ must pass, no error lines.

Stage only PRE-PUSH-CHECK.md and this prompt file (no `git add -A`). One commit:

`docs(PRE-PUSH-CHECK): gate handles parent folder; docs-only phase rules (from L-4-0)`

```
git status
```
→ clean.

## Report and stop

Commit SHA and files changed. Do NOT push. Gary pushes with:
`git push origin staging`
No PRE-PUSH-CHECK needed for this one — it edits the check itself.
