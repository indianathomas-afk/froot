> Renamed from STAGING_DEPLOY_LOG.md 2026-07-22 — logs both staging and prod deploys.

Deploy verification: 2026-07-02T22:00:05Z

---

## STANDING NOTE — docs-only commits the next real promotion's entry must name

- **Added 2026-08-10 (training filing session).** The next real PRODUCTION
  promotion's DEPLOY_LOG entry must NAME these docs-only commits so `main`'s
  push history reconciles: `65abb74` (docs-only --no-ff merge, board flips +
  BOOKKEEP-4 riders, 2026-08-10) and `f318d2e` (docs-only merge carrying
  BOOKKEEP-4's `0608f10`), plus the staging docs commits the promotion will
  carry without entries of their own: `35a25c6` (training audit + session
  prompt) and the 2026-08-10 training-filing docs commit — the commit that
  introduces this section. A commit cannot carry its own SHA; the promotion
  entry resolves it as the commit that added this note
  (`git log --oneline -- docs/DEPLOY_LOG.md`).
- **Provenance of this note:** the `65abb74` half of the obligation was first
  recorded 2026-08-10 inside docs/ROADMAP.yaml (the CHK row's docs-only-merge
  rider: "THE NEXT REAL PROMOTION'S DEPLOY_LOG ENTRY MUST NAME 65abb74");
  that text stands untouched. This section puts the standing list on the file
  where the promotion entry gets written, per the 2026-08-10 filing session's
  instruction that the obligation list live on the file, not in chat memory.
  `f318d2e` carried no recorded obligation anywhere at HEAD `35a25c6` and is
  named here for the first time.
- **Added 2026-08-10 (HR-20 build session).** The next real PRODUCTION
  promotion's entry must also name this session's two staging commits:
  `0a745c3` (HR-20 work — TrainingCategory entity, code, and the migration
  `20260810194426_hr20_training_category_entity`, applied to DEV only by the
  session; the staging and production Vercel builds replay it via
  `migrate deploy` on their own promotions — the promotion entry should
  confirm it in the build log) and the HR-20 docs commit, which cannot carry
  its own SHA and resolves as the commit that added this line
  (`git log --oneline -- docs/DEPLOY_LOG.md`). The work commit is not
  docs-only; it is listed so the reconciliation list stays the one complete
  place the promotion entry reads (per the 2026-08-10 HR-20 session prompt's
  instruction).
- **Added 2026-08-11 (HR-21 build session).** The next real PRODUCTION
  promotion's entry must also name this session's two staging commits:
  `a56c905` (HR-21 work — category CRUD routes under api/hr/training/
  categories, Manage Categories dialog, category badges + filter chips +
  card/list toggle, three-tab Active/Inactive/Archived partition on
  /hr/training; no migration — HR-20's entity, UI and routes only. Not
  docs-only; listed so this list stays the one complete place the
  promotion entry reads) and the HR-21 docs commit, which cannot carry
  its own SHA and resolves as the commit that added this line
  (`git log --oneline -- docs/DEPLOY_LOG.md`).
- **Added 2026-08-11 (HR-22 build session).** The next real PRODUCTION
  promotion's entry must also name this session's two staging commits:
  `bd63da7` (HR-22 work — bulk assign route + recipients endpoint under
  `api/hr/training/assignments/bulk`, the Bulk Assign dialog in HR-21's shared
  ModuleActions slot, and `skipDuplicates: true` retrofitted onto the
  single-assign POST; **no migration** — `dueDate` and HR-20's (module × staff)
  unique constraint both already existed. Not docs-only; listed so this list
  stays the one complete place the promotion entry reads) and the HR-22 docs
  commit, which cannot carry its own SHA and resolves as the commit that added
  this line (`git log --oneline -- docs/DEPLOY_LOG.md`). With this, the
  training trilogy HR-20/21/22 (`0a745c3`, `a56c905`, `bd63da7`) is complete on
  staging and awaits one promotion.
- **Added 2026-08-11 (HR-25 build session).** The next real PRODUCTION
  promotion's entry must also name **three** staging commits from the training
  access thread: `cc75949` (docs-only — the training access audit
  `docs/prompts/2026-08-11_TRAINING_ACCESS_AUDIT.md` and its session prompt,
  written 2026-08-11. **Named here for the first time**: it carried no recorded
  obligation anywhere at HEAD `cc75949`, the same gap `f318d2e` had above, and
  a docs-only commit with no entry is exactly what this list exists to catch);
  `f5d2883` (HR-25 work — the SELF tier of
  `api/hr/training/resources/[id]/download` now requires an open assignment,
  `SELF_FILES_SERVED_WHERE`/`selfFilesServed` in `lib/training.ts`, and
  `TrainingModuleView`'s new REQUIRED `resourcesAvailable` prop with its two
  call sites. **No migration** — no schema change and no database queries in
  that session. Not docs-only; listed so this list stays the one complete place
  the promotion entry reads); and the HR-25 docs commit, which cannot carry its
  own SHA and resolves as the commit that added this line
  (`git log --oneline -- docs/DEPLOY_LOG.md`). Note for whoever writes that
  promotion entry: HR-25 is an **access-control change on a confidential-content
  surface** — completed training stops being served its attached files — so the
  entry should say so rather than list it as a training tweak.
- **Added 2026-08-11 (HR-24 build session).** The next real PRODUCTION
  promotion's entry must also name this session's two staging commits:
  `0b1cf51` (HR-24 work — STORE read access to the training library: a new
  `requireHrTrainingReadAccess` guard and a new trimmed `GET
  /api/hr/training/library` route, `canReadTrainingModule` +
  `STORE_LIBRARY_WHERE` in `lib/training.ts`, a third `{kind:"read"}` mode in
  `TrainingModuleView`, STORE admitted to the `/hr` Training card, the
  `/hr/training` page and the HR-17 preview page, UI suppression of every
  authoring affordance behind a `canManage` prop, and the ROW #1 rider (the
  `/hr` Staff Directory card is now ADMIN||MANAGER). **No migration** — no
  schema change and no database queries in that session; its two measurements
  were run by Gary in the Neon console. **All 27 existing training guard call
  sites untouched.** Not docs-only; listed so this list stays the one complete
  place the promotion entry reads) and the HR-24 docs commit, which cannot
  carry its own SHA and resolves as the commit that added this line
  (`git log --oneline -- docs/DEPLOY_LOG.md`).
  **PROMOTION ORDER, AND THIS IS THE ONE THING THAT MUST NOT BE MISSED:
  HR-24 (`0b1cf51`) MUST NOT REACH PRODUCTION AHEAD OF HR-25 (`f5d2883`).**
  HR-25 closes what a completed employee is served; HR-24 widens who can read
  module content. Both are on staging and neither is on production, so a single
  promotion carrying both — or HR-25 first — are the only correct orders.
  Like HR-25, HR-24 is an **access-control change on a confidential-content
  surface** and the entry should say so rather than list it as a training tweak.
- **Added 2026-08-12 (HR-26 build session).** The next real PRODUCTION
  promotion's entry must also name this session's two staging commits:
  `7048504` (HR-26 work — MANAGER admitted to the training library as a reader
  and assigner: `requireHrTrainingReadAccess` widened to ADMIN/MANAGER/STORE
  and now returning `storeIds`, a MANAGER branch on `canReadTrainingModule`
  plus `managerLibraryWhere` in `lib/training.ts`, a third scope branch in `GET
  /api/hr/training/library`, MANAGER admitted to the `/hr` Training card, the
  `/hr/training` page and the HR-17 preview page — where MANAGER moves from
  `{kind:"preview"}` to `{kind:"read"}` and ADMIN becomes the only previewer —
  and a **second** UI flag, `canAssign`, carrying the Bulk Assign button and
  dialog. **No migration** — no schema change and no database queries in that
  session. **No new write path:** the bulk-assign route and its recipients
  endpoint already admitted store-scoped MANAGER since HR-22 and are not in the
  diff; **all 16 ADMIN-only and 11 manage-tier guard call sites untouched.** Not
  docs-only; listed so this list stays the one complete place the promotion
  entry reads) and the HR-26 docs commit, which cannot carry its own SHA and
  resolves as the commit that added this line
  (`git log --oneline -- docs/DEPLOY_LOG.md`).
  **PROMOTION ORDER — HR-24'S CONSTRAINT ABOVE IS NOW TRANSITIVE.** HR-26
  extends the guard and the route HR-24 created, so it cannot promote without
  HR-24, which in turn must not land ahead of HR-25 (`f5d2883`). All four
  commits are on staging and none is on production: **one promotion carrying
  all of them, or HR-25 first, remain the only correct orders.** Like HR-24 and
  HR-25, HR-26 is an **access-control change on a confidential-content
  surface** — it changes what a MANAGER account can see and do — and the entry
  should say so rather than list it as a training tweak.
- **Preserve-and-mark:** extend this list by dated line; when a promotion
  discharges an item, mark it discharged with the promotion SHA — never
  delete.

## 2026-08-10 (evening) — PRODUCTION promotion (the CHK phase's two surfaces: CHK-4 lifecycle visible + CHK-5 operations report + CHK-3's defect trilogy + DEBT-63/65 closed)

- **Merge SHA:** `d19cca6` — full: `d19cca6b5a13f7730498a08023c643f2c75a5e6f`.
  Parents: `bca5df1` (the previous production tip, this morning's promotion's
  own DEPLOY_LOG commit) and `150e4f1` (staging tip). Written on `main` after
  the merge and **before** the push, per WORKFLOW.md §2.
- **NINE commits**, `bca5df1..150e4f1`. Oldest `c05365a`, newest `150e4f1`.
  **The exclusive range is safe here and that is checked, not assumed:** the
  base `bca5df1` is itself the previous promotion's commit and is already on
  production, which is exactly the condition the `de3ba40` entry names for when
  `A..B` notation may be quoted. A second promotion on the same calendar day is
  the shape most likely to get this wrong — the morning's base was `7ab7106`,
  not `999cbdc`, for the same reason one layer back.
