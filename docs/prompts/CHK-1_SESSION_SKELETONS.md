# CHK — session prompt skeletons

Drafted 2026-08-09 alongside `docs/prompts/CHK-1_PLAN.md` at HEAD `552a5e7`.
**Skeletons, not prompts.** Each is the spine of a session prompt for Gary to
fill out in his own template — scope, gates, evidence, exclusions.

**The plan these implement was APPROVED 2026-08-09** (`CHK-1_PLAN.md` §0-RULING):
all five sessions, both migrations, all eleven §12 recommendations, and snapshot
scope ruled as names-only frozen on first task log. The sentence that stood here
— "None of them is approved work; the plan they implement is awaiting his
ruling" — was true for about an hour and is replaced rather than left to mislead,
since a skeleton's job is to instruct.

Every skeleton assumes the standing preamble: `cd ~/Claude_Projects/Froot/froot`,
branch `staging`, clean tree, fetch and level with origin, STOP on failure,
never push. And the standing close: ROADMAP update, triage counts, unpushed-commits
line.

---

## S1 — CHK-1 · Section entity and the as-executed freeze

**READ FIRST:** `docs/prompts/CHK-1_PLAN.md` §§1.2, 2.1, 2.4, 6.3, 6.4;
DEBT-36 in `docs/ROADMAP.yaml`; `docs/prompts/DEBT-59_AUDIT.md` §7 (the nine
checks); the TPL-1a migration as the precedent for the SQL shape.

**SHIPS**
1. Migration A verbatim from the plan §2.1 — `Section`, `Task.sectionId`,
   `TaskLog.sectionId`, `Checklist.sectionsSnapshot`, backfill. Gary runs it on
   dev; Claude writes the file and never executes it.
2. All six section render sites (plan §1.2) resolve through the join, string
   kept as fallback for a null `sectionId`.
3. Section management in `template-form.tsx` — explicit `sortOrder`, rename as a
   real rename, non-contiguous sections render one heading.
4. `sectionsSnapshot` written once, on the `Pending → In Progress` transition
   already in `api/checklists/[id]/task-log/route.ts:26-31`.
5. CSV import resolves `task_section` by name within the template; export
   unchanged.

**PROVES IT WORKED** — backfill query on the three LIVE branches, each naming
its branch (`unlinked_tasks = 0`) — dev, preview/staging, production.
**`preview/main` is an archived fossil and is owed nothing; do not query it and
do not treat a result from it as evidence** (`CHK-1_PLAN.md` §0a). The DEBT-36
trigger fired deliberately (rename a section
on a template with completed history → historical checklist and print copy
unchanged); non-contiguous section renders one heading; duplicate carries
sections; CSV round-trip; **DEBT-59 nine checks**.

**MUST NOT TOUCH** — `Checklist.status`, generation, `StoreHours`, the offsets,
the offsets box copy, any lifecycle behaviour. No cron.

**OPEN CALL TO CONFIRM BEFORE STARTING** — plan §12 items 4 and 5.

---

## S2 — CHK-2 · Day-close inputs

**READ FIRST:** `CHK-1_PLAN.md` §§3.1, 8; DEBT-32 and DEBT-33 rows;
`src/lib/phases.ts`, `src/lib/messages.ts:33-67`,
`store-view/checklist/[id]/handoff-notes.tsx:15-28`; `src/lib/labor-plan.ts:163-205`.

**SHIPS**
1. DEBT-32: delete the two `"During Hours"` alias lines, move `PHASE_ORDER` into
   `src/lib/phases.ts`, import from both sides of the client boundary.
2. `StoreHours` editor on `/stores` behind `stores.manage` — seven rows, open /
   close / closed-today, per store.

**PROVES IT WORKED** — handoff-note date resolution unchanged on all three
phases and on the legacy string; hours save, reload and render; Square resync
does not overwrite them; labor's weekly plan takes the explicit-hours branch for
a store that now has hours (first row ever to reach it).

**MUST NOT TOUCH** — checklist surfaces, the offsets, any schema.

