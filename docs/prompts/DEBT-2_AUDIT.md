# DEBT-2 — `sectionName` audit (DEBT-2a)

Audit run 2026-08-01 against checkout `bb1f578` (branch `staging`). **Read-only
session**: every statement executed was a `SELECT`, all against Neon branch
`dev` via local `.env`. No mutation ran on any branch, and no staging or
production connection string was obtained, requested, or used. DEBT-2 is not
closed by this file — it stays open; remediation is DEBT-2b.

DEBT-1 is closed at `status: staging` and was not re-opened or contradicted here.

---

## 1. The characterization verdict

**The row's premise does not survive contact with the schema. There is no
`section` field.**

A catalog query over every column in `public` whose name contains `section`
returned, on **branch `dev`**, exactly one row: `Task.sectionName`, `text`,
`NOT NULL`, no default. Across all 79 Prisma models there is no `Section` model
and no `sectionId`. `prisma/schema.prisma:309` and
`prisma/migrations/20260627002005_init/migration.sql:130` both say `sectionName`,
and no migration has ever altered it. The identifier `section` exists **only in
application code**, in three unrelated roles, none of which is a field: a local
object key in the seed script's data literal
(`scripts/import-keva-templates.ts`, mapped to `sectionName` at `:363`); a
destructuring variable in three render sites; and `<section>` tags plus
`.section` CSS classes in the print pages, which are a coincidence of spelling.
`task_section` is neither — it is the CSV wire-format column name
(`export/route.ts:30`, `import/route.ts:60`), mapped to `sectionName` at
`import/route.ts:148`.

So this is **one piece of data wearing a different name on each layer
boundary** — DB and Prisma `sectionName`, API JSON `sectionName` (pass-through
in both directions), CSV `task_section`, seed-script literal `section` — and
**not** an unfinished rename, a denormalised copy, or an API field mapped to a
different column. There is no Section entity, so there is no id-and-text pair
that can disagree, and **the disagreement queries Question 2 called for are N/A
by construction** rather than by assumption: the catalog query found one column,
and a bounded sweep of all eight `Json` columns in the schema returned zero hits
for the substring on `dev`.

There is a real ambiguity here; it is simply not the one the row named.
**`Task.sectionName` is free text with no entity behind it.** A "section" is not
a thing in this system — it is a `GROUP BY` over a string, recomputed
independently at five render sites. That is a modelling gap, not a dirty-value
problem, and it is why the fix shape differs from DEBT-1's at every point.

---

## 2. Blast radius

**Unlike DEBT-1's field, this one is not inert** — `sectionName` is the sole
grouping key on every checklist surface a store employee touches. But the drift
measured **zero on all three branches**: `dev` 29 distinct spellings / 29
distinct `lower(btrim())` over 210 tasks, `preview/staging` the same 29 / 29 over
exactly twice the rows, `production` identical to `dev` on all 29. So the radius
today is entirely *latent* — the defect described below is a thing the code
permits, not a thing the data has done.

What a drifted or empty row causes:

| Effect | Site | Severity |
|---|---|---|
| One section renders as two headings, tasks split across them, mid-shift, in front of staff | `checklist-execution-client.tsx:73-77`, `:181-186` | user-visible |
| Same split on the printed checklist and the template detail page | `print/checklist/[id]/page.tsx:40-47`, `print/template/[id]/page.tsx:21-26`, `templates/[id]/page.tsx:22-28` | user-visible |
| **"Select all in section" silently omits tasks** — exact `===`, so a whitespace twin is excluded from a bulk edit with no warning | `template-form.tsx:391-392`, `:490` | **silent wrong result — worst of the set** |
| Two identical headings from *undrifted* data, because the header row keys off adjacency rather than identity | `template-form.tsx:489` | cosmetic |
| A near-duplicate joins the autocomplete list and propagates itself | `template-form.tsx:373`, `:425-427` | amplifier |
| The "N sections" stat counts variants as separate sections | `template-form.tsx:837` | cosmetic |

