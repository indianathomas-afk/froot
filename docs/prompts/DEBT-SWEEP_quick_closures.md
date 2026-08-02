NEW SESSION — DEBT-SWEEP: batch closure of small, independent debt
rows. Nine items, each tiny on its own; the bundle exists because
running nine audit cycles for nine one-liners is worse than one
disciplined sweep. Every item is EITHER docs/comment-only OR a
two-line code change with no behavior change. Anything that grows
beyond that shape mid-session gets REPORTED AND SKIPPED, not
finished — a sweep that balloons is worse than a sweep that ships
eight of nine.

Save this prompt to docs/prompts/DEBT-SWEEP_quick_closures.md before
starting any work. If a file already exists at that path, do NOT
overwrite it — read it, report what it contains, and ask me where
this goes.

Read before doing anything: docs/ROADMAP.yaml rows DEBT-4, DEBT-6,
DEBT-11, DEBT-15, DEBT-18, DEBT-20, DEBT-23, DEBT-26, DEBT-31,
DEBT-33 (and phase L-1); CLAUDE.md; docs/MIGRATIONS.md;
docs/PERMISSIONS_INVENTORY.md. This message is the task order; the
rows' own text is the specification for each fix — where this prompt
summarizes a row, the row wins, and a conflict is reported.

STANDING RULES
- Treat this prompt's claims AND every row's file:line as UNVERIFIED.
  Re-verify against the current checkout; report drift.
- NO DATABASE ACCESS, any branch, with ONE narrow exception: Item 8
  reads the local .env's key names and hostnames only — never
  values, never a connection. Nothing else touches a database or
  needs one.
- NO SCHEMA CHANGES, no prisma/ edits, no migrations, no env
  changes.
- Behavior-preservation is the sweep's contract: Items 4-7 must
  produce identical runtime behavior. If any of them turns out to
  change behavior, stop that item and report.
- Audit first, plan (all items), wait for my approval, then edit.
  Commit only when I say so. Never push.
- Gate per commit: scoped eslint over that commit's touched code
  files (docs-only commits skip eslint), then bare npm run build,
  chained as ONE command, NO PIPES. No bare `npm run lint` (DEBT-33
  baseline is red).
- `meta.updated` is gone (DEBT-24, final). The ROADMAP header note
  about debt-row fields is WRONG (that is Item 1) — rely on
  src/lib/roadmap.ts types, not the header comment.
- Rows closed this sweep follow the house convention: status +
  quoted commits, CLOSED preamble above original text, original
  preserved below the marker, follow-up commit records SHAs.

────────────────────────────────────────────────────────────────
GROUP A — DOCS AND COMMENTS ONLY
────────────────────────────────────────────────────────────────
ITEM 1 — DEBT-26. Fix the two stale comments per the row's own fix
shape: (a) docs/ROADMAP.yaml:20-22 header NOTE — correct the debt
field list to id/title/status/commits/notes while PRESERVING the
`open:` half, which is still true and still type-errors the build;
(b) src/lib/roadmap.ts:57-59 — replace the dead DEBT-14 comment with
a pointer to isResolvedDebt. Closes DEBT-26.

ITEM 2 — DEBT-31. Narrow docs/MIGRATIONS.md:184 per the row: staging
is a Neon child branch of production that has DIVERGED PER-TABLE
since its branch point (StaffMember diverged; Template shares
ancestry). Keep the operational advice intact — a clean staging
result is still not evidence about production. While in the file,
add the three branch ids to the endpoint table (dev
br-broad-wave-a6vpjdw0; staging br-square-feather-a63z92vz;
production br-sparkling-block-a620qvg4 — verify against
DEBT-2_AUDIT.md's recorded identities, not memory). Closes DEBT-31.

ITEM 3 — DEBT-6's guidance moves to where auditors will find it.
The row is a method warning, not a defect: ~11 GET routes trigger
Square sync writes, so a write-path audit that greps only non-GET
handlers has a blind spot. Add a short "audit method" note to
docs/PERMISSIONS_INVENTORY.md saying exactly that — grep for
syncSalesForStore / ensureSalesCached BY NAME — and verify the ~11
count and helper names are still accurate at HEAD before writing
them. Then close DEBT-6 with a preamble stating its content now
lives in the inventory doc. If the count or helpers have changed
materially, report instead of closing.

ITEM 4 — L-1 (phase, not debt). L-1 is `verified` with no commits
field — the only such row, pre-existing, flagged twice. Per its
nature (verification-only phase, no code), add a one-line note on
the row stating that explicitly so the missing commits field reads
as deliberate, not as an omission. Do not invent a commits value.

────────────────────────────────────────────────────────────────
GROUP B — TWO-LINE CODE FIXES, ZERO BEHAVIOR CHANGE
────────────────────────────────────────────────────────────────
ITEM 5 — DEBT-20. src/app/api/staff/sync-square/route.ts:20-21 —
swap the inline isAdmin destructure/check for
`can({ role }, "staff.sync.square")`, exactly as the row scopes it.
Both land on ADMIN today, so behavior is identical; the point is
visibility to PERM-5's override layer. DO NOT widen to any other
inline check — the row is explicit that the contradicted sites need
rulings. Closes DEBT-20.

ITEM 6 — DEBT-11. src/app/api/staff/[id]/route.ts — dedupe storeIds
once at the top (`const storeIds = [...new Set(parsed.data
.storeIds)]`) and use that everywhere, matching what POST /api/staff
already does. Verify the 500 path the row describes actually exists
at HEAD first. Closes DEBT-11.

ITEM 7 — DEBT-15's approved hardening. src/app/api/users/route.ts:127
(verify) — replace the isClerkAPIResponseError identity check with
the duck-type the row specifies: `clerkError: true` plus an `errors`
array, data not identity. The row's own warning is binding: this is
CHEAP HARDENING, not the fix for the old staging failure — the
preamble must say so, per the row's "do not let the two be conflated
again". Closes DEBT-15 (the hazard remains unverified; the row
closes because its approved mitigation is applied and its audit is
preserved below the marker).

