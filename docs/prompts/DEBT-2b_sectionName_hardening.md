NEW SESSION — DEBT-2b: HARDEN sectionName's write paths. This is a
CODE-ONLY session. The DEBT-2a audit (docs/DEBT-2_AUDIT.md,
committed bceca47) measured all three branches CLEAN — 29 spellings,
29 normalized, zero anomalies everywhere — so there is NO DATA STEP.
No backfill, no UPDATE, no Neon console, no SQL of any kind. If you
find yourself wanting a database for anything beyond nothing, stop
and report why.

HARD PRECONDITION — check before anything else: docs/DEBT-2_AUDIT.md
must exist and be committed, with per-branch data tables showing all
three branches measured (no PENDING cells) and a §6 recommendation
stating this is a writer fix with no data step. If any of that is
absent, STOP and report — this session runs on that audit's
conclusions and cannot substitute its own.

Save this prompt to docs/prompts/DEBT-2b_sectionName_hardening.md
before starting any work. If a file already exists at that path, do
NOT overwrite it — read it, report what it contains, and ask me
where this goes.

Read before doing anything: docs/DEBT-2_AUDIT.md in full — §3's
writer table and §6's recommendation are the plan of record;
docs/ROADMAP.yaml rows DEBT-2, DEBT-36 (and DEBT-30, DEBT-33 for
what is out of scope); CLAUDE.md. Where this prompt and the audit
disagree, stop and report rather than picking one.

STANDING RULES
- Treat this prompt's claims AND the audit's file:line citations as
  UNVERIFIED against the current checkout. The audit was written at
  bb1f578; HEAD has moved. Re-verify every cited line and report
  drift rather than following it silently.
- NO DATABASE ACCESS of any kind, any branch. Not even dev. Nothing
  here needs one.
- DO NOT ENUM THIS FIELD. sectionName is legitimately free text —
  that is the audit's explicit ruling and exactly where DEBT-2
  differs from DEBT-1. src/lib/phases.ts is NOT the template to
  copy. The fix is trim + non-empty, nothing more. If you find
  yourself writing a canonical list of section names, stop.
- NO SCHEMA CHANGES, no prisma/ edits, no DDL. The btrim CHECK
  constraint idea belongs to DEBT-30's migration, not here.
- Files you may modify, and ONLY these:
    src/app/(app)/templates/template-form.tsx
    src/app/api/templates/route.ts
    src/app/api/templates/[id]/route.ts
    src/app/(app)/checklists/checklist-execution-client.tsx  (or the
      audit's cited path for the execution client — verify)
    docs/TEMPLATES_IMPORT_EXPORT.md
    docs/ROADMAP.yaml
    plus the prompt file save above.
  The seed script, the CSV import/export routes, templates-client's
  Duplicate, and the print pages are READ-ONLY — the choke-point
  strategy covers them; verify that claim, don't "improve" them.
- Audit first, plan, wait for my approval, then edit. Commit only
  when I say so. Never push.
- Build gate per commit: scoped lint then bare build chained as ONE
  command, NO PIPES anywhere:
    npx eslint <touched files> && npm run build && git commit ...
  No bare `npm run lint` — the baseline is red (DEBT-33).
- `meta.updated` is gone (DEBT-24, final).

────────────────────────────────────────────────────────────────
THE FOUR ITEMS — the audit's §6, in its order
────────────────────────────────────────────────────────────────
ITEM 1 — close the unguarded writer. template-form.tsx:526-527 (the
inline per-row section input) persists "" with no guard, while
addTask (:1169) and saveEditTask (:258) beside it both block empty.
Trim on the way into state and treat blank the way its two siblings
already do — match their existing behavior rather than inventing a
third. This is the whole of the realized risk.

ITEM 2 — uniform trimming at the two API choke points. POST
api/templates/route.ts:88 and the shared taskData() at
api/templates/[id]/route.ts:72 write sectionName untrimmed. Add
.trim() at both. Per the audit, these two edits cover writers 3-9;
verify that funnel claim against the current checkout and report if
any of the seven has grown a bypass since bb1f578.

ITEM 3 — one empty-value string everywhere. Four behaviors across
five sites today. "General" is the incumbent (three render sites
plus the CSV import default). Make checklist-execution-client.tsx:74
(blank heading) and template-form.tsx:506 ("No section") agree with
it. Display-layer only — do not write "General" into the database,
render it for empty. Verify the three incumbent sites still render
"General" before aligning the two stragglers to them.

ITEM 4 — the DEBT-1 leftover. docs/TEMPLATES_IMPORT_EXPORT.md:57
still lists two operational phases ("e.g. Before Opening, After
Closing"). List all three canonical values. One line. This carries
out DEBT-1b's uncarried recommendation without reopening DEBT-1 —
note it in the commit message as (DEBT-1 follow-through).

EXPLICITLY OUT OF SCOPE, per the audit and the rows: a Section
entity (DEBT-36); any DB-level CHECK (DEBT-30); CSV round-trip
fidelity (settled — the fix is upstream and Items 1-2 are it);
alignment of the print pages' own empty handling beyond what Item 3
names; the eleven red-baseline lint errors (DEBT-33).

────────────────────────────────────────────────────────────────
AUDIT AND PLAN — what I want back before any edit
1. Precondition check result, and every audit file:line re-verified
   at HEAD with drift called out.
2. The exact code change at each of the four sites, quoted, before
   you write it — including which existing sibling behavior Item 1
   adopts.
3. Verification of the funnel claim: writers 3-9 still route through
   the two choke points, or the exception.
4. Verification of Item 3's incumbents: the three "General" sites
   confirmed, and what the two stragglers currently render.
5. Anything contradicting the audit, the rows, or this prompt — say
   so rather than reconciling silently.
6. Commit plan. I expect two commits: the code fix (all four items,
   one commit — they are one hardening pass) then the ROADMAP
   follow-up recording its SHA.

DONE CRITERION
Row DEBT-2 gets status: staging with commits quoted, closing it off
the open list. CLOSED preamble above the audit marker above the
original text — three layers, all preserved, per the DEBT-1
precedent at bb1f578. The preamble must state: no data step was run
because none was needed (all three branches measured clean), the
enum was deliberately NOT added, and DEBT-36 carries the entity
question forward. Confirm at the end that no row touched this
session has a landed status without a commits field, and that
DEBT-30, DEBT-33, DEBT-36 are untouched.

REPORT BACK
1. The six audit items above, then what was actually committed.
2. Every file:line that had drifted, with the real location.
3. Scoped lint clean on touched files + build green, chained bare,
   no pipes, both commits.
4. The explicit unpushed-commits line — I run all pushes.
5. What I should verify on staging after I push: which forms, which
   actions, and what correct looks like for each of the four items —
   including how to exercise the formerly-unguarded input and what
   should now happen.