**Empty string behaves four different ways across five sites** — `"General"` at
`templates/[id]/page.tsx:24`, `print/template/[id]/page.tsx:22` and
`print/checklist/[id]/page.tsx:42`; a **blank heading** at
`checklist-execution-client.tsx:74`; `"No section"` at `template-form.tsx:506`.
This is the defect most likely to be seen, because `""` is reachable through the
UI with no validation at all (writer 6, §5).

**One structural property worth recording, because nothing else in the repo
states it:** `Checklist` does **not** snapshot task data — `api/checklists/route.ts:122`
and `:156` store only ids, and `TaskLog` carries no section. So renaming a
section **retroactively rewrites the headings on every historical completed
checklist and its print copy**. There is no as-executed record of section names
anywhere in the system. This is tracked as DEBT-36.

**Consequence for sequencing:** the realised risk is confined to writer 6 and
the empty-value divergence. Both are small and neither needs a data migration.

---

## 3. Code sites

### (a) Touches one field only, coherently

Reads, groups, displays; all `Task.sectionName`, none compared against anything
else:

| Site | Note |
|---|---|
| `templates/[id]/page.tsx:22-28`, `:70-73` | groups, `\|\| "General"` |
| `print/template/[id]/page.tsx:21-26`, `:90-92` | groups, `\|\| "General"` |
| `print/checklist/[id]/page.tsx:40-47`, `:139-141` | groups, `\|\| "General"` |
| `checklist-execution-client.tsx:18`, `:73-77`, `:181-186` | groups into a `Map`, **no `\|\| "General"` fallback** |
| `template-form.tsx:373` | `sectionNames` — the datalist source |
| `template-form.tsx:391-392` | `toggleSection`, exact `===` |
| `template-form.tsx:489-490`, `:499`, `:506` | header row on **adjacency**, not identity |
| `template-form.tsx:837` | distinct-section count stat |
| `template-form.tsx:29`, `:93`, `:304`, `:357`, `:426`, `:440` | type/UI plumbing |
| `templates-client.tsx:35` · `api/templates/route.ts:18`, `:85` · `api/templates/[id]/route.ts:33` · `store-view/checklist/[id]/page.tsx:21` | type or select pass-through |

No `orderBy` on the column anywhere. On **branch `dev`**, no index on it —
`Task_pkey` only.

### (b) Maps or copies between names — the skew factories

| Site | Mapping | Lossy? |
|---|---|---|
| `scripts/import-keva-templates.ts:363` | `section` → `sectionName` | no |
| `api/templates/export/route.ts:109` | `sectionName` → `task_section` cell | no |
| **`api/templates/import/route.ts:148`** | `task_section` → `sectionName`, with `.trim()` and `\|\| "General"` | **yes** |

The third is the only lossy mapping, and it matters: **export → import is not
round-trip faithful.** `"  Cleaning"` returns as `"Cleaning"`; `""` returns as
`"General"`. `docs/TEMPLATES_IMPORT_EXPORT.md` presents this as the
production→staging path, so a section name can silently change identity crossing
environments. Harmless today — **branch `dev`** has 0 untrimmed and 0 empty —
but this is the mechanism, and it is the same doorway DEBT-1 came through.

---

## 4. Data — per branch

Measured 2026-08-01. Every row names its branch. Unmeasured cells say PENDING;
they are not filled with expected values.

### Branch `dev` — identity confirmed first

`Q0` returned `neondb` / endpoint `ep-late-water-a6k53nv2` / branch
`br-broad-wave-a6vpjdw0`, matching the expected dev endpoint. The query script
carried a host guard that aborts on any other endpoint.

