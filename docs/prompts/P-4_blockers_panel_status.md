# P-4 — /internal/roadmap blockers panel counts resolved blockers as live

NEW SESSION — P-4: the /internal/roadmap blockers panel counts
resolved blockers as live. Audit first, plan, wait for my approval.

Save this prompt to docs/prompts/P-4_blockers_panel_status.md before
starting any work. If a file already exists at that path, do NOT
overwrite it — read it, report what it contains, and ask me where
this goes.

Read before doing anything: src/lib/roadmap.ts (the types),
src/app/(app)/internal/roadmap/roadmap-client.tsx (the render),
scripts/generate-roadmap.mjs; docs/ROADMAP.yaml's header NOTE about
which fields each row type accepts; rows DEBT-14 (the same defect
one level up, and the precedent for the fix), DEBT-21, DEBT-24,
DEBT-26, and the `withdrawn` ruling recorded on DEBT-18/DEBT-23;
CLAUDE.md; docs/WORKFLOW.md § Session completion rules.

THE PROBLEM, observed 2026-08-01. The panel reads "19 across 8
phases". Nearly all of those entries are resolved — they open with
GATE CLEARED, CLOSED, RESOLVED or WITHDRAWN, per the house
preserve-and-mark convention where a resolution paragraph is
prepended and the original text kept below a marker. The entries
therefore stay in the `blockers` array forever, and the panel counts
them. PERM-6 and PERM-7 are both `shipped`, in production since
746c1be (2026-07-29), with every gate on them now closed — and the
page still presents them as blocked.

THIS IS DEBT-14'S DEFECT ONE LEVEL DOWN. That row fixed exactly this
for the debt list: rows carried a status the UI ignored, so resolved
items rendered under a heading asserting "not yet fixed". Phases,
bugs and debt rows all gained status handling. Blocker ENTRIES never
did — they are bare strings in an array, with no field to carry
state and no way for the renderer to tell live from closed.

WHY IT MATTERS beyond cosmetics, and this is the actual cost: the
panel is what I look at to answer "what is stopping promotion". If
it cannot distinguish a live gate from a closed one, the answer is
untrustworthy in exactly the moment it matters — and the failure
direction is OVERSTATING, so real blockers hide among resolved ones.
The preserve-and-mark convention is CORRECT and is not what should
change; the renderer's blindness to it is.

────────────────────────────────────────────────────────────────
PART ONE — audit and options. Report back and STOP.
────────────────────────────────────────────────────────────────
1. Establish the real numbers, not my reading. Across all phases:
   how many blocker entries exist, how many are resolved by their
   own leading text, how many are genuinely live. Show your method
   for classifying — and say plainly how reliable it is, since
   leading-word matching on free prose is exactly the kind of
   heuristic this project has been burned by.

2. The types and the render path at HEAD, with file:line: what a
   `blockers` entry is today, how generate-roadmap.mjs passes it
   through, and where roadmap-client.tsx renders the panel and its
   count. Note whether `deferred` and `open` have the same problem —
   if so, say so; do not fix them without a ruling.

3. PRESENT THE OPTIONS with trade-offs, and RECOMMEND one. I expect
   at least these, and want you to add any I have missed:
   (A) STRUCTURED — blocker entries become objects with an optional
       `status` (or `resolved: true`), mirroring what DEBT-14 did.
       Type change, generator change, and a ROADMAP.yaml migration
       across every existing entry. Most correct, biggest diff, and
       the migration is the risk.
   (B) CONVENTION-READ — the renderer detects the existing
       preserve-and-mark prefixes (CLOSED / RESOLVED / WITHDRAWN /
       GATE CLEARED / …) and splits on them. No data migration, no
       schema change. Fragile in the way (1) is fragile, and it
       makes prose load-bearing for a count.
   (C) HYBRID — support an optional structured field, fall back to
       prefix detection for entries that lack it, and let new
       entries be written structured.
   For whichever you recommend: what the panel headline should then
   read, and whether resolved entries stay visible (they must — the
   ORDER and the history are the lesson on these rows) or collapse
   behind a disclosure like the debt list's "Resolved debt" panel.

4. Say whether this is one session or two. If the migration in (A)
   is large, splitting the renderer change from the data change may
   be right — tell me, do not assume.

5. Anything contradicting this prompt, including if you think the
   panel is behaving correctly and my reading is wrong. Say so.

STOP AFTER PART ONE. No edits until I approve an option.

────────────────────────────────────────────────────────────────
PART TWO — after I choose
────────────────────────────────────────────────────────────────
Implement the approved option only. Constraints:
- RESOLVED ENTRIES ARE NEVER DELETED OR REWORDED. Their text is the
  record; several rows say explicitly that the order is the lesson.
  This session changes how they are COUNTED and PRESENTED, nothing
  else.
- No schema changes, no prisma/ edits, no database access.
- If a ROADMAP.yaml migration is involved, it is mechanical and
  additive — no note text is edited in the same pass.
- File a row for anything found and not fixed.

STANDING RULES
- Treat every claim in this prompt as UNVERIFIED at HEAD.
- Audit first, wait for approval, commit only when I say so. Never
  push.
- Gate per commit: scoped `npx eslint <touched code files>` then
  bare `npm run build`, chained as ONE command, NO PIPES, redirect
  if the output is long (CLAUDE.md § Commit Gates). No bare
  `npm run lint` — DEBT-33's baseline is red (ten errors).
- meta.updated is gone (DEBT-24, final).
- ROADMAP.yaml's header NOTE is authoritative about which fields
  each row type accepts, and `open:` on a debt row type-errors the
  build. If your option adds a field, check the types rather than
  the header comment (DEBT-26).

REPORT BACK, part one
1. The real counts and your classification method, with its
   reliability stated.
2. Types and render path at HEAD, file:line, drift called out.
3. The options with trade-offs and your recommendation.
4. One session or two.
5. Contradictions.
