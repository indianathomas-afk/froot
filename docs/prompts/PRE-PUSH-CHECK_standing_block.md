═══════════════════════════════════════════════════════════════════
STANDING RULE: PRE-PUSH CHECK (paste this whole block into the
continuation prompt; applies to every phase, every session)
═══════════════════════════════════════════════════════════════════

Every build phase ends the same way, without me asking:

1. When a Claude Code build session reports done-and-committed, chat's next
   move is to hand me the pointer message for a PRE-PUSH-CHECK session using
   the template below, with the phase ID filled in. I never push before
   running it.
2. The check is TIER 1 and never pushes. I run all pushes.
3. Staging/production evidence always comes AFTER the push, in chat, per the
   browser-evidence standard (org ID + Clerk instance named, branch identity
   visible). The check session never claims deployed verification.
4. A ruling is only ratified by my reply in the check session (or my own
   wording committed there). A committed draft is not a ruling.

── PRE-PUSH-CHECK template (save once as docs/prompts/PRE-PUSH-CHECK.md;
   invoke with the phase ID) ──

# PRE-PUSH-CHECK — <PHASE-ID> — TIER 1

TIER 1: no code changes. At most one docs commit (reworded ruling or a fixed
doc). Verifies <PHASE-ID> is ready for Gary to push. Never pushes.

## Repo gate (one command at a time, paste results)
pwd                → must end in Froot/froot
git status         → on staging, tree clean

## Step 1 — rulings (hard STOP if any)
If <PHASE-ID> added or changed any docs/DECISIONS.md entry, print each
verbatim, then STOP and ask Gary: "Ratify as written, or give me your
wording." Record his exact reply. If he rewords: replace with his words
verbatim, npm run build, one docs commit. If the phase made no ruling,
say so and skip.

## Step 2 — docs sync audit (read-only; report a table: item / expected /
found / OK-or-DRIFT)
- docs/ROADMAP.yaml: the <PHASE-ID> row exists, status matches reality,
  work + docs SHAs recorded as quoted short SHAs, preserve-and-mark intact
  (nothing deleted), no meta.updated key.
- docs/DECISIONS.md: any ruling from this phase is present (per Step 1).
- docs/DEPLOY_LOG.md: entry for this promotion is drafted as a pasteable
  heredoc command for Gary to run at push time, sized to blast radius —
  not hand-edited, not missing, not bloated.
- CLAUDE.md: if this phase changed a house rule or pattern, it's reflected;
  if not, confirm untouched.
- docs/prompts/: this phase's session prompt(s) are committed.
Any DRIFT: STOP, report, and propose the one-commit fix. Do not fix
without Gary's go-ahead.

## Step 3 — pre-push sanity
git log --oneline @{u}..   → list must match what the build session
                             reported (plus any Step 1/2 docs commit).
                             Anything unexpected: STOP.
npm run build              → must pass. Confirm no error line above any
                             piped/gated output.
git status                 → tree clean.

## Step 4 — report and stop
"Ready to push. N commits: <list>. Gary runs the push. Staging evidence
is next, in chat, after deploy." Do NOT push. Do not suggest further work.

── Pointer message (what I paste into Claude Code) ──

TIER 1 session. Read docs/prompts/PRE-PUSH-CHECK.md and execute it for
<PHASE-ID>. Repo gate first, one command at a time. Stop where it says stop.
═══════════════════════════════════════════════════════════════════
