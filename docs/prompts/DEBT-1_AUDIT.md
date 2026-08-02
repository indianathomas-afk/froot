# DEBT-1 — `operationalPhase` audit (DEBT-1a)

Audit run 2026-07-30 against checkout `b46bc29` (branch `staging`). **Read-only
session**: every statement executed was a `SELECT`, all against Neon branch
`dev` via local `.env`; staging and production were read by Gary in the Neon
console from SQL written here. No mutation ran on any branch. DEBT-1 is not
closed by this file — remediation is DEBT-1b.

DEBT-2 (`sectionName` vs `section`) was out of scope and was not examined.

---

## 0. Blast radius — read this before the verdict

**The field it is dirty in has almost no runtime effect.** The template form
asks *"When is this checklist available?"* (`template-form.tsx:917`) and states
*"Availability calculated based on each store's operating hours"*
(`template-form.tsx:925`), writing `operationalPhase` + `startOffsetHours` +
`endOffsetHours`. **Nothing reads those three to gate anything.** `Checklist`
rows are created in exactly two places — `src/app/api/checklists/route.ts:118`
(single) and `:155` (bulk) — and neither references phase or offsets. There is
no cron generator (only `/api/cron/pace-alerts` and `/api/cron/sales-reconcile`).
No code path joins the offsets to `StoreHours` (`prisma/schema.prisma:133`).
Store-view's "Available Checklists" heading labels every generated checklist; it
is not a filter.

So the **only** functional consumer of `operationalPhase` in the product is
handoff-note date resolution (`src/lib/messages.ts:38-66`), which is
alias-covered and therefore correct for `"During Hours"` today. A dirty row's
entire user-visible effect is confined to the template **edit form** (§2, class
b): an empty required dropdown, offset inputs labelled with the wrong reference
point, a blank preview line — and the numbers those labels describe do not do
anything either.

**Consequence for sequencing:** DEBT-1b is low-risk cleanup, not an incident.
But if DEBT-29 is ever resolved by *implementing* the availability gate, this
stops being true — a dirty phase string would then decide when a checklist
appears. Do the cleanup before that, not after.

---

## 1. Writer verdict

**THE TAP IS OPEN — but there is no evidence it has fired since the I-14b fix.**

Both halves matter and they are separate claims.

### Open by inspection

Six paths reach the column. Ranked by how easily they are reached, not by
severity:

| Reachability | Path |
|---|---|
| One click, no typing | **Duplicate** button — `templates-client.tsx:133` POSTs `operationalPhase` verbatim, creating a **new** dirty row from an old one |
| Documented workflow | **CSV export → import** — `export/route.ts:94` emits the raw value; `import/route.ts:44` accepts `z.string().optional().nullable()` with no enum and writes it at `:130`. `docs/TEMPLATES_IMPORT_EXPORT.md` presents this as the prod→staging template path, and its `template_operational_phase` row lists only `Before Opening` / `After Closing` — the canonical mid value is never stated |
| Ad-hoc script | `scripts/import-keva-templates.ts:83` hardcodes `"During Hours"`, written at `:357`. Runnable today against whatever `DATABASE_URL` is in `.env` |
| Hand-crafted HTTP | `POST /api/templates` — `route.ts:68`, `templateData.operationalPhase \|\| null`, no validation, no trim (whitespace variants are possible here) |
| Hand-crafted HTTP | `PATCH /api/templates/[id]` — `[id]/route.ts:80` spreads `...templateData` wholesale, zero validation |
| Re-persist | `template-form.tsx:790` — form state is seeded from the row at `:634`, so editing anything else on a dirty template and saving writes `"During Hours"` back |

No database-level guard exists: the column is plain `TEXT`, no `CHECK`, no enum
(`prisma/schema.prisma:280`;
`prisma/migrations/20260627002005_init/migration.sql:108`). See DEBT-30.

**What would disconfirm "open":** an enum on the import Zod schema, `duplicate()`
normalising or dropping the phase, and the seed script deleted or guarded. None
of the three hold at `b46bc29`.

### No firing since the fix