- **ROLLBACK — the three-line recipe, not one line** (WORKFLOW.md §2 as
  corrected in `7ab7106`; `git revert -m 1` alone conflicts on
  `docs/DEPLOY_LOG.md` every time, structurally):

  ```bash
  git checkout main
  git revert -m 1 --no-commit d19cca6
  git checkout HEAD -- docs/DEPLOY_LOG.md   # KEEP the log
  git commit -m "Revert the 2026-08-10 evening promotion"
  git push origin main
  ```

  Faster posture if the site is actively broken: Vercel → promote the `bca5df1`
  production deployment back to current, then revert at leisure. **Reverting
  this promotion leaves the engine running and takes the surfaces away** — the
  lifecycle columns, the cron and its writes are all from the MORNING's
  promotion and are untouched by this revert. Production would go back to
  accumulating Missed rows that nobody can read, which is the state described
  in the entry below.
- **NO MIGRATIONS IN THIS RANGE. VERIFIED, NOT ASSUMED:**
  `git diff --stat bca5df1..150e4f1 -- prisma/` returns **empty** — S4 and S5
  shipped no schema change, and `prisma/` is byte-identical across the whole
  promotion set. `prisma migrate deploy` still runs in the production build and
  should report no pending migration. **If the build log shows a migration
  applying, this claim is wrong and the deploy wants stopping and reading** —
  that is the check, and it is cheap because the expected answer is "nothing".
- **PROMOTED BY GIT PUSH.** DEBT-66's 2026-08-10 ruling stands: a dashboard
  redeploy of `main` is not available on this project, as a promotion path or
  as a recovery tool. Use the revert recipe above, or Vercel's
  promote-a-previous-deployment.
- **What shipped**, by theme:
  - **CHK-4 — the lifecycle becomes visible** (`c05365a`, `8ff4cce`,
    `bbb5734`). Overdue chips on `/store-view` and the overdue banner on the
    execution page, both **flagging without ever hiding** (R3, DEBT-48);
    `Missed` given its own style on `/checklists` and a read-only execution
    page; the as-executed print sheet with its MISSED stamp; the (i) explainer
    beside the offset fields; DEBT-59's "not yet used" copy retired by the
    session that made it false. `src/lib/checklist-status-display.ts` holds
    words and colours only — no predicate was re-derived, so
    `checklist-lifecycle.ts` is still the single definition site (DEBT-26).
    `bbb5734` is the clamp-warning fix: the form stopped doing its own
    arithmetic and now asks the engine's `endClampsAtDayClose`, which is why
    a Before Opening template finally warns.
  - **CHK-5 — the operations report** (`5190fd9`, `2980936`).
    `/reports/operations`: missed and completed-late by store × day × template
    over a date range, gated by INHERITANCE from `reports/layout.tsx`
    (`reports.view` = MANAGE) with **no new capability and no permissions.ts
    edit**, store-scoped through `getUserStoreScope()`. It derives nothing —
    every state comes from the lifecycle predicates. **DEBT-63 closed**: the
    total is now the row count and the five buckets partition it, so the tiles
    and the per-store table stop disagreeing in opposite directions.
  - **CHK-3's defect trilogy** (`1c907d2`, `dc90ff6`) — the frequency exclusion
    now holds at the CLOSING site as well as at materialisation (six fictional
    Weekly misses a week, gone); a `createdAt` floor so no Missed row predates
    its template (24 such rows had accumulated on staging; production measured
    0/0 and is owed no cleanup); and five split counters summed into the
    totals, so a sweep that excluded everything and a sweep that wrote nothing
    stop reading identically in the logs.
  - **DEBT-65 closed, twice** (`230f019` on top of `5190fd9`) — see the gate
    note below, which is the part with a production consequence.
  - **The phase's closing record** (`150e4f1`) — CHK-4's seven checks written
    out in full for the first time, CHK-4 and CHK-5 both verified on staging,
    the no-heartbeat finding on CHK-3, and two rows filed: **CHK-6** (past-day
    checklists are not browsable) and **SQ-4** (import store hours from
    Square).
- **DAY-ONE BEHAVIOUR ON PRODUCTION — THE REPORT OPENS ONTO A POPULATED TABLE,
  AND THE NUMBERS WILL BE REAL IMMEDIATELY.** This is the inverse of the
  morning entry's day-one note and wants reading with it. The engine has been
  closing production days **unattended** since that promotion — the hourly
  schedule fires on Production, which is the one environment where it does —
  so `/reports/operations` does not start empty and fill up over a week. It
  starts full.
  - **Expect the numbers to be ugly, and expect that to be correct.** Every
    production store falls to the midnight + 3h fallback unless somebody has
    set its hours since this morning, and every Daily template × store × day
    since the first sweep has a closed row behind it. Nothing here is a
    regression introduced by this promotion; it is the first time anyone can
    SEE what the engine has been recording.
  - **The three disclosures on the report's own face are what keep that
    honest** — daily-only tracking with the excluded count, tracking-starts-at
    -deploy with windowless rows in their own column rather than counted
    on-time, and the named stores running on the midnight fallback. A manager
    reading a bad number should be able to tell from the page itself which part
    of it is "we missed work" and which part is "we have not set this up yet".
  - **`/reports` moves again, and this time toward the truth.** The morning's
    entry warned its tiles under-report while its table over-counts. DEBT-63's
    fix ends that: one denominator, five buckets, Missed present in both
    halves.