| Branch | Measurement | Result |
|---|---|---|
| `dev` | columns in `public` named `%section%` | **1** — `Task.sectionName`, `text`, `NOT NULL`, no default |
| `dev` | tasks / templates / live templates / orgs / task logs | 210 / 8 / 8 / 4 / 38 |
| `dev` | distinct `sectionName` spellings | **29** |
| `dev` | distinct `lower(btrim(...))` | **29** — identical, so zero case/whitespace drift |
| `dev` | empty string | **0 rows** |
| `dev` | untrimmed (`<> btrim`) | **0 rows** |
| `dev` | inner double space / tab / newline / CR / NBSP | **0 rows** each |
| `dev` | `= 'General'` / `lower() = 'general'` | **0 rows** / **0 rows** |
| `dev` | length min / max | 8 / 20 |
| `dev` | near-duplicate groups (Q4) | **0 rows** |
| `dev` | within-template drift (Q5) | **0 rows** |
| `dev` | non-contiguous section runs (Q6) | **0 rows** |
| `dev` | JSON sweep, all eight `Json` columns | **0 hits** in all eight |
| `dev` | `CHECK` constraint on `sectionName` | **none** — `NOT NULL` only |
| `dev` | index on `sectionName` | **none** — `Task_pkey` only |

All 210 tasks belong to org `cf888f2d-…` ("Keva Juice"); the other three of four
orgs on **branch `dev`** hold no templates. The 29 values map cleanly onto the
eight templates — `Opener Checklist` 48 tasks / 3 sections, `Cleaning Checklist`
40/7, `Mid-Shift Checklist` 31/5, `Closer Checklist` 28/5, `Berries & Bouquets`
24/2, `Management Tasks` 22/5, `Coffee Checklist` 16/4, `Peet's Coffee` 1/1 — an
exact match for the seed script's `TEMPLATES_DATA`. **Every section name on
branch `dev` came from the seed script.** `"General"` has never been written, so
the import route's default has never fired here.

### Branch `preview/staging` — measured, clean

`S0` returned `neondb` / endpoint `ep-odd-rain-a6gr4xmm` / branch
`br-square-feather-a63z92vz`, matching the expected staging endpoint. Run by
Gary in the Neon console.

**Sequence recorded as it happened, not as designed** — the DEBT-1b precedent
for this is §"Step 2, branch `preview/staging`", and the same honesty applies:

- `S1`–`S7` and `S9` were executed **~18:20 UTC**. The console breadcrumb read
  `preview/staging` and was screenshotted, but **`S0` identity output was not
  captured at that time**.
- `S0` was run at **20:43:38 UTC**, in a later console session, and returned the
  staging identity above. `S8`'s constraint statement was run in that same
  20:43 session.
- Between the two, `S0` was **run once against `production` by mistake** and
  that result was discarded. Disclosed by Gary unprompted; recorded here because
  a branch switch inside the gap is exactly what makes the gap matter.

So the identity output proves the console was on `preview/staging` at 20:43. It
does **not**, on its own, prove it was there at 18:20. **The data closes that gap
structurally, independent of the console:** every one of the 29 census rows
returns `orgs = 2`, and every task count is *exactly* twice branch `dev`'s.
Branch `dev` returns `orgs = 1` on every row, and DEBT-1 established that the
second org (`cmr54z65v…`, seeded 2026-07-11 by a hand-edited `TARGET_ORG_ID`)
exists on **`preview/staging` only**. A two-org, exactly-doubled dataset is
therefore a fingerprint no other branch can produce.

**What would disconfirm the 18:20 attribution:** `P2`/`P7` returning `orgs = 2`
or 420 tasks on `production`. That would mean the fingerprint is not unique and
this attribution weakens.

**RESOLVED — the disconfirmer was run and came back negative.** Branch
`production` returned `orgs = 1` on every census row and 210 tasks (§4
`production`). No branch other than `preview/staging` produces the two-org
doubled shape, so the 18:20 data can only have come from `preview/staging`. The
attribution now rests on structure, not on the breadcrumb alone.

