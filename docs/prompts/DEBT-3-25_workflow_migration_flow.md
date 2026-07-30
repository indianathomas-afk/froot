NEW SESSION — DEBT-3, plus DEBT-25 as a bundled same-file item. Do
not carry assumptions from any prior session; the last one closed
DEBT-7 (commits 705584f, a2356d5, both pushed) and logged DEBT-25 and
DEBT-26. It is finished. DEBT-26 is NOT this session — do not touch
its two stale comments, and do not contradict its row.

Save this prompt to docs/prompts/DEBT-3-25_workflow_migration_flow.md
before starting any work. If a file already exists at that path, do
NOT overwrite it — read it, report what it contains, and ask me where
this goes.

Read before doing anything: docs/ROADMAP.yaml rows DEBT-3, DEBT-25
(and DEBT-24, DEBT-26, which they cross-reference); CLAUDE.md;
docs/MIGRATIONS.md in full; docs/WORKFLOW.md in full. This message is
the task order.

STANDING RULES
- Treat this prompt's claims AND the ROADMAP rows' claims as
  UNVERIFIED. Re-verify every file:line against the current checkout.
  If a reference has drifted, report the real location rather than
  following it silently.
- This is a DOCS-ONLY session. No database access of any kind — no
  Neon, no `vercel env`, nothing here needs a database. If you find
  yourself wanting one, stop and report why.
- The ONLY files you may modify: docs/WORKFLOW.md, docs/ROADMAP.yaml,
  and the prompt file save above. No src/, no prisma/, no env
  changes. Anything else you think needs fixing goes in the report
  as text.
- Audit first, plan, wait for my approval, then edit. Commit only
  when I say so. Never push.
- Chain build and commit as ONE command — `npm run build && git
  commit ...` — never two lines. A reported build is not a gate.
- `meta.updated` no longer exists (DEBT-24 ruling, not to be
  re-litigated). Do not bump it, do not re-add it. Note that
  WORKFLOW.md itself still orders the bump — that is exactly what
  Item 2 fixes.

────────────────────────────────────────────────────────────────
ITEM 1 — DEBT-3. WORKFLOW.md §3 prescribes a broken flow.
────────────────────────────────────────────────────────────────
docs/WORKFLOW.md §3 (heading around :39) still says, at :43:
    npx prisma migrate dev --name describe_the_change
`migrate dev` is BROKEN here — the baseline squash was never done, so
shadow-DB replay fails with P3018, and .env has no
SHADOW_DATABASE_URL. The live policy is the hand-authored
`migrate diff` flow in CLAUDE.md and docs/MIGRATIONS.md §3.

Note the subtlety before you edit: WORKFLOW.md:50 already says
"Never run `db push` or `migrate dev` against staging or prod
databases." That line is TRUE and is not the problem. The problem is
that :43 prescribes migrate dev LOCALLY, which is where it is broken.
Do not delete :50 as though it were the error — it survives the
rewrite, verbatim or strengthened, your call, but it survives.

Replace §3's body with the current flow. Requirements:
- SHORT. §3's own heading says "see MIGRATIONS.md for full detail" —
  keep that pointer and honour it. Do not duplicate MIGRATIONS.md;
  summarise the shape (edit schema → migrate diff → review SQL →
  db execute → migrate resolve → generate → commit WITH the code)
  and send the reader there for the real steps.
- Do not contradict MIGRATIONS.md §3's connection-routing note
  (DATABASE_URL_UNPOOLED, BUG-3). You don't need to restate it —
  just don't write anything a reader could follow that bypasses it.
- Two migrations were hand-authored 2026-07-29 using this flow
  (20260729124105_build2_user_default_store,
  20260729145504_build2_staff_one_primary_store); cite them as the
  worked example if you want one, after verifying they exist in
  prisma/migrations/.
- Include the one-line future note that once the baseline squash
  lands and SHADOW_DATABASE_URL is set, the flow collapses back to
  `migrate dev` — MIGRATIONS.md already says this; a half-sentence
  pointer is enough. Do not present migrate dev as available today.

────────────────────────────────────────────────────────────────
ITEM 2 — DEBT-25. Same file, one bullet, logged last session.
────────────────────────────────────────────────────────────────
WORKFLOW.md's Session completion rules (:88-91 per the row — verify)
still order the reader to bump `meta.updated`. The field was deleted
2026-07-30 (DEBT-24, commit f646bf6) and the ruling is final. The
risk DEBT-25's row names is a future session re-adding the field to
satisfy this checklist, quietly reversing DEBT-24.

Fix: remove or replace that bullet so the checklist matches the
ruling. If you replace rather than delete, the replacement may note
that /internal/roadmap dates itself from the file's git commit date —
that half of the existing text is still true. Propose the exact text;
do not silently pick delete vs. replace without showing me both your
choice and why.

────────────────────────────────────────────────────────────────
AUDIT AND PLAN — what I want back before any edit
1. Both items' real file:line, with drift called out.
2. For DEBT-3: the full replacement §3 text, quoted, before you
   write it — including where :50's prohibition line lands in it.
3. For DEBT-25: delete vs. replace, your pick, the exact text if
   replace, and why.
4. Confirmation the two worked-example migration folders exist in
   prisma/migrations/ (name them), or the correction if they don't.
5. Anything in this prompt that contradicts the repo or the ROADMAP
   rows — say so rather than reconciling it silently.
6. Commit plan. I expect two commits: the WORKFLOW.md edit (both
   items, one file, one commit), then the follow-up ROADMAP.yaml
   commit recording its SHA on BOTH rows.

DONE CRITERION
Rows DEBT-3 and DEBT-25 leave the open list on /internal/roadmap.
`isResolvedDebt` counts staging | shipped | verified. A row cannot
record the SHA of the commit that contains it — use the repo's
follow-up-commit convention (precedents: 6f0821c, 116d77e, b407de1,
a2356d5). Short SHAs must be QUOTED in ROADMAP.yaml —
`commits: ["705584f"]` — because YAML reads bare SHAs like 84437e5 as
scientific notation. Both rows get a CLOSED preamble above their
original text, original wording preserved below the marker, per the
DEBT-8 / DEBT-14 / DEBT-7 house style. Confirm at the end that
neither row has a landed status without a commits field.

REPORT BACK
1. The six audit items above, then what was actually committed.
2. Every file:line that had drifted, with the real location.
3. `next build` green, chained with each commit as one command.
4. The explicit unpushed-commits line — I run all pushes.

STILL OUTSTANDING, DO NOT ACTION — just do not contradict: DEBT-26
(stale ROADMAP header comment + dead roadmap.ts comment) is logged
and waiting. Phase L-1 is `verified` with no `commits` field,
pre-existing, noted last session, not yet rowed. DEBT-5's label half
is scoped and ready as its own session after this one.