The I-14b alias fix `8a3667c` was committed `2026-07-11 17:00:13 -0700` =
**2026-07-12 00:00:13 UTC**. The most recent `"During Hours"` row on any branch
was created **2026-07-11 19:44:15.275 UTC** (branch `preview/staging`) — about
4h16m *earlier*, and earlier still than the staging deploy that followed. Every
other dirty row dates to 2026-06-27. Production has had **no** template row
created since 2026-06-27 at all (§3).

The timezone step is load-bearing, so it was checked rather than assumed: row
`cmqx004mk001d3apdv3b6h4mj` exists on both branches; Prisma returned
`2026-06-27T23:35:40.652Z` on **branch `dev`**, and the Neon console shows
`2026-06-27 23:35:40.652` for the same row on **branch `preview/staging`** —
identical, not offset by seven hours, so the console renders UTC. Had it
rendered browser-local, the 07-11 row would land *after* the fix and this
section would say the opposite.

**What would disconfirm "no firing since":** any `Template` row with a
non-canonical phase and a `createdAt` after 2026-07-12 00:00 UTC on any branch.
Re-run Q1 (§6) before trusting this section at a later date — it is a statement
about 2026-07-30, not a permanent property.

### Attribution of the two batches

Both dirty populations were written by `scripts/import-keva-templates.ts`:

- **2026-06-27 batch** (all branches, org `cf888f2d-…` "Keva Juice"): 8 templates
  in a 1.9-second window, phase distribution 3× `Before Opening` / 1× `During
  Hours` / 1× `After Closing` / 3× `NULL` — an exact match for the script's eight
  `TEMPLATES_DATA` entries. Created `23:35:40 UTC` = `16:35 PDT`, about an hour
  *before* `6eab9de` committed the script at `17:43 PDT` — run from the working
  tree, then committed. Normal, and it corroborates rather than undermines the
  attribution.
- **2026-07-11 batch** (branch `preview/staging` only, org `cmr54z65v…`): same
  eight templates in a ~3-second window, and the sub-second ordering follows the
  script's array order exactly — `Before Opening` → **`During Hours` 15.275** →
  `After Closing` 15.734 → `NULL`s → `Before Opening` last 18.084. The script's
  `TARGET_ORG_ID` is hardcoded to the UUID org, so this run had it edited.

Two paths are **ruled out** for the 07-11 batch: the CSV import hardcodes
`isActive: false` (`import/route.ts:134`) and both dirty rows are `isActive =
true`; the Duplicate button appends `" (Copy)"` to the name and both rows are
named exactly `"Mid-Shift Checklist"`.

**What would disconfirm the attribution:** a batch whose creation ordering does
not follow the script's array order, or a dirty row with `isActive = false`.

---

## 2. Code sites

### The alias — two copies, not one

| Location | Content |
|---|---|
| `src/lib/messages.ts:38-46` | `PHASE_ORDER` = `Before Opening:0, During the Day:1, During Hours:1, After Closing:2`; `phaseOrder()` returns `PHASE_ORDER[x] ?? 1` |
| `src/app/(app)/store-view/checklist/[id]/handoff-notes.tsx:21-27` | byte-identical duplicate map + `order()`, deliberate — `messages.ts` imports the Prisma runtime and cannot be imported by a client component |

Both added in `8a3667c` (I-14b), 2026-07-11.

**The alias is behaviourally inert.** `phaseOrder` falls back to `?? 1`, and the
alias maps `"During Hours"` → `1` — the same value the fallback already produces.
Deleting the alias line today changes no output. It is documentation, not logic.
(Disconfirmer: any future call site that treats an unknown phase differently from
mid — throwing, or a fallback of `0` — makes it load-bearing.)

### (a) Safe — reaches the value through the alias

| Site | Note |
|---|---|
| `src/lib/messages.ts:50-53` `phaseToShiftPhase` | `"During Hours"` → `mid`; correct |
| `src/lib/messages.ts:58-66` `resolvePostedForDate` | correct today/tomorrow resolution |
| `src/app/api/checklists/[id]/handoff-messages/route.ts:125-128, :137` | both call sites go via the helpers |
| `handoff-notes.tsx:130, :138, :141` | composer sort and the today/tomorrow filters, via `order()` |
| `store-view/checklist/[id]/page.tsx:53` | `select` only, pass-through |
| `checklist-execution-client.tsx:46, :179, :345` | prop pass-through |