| Branch | Measurement | Result |
|---|---|---|
| `preview/staging` | columns in `public` named `%section%` | **1** — `Task.sectionName`, `text`, `NOT NULL`, no default |
| `preview/staging` | tasks / templates / live templates / orgs / task logs | 420 / 16 / 16 / 9 / 103 |
| `preview/staging` | distinct `sectionName` spellings | **29** |
| `preview/staging` | distinct `lower(btrim(...))` | **29** — identical, so zero case/whitespace drift |
| `preview/staging` | empty string | **0 rows** |
| `preview/staging` | untrimmed (`<> btrim`) | **0 rows** |
| `preview/staging` | inner double space / tab / newline / CR / NBSP | **0 rows** each |
| `preview/staging` | `= 'General'` / `lower() = 'general'` | **0 rows** / **0 rows** |
| `preview/staging` | near-duplicate groups (S4) | **0 rows** |
| `preview/staging` | within-template drift (S5) | **0 rows** |
| `preview/staging` | non-contiguous section runs (S6) | **0 rows** — confirmed, console showed no grid |
| `preview/staging` | JSON sweep, all eight `Json` columns | **0 hits** in all eight |
| `preview/staging` | `CHECK` constraint on `sectionName` | **none** — `Task_sectionName_not_null` only |

**The two branches are the same 29 values, doubled.** Every census row matches
branch `dev` on `length()` exactly, and on task count at precisely 2× — 25→50,
24→48, 19→38, 15→30, 9→18, 8→16, three at 7→14, five at 6→12, six at 5→10, five
at 4→8, two at 3→6, 2→4, 1→2. The 29 rows sum to 420, matching `S3`'s
`total_tasks`. The `templates` column doubles too (3→6, 2→4, the rest 1→2).

That is the signature of the seed script run twice against two orgs, and nothing
else. **Branch `preview/staging` carries no drift, no anomaly, and no third
variant** — the branch most likely to hold drift, because it is the only one
with data the seed script did not write in a single pass, does not hold any.

### Branch `production` — measured, clean

`P0` returned `neondb` / endpoint `ep-green-smoke-a6xthq4r` / branch
`br-sparkling-block-a620qvg4`, matching the expected production endpoint. Run by
Gary in the Neon console.

**Sequence, recorded as it happened:** `P0` ran **first**, at 21:12:36 UTC, and
`P1`–`P8`'s first statement followed in order in that one session with the
branch selector and breadcrumb confirmed. `P8`'s constraint statement ran a few
minutes later on the same branch, breadcrumb re-confirmed. This is the strong
form — identity captured before the data, in the same session, no gap.

| Branch | Measurement | Result |
|---|---|---|
| `production` | columns in `public` named `%section%` | **1** — `Task.sectionName`, `text`, `NOT NULL`, no default |
| `production` | tasks / templates / live templates / orgs / task logs | 210 / 8 / 8 / 5 / 38 |
| `production` | distinct `sectionName` spellings | **29** |
| `production` | distinct `lower(btrim(...))` | **29** — identical, so zero case/whitespace drift |
| `production` | empty string | **0 rows** |
| `production` | untrimmed (`<> btrim`) | **0 rows** |
| `production` | inner double space / tab / newline / CR / NBSP | **0 rows** each |
| `production` | `= 'General'` / `lower() = 'general'` | **0 rows** / **0 rows** |
| `production` | near-duplicate groups (P4) | **0 rows** |
| `production` | within-template drift (P5) | **0 rows** |
| `production` | non-contiguous section runs (P6) | **0 rows** |
| `production` | `CHECK` constraint on `sectionName` | **none** — `Task_sectionName_not_null` only |
| `production` | JSON sweep | **N/A** — staging-only by the DEBT-1 precedent; `P1` answers the structural question without a data scan |

