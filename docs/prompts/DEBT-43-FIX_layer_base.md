# DEBT-43-FIX — wrap globals.css's universal border reset in @layer base

NEW SESSION — DEBT-43-FIX: wrap globals.css's universal border
reset in @layer base. ONE LINE of CSS. No other code changes, no
schema, no migrations, NO DATABASE ACCESS.

Save this prompt to docs/prompts/DEBT-43-FIX_layer_base.md before
starting any work. If a file already exists at that path, do NOT
overwrite it — read it, report what it contains, and ask me where
this goes.

Read before doing anything: DEBT-43 IN FULL — it carries the
corrected mechanism, the scope, the two failed fix proposals and
the measurement warnings, all written 2026-08-02 by DEBT-TRIAGE-1;
src/app/globals.css in full; CLAUDE.md § Commit Gates.

THE CHANGE: `* { border-color: var(--color-border) }` at
globals.css:61 is UNLAYERED, so it beats every Tailwind border
utility, all of which sit in @layer utilities. Wrapping that one
rule in `@layer base` puts the reset below utilities in the cascade
and every existing call site starts working with no call-site edits
at all.

WHAT THIS IS NOT: it is not a rewrite of 92 call sites. DEBT-43's
original fix proposals — border-l-[…] and the theme-named
border-warning — BOTH FAIL for the same reason and were measured
failing. If you find yourself editing a component, stop and report.

────────────────────────────────────────────────────────────────
PART ONE — measure before, then change, then measure after
────────────────────────────────────────────────────────────────
1. RE-VERIFY THE MECHANISM at HEAD before touching anything. Fresh
   build, brace-depth scan of the emitted chunk. Confirm the
   utility declarations are emitted inside @layer utilities and the
   universal rule sits at depth 0 unlayered. Three sessions have
   now measured this and one of them measured it wrong; measure it
   yourself. State your unit (occurrences, not lines) and EXCLUDE
   src/generated/roadmap.ts — DEBT-43's own prose is in Tailwind's
   scan path and has contaminated two prior measurements in
   opposite directions.

2. MAKE THE CHANGE. One rule, wrapped. Preserve any comment above
   it. If globals.css has other unlayered rules, REPORT THEM AND DO
   NOT TOUCH THEM — this session fixes the one rule DEBT-43 names.

3. MEASURE AFTER. Same build, same scan. I want:
   - the universal rule now at depth 1 inside @layer base
   - the utilities unchanged at depth 1 inside @layer utilities
   - confirmation that @layer base precedes @layer utilities in the
     emitted order, since that ordering is what makes the fix work
     and not merely move the problem

4. THE RISK, and name it in your report: 92 sites across 44 files
   start rendering a colour they have never rendered. 45 are
   --color-primary, the selected-state affordance app-wide. Nothing
   breaks — elements render what they always asked for — but the
   app will LOOK different. Give me the highest-traffic surfaces
   affected, by file, so I know where to look. I will do the visual
   pass; you do not need to.

5. DEBT-43 CLOSES on this commit. House convention: status,
   quoted commit, CLOSED preamble above the original text, original
   preserved below the marker. Record the before/after
   measurements. Record explicitly that the 468 --color-border
   occurrences are unaffected — they ask for the default and get
   it either way, before and after.

────────────────────────────────────────────────────────────────
STANDING RULES
- Treat every claim in this prompt and in DEBT-43 as UNVERIFIED at
  HEAD.
- ONE CSS RULE. No component edits. No Tailwind config changes. If
  the fix does not work as described, report — do not escalate to
  a bigger change.
- Audit first, show me the measurements and the one-line diff, WAIT
  for approval, then commit. Never push.
- Gate: globals.css is a code file, so scoped `npx eslint` on it if
  eslint covers CSS in this repo — check rather than assume; if it
  does not, say so and gate on bare `npm run build` alone, chained,
  redirect not pipe. No bare npm run lint (DEBT-33, ten errors).
- Two commits: the CSS change, then the ROADMAP closure recording
  its SHA. Never an amend.
- meta.updated is gone (DEBT-24, final).

REPORT BACK
1. Before/after measurements, your units stated.
2. The one-line diff.
3. Layer ORDER in the emitted output.
4. The highest-traffic affected surfaces by file, for my visual
   pass.
5. Any other unlayered rule in globals.css — reported, untouched.
6. Gates green. The unpushed-commits line — I run all pushes.