### (b) Raw comparison — the live bug surfaces

All in the template edit form; all triggered by opening a `"During Hours"`
template for edit. Derived by inspection, not exercised in a browser —
disconfirm by opening `/templates/cmqx004mk001d3apdv3b6h4mj/edit` on dev and
seeing a populated dropdown with opening-relative labels.

| Site | What a `"During Hours"` row does |
|---|---|
| `template-form.tsx:64-68` `PHASES` + `:938` `<Select value={phase}>` | no matching `SelectItem` → the **required** Operational Phase dropdown renders empty |
| `template-form.tsx:942, :946` | ternaries fall to the else-branch → offsets labelled *"Starts (hours before closing) / Ends (hours after closing)"*. A mid-day checklist is described to the admin as closing-relative |
| `template-form.tsx:70-77` `getPhaseDescription` | returns `""` → the Preview box renders a blank line |
| `template-form.tsx:954-960` | else-branch → a *"Store closes 8:00 PM → …"* example on a mid-day template |

Nothing else compares the value raw: it is not shown on the templates list, the
template detail page, the print page, or in any `orderBy`.

### (c) Writers

See the verdict table in §1. Summary: `scripts/import-keva-templates.ts:83`
(origination, hardcoded), `templates-client.tsx:133` (origination, one click),
`import/route.ts:130` (origination, documented workflow),
`api/templates/route.ts:68` and `api/templates/[id]/route.ts:80` (unvalidated
surfaces), `template-form.tsx:790` (re-persist).

---

## 3. Data — every location × branch × value × count

`Template.operationalPhase` is the **only** carrier. Verified, not assumed: a
sweep of every `text` / `varchar` / `json` / `jsonb` column in `public` for
`%uring%our%` returned exactly one hit on each branch it was run against. No
JSON blob, no template-definition snapshot, no denormalised copy holds the
value; `Checklist` stores none.

Measured 2026-07-30. Every row names its branch.

| Branch | Value | len | rows | orgs | createdAt range (UTC) |
|---|---|---|---|---|---|
| `dev` | `[Before Opening]` | 14 | 3 | 1 | 2026-06-27 23:35:40.372 … 23:35:42.274 |
| `dev` | `<NULL>` | — | 3 | 1 | 2026-06-27 23:35:41.198 … 23:35:42.013 |
| `dev` | `[After Closing]` | 13 | 1 | 1 | 2026-06-27 23:35:40.926 |
| `dev` | **`[During Hours]`** | 12 | **1** | 1 | 2026-06-27 23:35:40.652 |
| `preview/staging` | `[Before Opening]` | 14 | 6 | 2 | 2026-06-27 23:35:40.372 … 2026-07-11 19:44:18.084 |
| `preview/staging` | `<NULL>` | — | 6 | 2 | 2026-06-27 23:35:41.198 … 2026-07-11 19:44:17.632 |
| `preview/staging` | `[After Closing]` | 13 | 2 | 2 | 2026-06-27 23:35:40.926 … 2026-07-11 19:44:15.734 |
| `preview/staging` | **`[During Hours]`** | 12 | **2** | 2 | 2026-06-27 23:35:40.652 … 2026-07-11 19:44:15.275 |
| `production` | `[Before Opening]` | 14 | 3 | 1 | 2026-06-27 23:35:40.372 … 23:35:42.274 |
| `production` | `<NULL>` | — | 3 | 1 | 2026-06-27 23:35:41.198 … 23:35:42.013 |
| `production` | `[After Closing]` | 13 | 1 | 1 | 2026-06-27 23:35:40.926 |
| `production` | **`[During Hours]`** | 12 | **1** | 1 | 2026-06-27 23:35:40.652 |

**Backfill scope for DEBT-1b: dev 1 row, `preview/staging` 2 rows, production 1
row — four rows total.**

The dirty rows in full:

| Branch | id | org | name | active / archived | createdAt (UTC) |
|---|---|---|---|---|---|
| `dev` | `cmqx004mk001d3apdv3b6h4mj` | `cf888f2d-f234-48c7-8097-fd5b44b5b3dd` | Mid-Shift Checklist | true / false | 2026-06-27 23:35:40.652 |
| `preview/staging` | `cmqx004mk001d3apdv3b6h4mj` | `cf888f2d-f234-48c7-8097-fd5b44b5b3dd` | Mid-Shift Checklist | true / false | 2026-06-27 23:35:40.652 |
| `preview/staging` | `cmrgrwfxn001d04ju93cwc8v1` | `cmr54z65v000105jxczpt72w1` | Mid-Shift Checklist | true / false | 2026-07-11 19:44:15.275 |
| `production` | `cmqx004mk001d3apdv3b6h4mj` | `cf888f2d-f234-48c7-8097-fd5b44b5b3dd` | Mid-Shift Checklist | true / false | 2026-06-27 23:35:40.652 |

All four are `type = "Mid-Shift"`, `availabilityType = "StoreHours"`, live
(`isActive = true`, `isArchived = false`).

Supporting measurements, each naming its branch:

| Branch | Measurement | Result |
|---|---|---|
| `dev` | schema-wide sweep for `%uring%our%` | `Template.operationalPhase`, 1 row — only carrier |
| `preview/staging` | schema-wide sweep | `Template.operationalPhase`, 2 rows — only carrier |
| `production` | schema-wide sweep | `Template.operationalPhase`, 1 row — only carrier |
| `dev` | `TeamMessage.shiftPhase` | `opening` 1 |
| `preview/staging` | `TeamMessage.shiftPhase` | `opening` 12, `<NULL>` 5, `closing` 2 — no `mid` rows |
| `production` | `TeamMessage.shiftPhase` | `opening` 1 |
| `dev` | org `cf888f2d-…` | "Keva Juice", 8 templates, 1 named Mid-Shift Checklist |
| `preview/staging` | org `cf888f2d-…` | "Keva Juice", 8 templates, 1 named Mid-Shift Checklist |
| `production` | org `cf888f2d-…` | "Keva Juice", 8 templates, 1 named Mid-Shift Checklist |

`TeamMessage.shiftPhase` is a **derived** field (`opening|mid|closing`,
Zod-enum-validated at `api/messages/route.ts:21`) and is clean on all three
branches. A `"During Hours"` source maps to `mid` with or without the alias, so
it is not a dirty location and needs no backfill.

The last row of that table also means the seed script, **unmodified**, is a
no-op on all three branches today: it skips templates whose name already exists
for its target org, and `Mid-Shift Checklist` exists on all three. It stops
being a no-op the moment `TARGET_ORG_ID` is edited — which is exactly what
happened on 2026-07-11.

---

## 4. Third variant — NONE FOUND

**No third variant exists on any branch.** Every distinct value was returned
with `length()` alongside it, so whitespace and casing drift would have shown as
a length mismatch against the canonical strings. All lengths are exact:
`Before Opening` 14, `After Closing` 13, `During Hours` 12. `"During the Day"`
does not appear in the data **at all** on any branch — the canonical value has
never actually been written to any database, because the only rows carrying a
mid-day phase came from the seed script.

That last point is worth keeping: after the backfill, `"During the Day"` will
exist in the data for the first time.

---

## 5. Recommendation for DEBT-1b

**Order is fixed. Plug, then backfill, then retire.**

1. **Plug the writers — own commit, before any data change.** Introduce one
   shared canonical constant in a client-safe module (no Prisma import) and have
   every site use it, replacing the two hand-copied lists:
   - `scripts/import-keva-templates.ts:83` → `"During the Day"`.
   - `templates-client.tsx:133` — normalise through the shared canonicaliser.
   - `import/route.ts:44` — Zod enum of the three canonical values. **Reject, do
     not silently coerce**, so a bad CSV is visible to the importer rather than
     quietly rewritten.
   - `api/templates/route.ts:68` and `api/templates/[id]/route.ts:80` — validate
     against the same enum; the PATCH spread is the wider hole of the two.
   The fix writes the canonical value only. It adds no new variant and does not
   touch the alias.