- **THE ARCHIVED-AND-INACTIVE GATE NOW GUARDS BOTH FLAGS, ON BOTH GENERATION
  PATHS. MEASURE PRODUCTION — DO NOT ASSUME IT.** All three applicability
  filters now read `isActive: true, isArchived: false`: bulk generate, the
  single create at `api/checklists/route.ts` (which previously scoped on
  organization ALONE), and the crew list. The cron has read both flags since
  `d089a7c`. **The consequence is that a retired template stops generating on
  the day this deploys.** On staging that meant FIVE templates — `isActive
  = false`, `isArchived = true` on zero of them, because at Keva "archiving" is
  performed with the Deactivate button. **Production's count is UNMEASURED.**
  Five is a staging number and must not be carried across; run this in the Neon
  console on `production` (`br-sparkling-block-a620qvg4`), no credential pulled
  to disk:

  ```sql
  select current_setting('neon.branch_id', true) as branch,
         t."isActive",
         t."isArchived",
         count(distinct t.id) as templates,
         count(c.id)          as checklist_rows
  from   "Template" t
  left   join "Checklist" c on c."templateId" = t.id
  where  t."organizationId" = 'cf888f2d-f234-48c7-8097-fd5b44b5b3dd'
  group  by 2, 3
  order  by 2, 3;
  ```

  Read it this way: every row where `isActive` is false OR `isArchived` is true
  is a template that **stops generating** as of this deploy, and its
  `checklist_rows` are rows that already exist and are **not touched** — this
  promotion deletes nothing. A large count under a retired template is a
  conversation about cleanup (DEBT-65's (a)/(b) split), not a defect. Note the
  `organizationId` filter names the production Keva org by ID; widen it if a
  second org matters.
- **PRODUCTION EVIDENCE QUERIES OWED — the phase is not `shipped` until they
  come back.** Four, enumerated on the CHK-5 row: the report's headline numbers
  reconciling against direct SQL; DEBT-63's total equalling the sum of its
  tiles; DEBT-65's cleanup exposure; and the archived/inactive census above.
  All on `br-sparkling-block-a620qvg4`, each naming its branch.
- **GARY'S POST-PUSH CHECKLIST, in order:**
  1. `git push origin main` then `git push origin staging`. Both are needed —
     `staging` carries the docs commit `150e4f1` and would otherwise sit behind
     `main`.
  2. Watch the Production build to **Ready**. **No migration is expected** —
     flag it if the log shows one applying (see the migrations note above).
  3. **Production spot-check, ~3 minutes**, org ID first: `/reports/operations`
     renders with real numbers; one store's day-close source line reads either
     "Store hours" or "Midnight fallback"; the "What this report does not
     cover" panel is present with all three disclosures; and a template form
     shows the (i) explainer AND the clamp warning at a large Ends value
     against a store with hours. **That last one is the first time the clamp
     warning will have been seen on a rendered page anywhere** — it was fixed
     in `bbb5734` and verified eleven cases deep at the predicate level only.
  4. The archived/inactive census query above, branch named in the result.
  5. `git checkout staging`.
  6. **Optional, and the satisfying one:** query production for yesterday's
     closed rows. They closed themselves — no manual sweep was involved, which
     is the one thing staging has never been able to demonstrate (CHK-3's
     no-heartbeat rider).

## 2026-08-10 — PRODUCTION promotion (the whole CHK phase engine: CHK-1 sections + CHK-2 day-close inputs + CHK-3 lifecycle + TPL-2 steps 1–2 + DEBT-41)

- **Merge SHA:** `ddaa216` — full: `ddaa2164abccbdded6e2e948630fcf91265c4a5a`.
  Parents: `7ab7106` (previous production tip) and `a0ed954` (staging tip).
  Written on `main` after the merge and **before** the push, per WORKFLOW.md §2.
- **TWENTY-ONE commits**, `7ab7106..a0ed954`. Oldest `216ea74`, newest
  `a0ed954`. **The base is `7ab7106`, NOT `999cbdc`** — `999cbdc` was the
  2026-08-04 promotion and the 2026-08-07 promotion (`fad9207`) sits between
  them, so a `999cbdc..` range would re-count 25 commits that are already on
  production. Written out because the range-notation trap this file documents on
  the `de3ba40` entry is exactly the one available here, and the count (21) is
  right for a base that is easy to get wrong.
- **ROLLBACK — the three-line recipe, not one line** (WORKFLOW.md §2 as
  corrected in `7ab7106`; `git revert -m 1` alone conflicts on
  `docs/DEPLOY_LOG.md` every time, structurally):

  ```bash
  git checkout main
  git revert -m 1 --no-commit ddaa216
  git checkout HEAD -- docs/DEPLOY_LOG.md   # KEEP the log
  git commit -m "Revert the 2026-08-10 promotion"
  git push origin main
  ```

  Faster posture if the site is actively broken: Vercel → promote the `7ab7106`
  production deployment back to current, then revert at leisure. **Both
  migrations are additive and stay either way** — reverting the code leaves
  unread columns, which is harmless; dropping them is a destructive migration
  against production for no benefit.
- **PROMOTED BY GIT PUSH, AND THAT IS NOW A RULE RATHER THAN A HABIT.**
  DEBT-66 — three dashboard redeploys of `main` at `7ab7106` failed 2026-08-09
  in `vercel-build` with no database env attached — was ruled 2026-08-10 not to
  block a git-push promotion, because every measured failure was on the
  dashboard-redeploy path and the git-pushed deploy of that same commit built
  clean. The row stays OPEN, rescoped. The consequence to hold onto: **a
  dashboard redeploy is not available as a recovery tool on this project**, which
  bites hardest in exactly the situation where someone would reach for one. Use
  the revert recipe above, or Vercel's promote-a-previous-deployment.
- **What shipped**, by theme:
  - **CHK-1 — sections become a first-class per-template entity** (`4fd9152`,
    `7c99da3`, `7031155`). `Section` per template, `Task.sectionId`,
    `TaskLog.sectionId`, and `Checklist.sectionsSnapshot` — the as-executed
    record DEBT-36 said did not exist, frozen once on the first task log and
    never rewritten. All six section render sites resolve through one helper
    (`src/lib/sections.ts`). Staging-verified, including DEBT-36's latent trigger
    fired deliberately: a rename left the historical checklist and its print copy
    unchanged.
  - **CHK-2 — day-close inputs** (`597e86d`, `5298d42`, `09a0898`). DEBT-32's
    three phase lists folded into one derived list in `src/lib/phases.ts`, and
    **the first writer `StoreHours` has ever had** (`/stores`, behind
    `stores.manage`). The table has existed unwritten since
    `20260627002005_init`.
  - **CHK-3 — the lifecycle engine** (`d089a7c`, `3f062ab`, `411557a`,
    `8752708`). `closedAt` / `completedLate` / `expectedStartAt` /
    `expectedEndAt`; `src/lib/checklist-lifecycle.ts` holding the five
    predicates once each; `GET /api/cron/checklist-day-close` hourly under
    `CRON_SECRET`; and the S1 integrity fix — `task-log` now refuses a `taskId`
    that does not belong to the checklist's template, and `submit` counts
    distinct valid logs instead of raw rows. Overdue is derived on read and is
    written nowhere; Missed is the only written closed fact.
  - **TPL-2 steps (1) and (2)** (`198d040`, `332e6fb`) — the legacy
    `Template.type` string is no longer read; every site resolves the name
    through the joined row. Step (3), the destructive column drop, is NOT in
    this promotion and is not authorised.
  - **DEBT-41** (`13e96fb`, `cc837db`) — `narrowed`, the third `BlockerEntry`
    state, with both exemplars migrated.
  - **Rulings and bookkeeping** (`216ea74`, `552a5e7`, `746918c`, `3ec9bc8`,
    `32237ee`, `a0ed954`) — the approved CHK plan and session skeletons, the CHK
    track filed, the CRON-DIAG findings, and today's gate resolutions. `df96e9b`
    (temporary cron instrumentation) is in the range and was reverted by
    `32237ee` before this promotion; both are present and cancel out.
- **MIGRATIONS — TWO, applied on this promotion by the pipeline's
  `prisma migrate deploy` during the build. Never run by hand against
  production.**
  - `20260809160000_chk1_section_entity` — Migration A. Structural half plus a
    **data backfill**: one `Section` per distinct `(templateId, sectionName)`,
    with `sortOrder` recovered from `MIN(orderIndex)` rather than invented, then
    `Task.sectionId` and `TaskLog.sectionId` filled by name match. Idempotent.
    **This is the only part of this promotion that has never run against real
    production rows** — the structural half was proven against `migrate diff`,
    but a backfill is per-branch by construction. CHK-1 does not go `shipped`
    until `unlinked_tasks = 0` comes back from `br-sparkling-block-a620qvg4`;
    the query is on the CHK-1 row.
  - `20260809194500_chk3_checklist_lifecycle` — Migration B. Four lifecycle
    columns, two scan indexes, **and two unique indexes**:
    `Checklist_storeId_templateId_date_key` and
    `StoreHours_storeId_dayOfWeek_key`. **No backfill** — every pre-existing row
    keeps NULLs, because no expected window existed before this phase and
    inventing one would manufacture retroactive data.
  - **THE PRECHECK WAS RE-RUN ON PRODUCTION 2026-08-10 AND IT IS WHAT MADE THOSE
    TWO UNIQUE INDEXES SAFE TO SHIP.** Branch `br-sparkling-block-a620qvg4`:
    `checklist_dupes 0`, `storehours_dupes 0`. A unique index is the one kind of
    statement in either file that can fail on existing data, and a failure here
    fails the production build. The August 9 zero was not reused — the table
    grows daily and `StoreHours` had been taking writes from CHK-2's editor since
    that morning.
- **DAY-ONE BEHAVIOUR ON PRODUCTION — EXPECTED, AND IT WILL LOOK LIKE A
  REGRESSION IF NOBODY WROTE IT DOWN.** The engine ships **ahead of its
  surfaces**: CHK-4 (chips, banners, the Missed style, the print stamp) and
  CHK-5 (the operations report) are not built. That split is the plan's design —
  it is what made CHK-3 verifiable on its own — not an oversight.
  - The first hourly sweep after deploy **materialises a Missed row for every
    Daily template × every store × the two-day lookback**. On staging that was
    88 materialised rows across 12 stores in one sweep. Production will be the
    same shape.
  - **Every production store falls to the midnight + 3h fallback**, because
    `StoreHours` is empty there — CHK-2's editor is that table's only writer and
    reaches production with this very promotion. Stores get real day-close
    instants only once someone fills the hours in.
  - **`/reports` will visibly move, in two directions at once.** Its four tiles
    do not count `Missed`, so they under-report; its per-store table derives the
    total from the row count, so materialised rows push totals up and completion
    rates **down**. Same page, one number too low and another too high, from one
    cause. That is DEBT-63, which anticipated it.
  - The STAFF nav badge counts `Pending`/`In Progress` with no date scope, so
    stale rows flipping to `Missed` can remove the Checklists item for a STAFF
    user.
  - **DEBT-65** — bulk generate creates checklists for archived templates that
    no store surface shows, and day close now files those as Missed. An operator
    may see a store "missing" work nobody was ever shown.
  - None of this is visible to crews as a feature: `/checklists` and
    `/store-view` are scoped to today's business day and the lookback never
    includes today, so a materialised row appears on neither.
- **CRON_SECRET WAS NOT ROTATED, BY RULING** (Gary, 2026-08-10). The deployed
  value transited a chat transcript on 2026-08-09. Blast radius assessed low —
  `/api/cron/checklist-day-close` is idempotent and Vercel fires it hourly
  anyway, so an unauthorised caller only makes the same sweep happen sooner.
  **Accepted, not fixed**: it is an open low-priority item on CHK-3, to be done
  at the next secret-touching session by the CLAUDE.md § Environment Variables
  ritual. Recorded here because a deferred rotation that appears nowhere is a
  rotation nobody does.
- **VERIFICATION OWED AFTER THE PUSH**, in order: both migrations visible as
  applied in the production build log; CHK-1's `unlinked_tasks = 0` on
  `br-sparkling-block-a620qvg4`; CHK-3's structure query on the same branch
  (four columns, three `Checklist` indexes, one `StoreHours` index); then the
  first scheduled sweep's response read from the Vercel function log. Until
  those land, this entry records what was PROMOTED, not what was proven.

## 2026-08-07 — PRODUCTION promotion (TPL-1 template types + DEBT-59 offsets + six debt rulings)

- **Merge SHA:** `fad9207` — full: `fad92078176969b681ea80770dfbf6e2366edafa`.
  Parents: `999cbdc` (previous production tip) and `b36521f` (staging tip).
  Written on `main` after the merge and **before** the push, per WORKFLOW.md §2.
- **A REAL MERGE COMMIT, AND THAT IS THE POINT.** This is the FIRST promotion
  under the `--no-ff` rule added in `7d984be` (DEBT-38's fix). The two previous
  entries below both record *"FAST-FORWARD, not a merge — `git revert -m 1` does
  not apply"*, each followed by a hand-assembled reverse-order revert list of 32
  and 28 commits. That is what `--no-ff` exists to stop, and here it worked:
  `fad9207` has two parents, so **rollback is one line** (below) instead of a
  28-line list assembled under pressure.
- **TWENTY-SIX commits**, `999cbdc..b36521f`. The exclusive range notation is
  correct here for the same reason the `999cbdc` entry gives: the base is itself
  the previous promotion SHA and is already on production. Oldest promoted
  `cc6e9af`, newest `b36521f`.
- **ROLLBACK — three lines, not one. TESTED, NOT ASSUMED (2026-08-07):**
  ```
  git checkout main
  git revert -m 1 --no-commit fad9207
  git checkout HEAD -- docs/DEPLOY_LOG.md   # keep the log — see below
  git commit -m "Revert the 2026-08-07 promotion" && git push origin main
  ```
  `-m 1` keeps parent 1 (`999cbdc`, production as it stood) and reverts
  everything that came in from `staging`.
  **`git revert -m 1 fad9207` ALONE CONFLICTS — and it will conflict on every
  future promotion too.** Measured here by running it: all 37 other files
  revert cleanly and `docs/DEPLOY_LOG.md` is the single conflicted path. The
  cause is structural rather than specific to this promotion — WORKFLOW.md §2
  requires the log entry to be committed on `main` after the merge, while
  `DEPLOY_LOG.md` is also touched by commits *inside* the promotion set
  (`cc6e9af` and `72bcf30` here, the previous promotion's own entry among
  them). So the revert always tries to undo edits to a file the post-merge
  commit has since rewritten.
  **Keeping the log is the correct resolution, not a workaround.** A deploy log
  is the record that the deploy happened; reverting it would erase the entry
  describing the very thing being rolled back, at the moment that entry is most
  needed. Resolve by keeping the current file, always.
  Faster posture if the site is actively broken: Vercel → promote the `999cbdc`
  deployment back to current, then do the revert at leisure.
  **This is a gap in DEBT-38's fix, found on its first exercise.** §2 still
  promises "a one-line `git revert -m 1 <merge-sha>`". That promise is what
  `--no-ff` bought, and it is very nearly true — the correction is one extra
  line — but somebody reading §2 mid-incident will hit an unexpected conflict.
  WORKFLOW.md is NOT edited by this session: process-doc changes flow
  staging → main like everything else, and a promotion is the wrong moment to
  edit the runbook being exercised. Filed for the next staging session.
  **The migration is additive and stays either way — do NOT drop the table.**
  Reverting the code leaves `TemplateType` and `Template.typeId` unread, which
  is harmless; dropping them is a destructive migration against production for
  no benefit. This is the same posture the `999cbdc` entry took on
  `User.deniedCapabilities`.
- **What shipped**, by theme:
  - **TPL-1 — template types become a first-class managed entity**
    (`8461a48`, `a286b30`, `182ca1c`, `6667bfe`, `b36521f`). `Template.type` was
    a required, unconstrained, free-text column the template form could not set:
    the form carried the state and the payload key but no control was ever
    rendered, so `type: templateData.type || "Mid-Shift"` stamped **"Mid-Shift"
    on every template made through Create**. TPL-1a added the `TemplateType`
    entity, the migration, the required Type select and org-verified `typeId`
    resolution on POST and PATCH; TPL-1b added the Manage Types dialog
    (create / rename / recolour / reorder, delete blocked while in use with a
    reassign path), filter chips and sort on `/templates`, badges reading stored
    colours, CSV type resolution, and the starter-type seed at org creation.
    Full audit: `docs/prompts/TYPE-1_AUDIT.md`.
  - **DEBT-59 — availability offsets optional and blank by default**
    (`2ccca7d`, `2d5b93d`). The form no longer manufactures a 1/2 window nobody
    chose. Verified on staging by Gary across nine manual checks.
  - **Six debt rulings** (`ac59d64`, `7d984be`) — DEBT-38 and DEBT-45 closed,
    DEBT-41 converted to work, DEBT-42 relabelled, DEBT-36 and DEBT-48 parked
    for a feature phase, R6 resolved. **`7d984be` is the commit that added the
    `--no-ff` rule and the DEPLOY_LOG step this entry is the first to follow**,
    and the audit-artifact rule in CLAUDE.md.
  - **Board and docs** (`90d8293`, `411ccd2`, `2ab22f1`, `27a32cf`, `3c73a7f`,
    `f10599a`, `b261f40`, `878f47e`, `92c5c0c`, `d1de703`, `9f317d4`,
    `1218be3`, `cf3e93f`, `72bcf30`, `cc6e9af`) — R1–R5 recorded, the rulings
    log rendered onto the board, L-2 re-scoped, PERM-5 flipped to shipped.
  - **iPad standalone mode** (`28bbd8a`, `c473b72`) — manifest and
    apple-touch-icon, so store iPads launch without Safari chrome. Note DEBT-58:
    this shipped without hardware verification and is still unverified on a
    real device.
- **MIGRATION — one, replaying on this promotion:**
  `20260808103000_tpl1a_template_type_entity`. Three parts in one transaction:
  creates `TemplateType` (+ the `@@unique([organizationId, name])` index and the
  org FK), adds the nullable `Template.typeId` with an `ON DELETE RESTRICT` FK
  and its index, then **seeds and backfills** — one type per distinct
  `(organizationId, type)` already in use with colours carried from the old
  hardcoded map, a four-type starter set for any org that would otherwise end at
  zero, and `typeId` backfilled by exact string match. Idempotent
  (`ON CONFLICT DO NOTHING`, and the backfill only touches `typeId IS NULL`).
  **Applied by the pipeline's `prisma migrate deploy` during the production
  build. Never run by hand against production.**
- **PRE-PROMOTION EVIDENCE, branches named per CLAUDE.md § Database Evidence:**
  `preview/staging` `br-square-feather-a63z92vz` — unlinked 0, total 16
  (2026-08-07). `dev` `br-broad-wave-a6vpjdw0` — unlinked 0, total 8.
  **Production is NOT yet measured** — that is the post-push step below, and it
  is the precondition for filing TPL-2.
- **POST-PUSH VERIFICATION — not yet performed at the time of writing.**
  1. Confirm the production build log shows the migration applying.
  2. Run on the production branch (`br-sparkling-block-a620qvg4`,
     `ep-green-smoke`), expecting `unlinked` = 0:
     ```sql
     SELECT current_setting('neon.branch_id', true) AS branch,
            COUNT(*) FILTER (WHERE "typeId" IS NULL) AS unlinked,
            COUNT(*) AS total
     FROM "Template";
     ```
  3. Browser spot-check on www.usefroot.com: the Type select is present on the
     template form, one template's badge renders in its stored colour, and
     Manage Types opens.
  **`TemplateType` ids are generated per branch and will NOT match dev or
  staging** — the inverse of the row-id trap in CLAUDE.md § Database Evidence.
  Never carry one across.
- **STILL OPEN AFTER THIS PROMOTION:** TPL-2 (retire the legacy
  `Template.type` string column) is deliberately unfiled. Per Gary's Q6 it
  becomes fileable only once the production evidence above shows unlinked 0.

## 2026-08-04 — PRODUCTION promotion (DEBT-53/54 security + PERM-5 Sessions B+C + DEBT-50 docs package + DEBT-55 site 1 + DEBT-9/13/29/43/46 closures)

- **Promotion SHA:** `999cbdc` — full: `999cbdc78ffe1f3c7e66d2653aab2497745619b3`.
  Pushed to `origin/main` 2026-08-04.
- **FAST-FORWARD, not a merge.** `origin/main`, `origin/staging` and `999cbdc`
  are all the same commit; the previous production tip `de3ba40` is an ancestor
  of `999cbdc` and the set is contiguous. **No merge commit exists, so
  `git revert -m 1` does not apply** — this is the DEBT-38 fact the entry
  exists to record, since a fast-forward leaves no artifact on the platform.
- **THIRTY-TWO commits**, `de3ba40..999cbdc`. The exclusive range is correct
  here — `de3ba40` was itself the previous promotion SHA and is already on
  production — but note the trap the `de3ba40` entry below documents: that
  range notation excludes its base, and it is only safe when the base is
  already promoted. Oldest promoted commit `f4648ca`, newest `999cbdc`.
- **Rollback = revert all 32 in reverse order**, then push main:
  `999cbdc bf87743 2a7e044 2d0e0d9 7cf96a7 b08f994 a039212 635bb5f 18b8809
  13c332a e7685d0 4e4cb82 24fa108 6fb4b4f 21a80e7 2e75029 096edd7 24eb289
  5119a6b 1024bf6 3784c34 5695aab eabf779 ae61597 736ac99 58589c9 d098530
  f2082ce 426f07c 3536a30 16d1006 f4648ca`
  Faster posture if it comes to it: Vercel → promote the `de3ba40` deployment
  back to current. **The migration is additive and stays either way.**
- **What shipped**, by theme:
  - **DEBT-53 / F1 — cross-org privilege escalation guard** (`5695aab`).
    `getCurrentUser()` no longer returns a `User` row belonging to a different
    organization than the active Clerk org. Verified on staging with log
    evidence. **Security.**
  - **DEBT-54 / F4 — accept-invite fails toward sign-in** (`3784c34`), not
    sign-up. **Security.**
  - **PERM-5 Session B — the override machinery** (`5119a6b`, `24eb289`,
    `096edd7`): `User.deniedCapabilities` via migration `20260804123449`, the
    `can()` override seam, and the Edit User capability grid (20 rows) on a
    footer that now works.
  - **PERM-5 Session C — the 39-site migration sweep** (`6fb4b4f`, `24fa108`,
    `4e4cb82`, `e7685d0`, `13c332a`, `18b8809`, `635bb5f`, `a039212`,
    `b08f994`, `7cf96a7`, `2d0e0d9`, `2a7e044`, `bf87743`, `999cbdc`) —
    inline role checks migrated onto `can()` across Staff, Templates, Stores,
    Reports, Dashboard, purchase-order writes, `/settings`, `/settings/labor`
    and Users; the deniable-list rule (the grid list IS the deniable list);
    and a security fix found mid-sweep — `DELETE /api/staff/[id]` was
    unguarded (`2a7e044`).
  - **DEBT-50 docs package** (`1024bf6`) — rows 53–57 filed, the `DECISIONS.md`
    mechanism entry, and the F3 rulings.
  - **DEBT-55 site 1/21** (`2e75029`, `21a80e7`) — `(app)/layout.tsx`
    org-guards the sidebar's user lookup; four follow-on prompts filed.
  - **Pre-existing closure docs** (`f4648ca`, `16d1006`, `3536a30`, `426f07c`,
    `f2082ce`, `d098530`, `58589c9`, `736ac99`, `ae61597`, `eabf779`) —
    DEBT-9 closed on the production gate walk, DEBT-46 closed on the
    manufacturing paths (Clerk paginated-list drain, invite resolution by
    normalised email, revoke-order fix), DEBT-13/29/43 shipped against
    production, DEBT-51/52 filed.
- **MIGRATION — one, applied on this promotion:**
  `20260804123449_perm5_user_denied_capabilities` — adds
  `User.deniedCapabilities`. **Applied to production by the pipeline's
  `prisma migrate deploy` during this build; the production build log's
  applying-line was confirmed before this entry was written.** Never run by
  hand against production.
  **On rollback: do NOT drop the column.** Reverting the code leaves an unread
  additive column, which is harmless; dropping it is a destructive migration
  against production for no benefit.
- **SMOKE TEST PASSED 2026-08-04 (Gary), on www.usefroot.com, org
  `org_3FhYUR4l0ue7egug1I0Ig8wxOVn`** — every Step 5 checkbox green: the
  capability grid renders on production, **the Vercel production log search
  for "cross-org" returned ZERO lines**, and baselines are unchanged at zero
  denials. Nothing was denied on a production account; day one was observation
  only, by design. Recorded in a follow-up commit after the entry above, per
  the runbook's own "amend or follow-up — note which".
- **ORG ID ATTRIBUTION, corrected here because the contrary is written down
  elsewhere:** `org_3FhYUR4l0ue7egug1I0Ig8wxOVn` is the **PRODUCTION** Clerk
  org (Keva Juice, 5 members) — evidenced by the production Clerk dashboard's
  Organizations list under the Production breadcrumb, and by a production SQL
  query on `br-sparkling-block-a620qvg4` joining `Organization`
  `cf888f2d-f234-48c7-8097-fd5b44b5b3dd` to that `clerkOrgId`. CLAUDE.md
  § Browser Evidence currently attributes the same id to **dev**, alongside
  `org_3FhMmIWVjja5HYpsou8n6rVtZn2`. The reconciliation is the fossil-row
  trap this log already documents: staging/dev were branched FROM production
  and **inherited its `Organization` rows verbatim**, so that `clerkOrgId`
  string is present in the dev/staging DATABASE while the Clerk org itself
  lives on the production instance. **Clerk-side truth wins over a DB row.**
  The dev instance's own Keva Juice orgs are `org_3FhMmIWVjja5HYpsou8n6rVtZn2`
  and one other. CLAUDE.md is NOT edited by this session (scope was two docs);
  the correction is filed for a ruling.

## 2026-08-02 (night) — PRODUCTION promotion (PERM-6/7 closure + P-4 + DEBT-TRIAGE + DEBT-43/13/29 + DEBT-9 Phases 1–3) + DEBT-9 Phase 4 production data

- **Promotion SHA:** `de3ba40` — full: `de3ba40bd3767dec10f81afb313b575e3cd858df`.
  Pushed to `origin/main` 2026-08-02.
- **FAST-FORWARD, not a merge.** `origin/main` was `7b590b3`, which is an
  ancestor of `de3ba40`, and `46d6571`'s parent IS `7b590b3` — the set is
  contiguous. **`git revert -m 1` does not apply.**
- **TWENTY-EIGHT commits, not 27.** Stated explicitly because the range that
  gets quoted, `46d6571..de3ba40`, is git notation and EXCLUDES `46d6571` —
  which is itself unpromoted. The promotion set is `origin/main..de3ba40` = 28.
  A rollback built from 27 would strand `46d6571` on main.
- **Rollback = revert all 28 in reverse order**, then push main:
  `de3ba40 04388f0 4adcb13 5d59cda 18d2f5e 24894fa 5da1008 65c20cb 00e454a
  778cf10 ffee362 790cfc4 04da67f 475e425 06befd2 bc0e43c 5faec45 3d57fb6
  4a058ff 8b855d3 cc1fffc ca64632 1dbe9ca eb95883 3a2f7ac b76860d bed3a9e
  46d6571`
- **What shipped**, by theme:
  - **PERM-6/7 closure and record repair** (`46d6571`, `bed3a9e`, `ca64632`,
    `cc1fffc`, `b76860d`) — invite-gate blocker cleared, Task 7 closed on
    unreachability, DEBT-39/40/44 filed, and the Neon branch-label technique.
  - **P-4** (`3a2f7ac`, `eb95883`) — the roadmap UI learns a blocker entry can
    be resolved; 8 resolved entries migrated. **P-4 ships while still
    `in_progress`, deliberately** (Gary, 2026-08-02): `/internal/roadmap` is
    ADMIN-gated and internal, with no merchant-facing surface, so an
    in-progress phase's UI reaching production carries no tenant risk. Not a
    precedent for merchant-facing phases.
  - **DEBT-TRIAGE-1/2** (`8b855d3`, `4a058ff`, `3d57fb6`, `5faec45`, `bc0e43c`)
    — record halves relocated into the code they fire in, a COST OF DOING
    NOTHING line on every open row, DEBT-19/DEBT-35 closed, DEBT-45/46/47 filed.
  - **DEBT-43** (`1dbe9ca`, `06befd2`, `475e425`, `04da67f`, `790cfc4`,
    `5da1008`, `24894fa`) — universal border reset wrapped in `@layer base`;
    `docs/` excluded from the Tailwind scanner.
  - **DEBT-13** (`ffee362`, `778cf10`) — `/staff` lists staff who work at a
    store but are based elsewhere.
  - **DEBT-29** (`00e454a`, `65c20cb`) — the template form stops claiming the
    availability window works.
  - **DEBT-9 Phases 1–3** (`18d2f5e`, `5d59cda`, `4adcb13`, `04388f0`,
    `de3ba40`) — `StaffMember.isCorporate`, the `primaryStoreName()` corporate
    branch and the training-cert reroute, and the four Phase 3 surfaces
    including the acknowledgments-route server guard.
- **MIGRATION — one, applied on this promotion:**
  `20260802162617_debt9_staff_corporate_location` —
  `ALTER TABLE "StaffMember" ADD COLUMN "isCorporate" BOOLEAN NOT NULL DEFAULT false`.
  Additive, metadata-only on PG 11+, no backfill. Confirmed present on branch
  `production` (`br-sparkling-block-a620qvg4`) after the `de3ba40` build:
  boolean, NOT NULL, default false.
  **On rollback: do NOT drop the column.** Reverting the code leaves an unread
  additive column, which is harmless; dropping it is a destructive migration
  against production for no benefit.
- **DEBT-9 PHASE 4 PRODUCTION DATA — branch `production`
  (`br-sparkling-block-a620qvg4`), org `cf888f2d-f234-48c7-8097-fd5b44b5b3dd`:**
  ids resolved from scratch on the production branch, then
  `UPDATE "StaffMember" SET "isCorporate" = true` keyed on ids and org-guarded,
  **returned exactly 2 rows** — `cmqxfyiwy000004l49ps3w1tf` (Gary Thomas) and
  `cmqxfyjt1000004jtbfzj9jmz` (Kelton Thomas). The confirmation query shows
  exactly those two corporate in the org and nobody else.
  **Production carried 9 assignments and 0 primaries for each** — production is
  the ONLY branch that ever had the condition DEBT-9 describes (staging had 1
  and 3; dev had 9 and 9 but is not a live environment).
- **THE IDS ARE IDENTICAL ON STAGING AND PRODUCTION**, because staging was
  branched from production. `cmqxfyiwy…` and `cmqxfyjt1…` are the same strings
  on both. **A cross-branch paste would have matched silently and succeeded**
  — the `id IN (…) AND "organizationId" = …` guard could not have caught it,
  because every value in it is valid on both branches. The "resolve from
  scratch on each branch" rule held here by discipline, not by enforcement.
  Recorded in CLAUDE.md § Database Evidence, since it fires on any cross-branch
  database work, not only this row.
- **DEBT-9 STAYS OPEN.** The flags are live on production; the GATE is not
  satisfied. Still owed: the four-phase ceremony walk as a corporate member,
  the frozen `HrDocumentAcknowledgment.storeName` read back as "Corporate",
  the rendered PDF's Store line, and a non-corporate walk proving the picker's
  selection is what gets stamped. Phase 3's (a), (c) and (d) still carry NO
  rendered evidence. See the GATE paragraph on the DEBT-9 row.
- **Verification owed AFTER this promotion** — three rows shipped at
  `status: staging` and their checks are re-run against production per the
  convention in the entries below: **DEBT-43** (borders render; `npm run dev`
  unaffected), **DEBT-13** (`/staff` "Also works here" block for a
  multi-store member), **DEBT-29** (template form copy). Flip all three to
  `shipped` with `de3ba40` once confirmed.

## 2026-08-02 (evening) — STAGING deploy + DEBT-9 Phase 4 staging data — NOT a promotion

- **Staging SHA:** `04388f0` — full: `04388f0e1423ce7ac74f884273f79696412a5695`.
  Pushed to `origin/staging` 2026-08-02. **`origin/main` remains `7b590b3` —
  nothing was promoted to production.**
- **Deployed SHA confirmed** on `froot-git-staging-indianathomas-2483s-projects.vercel.app`
  → `dpl_39Up3adkojKwsr3iapuZeZGm6EvX`, READY. **Note the method, because the one
  in CLAUDE.md no longer works:** `vercel inspect --json` returns a trimmed object
  on CLI 58.4.4 with no git metadata at all, so the documented
  `| grep -i githubCommitSha` finds nothing. Confirmation was instead
  `vercel ls --meta githubCommitSha=<FULL 40-char sha>` returning the same
  deployment the staging alias points at. The short SHA does not match — the
  filter compares the full value.
- **Migration applied by the build:** `20260802162617_debt9_staff_corporate_location`
  — `ALTER TABLE "StaffMember" ADD COLUMN "isCorporate" BOOLEAN NOT NULL DEFAULT false`.
  Additive; existing rows unaffected (false = homed at a store = prior behaviour).
- **DEBT-9 Phase 4 DATA — branch `preview/staging` (`br-square-feather-a63z92vz`),
  org `cf888f2d-f234-48c7-8097-fd5b44b5b3dd`:**
  `UPDATE "StaffMember" SET "isCorporate" = true`, keyed on ids and org-guarded,
  returned **exactly 2 rows** — `cmqxfyiwy000004l49ps3w1tf` (Gary Thomas) and
  `cmqxfyjt1000004jtbfzj9jmz` (Kelton Thomas), both ACTIVE. Query 4c confirms
  those two are the only corporate members in the org.
  The BEFORE/AFTER fingerprint pair was skipped. `RETURNING` proving exactly two
  rows changed, plus 4c showing exactly two corporate now (therefore zero
  before), covers what the fingerprint was for.
  **Staging is not shaped like production:** assignment counts there are 1 and 3,
  not 9 each. Staging does not reproduce the nine-store ambiguity DEBT-9 exists
  for.
- **Production: NOT done.** Phase 4 production SQL is pending and must resolve
  both members' ids on `production` from scratch — no staging id may be reused.
- **Gate NOT satisfied.** DEBT-9 carries a GATE ON THE PHASE 4 PROMOTION: the
  four-phase ceremony walk, the frozen `HrDocumentAcknowledgment.storeName` read
  back as "Corporate", and the PDF's Store line. It could not run here — Clerk's
  `verified-snapper-7` instance is shared by local and staging, and the
  browser-reachable account belongs to exactly one org, which is not
  `org_3FhYUR4l0ue7egug1I0Ig8wxOVn` (DEBT-50). Adding the membership was
  considered and rejected: the webhook may not reach staging, leaving a session
  that is an org member with no `User` row. **The walk moves to PRODUCTION after
  Phase 4 production**, against the real nine-assignment accounts.
- **Unpromoted stack: 27 commits**, `46d6571..04388f0` inclusive — `46d6571`
  itself is not an ancestor of `origin/main`. Spans PERM-6/7 closure, P-4,
  DEBT-TRIAGE-1/2, DEBT-43, DEBT-13, DEBT-29 and DEBT-9 Phases 1–3. The
  production promotion entry, with its own SHA and verification list, is owed
  separately when that happens.

## 2026-08-01 (evening) — PRODUCTION promotion (DEBT-SWEEP + the audit relocation)

- **Promotion SHA:** `97ed309` — full: `97ed30949a5d5be875a1a957a6beb9664a4855cf`.
  Pushed to `origin/main` 2026-08-01 18:24.
- **FAST-FORWARD, not a merge.** Parent is `63407be` (the entry below), so
  **`git revert -m 1` does not apply**. Rollback is reverting the six commits in
  reverse order (`97ed309`, `cde5022`, `cf0b044`, `89c70f7`, `6f33427`,
  `9508d4c`) → push main.
- **What shipped**, six commits, the DEBT-SWEEP quick-closure batch:
  - `9508d4c` — three stale model descriptions corrected and the Square-sync audit
    method relocated into PERMISSIONS_INVENTORY.md (DEBT-26, DEBT-31, DEBT-6, L-1).
  - `6f33427` — route capability check, storeIds dedupe, payload-based Clerk error
    guard (DEBT-20, DEBT-11, DEBT-15).
  - `89c70f7` — `prefer-const` on hr-signed-pdf's inline mark size (DEBT-33, partial).
  - `cf0b044` — `withdrawn` added to `PhaseStatus` for retracted rows (the DEBT-18 /
    DEBT-23 ruling).
  - `cde5022` — nine debt rows closed with their SHAs; DEBT-37 filed.
  - `97ed309` — `DEBT-1_AUDIT.md` and `DEBT-2_AUDIT.md` moved into `docs/prompts/`,
    every live reference repointed, both conventions recorded.
- **Migrations: none.** `git diff --stat 63407be..97ed309 -- prisma/` is empty.
  Nothing in this promotion touched the schema.
- **Verification — six checks, run by Gary on staging and RE-RUN against
  production after the promotion:**
  1. **Deployed SHA confirmed `97ed309` on both environments** — the
     CLAUDE.md § Staging Verification precondition, satisfied before any other
     check was read.
  2. **DEBT-11** — edited staff member Tommy Thomas (Las Brisas) and saved
     **without** changing stores. Store assignments survived with the Primary star
     intact. This is the tell for the `undefined`-vs-`[]` path: `storeIds` is
     `.optional()` on this route, so an undefined value must still mean "leave
     assignments alone" after the dedupe. The naive one-liner the DEBT-11 row
     originally proposed would have thrown here — see that row's drift finding.
  3. **DEBT-15** — `/users` → Invite with `corporate@keva.com`, an address that
     already has a login. The **409 rendered in the dialog with the plus-address
     suggestion**, not a generic "Bad Request". Two things worth recording:
     - This also **confirms DEBT-16's prediction** — the dialog surfaces the
       server's text, which already carries the suggestion. The missing client-side
       pre-check therefore stays polish, not a correctness gap.
     - **The first attempt tested the WRONG SURFACE.** A staff member was created
       with a duplicate email and the success read as a possible bug. That is a
       different path with no uniqueness constraint. **Test the invite path, not
       the staff form** — recorded so the next reader does not repeat it.
  4. **DEBT-20** — `/staff` → "Sync Locations from Square" as admin: worked, no 403.
     The capability check resolves the same as the inline `isAdmin` it replaced.
  5. **DEBT-33** — HR signed PDF (Dress Code Policy, record `9DFF7BA437AC`) renders
     its inline signature and date. The `prefer-const` change touched nothing.
  6. **`/internal/roadmap`** — 15 open, 22 resolved.

## 2026-08-01 (afternoon) — PRODUCTION promotion (DEBT-1, DEBT-2 and the 07-30 debt batch)

- **Promotion SHA:** `63407be` — full: `63407beb02b931c242026add85e0a7bfa94669a7`.
  Pushed to `origin/main` 2026-08-01 16:27.
- **FAST-FORWARD, not a merge.** Parent is `493175e` (the BUILD-2 promotion below),
  so **`git revert -m 1` does not apply**. Rollback is reverting the twenty-one
  commits in `493175e..63407be` in reverse order → push main.
- **What shipped**, twenty-one commits spanning 2026-07-30 to 2026-08-01:
  - **DEBT-1 / DEBT-1b** (`c17ccc1`, `c01a2b1`) — the canonical `operationalPhase`
    enforced at every write path via `src/lib/phases.ts`, plus the remediation
    record. **This is the promotion that plugs the writers**; see the 2026-07-31
    backfill entry below, whose closing line — "production runs unplugged writers
    over clean data" — this entry ends.
  - **DEBT-2 / DEBT-2a / DEBT-2b** (`bceca47`, `5003d65`, `31ef9a0`, `63407be`) —
    the `sectionName` characterization audit and the write-path hardening. No data
    step was needed; all three branches measured clean.
  - **DEBT-3 + DEBT-25** (`6b36471`) — WORKFLOW.md §3's migration flow, and the
    removal of the `meta.updated` bump from the session-completion rules.
  - **DEBT-5** (`838ad99`) — `/users` store chips carry number and name.
  - **DEBT-7** (`705584f`) — STAGING_SETUP.md marked aspirational, its dangerous
    `DATABASE_URL` advice warned at.
  - **DEBT-17 + DEBT-22** (`84437e5`) — the invited role resolved from
    `PendingInvite`; the last unordered `storeAssignments` load given an `orderBy`.
  - **DEBT-21** (`70ee3c8`) — debt commit SHAs coerced to strings in the generator.
  - **DEBT-24** (`f646bf6`) — `meta.updated` deleted; this commit also carried the
    BUILD-2 close-out and DEBT-23's withdrawal.
- **Migrations: none.** `git diff --stat 493175e..63407be -- prisma/` is empty.
  DEBT-1b's backfill was deliberately **not** a committed migration — it ran as
  one-off approved SQL per branch in the Neon console. The full reasoning is in the
  2026-07-31 entry below and in `docs/prompts/DEBT-1_AUDIT.md`; the short version is
  that a migration file would have fired unattended during a Vercel build, taking
  the operator's hand off a production mutation DEBT-1 always required be approved
  per statement, per branch.
- **Verified in production (Gary):** the Mid-Shift template form shows
  **"During the Day"** — the canonical value, rendered by the promoted code over
  the already-backfilled production data. DEBT-1 moves to `verified` on this
  evidence; every other row in this promotion is `shipped`, with no prod smoke test
  recorded.

## 2026-07-31 — DATA BACKFILL, all three branches (DEBT-1b operationalPhase) — NOT a promotion

- **This entry is not a deploy.** No code reached production and no migration ran.
  It is logged here because it is the first time approved SQL mutated all three
  Neon branches by hand, and the mechanism ruling that chose that route belongs
  in the deploy record.
- **Mechanism, ruled 2026-07-31:** one-off approved SQL per branch in the Neon
  console, **not** a committed data-migration file. `prisma/` was outside the
  session's writable set; a migration would have fired unattended during a Vercel
  build, taking the operator's hand off a production mutation that DEBT-1 has
  always required be approved per statement, per branch. Full reasoning and the
  named residual are in `docs/prompts/DEBT-1_AUDIT.md` § DEBT-1b remediation record.
- **The statement**, identical on every branch, idempotent by exact equality:
  ```sql
  UPDATE "Template" SET "operationalPhase" = 'During the Day'
   WHERE "operationalPhase" = 'During Hours'
  RETURNING id, name, "organizationId", "operationalPhase" AS new_phase;
  ```
- **Rows changed, in the order run — dev → preview/staging → production**, each
  branch separately approved, each verified immediately after:
  - **branch `dev`** — 1 row (`cmqx004mk001d3apdv3b6h4mj`). Run by Claude via
    local `.env`, inside a transaction that rolls back on any count but 1.
    `non_canonical_remaining = 0`.
  - **branch `preview/staging`** — 2 rows (`cmqx004mk001d3apdv3b6h4mj`,
    `cmrgrwfxn001d04ju93cwc8v1`). Run by Gary. `non_canonical_remaining = 0`.
    The `UPDATE` was accidentally run a second time and returned **no rows** —
    the idempotent `WHERE` working as designed, and an independent confirmation
    that nothing non-canonical survived. The first run's `RETURNING` output was
    lost and was reconstructed by `SELECT` on the two known ids.
  - **branch `production`** — 1 row (`cmqx004mk001d3apdv3b6h4mj`). Run by Gary,
    **once**, `RETURNING` captured. `non_canonical_remaining = 0`.
- **No DDL, no schema change, no `_prisma_migrations` row.** Code rollback and
  data rollback are fully independent here: reverting `c17ccc1` restores the old
  writers but leaves the data canonical, which is harmless — the alias still
  reads legacy values, and nothing enforces the field at runtime (DEBT-29).
- **Rollback of the data**, if it were ever wanted, is the mirror statement per
  branch — but it would reintroduce a known-bad value and there is no reason to.
- **Code state after this entry:** `c17ccc1` (the writer fix) is on branch
  `staging` and **not** in production. Until `staging → main` is promoted,
  production runs unplugged writers over clean data. See DEBT-1's row.

## 2026-07-29 (evening) — PRODUCTION promotion (BUILD-2 default store + one-primary-store index)

- **Promotion SHA:** `493175e` — full: `493175ee337dd628d56c77a4a84e9b2600ae0759`.
  Pushed to `origin/main` 2026-07-29 21:59. *"(evening)" added to this heading
  2026-08-01 by DOCS-2 — purely disambiguating, since the 746c1be entry below is
  also dated 2026-07-29 and this file's order is the thing it exists to convey.
  The time is from `git reflog show main`; nothing else in this entry changed.*
- **FAST-FORWARD, not a merge — the rollback differs from every entry below.**
  `origin/main` HEAD has a **single parent** (`f480568`), so there is no merge
  commit and **`git revert -m 1` does not apply**. Rollback is reverting the four
  commits in reverse order (`493175e`, `f480568`, `944dfa3`, `118a02d`) → push main.
- **⚠️ Reverting the code does NOT undo the schema.** `118a02d` carries two
  migrations that `prisma migrate deploy` has already applied to the production
  database. Reverting it removes the migration *files* but leaves
  `User.defaultStoreId` and `StoreStaffAssignment_one_primary_key` in place, and
  leaves both rows in `_prisma_migrations`. Removing either would need a NEW
  forward migration — never by hand, and never by deleting ledger rows. This is
  the first entry in this log where code rollback and schema rollback come apart.
- **What shipped:** BUILD-2 — `User.defaultStoreId` (nullable FK, `onDelete: SetNull`),
  a partial unique index enforcing one primary store per staff member, the Default
  Location select in the Edit User modal, PATCH write-time validation
  (`src/lib/default-store.ts`), the device-account provisioning default in the Clerk
  webhook, and Task 8's `primaryStoreName()` internal tie-break.
- **Migrations: two**, both applied via `prisma migrate deploy` in the Vercel build:
  - `20260729124105_build2_user_default_store` — additive. `ALTER TABLE "User" ADD
    COLUMN "defaultStoreId" TEXT` plus an FK `ON DELETE SET NULL`. No table rewrite,
    no backfill.
  - `20260729145504_build2_staff_one_primary_store` — `CREATE UNIQUE INDEX
    "StoreStaffAssignment_one_primary_key" ON "StoreStaffAssignment"("staffMemberId")
    WHERE "isPrimary"`. **Hand-authored** — not expressible in `schema.prisma`
    (no `WHERE` on `@@unique`); see MIGRATIONS.md § Protected indexes. Fail-closed:
    aborts rather than corrupting if a duplicate primary exists.
- **Pre-checks:** Query A (duplicate primaries) returned **zero rows on branch
  `production`** (2026-07-27, re-run 2026-07-29/30) and **zero rows on branch
  `preview/staging`** (2026-07-29).
- **Post-promotion verification is INCOMPLETE.** The column and index were confirmed
  present on branch **`preview/staging`** only — *not* on branch `production` — and
  none of BUILD-2's five UI checks have been run. The phase is `shipped`, not
  `verified`, for exactly that reason.
- **Note:** consumption belongs to UX-2. Until it lands, setting a default store has
  no visible effect beyond the Edit User modal — expected, not a defect.

## 2026-07-29 (morning) — PRODUCTION promotion (PERM-6 + PERM-7 + DEBT-8 + DEBT-10 + DEBT-14)

- **Promotion SHA:** `746c1be` — full: `746c1be71079ce0e1e1701cfba7f3e8555d5728f`.
  Pushed to `origin/main` 2026-07-29 08:24 — i.e. **before** the BUILD-2 promotion
  in the entry above, which went out the same day at 21:59.
- ***Recorded retroactively 2026-08-01 by DOCS-2 — this entry was missing for three
  days.*** It was found from `git reflog show main`, not from this log, and not from
  `git log --merges`, which finds nothing here. Filed as its own debt row,
  **DEBT-38**, together with the mechanism. It is **not** evidence for DEBT-23's
  withdrawn "second occurrence" reasoning, which remains withdrawn and false; this
  is the first genuine recurrence, established independently.
- **FAST-FORWARD, not a merge.** Parent is `17dc723`, so **`git revert -m 1` does
  not apply**. Rollback is reverting the twenty-one commits in `17dc723..746c1be`
  in reverse order → push main.
- **What shipped**, twenty-one commits:
  - **PERM-6** (`d4a6bdc`) — store-assignment integrity: `storeIds` validated on
    every write, the Square locations route gated, the forecasting `isAdmin` fusion
    split.
  - **PERM-7** (`6530d8b`, `bae09ed`) — store device logins provisioned from
    `/stores`, Square-seeded email, role-aware badge. `6530d8b` is **DEBT-8**
    (PERM-7 Task 0), committed separately per Ruling 1: `Store.contactEmail`
    populated from Square `business_email`.
  - **DEBT-10** (`2877b41`) — `GET /api/square/team-members` gated at
    `staff.sync.square`; the Square spread replaced with a field allow-list.
  - **DEBT-14** (`46e1b64`) — the internal roadmap debt section now splits on a
    row's `status`.
  - The remaining fourteen are docs: the PERM-5/6/7, BUILD-2 and UX-2 session
    prompts, the roadmap reconcile, the BUILD-2 production pre-check, and three
    permission rulings.
- **Migrations: none.** `git diff --stat 17dc723..746c1be -- prisma/` is empty.
- **Verified in production 2026-07-29 (Gary):** **DEBT-10** — a STORE account
  (Las Brisas) received 403 and an ADMIN received 200 on the gated route; and
  **DEBT-14** — the roadmap page's resolved-debt split renders. Both rows are at
  `verified` on that evidence. PERM-6, PERM-7 and DEBT-8 have **no prod smoke test
  recorded** and are `shipped`.
- **⚠ PERM-6's promotion gate was never confirmed.** Its blocker reads "SINGLE
  PROMOTION UNIT WITH PERM-7 — NEITHER PHASE REACHES MAIN UNTIL ONE REAL INVITE RUNS
  START TO FINISH ON STAGING." Both phases reached main in this promotion **without
  that gate being confirmed** — Gary has no clear recollection of the invite running
  end-to-end, and unknown is not satisfied. **The blocker stays open** and will be
  cleared with real evidence, not from memory. So the invite → `PendingInvite` →
  webhook-acceptance path is in production still unexercised end-to-end.
- **Two docs-only fast-forwards bracket this promotion and are deliberately not
  given their own headings**, since they carried no code: `17dc723`
  (2026-07-27 17:49, recording the 07-27 promotion and BUILD-1/BUG-3/SQ-2 verified
  in production) and `18220bb` (2026-07-29 10:15, recording DEBT-10 and DEBT-14
  verified in production). Both are ROADMAP.yaml edits only, neither touched
  `prisma/`. They are named here so a reader reconstructing main's history from
  `git reflog` can account for every push.

## 2026-07-27 — PRODUCTION promotion (PERM-2 + PERM-3 + BUILD-1 + SQ-1 docs + roadmap dashboard)

- **Merge commit / rollback SHA:** `06b1561` — full: `06b156108688061a8a4bfdb56af1d945a8a56676`
  (rollback: `git revert -m 1 06b156108688061a8a4bfdb56af1d945a8a56676` → push main;
  pre-merge tag `pre-staging-merge-20260727-1427` also on origin). Parents `0363b2f`
  (main) and `5e8effc` (staging). **74 files changed, +4002 / −179.**
- **What shipped:** PERM-2 permission-contradiction resolution (`979da0b` — §3 #2/#3/#4/#5/#6/#8
  via the capability layer, incl. the security fix for a completely unguarded
  `POST /api/staff`), PERM-3 MANAGER forecast read window + forecasting store scoping
  + affordance gating (`b8f32bb`), BUILD-1 vercel-build split (`6a77e68`), the SQ-1
  token-refresh audit write-up (`f93b906`/`9bd61c7`/`056943f`), the P-3 live
  `/internal/roadmap` dashboard (`3902d5c`), and the DOCS-2 roadmap reconcile
  (`5e8effc`).
- **Migrations:** **none.** `git diff --stat pre-staging-merge-20260727-1427..HEAD -- prisma/`
  returned empty. Production build log confirms: `31 migrations found; No pending
  migrations to apply.`
- **Merge conflict:** one, `docs/ROADMAP.yaml` — expected, since main carried the SQ-2
  cherry-pick (`9dc6dc0`) while staging carried its own SQ-2 row plus the whole DOCS-2
  reconcile. Resolved by taking **staging's superset**, which had already been written
  to match main's SQ-2 note verbatim for exactly this reason. No content lost from
  either side.
- **Verification results (5):**
  - **BUILD-1 — verified in production.** Log shows `Running "npm run vercel-build"` →
    `prisma migrate deploy && npm run build`, then `31 migrations found`. Proves both
    that `vercel-build` is picked up by @vercel/next AND that migrate deploy actually
    runs. This satisfies BUILD-1's own verification step 3, in prod rather than the
    staging log it asked for. Status flipped `in_progress` → `shipped`.
  - **BUG-3 — proof finally recorded; closed.** Datasource resolved to the DIRECT
    endpoint in both logs, neither host ending `-pooler`: staging (13:14)
    `ep-odd-rain-a6gr4xmm`, production (14:49)
    `ep-green-smoke-a6xthq4r.us-west-2.aws.neon.tech`. Decisively, **neither log
    contains the `[prisma.config] DATABASE_URL_UNPOOLED is not set` fallback
    warning** — the negative evidence a green deploy alone could never provide,
    since the fix is a `??` fallback that would have deployed green either way.
  - **F-1 — cron execution confirmed.** Vercel → Observability → Cron Jobs, Production,
    last 12h: `/api/cron/sales-reconcile` (0 11 * * *) 1 invocation P75 **14s**;
    `/api/cron/pace-alerts` (0 15 * * *) 1 invocation P75 **30s**. Durations in the tens
    of seconds prove completion, not a millisecond 401 rejection.
  - **SQ-2 — token refresh confirmed in production; the 08-06 expiry risk is CLOSED.**
    Production logs 2026-07-26 21:39:15, on both `/api/dashboard/summary` and
    `/api/dashboard/sales`: `[square] token refresh success org=cf888f2d-…`
    `expiresAt=2026-08-06T02:48:55.000Z -> 2026-08-26T04:39:18.000Z`. Fired on the first
    Square-touching request after promotion, exactly as the 23-day window predicted.
  - **SEC-1 — PARTIAL.** As ADMIN in prod, `fetch('/api/square/auth',{redirect:'manual'})`
    returned `0 opaqueredirect`, so the legitimate connect path still works and the
    deny-by-default change caused no regression. The **403-for-non-ADMIN half remains
    untested and is currently untestable** — no non-ADMIN account exists in the
    production Clerk instance. Logged as a new open item (create a production test
    account); every role verification to date has run through staging's Clerk DEV
    instance.
- **Also verified:** the P-3 roadmap dashboard renders at `/internal/roadmap` with
  "Jul 27, 2026 · from the git commit date of docs/ROADMAP.yaml" — the shallow-clone
  `unknown` fallback did **not** fire.
- **Post-promotion env change:** Gary scoped the Jun 26 `DATABASE_URL` row from
  *Production and Preview* to **Production only**; production redeployed successfully
  afterward (Datasource still `ep-green-smoke`), proving the value survived the edit.
  This closes the fail-open half of BUILD-1's blocker. The remaining half — no
  generic Preview-scoped `DATABASE_URL`/`DATABASE_URL_UNPOOLED`, so non-staging
  preview builds now fail at build time — is **deliberately deferred**; it costs
  nothing while only `staging` and `main` are pushed, and blocks only the deferred
  second-developer plan.

## 2026-07-26 — PRODUCTION promotion (PERM-1 + SEC-1 + BUG-3 fix)

- **Merge commit / rollback SHA:** `c463af3` — full: `c463af3482b1be4955c9e35b221e01db26f90eba`
  (rollback: `git revert -m 1 c463af3482b1be4955c9e35b221e01db26f90eba` → push main).
  Parents: `1ba059c` (previous main) and `95df9aa`.
- **What shipped:** PERM-1 permission capability shim (`6f70465`: enforcement
  inventory, capability registry, `can()`/`scope()`, sidebar nav pilot,
  zero behavior change), SEC-1 Square OAuth hardening (`ecee728`: session-org
  binding, 32-byte state nonce via double-submit httpOnly cookie, ADMIN gate on
  `/api/square/auth` and `/api/square/disconnect`), and the BUG-3 fix (`f6818f1`:
  `prisma.config.ts` routes Prisma CLI through Neon's direct endpoint).
- **Migrations:** none. SEC-1 Part B was chosen specifically to avoid a schema
  change, and BUG-3 is connection routing only.
- **Open prod-verification items:** SEC-1's ADMIN gate was never smoke-tested in
  production — verify a non-ADMIN gets 403 on `/api/square/auth`. **Do not test via
  Disconnect**, which revokes Keva Juice's live Square token. BUG-3's required proof
  (a build log showing the `Datasource "db"` host WITHOUT `-pooler`) is still
  unrecorded, which is why BUG-3 remains `in_progress` despite being in prod on both
  branches.
- *Recorded retroactively 2026-07-27 during the DOCS-2 reconcile — this entry was
  missing when the promotion happened.*

## 2026-07-25 — PRODUCTION promotion (HR-17 training preview)

- **Merge commit / rollback SHA:** `1ba059c` — full: `1ba059c03a9a2603eb1d1da3976e1e8d8ee6db1e`
  (rollback: `git revert -m 1 1ba059c03a9a2603eb1d1da3976e1e8d8ee6db1e` → push main).
  Parents: `59a6cdc` (previous main) and `da413bd`.
- **What shipped:** HR-17 only (`438a9ef`, built 7-24) — training builder "Save &
  Preview" opens the trainee renderer read-only, through the same extracted
  `TrainingModuleView` the `/my` execution page uses. Read-only by construction:
  preview carries no `assignmentId`, so neither write endpoint is reachable. Gated
  ADMIN/MANAGER, manager limited to modules applying to their stores; the resource
  download route's admin tier widened to the manage tier for the same scope.
- **Migrations:** none — HR-17 has no schema changes.
- **Attribution note (verified 2026-07-27):** this promotion carried HR-17 **only**.
  PERM-1 (`6f70465`) and SEC-1 (`ecee728`) are **not** ancestors of `1ba059c` —
  confirmed with `git merge-base --is-ancestor` (false for both) and
  `git log --ancestry-path 6f70465..origin/main`, whose first merge is `c463af3`.
  They shipped 07-26 in the entry above, not here.
- *Recorded retroactively 2026-07-27 during the DOCS-2 reconcile — this entry was
  missing when the promotion happened.*

## 2026-07-24 — PRODUCTION promotion (HR-11b + HR-11c) + HR LAUNCH

- **Merge commit / rollback SHA:** `59a6cdc` — full: `59a6cdcc4a989baf32951cc0f5d3db7863b378cc`
  (rollback: `git revert -m 1 59a6cdcc4a989baf32951cc0f5d3db7863b378cc` → push main;
  pre-merge tag `pre-staging-merge-20260724-2107` also on origin).
- **What shipped:** HR-11b field anchoring & inline stamping (DocumentAnchor model,
  server-side detection via new dep `unpdf`, admin confirm/rescan UI, per-signature
  checkpoints + timestamps), HR-11c ceremony fixes (anchor dedup, affordance-at-line,
  identity chips, legal Full Name capture + Square writeback), DECISIONS.md.
- **Migrations:** 2 additive (`20260723220118_hr11b_document_anchors`,
  `20260724153903_staff_legal_name_lock`) applied via `prisma migrate deploy` in the
  Vercel build. Pre-merge audit: no conflicts, no destructive SQL, no new env vars,
  local `next build` green before and after the merge.
- **HR LAUNCH:** `HR_MODULE_AVAILABLE=true` added to the Vercel **Production** scope
  post-push + redeploy (aliased to www.usefroot.com). Per-org `activeModules` "hr"
  toggle still flips in Settings per org.
- **Open prod-verification items (carried from HR-11c blockers, not re-tested
  pre-promotion):** certificate org-name ("Microsoft") re-test in prod; mobile
  visual QA of lift offsets on /my signing.

## 2026-07-23 — PRODUCTION promotion (HR-8 → STAFF-1 batch)

- **Merge commit / rollback SHA:** `942bc59` — full: `942bc591309a7f6fafee9089a9606db103a6ff6c`
  (rollback: `git revert -m 1 942bc591309a7f6fafee9089a9606db103a6ff6c` → push main).
- **What shipped:** HR-8 compliance rollup, BUG-1 steps 1–3 + BUG-2 fixes, UM-1
  user-management fixes, HR-15/HR-15b rehire + signing cycles, STAFF-1 (staff
  `/my` experience, nav matrix, HR-11 inline signing ceremony, BUG-1 step 4),
  DOCS-1 docs consolidation.
- **Migrations:** 1 additive (`20260723180000_hr15b_signing_cycles`) applied via
  `prisma migrate deploy` in the Vercel build.
- **Note:** HR stays dark in prod (`HR_MODULE_AVAILABLE` unset in Production).
- *Recorded retroactively 2026-07-24 during the Roadmap Tier-0 session — this
  entry was missing when the promotion happened.*

## 2026-07-21 — PRODUCTION promotion (L-3 + HR/Labor backlog)

- **Event:** first `staging → main` promotion in a while; `main` had drifted **53 commits behind** staging, so this promotion carried the **entire backlog**, not just L-3.
- **Merge commit / rollback SHA:** `9743899` — full: `974389946392dbacfca08f8add66264f8219e26b`
  (rollback: `git revert -m 1 974389946392dbacfca08f8add66264f8219e26b` → push main).
- **What shipped:** L-3 Weekly Plan (floor-first daily split, GM 40-hr cap, cross-day rebalancing) **plus the full HR module** (HR-0…HR-7.6) **and the Labor foundation** (pre-reset L-0…L-3).
- **Migrations:** 11 additive migrations applied to production Neon via `prisma migrate deploy` in the Vercel build — **succeeded** (a first redeploy hit the transient Prisma P1002 Neon-pooler timeout; a retry went green). No destructive ops, no data rewrites. See `MIGRATIONS.md`.
- **Post-promote:** enabled Labor in prod (`LABOR_MODULE_AVAILABLE=true` added to the **Production** env scope + org `activeModules` "labor" toggle); HR left dark. Prod forecast plan was regenerated (see `DECISIONS.md` — it was stale per-environment data, unrelated to this promotion).

> **Renamed 2026-07-22:** was `STAGING_DEPLOY_LOG.md`; renamed to `DEPLOY_LOG.md` (DOCS-1 consolidation) since it records both staging and production events. Splitting into separate staging/prod logs remains a future option if the mixed log gets noisy.