**Branch `production` is identical to branch `dev` on all 29 census rows** —
every value, every `length()`, every task count, every template count, `orgs = 1`
throughout. `P7`'s 210 tasks / 8 templates / 38 task logs match `dev` exactly.
The only difference between the two branches anywhere in this audit is
`Organization` count, 5 against `dev`'s 4 — consistent with `dev` being a
snapshot taken at BUILD-1 time and production having gained an org since. That
difference is outside `Task` and does not touch this audit's subject.

**This is also the disconfirming test for §4's staging attribution, and it came
back negative.** The staging block's 18:20 data was attributed to
`preview/staging` on the strength of a structural fingerprint — `orgs = 2` on
every census row and counts at exactly 2× `dev`. That argument was stated with
its own falsifier: production returning `orgs = 2` or 420 tasks would have meant
the fingerprint was not unique. Production returned `orgs = 1` and 210 tasks on
every row. **The fingerprint is unique to `preview/staging`, so the attribution
holds on structural grounds and not merely on the breadcrumb.**

---

## 5. Writer verdict

**THE TAP IS OPEN, and wider than DEBT-1's was.** Zero validation of any kind
reaches this column at any entry point. On **branch `dev`** the database carries
only `NOT NULL` (`Task_sectionName_not_null`) — no `CHECK`, no default.

Nine paths write it:

| # | Path | file:line | Trims | Non-empty guard | Enum |
|---|---|---|---|---|---|
| 1 | Seed script, direct Prisma | `scripts/import-keva-templates.ts:363` | no | no | no |
| 2 | CSV import | `api/templates/import/route.ts:148` | **yes** | defaults `"General"` | no |
| 3 | `POST /api/templates` | `api/templates/route.ts:88` | no | no | no |
| 4 | `PATCH /api/templates/[id]` | `api/templates/[id]/route.ts:72` (used at `:88` update, `:100` create) | no | no | no |
| 5 | Duplicate button | `templates-client.tsx:140` | no | no | copies verbatim |
| 6 | **Form — inline row input** | `template-form.tsx:526-527` | no | **NONE** | no |
| 7 | Form — bulk "set Section" | `template-form.tsx:405-407` | **yes** | yes (`:457`) | no |
| 8 | Form — add task | `template-form.tsx:1096`, guard `:1169` | no | yes | no |
| 9 | Form — edit drawer | `template-form.tsx:173`, guard `:258` | no | yes (`:258`) | no |

Two specifics carry the weight:

- **Path 6 is an unguarded hole reachable with no typing skill.** `addTask` and
  `saveEditTask` both block an empty section; the inline per-row input beside
  them has no guard at all. Clear the cell, hit Save, and `""` persists. That is
  how the four-way empty-string divergence in §2 gets exercised.
- **Paths 7 and 2 trim; paths 1, 3, 4, 5, 6, 8 and 9 do not.** The inconsistency
  sits inside a single component — bulk-set trims, the row input next to it does
  not.

**The fix surface is narrow.** Paths 3–9 all funnel through **two API routes**;
only path 1 (direct Prisma) and path 2 (its own route) sit outside them. Three
choke points, against DEBT-1's six.

**What would disconfirm "open":** a Zod enum or `.trim()` on `sectionName` in
either `api/templates` route, or a `CHECK`/normalisation at the database.
Neither holds at `bb1f578`.

---

## 6. Recommendation for DEBT-2b

**All three branches are measured and all three are clean on every single
measure. There is no data to remediate — DEBT-2b is not a backfill. Do not run
a normalising `UPDATE`; there is nothing for it to change.** This is the point
where DEBT-2 diverges from DEBT-1, and the divergence should be stated up front
in the 2b prompt rather than discovered inside it: DEBT-1 was a dirty-data
cleanup with a writer fix attached, DEBT-2 is a writer fix with no cleanup at
all.

What DEBT-2b should be instead, in order:

1. **Close writer 6.** `template-form.tsx:526-527` is the only unguarded write
   in the app. Trim on the way into state, and treat blank the way
   `addTask`/`saveEditTask` already do. This is the whole of the realised risk
   and it is a few lines.