2. **Backfill `dev` → `preview/staging` → `production`,** each branch its own
   approval, one statement per branch:
   `UPDATE "Template" SET "operationalPhase" = 'During the Day' WHERE "operationalPhase" = 'During Hours';`
   Expected row counts: **dev 1, `preview/staging` 2, production 1.** Re-run the
   §6 Q1 SELECT immediately before each UPDATE — these counts are from
   2026-07-30 and a stale count is a reason to stop, not to proceed.
3. **Retire the alias — third, after all three branches read zero.** Delete both
   copies (`messages.ts:41`, `handoff-notes.tsx:24`) in one commit. It is inert
   today, so this is cosmetic and it is safe either way; sequencing it last
   simply keeps the safety net in place until the data is provably clean.
4. **Documentation, same session:** `docs/TEMPLATES_IMPORT_EXPORT.md`'s
   `template_operational_phase` row must list all three canonical values. The
   omission is precisely how a hand-authored CSV invents a variant.

**Named limitation, and it is not fixable inside DEBT-1b.** App-layer validation
is the ceiling that session can reach: its task order forbids schema changes and
DDL outright. Any *future* route that writes this column re-opens the class —
exactly as the CSV import did after the template form was already correct. The
durable fix is a `CHECK` constraint or a Postgres enum, tracked as **DEBT-30**
and gated on this backfill completing on all three branches. Note for that
session: `NULL` must remain legal — `AllDay` templates write it deliberately
(`template-form.tsx:790`) and 3 of 8 rows per org carry it.

---

## 6. Method, and what this audit does not cover

Queries used (all `SELECT`; run on `dev` via local `.env`, on the other two
branches in the Neon console):

- **Q1** `GROUP BY "operationalPhase"` with `length()`, counts, distinct orgs,
  and min/max `createdAt` — the distinct-value census. Bracketing the value
  (`'[' || … || ']'`) plus `length()` is what surfaces whitespace rather than
  masking it.
- **Q2** every row whose phase is non-`NULL` and not one of the three canonical
  values.
- **Q3** schema-wide sweep via `query_to_xml` over every text/json column in
  `public` for `ILIKE '%uring%our%'`.
- **Q4** `TeamMessage.shiftPhase` distribution.
- **Q5** the seed script's hardcoded org, its template count, and whether
  `Mid-Shift Checklist` already exists there.

**Limits, stated so a later reader does not over-trust this file:**

- Q3 detects only that *string shape*. It proves no other column holds a
  `"During Hours"`-like value; it does **not** prove no other column holds a
  phase value under some different spelling. Q1 catches every spelling, but only
  in `Template.operationalPhase`.
- Q3 was planned for staging only (its production answer is structural, and the
  scan is unbounded on large tables); it was in fact run on all three branches
  and returned in ~1s on production. Recorded because the file should say what
  was run, not what was planned.
- The class-(b) form behaviour is derived from source, not exercised in a
  browser.
- Counts are a snapshot of 2026-07-30. Re-measure before acting on them.
- Branch `dev` is a snapshot branched from `production` at BUILD-1 time. Its
  agreement with `production` here is a fact about 2026-07-30, not a standing
  guarantee; each branch was measured separately for that reason.

---

## 7. Findings outside DEBT-1's scope

Recorded as text per this session's task order; no code was changed.

- **BUG-5** — duplicating a template creates it ACTIVE. `templates-client.tsx:137`
  sends `isActive: false`; the create block at `api/templates/route.ts:60` never
  reads it, so the schema default `true` (`prisma/schema.prisma:283`) applies,
  and the bulk generator at `api/checklists/route.ts:138` picks the copy up.
- **DEBT-29** — the availability window is collected, stored, exported and never
  enforced (§0). A product decision: implement the gate or remove the form's
  claim.
- **DEBT-30** — no DB-level constraint on the column; app-layer validation is the
  ceiling until one exists. Gated on this backfill and on the hand-authored
  migration flow in `docs/MIGRATIONS.md` §3.
- **Doc drift** — `docs/MIGRATIONS.md:184` says *"`dev` inherits production's
  data shape; staging does not"* and that staging was separately seeded. For
  `Template` that is wrong: **branch `preview/staging`** carries the *same cuid*
  (`cmqx004mk001d3apdv3b6h4mj`) as **branch `dev`** and **branch `production`**
  for the 2026-06-27 row, and the Neon console shows `preview/staging` as a child
  branch of `production`. The 2026-07-29 staff-query observation behind that line
  may still hold for `StaffMember`, which has diverged since the branch point,
  but the claim as written is too broad. Correcting `MIGRATIONS.md` was outside
  this session's allowed files.