**HAZARD, NAMED IN ADVANCE** — `handoff-notes.tsx` carries a DEBT-33 baseline
lint error at `:70:25`. Scope the eslint gate to exclude it and say so in the
commit message; do not appear to have fixed a DEBT-33 error.

---

## S3 — CHK-3 · Lifecycle engine

**READ FIRST:** `CHK-1_PLAN.md` §§2.2, 2.3, 3, 4, 5.4; DEBT-48 (Gary's
overdue-not-hidden thinking); `api/cron/pace-alerts/route.ts` as the cron shape;
`src/lib/reports.ts:51-73`.

**SHIPS**
1. Migration B verbatim from plan §2.2, **including** the uniqueness index from
   §2.3 — Gary's precheck returned zero on the three live branches 2026-08-09
   (plan §0a). **Re-run the precheck before applying**: the table grows daily and
   the create path can in principle produce the duplicate the index forbids, so a
   clean result in August is not a clean result on the day this ships. A
   non-zero re-measure drops the index; it does not delay the migration.
2. `src/lib/checklist-lifecycle.ts` — the five predicates, one definition each,
   plus `expectedWindow()` and `zonedInstant()`.
3. `GET /api/cron/checklist-day-close` + `vercel.json` entry, hourly,
   `CRON_SECRET`, two-day lookback, Daily-only materialisation.
4. `completedLate` written by `api/checklists/[id]/submit`.
5. 409 on `task-log` and `submit` when `closedAt` is set and the row is not
   `Completed`.

**PROVES IT WORKED** — SQL and the cron's own response body, **no UI**. Every
check in plan §9's S3 block: missed marking, missed materialisation, idempotency
on a second run, weekly exclusion, `isClosed` day, 409 refusal, pre-deploy rows
untouched.

**MUST NOT TOUCH** — any rendering. A chip on a screen in this session means the
split failed.

---

## S4 — CHK-4 · Lifecycle surfaces

**READ FIRST:** `CHK-1_PLAN.md` §§5, 6.1, 6.2; DEBT-59 row and audit §7;
DEBT-29's surviving comment blocks in `template-form.tsx:1007-1009`, `:1048-1055`.

**SHIPS**
1. `store-view-client.tsx` — Overdue and Upcoming chips; button behaviour
   unchanged.
2. `checklist-execution-client.tsx` — overdue banner; read-only missed state.
3. `checklists/page.tsx` — `Missed` in `STATUS_STYLES`; derived Overdue chip.
4. `reports/page.tsx` — Missed in the counts.
5. `print/checklist/[id]` — headings from `sectionsSnapshot`; MISSED stamp.
6. The (i) explainer beside the offsets, copy per plan §6.1.
7. DEBT-59's "not yet used" sentence retired, per plan §6.2 — **prepend to the
   DEBT-29 comment blocks, never edit them**.

**PROVES IT WORKED** — plan §9's S4 block, including the negative (nothing is
ever hidden by a window), blank offsets never overdue, `AllDay` never overdue,
STAFF nav badge, and **DEBT-59 nine checks a second time**.

**MUST NOT TOUCH** — the cron, the predicates, the schema.

---

## S5 — CHK-5 · Operations report

**READ FIRST:** `CHK-1_PLAN.md` §7; `src/lib/permissions.ts:171`;
`checklists/page.tsx:17-45` as the store-scoping precedent.

**SHIPS** — `/reports/operations` behind `reports.view`, store-scoped for
MANAGER; three views (by store, by day, by template) over missed,
completed-late and completion rate across a date range; the three disclosure
lines from plan §7.

**PROVES IT WORKED** — role gate at ADMIN / MANAGER / STORE / STAFF; counts
reconcile against direct SQL on the same branch, branch named.

**MUST NOT TOUCH** — anything upstream. Pure read surface.

**CLOSES THE PHASE** — file the two deferred rows (per-task as-executed
snapshot, frequency-aware generation) and write the DEBT-36 / DEBT-48 / DEBT-32
/ DEBT-59 closure riders per plan §10.