2. **Make trimming uniform at the two API choke points** —
   `api/templates/route.ts:88` and the shared `taskData()` at
   `api/templates/[id]/route.ts:72`. That covers writers 3–9 in two edits.
   **Trim only. Do not enum this field** — it is legitimately free text, and an
   enum would be wrong here. That is exactly where DEBT-2 differs from DEBT-1,
   and the reason `src/lib/phases.ts` is not the template to copy.
3. **Pick one empty-value string and use it everywhere.** Four behaviours across
   five sites is the actual user-visible defect. `"General"` is the incumbent —
   three render sites plus the import default — so make
   `checklist-execution-client.tsx:74` and `template-form.tsx:506` agree with it.
4. **Fix the DEBT-1 leftover while the file is open** —
   `docs/TEMPLATES_IMPORT_EXPORT.md:57` still lists only two operational phases.
   See §7.

**Named limitations, out of 2b's likely scope, per the DEBT-30 precedent:**

- **A `Section` entity** — id, name, order, per-template — is the durable answer
  to everything in §2, and it also fixes the no-snapshot problem. It is a
  product decision plus a migration plus a UI, not a debt cleanup. Tracked as
  **DEBT-36**; do not let it ride along on 2b.
- **A DB-level guard.** There is nothing sane to `CHECK` on a free-text field
  beyond `btrim(x) <> ''`. Worth having, but it is DDL and belongs with
  DEBT-30's migration, not in a session that cannot touch `prisma/`.
- **Round-trip fidelity of the CSV path.** Making export→import lossless means
  the import stops trimming, which is worse. Leave it — the fix is upstream. If
  nothing untrimmed can be *written*, nothing untrimmed needs *preserving*, and
  step 2 is what makes that true.

**The row's title should be rewritten as part of 2b** — done in this audit's
ROADMAP commit — so the next reader does not hunt for a `section` column the way
this session did.

---

## 7. Method, and what this audit does not cover

The exact SQL is committed alongside this file as
`docs/prompts/DEBT-2a_staging_and_production.sql` — the per-branch numbers in §4
come from those statements and no others. It is 21 statements, 19 `SELECT` and
2 `WITH` (both terminating in `SELECT`); stripping comments leaves no `UPDATE`,
`INSERT`, `DELETE`, `DROP`, `ALTER`, `TRUNCATE`, `GRANT`, `REVOKE`, `MERGE`,
`COPY` or `SET` anywhere in it.

Queries used (all `SELECT`; run on **branch `dev`** via local `.env`, and on
**branch `preview/staging`** and **branch `production`** by Gary in the Neon
console):

- **Q0** identity — `current_database()`, `neon.endpoint_id`, `neon.branch_id`.
  First statement in every branch block. A result arriving without it does not
  count.
- **Q1** catalog sweep for every column in `public` named `%section%`.
- **Q2** the census — bracketed value plus `length()`, counts, distinct
  templates and orgs. Bracketing plus length is what surfaces whitespace rather
  than masking it.
- **Q3** anomaly counters — empty, untrimmed, inner double space, tab, newline,
  CR, NBSP, `General` in both casings, distinct spellings vs distinct
  normalised.
- **Q4** near-duplicate groups collapsing under `lower(btrim())`.
- **Q5** the same collapse *within a single template* — the case that splits a
  heading in front of staff.
- **Q6** sections whose tasks are non-contiguous in `orderIndex`, which render
  two headings from undrifted data.
- **Q7** scale context.
- **Q8** Task column types and constraints.
- **Q9** JSON sweep, bounded to the eight `Json` columns in `schema.prisma` —
  deliberately **not** the unbounded `query_to_xml` pattern, and staging-only
  per the DEBT-1 precedent.

**Limits, stated so a later reader does not over-trust this file:**

- Q1 is a *catalog* query: it proves no column is **named** `section`. It does
  not prove no column **holds** a section value under an unrelated name. Q9
  covers the JSON columns for the substring; nothing covers a hypothetical
  differently-named text column holding section values, and no evidence suggests
  one exists.