- **`ROADMAP.yaml` DEBT-1 row drift** — the row said the audit-then-fix prompt
  was *"NOT in docs/prompts/ yet"*. Both `DEBT-1a_operationalPhase_audit.md` and
  `DEBT-1b_operationalPhase_remediate.md` now exist there.

---

# DEBT-1b — remediation record

Appended 2026-07-31, the session after the audit above (continued in the same
conversation by Gary's ruling, with the precondition re-checked against the
committed file rather than against conversation memory). Read-only claims above
are unchanged; this section records what was altered.

## Step 1 — writers plugged, commit `c17ccc1`

`fix: enforce the canonical operationalPhase at every write path (DEBT-1b step 1)`
— 8 files, +218/−11. New module `src/lib/phases.ts` carries `OPERATIONAL_PHASES`,
`normalizePhase()` and `isOperationalPhase()`, free of Prisma and React imports so
API routes and client components share one rule. All six writer sites from the
verdict above now pass through it: `scripts/import-keva-templates.ts:83` (the
hardcoded origin string, now canonical), `POST /api/templates`, `PATCH
/api/templates/[id]`, the CSV import's Zod field, `templates-client.tsx`'s
Duplicate, and `template-form.tsx`'s state seed. `template-form.tsx`'s local
`PHASES` literal now derives from the shared constant.

**Neither I-14b alias copy was touched** (`messages.ts:41`,
`handoff-notes.tsx:24`) — out of scope by the task order. Retirement is tracked
as DEBT-32. That leaves a third copy of the phase list in the repo until then.

### Rule change from this file's own recommendation — recorded deliberately

§5 above recommended **"Reject, do not silently coerce"** at the CSV import.
The rule actually implemented is **map the one known legacy alias
(`"During Hours"` → `"During the Day"`), reject everything else by name**, at
*every* entry point rather than only the import. Changed on Gary's ruling,
2026-07-31, for these reasons:

- CSV files exported from any branch **before** this backfill still exist on
  disk. Rejecting them helps nobody when the mapping is unambiguous.
- The mapping is not a judgment call: I-14b already ordered the two strings
  identically, so no information is lost or invented by applying it.
- Unknown values still fail loudly — per row, with the row number, through the
  import route's existing `errors: {row, error}[]` channel.

The audit's underlying concern (never silently rewrite something you had to
guess at) is preserved: exactly one string is mapped, and it is the one whose
meaning was already settled.

## Mechanism ruling

**One-off approved SQL per branch in the Neon console** — not a committed
data-migration file. Ruled 2026-07-31. Reasons: `prisma/` was outside the
session's writable set; a migration file would fire unattended during a Vercel
build, taking the operator's hand off a production mutation that DEBT-1's row
has always required be approved; and the replay benefit is largely moot here
(four rows, an idempotent `WHERE`, and future Neon branches inherit clean data
from production anyway).

**Named residual:** nothing structurally prevents a future branch cut from a
pre-fix point in time from resurrecting dirty rows. A migration file would not
have fixed that either. The durable answer is DEBT-30's `CHECK` constraint,
gated on this backfill.

## Step 2 — the backfill, per branch

The statement, identical on all three branches, idempotent by exact equality:

```sql
UPDATE "Template" SET "operationalPhase" = 'During the Day'
 WHERE "operationalPhase" = 'During Hours'
RETURNING id, name, "organizationId", "operationalPhase" AS new_phase;
```

| Branch | Before | Rows changed | Q3 after (non-canonical remaining) | Run by |
|---|---|---|---|---|
| `dev` | `[During Hours]` 1 | 1 | **0** | Claude, local `.env` |
| `preview/staging` | `[During Hours]` 2 | 2 | **0** | Gary, Neon console |
| `production` | `[During Hours]` 1 | 1 | **0** | Gary, Neon console |

