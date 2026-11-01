TIER 1 session. Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/DOCS-SWEEP_template-note_overlay-row.md and execute it. Repo gate first, one command at a time. Stop where it says stop.

# DOCS SWEEP — template note + overlay-toggle row — TIER 1

TIER 1: docs only. No code, no schema. One docs commit on `staging`. Never
pushes. Two loose ends from the L-4 and BUG-17 work; nothing else.

## Repo gate (one command at a time, paste results)

```
pwd
```
→ must end in `Froot/froot`. If it ends in capital-F `Froot`, run
`cd /Users/garythomas/Claude_Projects/Froot/froot` and run `pwd` again.

```
git status
```
→ on `staging`, tree clean except this prompt file.

```
git log --oneline -1
```
→ expect `6089816`.

## Item 1 — CLAUDE.md: PRE-PUSH-CHECK.md is a living template

**Background.** CLAUDE.md says nothing in `docs/prompts/` is ever edited. That
rule keeps finished session prompts as a true record. But
`docs/prompts/PRE-PUSH-CHECK.md` is a reusable template that Gary deliberately
improves. It was edited by DOCS-6, by the 2026-10-24 rider, and by `da90d9e`.
Sessions keep flagging those edits as rule breaks.

1a. Find the rule in `/Users/garythomas/Claude_Projects/Froot/froot/CLAUDE.md`
    and quote it verbatim with its line number. Also list any other file in
    `docs/prompts/` that is clearly a reusable template, not a one-time
    session prompt. Report candidates only; don't add them.
1b. Draft one short exception sentence placed right after the rule. Proposed
    wording, adjust only to fit the surrounding style:
    "Exception: `docs/prompts/PRE-PUSH-CHECK.md` is a living template, not a
    session record — it is edited deliberately (in its own docs commit) when
    the check itself needs to change."

## Item 2 — file the overlay-toggle row

**Background (L-4d Phase B6, 2026-10-30).** The Square schedule overlay
(`src/app/api/labor/coverage/route.ts` near :72) and the scheduled-vs-suggested
comparison (`src/app/api/labor/weekly-plan/route.ts` near :119) never check
`laborOverlayOn`. With the Square labor integration toggled off, rows already
mirrored can still render, labelled stale. That contradicts
`labor-dashboard.ts:45-48`: "gates 1-4 off ⇒ renders exactly as before." The
L-4d band itself does check the toggle. Keva has the toggle on, so nothing is
broken today.

2a. Re-verify both cites at HEAD (re-measure, never cite). If either route now
    checks the gate, say so and file nothing.
2b. Confirm it isn't already filed. Search ROADMAP.yaml for `laborOverlayOn`
    and for "overlay" near "toggle".
2c. Pick the row type and the next free ID from the file. Lean: a DEBT row,
    since it's a gap with no live impact. Use a BUG row only if the file's
    conventions say otherwise. Status `planned`. Notes: the two cites, the
    contract it breaks, "found in L-4d Phase B6, 2026-10-30", and the one-line
    fix shape (gate both reads on `laborOverlayOn`).

## STOP

Print the CLAUDE.md diff and the new row's YAML. Ask Gary: "Commit as shown,
or change it?" Write nothing until he replies.

## After Gary's go

1. Placeholder count before and after (`grep -c '__' docs/ROADMAP.yaml`). It
   must not rise.
2. Run `npm run build`. It must pass with no error lines.
3. Stage only `CLAUDE.md`, `docs/ROADMAP.yaml` and this prompt (no `git add -A`).
   One commit:
   `docs: PRE-PUSH-CHECK.md living-template exception; file overlay-toggle row <ID>`
4. `git status` shows a clean tree.

## Report and stop

Report the SHA, the new row's ID, and the template candidates from 1a. Do NOT
push. No PRE-PUSH-CHECK is needed: this is docs-only and makes no ruling. Gary
pushes with `git push origin staging`.