ITEM 8 — DEBT-4 close-out. The row's own notes say every closing
condition is met and end "Gary to confirm and close" — I am
confirming via this task order. Session verifies the last checkable
fact: local .env DATABASE_URL and DATABASE_URL_UNPOOLED both resolve
to ep-late-water (dev), BY HOSTNAME ONLY, no values read. Then close
the row with a preamble that: corrects the stale title in the
preamble text (the notes already record the repoint), restates that
the vercel-env-pull gap is procedural and unfixable-by-configuration
(pointing at CLAUDE.md § Environment Variables and DECISIONS.md
2026-07-28), and notes DEBT-34 as the successor row carrying the
structural-guard question. Closes DEBT-4.

ITEM 9 — DEBT-33, ONE LINE ONLY, row stays OPEN.
src/lib/hr-signed-pdf.ts:373 — the prefer-const fix, the only
auto-fixable one of the eleven. Verify with scoped eslint that the
file's error count drops by exactly one and nothing else changes.
Update DEBT-33's row: eleven → ten, prefer-const line marked done.
DO NOT touch the ten react-hooks errors — they are refactors and
explicitly not this sweep. DEBT-33 remains open.

────────────────────────────────────────────────────────────────
GROUP C — THE WITHDRAWN-STATUS RULING (DEBT-18, DEBT-23)
────────────────────────────────────────────────────────────────
RULING, provided by Gary via this task order: PhaseStatus/DebtItem
gains a `withdrawn` status value, counted by isResolvedDebt as
resolved, rendered distinctly if cheap (a "withdrawn" label is
enough; do not build UI beyond a word). Apply status: withdrawn to
DEBT-18 and DEBT-23 — both rows already open with WITHDRAWN as
their first word and both explicitly kept for the record. Their
text is NOT edited beyond the status field and a one-line preamble
noting when the status value was applied. Verify the generator
(scripts/generate-roadmap.mjs) and roadmap-client.tsx handle the
new value; report what rendering looks like. If this turns out to
require more than the type, isResolvedDebt, and a label — report
and skip; the ruling can wait for its own session.

────────────────────────────────────────────────────────────────
AUDIT AND PLAN — what I want back before any edit
1. Per item: the real file:line at HEAD, drift called out, and the
   exact change quoted. Nine items, nine entries — or "SKIP:
   reason" where an item fails its own precondition.
2. For Item 3: the current sync-helper call-site count.
3. For Group C: what the generator and client do with `withdrawn`
   today, and the minimal change set.
4. Anything contradicting the rows or this prompt — say so.
5. Commit plan. Expected shape: one commit per group (A docs, B
   code, C status machinery), then the ROADMAP follow-up commit
   recording SHAs on every closed row. If B's items are cleaner as
   two commits, say so and why.
6. Current git state: branch, HEAD, unpushed, and how far main is
   behind staging — on record, no action.

DONE CRITERION
Rows DEBT-4, DEBT-6, DEBT-11, DEBT-15, DEBT-18, DEBT-20, DEBT-23,
DEBT-26, DEBT-31 leave the open list (staging or withdrawn as
applicable); DEBT-33 stays open with its count corrected; L-1 keeps
verified with its note. Every closed row: house-style preamble,
original text preserved, quoted commits. Confirm at the end that no
row touched has a landed status without a commits field (withdrawn
rows excepted per the ruling — state how that is handled), and that
DEBT-9, DEBT-12, DEBT-13, DEBT-16, DEBT-19, DEBT-27 through DEBT-30,
DEBT-32, DEBT-34 through DEBT-36 are untouched.

REPORT BACK
1. The six plan items, then what was actually committed, per group.
2. Every file:line that had drifted.
3. Scoped lint + bare build, chained, no pipes, per commit — and for
   Item 9, the before/after error count on hr-signed-pdf.ts.
4. The explicit unpushed-commits line — I run all pushes.
5. What I should verify on staging after pushing — expected: almost
   nothing visible (behavior-preserving sweep), but name the one
   thing per Group B item that would betray a regression, and what
   the /internal/roadmap page should now show (open-debt count
   before → after, withdrawn rendering).