- Q9 detects only that substring, in only those eight columns.
- **All three branches are measured. Nothing in §4 is PENDING.**
- **Branch `preview/staging`'s identity was captured 2h23m after its data**, in
  a later console session, with one mistaken `S0` against `production` in the
  gap. §4 records that in full rather than presenting the run as clean. The
  structural fingerprint (`orgs = 2`, exactly 2× `dev`) is what closes it, and
  that argument was falsifiable by the production run, which was then run and
  came back negative. Evidence quality is therefore **strong on `dev` and
  `production`** (identity captured before the data, same session) and
  **reconstructed on `preview/staging`** — sound, but by a different route.
  Stated rather than smoothed, per the DEBT-1b precedent.
- The JSON sweep was run on `dev` and `preview/staging` only. Branch
  `production`'s answer to "is there a second carrier" rests on `P1`, the
  catalog query, which is structural rather than a data scan.
- The class-(a) and class-(b) render behaviour is derived from source, not
  exercised in a browser.
- Counts are a snapshot of 2026-08-01. Re-measure before acting on them.
- Branch `dev` is a snapshot branched from `production` at BUILD-1 time, and
  this audit found the two identical on all 29 census rows. Per DEBT-31 that
  agreement is a fact about 2026-08-01, not a standing guarantee — which is
  exactly why all three branches were measured separately rather than one being
  inferred from another.
- **Method note, recorded because the file should say what was run:** the first
  form of Q3 failed with `column "sectionName" does not exist`. That was
  backslash-escaped regex literals passing through the Neon HTTP driver, not a
  schema fact. Rewritten with `strpos()`/`chr()` it runs clean, and that is the
  form in the SQL handed over.

---

## 8. Findings outside DEBT-2's scope

Recorded as text per this session's task order; no code was changed.

- **DEBT-34** — a production connection string and five other production
  secrets were sitting in `froot/.env.backup` (untracked, gitignored, never
  committed, created 2026-07-26 22:00 PDT). Found while confirming this
  session's own database protocol. Only the hostname was read. **Deleted by
  Gary 2026-08-01**, verified absent the same day.
- **DEBT-35** — the migrations folder cannot rebuild the live schema.
  `Task.estimatedTimeMinutes` is `double precision` on **all three branches** —
  `dev`, `preview/staging` and `production`; `schema.prisma:311` says `Float?`;
  the only migration that creates it (`20260627002005_init/migration.sql:132`)
  says `INTEGER`, and no migration alters it. Schema and databases agree — the
  *ledger* is what is wrong, on every branch that exists. Not a local artefact
  and not a staging-only artefact: whatever changed the type reached production.
  Confirms the long-standing `estimatedTimeMinutes` audit item rather than
  discovering it.
- **DEBT-36** — sections are implied, not modelled: no entity, no canonical
  list, no independent ordering, and — because `Checklist` does not snapshot
  task data — renaming a section retroactively rewrites the headings on every
  historical completed checklist and its print copy.
- **DEBT-1 recommendation not carried out** — `docs/TEMPLATES_IMPORT_EXPORT.md:57`
  still describes `template_operational_phase` as *"e.g. `Before Opening`,
  `After Closing`"*. DEBT-1's §5 item 4 required all three canonical values, and
  called the omission *"precisely how a hand-authored CSV invents a variant"*.
  DEBT-1b's `c17ccc1` touched eight files, none of them this one; the file was
  last changed in `3ff8720`. Reported, not fixed, and DEBT-1 is not re-opened —
  folded into DEBT-2b's step 4 instead.
- **`docs/MIGRATIONS.md:176-182` lists endpoints but no branch ids.** Branch
  `dev` is `br-broad-wave-a6vpjdw0`, measured this session; DEBT-1b recorded the
  other two. Filling the column in would make the identity check a direct
  comparison. Minor; no row filed.