**Branch `dev`** — Q0 host check (`ep-late-water-a6k53nv2`) aborted the script if
the endpoint was anything else. `UPDATE` ran inside a transaction that throws —
and therefore rolls back — on any count other than 1 or any id other than
`cmqx004mk001d3apdv3b6h4mj`; it did not fire. `RETURNING` captured:
`cmqx004mk001d3apdv3b6h4mj` "Mid-Shift Checklist", org `cf888f2d-…`,
`new_phase = "During the Day"`. After: `[Before Opening] 3 · <NULL> 3 ·
[After Closing] 1 · [During the Day] 1`, `non_canonical_remaining = 0`.

**Branch `preview/staging`** — identity confirmed (`ep-odd-rain-a6gr4xmm` /
`br-square-feather-a63z92vz`) before anything ran. Recorded as it happened, not
as designed:

- Q1 before, `[During Hours] 2` — as expected.
- Q2 at 2:02pm succeeded, but **the `RETURNING` output was not captured**.
- Q3 at 2:03pm: `non_canonical_remaining = 0`.
- **Q2 was accidentally run a second time at 2:04pm** and returned **no rows** —
  the idempotent `WHERE` behaving exactly as designed. This destroyed nothing
  and is itself an independent confirmation that no `"During Hours"` row
  survived the first run, reached by a different route than Q3.
- Reconstruction at 2:06pm: `SELECT` on the two known ids returned exactly 2
  rows — `cmqx004mk001d3apdv3b6h4mj` (org `cf888f2d-…`) and
  `cmrgrwfxn001d04ju93cwc8v1` (org `cmr54z65v…`), both "Mid-Shift Checklist",
  both `operationalPhase = "During the Day"`. Screenshot captured.
- Q1 after-picture: **NOT CAPTURED.**

**Branch `production`** — identity confirmed
(`ep-green-smoke-a6xthq4r` / `br-sparkling-block-a620qvg4`). Ordering recorded as
it happened:

- Q1 ran **first**, at 2:12pm, *before* Q0 — `[During Hours] 1`.
- Q0 at 2:13pm confirmed the endpoint, then **Q1 was re-run at 2:13pm**, same
  result. That re-run is the admissible before-count; the 2:12pm read
  corroborates it but was taken before the branch was named, so by CLAUDE.md
  § Database Evidence it does not stand on its own. Identity *was* confirmed
  before the mutation, which is what matters.
- Q2 ran **once** at 2:14pm with `RETURNING` **captured**: exactly 1 row,
  `cmqx004mk001d3apdv3b6h4mj`, "Mid-Shift Checklist", org `cf888f2d-…`,
  `new_phase = "During the Day"`.
- Q3 at 2:15pm: `non_canonical_remaining = 0`.
- Q1 after-picture: **NOT CAPTURED.**

### Evidence quality, stated rather than glossed

`RETURNING` proves *that statement changed those rows*. A later `SELECT` proves
only *their current state*. Production has the strong form; `preview/staging`
has the reconstruction. The gap is immaterial there because Q1-before pinned the
dirty population at exactly those two ids, Q3 shows none remain, and the
accidental re-run independently returned zero — but the distinction is recorded
rather than smoothed over.

Two Q1 after-pictures were never captured. They are marked NOT CAPTURED above
rather than filled in with their expected values. Nothing depends on them: Q3 is
the load-bearing check on both branches, and the `UPDATE`'s exact-equality
`WHERE` cannot have touched a row holding any other value.

## State at the end of DEBT-1b

- **Data: clean on all three branches.** Zero non-canonical rows, verified
  per branch with branch-named counts.
- **Code: writers plugged, but committed to `staging` only.** Until Gary merges
  `staging → main`, **production runs unplugged writers over clean data.** The
  practical risk is nil — after the backfill there is no legacy row for Duplicate
  to copy, and the origination path was a hand-edited script — but the state is
  real and is why DEBT-1 is `status: staging` and not `verified`.
- **`"During the Day"` now exists in the data**, on all three branches, for the
  first time (see §4 — the canonical value had never been written).
- **Open successors:** DEBT-30 (DB-level `CHECK`, now unblocked by the clean
  backfill), DEBT-32 (retire the two alias copies and fold the three phase lists
  into one), DEBT-33 (repo-wide lint baseline is red), BUG-5, DEBT-29, DEBT-31.
