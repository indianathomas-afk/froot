# DEBT-TRIAGE-1 — corrections

> Saved verbatim. The prompt arrived in two parts: the first message was
> truncated mid-sentence inside ITEM 1 ("original text preserved, the false
> mechanism marked false, the reasoning"), and the remainder was sent as a
> second message that resumed from the start of that same instruction. The two
> are stitched at that overlap below. Nothing else is altered, added or
> reordered. The saved file was deliberately NOT written until the full text was
> in hand — a prompt in `docs/prompts/` is a claim wholesale and is never edited
> afterwards, so a truncated one could not have been repaired later.

NEW SESSION — DEBT-TRIAGE-1: correct the debt list's stale and
false claims so the remaining rows are trustworthy. ROADMAP.yaml
only. No code, no schema, no relocations, no closures, NO DATABASE
ACCESS. Nothing leaves the open list this session.

Save this prompt to docs/prompts/DEBT-TRIAGE-1_corrections.md
before starting any work. If a file already exists at that path, do
NOT overwrite it — read it, report what it contains, and ask me
where this goes.

ALSO: docs/prompts/DEBT-TRIAGE_records_vs_tasks.md is UNTRACKED
from the triage session. Commit it with this session's work.

Read before doing anything: docs/prompts/DEBT-TRIAGE_records_vs_
tasks.md (the audit this session executes); rows DEBT-9, 28, 29,
30, 32, 33, 43 IN FULL; CLAUDE.md; docs/WORKFLOW.md § Session
completion rules.

WHY THIS SESSION EXISTS, and why it closes nothing. The triage
audit found five rows whose evidence has drifted and one row that
is FALSE ABOUT ITS OWN MECHANISM. A list where individual rows
mislead is worse than a long list — the next person acts on a row,
not on a count. This session makes every remaining row trustworthy
and defers all relocation to DEBT-TRIAGE-2.

────────────────────────────────────────────────────────────────
ITEM 1 — DEBT-43, and do this one FIRST
────────────────────────────────────────────────────────────────
The row's OBSERVATION is right and its MECHANISM is false. Both
fixes it proposes would fail. As written it would send someone to
edit 96 call sites for no effect.

THE FALSE CLAIM: "Tailwind cannot tell whether an opaque var()
inside the BARE border-[…] utility is a width or a colour", so the
border-color declaration is never emitted. Contradicted by the
compiled stylesheet on its face — the triage audit measured
`.border-\[var\(--color-warning\)\]{border-color:var(--color-warning)}`
present in both the dev chunk dated to the filing minute AND the
current production chunk. The declaration IS emitted.

THE REAL MECHANISM, per the audit: `* { border-color:
var(--color-border) }` at globals.css:61 is UNLAYERED (brace depth
0), while `@import "tailwindcss"` puts every utility inside
`@layer utilities` (brace depth 1). Unlayered declarations beat
every layered one regardless of specificity, so that single rule
overrides every border-color utility in the application.

RE-VERIFY ALL OF THAT AT HEAD before writing it — measure the
brace depths and grep the compiled CSS yourself. Do not inherit the
audit's numbers; it inherited P-4's and found them wrong.

WRITE THE CORRECTION as a correction, not an edit: original text
preserved, the false mechanism marked false, the reasoning error
named. The error is worth more than the fix — a plausible mechanism
was inferred from a correct observation and never tested against
the artifact that would have refuted it in one grep. Same family as
DEBT-15 and DEBT-23. Say so.

TITLES ARE IN SCOPE for this session, answering your question.
DEBT-43's title carries the false claim itself, so it gets
corrected. Same exception as DEBT-33: a title stating a CHECKABLE
FACT that is wrong gets fixed; a title carrying a dated
characterisation stays (DEBT-4, DEBT-5 precedent). Say which rule
you applied where.

ALSO CORRECT ON DEBT-43:
- The row's "LIKELY FIX" (border-warning) would ALSO fail — same
  layer, same loss. Record your finding that .border-warning
  appears in the compiled chunk ONLY because the string sits in
  this row's own notes text at src/generated/roadmap.ts:1327 and
  Tailwind's content scanner picked it out of the prose. Zero real
  usages in src. That is a genuinely funny artifact and a real
  methodological warning: a debt row's text can manufacture the
  evidence someone later reads as usage.
- The real fix is one line: wrap globals.css:61 in `@layer base`.
  Record it as the fix DIRECTION. DO NOT APPLY IT — a visual change
  to 96 sites gets its own session.
- SCOPE as you measured it: 563 occurrences across 107 files, 468
  of them --color-border and therefore invisible no-ops, 95 plus
  one border-l = 96 sites rendering the wrong colour, of which 45
  are --color-primary, the selected-state affordance app-wide.
  Record that the row's own "11 elements on /internal/roadmap" is a
  small fraction of the real scope.
- EVIDENCE LIMIT on the row: static analysis of compiled CSS plus
  the cascade-layer rule, NOT a browser measurement. I will confirm
  in the browser before authorising the fix. Note that the
  falsified half needs no cascade reasoning — "the declaration is
  missing" is contradicted by the stylesheet directly.

ITEM 2 — the two rows that read as blocked and are not
DEBT-30 and DEBT-32 both say "gated on DEBT-1 being verified".
DEBT-1's status at HEAD is `verified` — promoted 63407be, verified
in production 2026-08-01. VERIFY THAT, then record on both rows
that the gate cleared, with date and evidence. Neither row knows.
Two of twenty-two are silently ready to run and nobody can tell by
reading them.

ITEM 3 — stale file:line evidence
Re-verify each at HEAD; correct in place with the original citation
preserved. These are POINTERS, so repair them.
- DEBT-9: cites src/lib/hr.ts:44-49 and QUOTES
  `.find(a => a.isPrimary) ?? staff.storeAssignments[0]`. The audit
  found the function at :65-71 with no `.find` at all — BUILD-2
  Task 8 (f480568) rewrote it to sort internally. The quoted code
  does not exist. Worst of the five: a row quoting absent code
  reads as authoritative. Also "Do this BEFORE BUILD-2's index
  lands" — the index landed 2026-07-29.
- DEBT-29: template-form.tsx :917→:936, :925→:944, :954-960→~:973.
- DEBT-28: template-form.tsx :995→:1014, users/page.tsx :299→:301,
  clerk/route.ts :133→:134. Confirm the other 11 sites rather than
  assume.
- DEBT-33: title says 11 errors; HEAD measures 32 problems / 10
  errors. The BODY already records the correction. Fix the TITLE
  under the checkable-fact exception above.

ITEM 4 — mark the four deferred rows in their titles
DEBT-36, DEBT-38, DEBT-41, DEBT-42 are deferred by an explicit
ruling of mine with a named trigger — awaiting me, not awaiting
work. You reported wanting a schema field for this and correctly
did not propose one. Use the convention this file already set:
prefix each title with `AWAITING RULING — `, exactly as DEBT-18
and DEBT-23 carried `WITHDRAWN` before the status value existed.
No code, no type change, no new field. Add one line to each naming
WHAT I have to decide. Do not restate the row.

STANDING RULES
- Treat every claim in this prompt AND in the triage audit as
  UNVERIFIED at HEAD. You already did this for DEBT-43 and found
  something the audit missed; do the same for the rest.
- NOTHING CLOSES. No status: field added to any row. No relocation
  — that is DEBT-TRIAGE-2. If you want to move content, report and
  stop.
- Audit first, plan, wait for my approval, then edit. Commit only
  when I say so. Never push.
- Gate: docs-only, eslint skipped. Bare npm run build, chained,
  redirect not pipe.
- meta.updated is gone (DEBT-24, final).
- Commit docs/prompts/DEBT-TRIAGE_records_vs_tasks.md with this
  session's work — it has been untracked since the triage session.

REPORT BACK
1. DEBT-43 as you measured it — already banked, write it up.
2. Every file:line corrected, before → after.
3. Confirmation DEBT-1 is `verified` at HEAD, with evidence.
4. The four titles as written, plus which title rule you applied
   where.
5. Open debt count UNCHANGED at 22 — confirm.
6. Bare build green. The unpushed-commits line — I run all pushes.
