TIER 3

# COMP-1 — Compensation confidentiality + per-user Labor page access

You are working in the Froot repo. Run `froot` to navigate to the git root
(`~/Claude_Projects/Froot/froot` — the lowercase `froot` is the repo; do not
work in the capital-F parent). Read `CLAUDE.md` and `docs/WORKFLOW.md` before
touching anything. This is a TIER 3 session: **audit first, present the plan,
STOP, and wait for Gary's explicit approval before any file is edited.** Do not
commit any phase before returning evidence. You never push — Gary runs every
push. Commits go on `staging`, never directly on `main`. No `&&` chains in any
pasteable command block — one command at a time, results read before the next.

## Row

`COMP-1` in `docs/ROADMAP.yaml`. Verify the ID is unused before recording
anything (grep for `COMP-` — it was free as of 2026-08-28). The row is written
at the END of the session from what was actually done, prepend-style, nothing
deleted. If a deviation must be numbered, read the highest recorded deviation
in ROADMAP.yaml first — never assign from this prompt.

## Why this exists

During the first manager rollout, a MANAGER account on `/settings/labor` could
see every person's compensation on the Positions roster — including
Administrator and Manager salaries that are highly confidential (e.g. the
$51k/$52k salaried rows visible in production screenshots). The existing
per-user "See pay rates and tips" permission is all-or-nothing across people:
a manager needs it ON to run their store, and ON exposes everyone. The missing
granularity is on the **person**, not the viewer.

## Ratified rulings (docs/DECISIONS.md — write this entry as part of the work commit)

Ruled by Gary, 2026-08-28, in chat:

1. Confidential comp is marked by a **per-person admin-set flag**, not an
   automatic role rule. The migration seeds it ON for salaried people and
   admins so coverage exists on day one, but it remains per-person thereafter.
2. Confidential comp is visible to **Admin only**. No per-user grant for now.
3. **Option B shape confirmed** (same pattern as the GM on-floor band ruling):
   masked numbers still feed the weekly labor budget; budget totals stay
   visible to managers. **Accepted limitation, recorded deliberately:** at a
   store with exactly one confidential person, a manager who sees the total
   and all visible rows can infer the hidden salary by subtraction.
4. Labor page access becomes a **per-user Edit User permission**, default ON
   for MANAGER, not an org-wide settings toggle. (The existing `/settings`
   labor toggle disables the module globally; that stays untouched.)

Before writing the entry into `docs/DECISIONS.md`, confirm with Gary that the
entry text he approved in chat is the text you are writing. Pasting words he
has not approved is not a ruling.

## Scope — three parts, one row

**Part 1 — the flag.** Additive schema change: a `compConfidential` boolean
(non-null, `@default(false)`) on whichever model actually backs a person on
the Positions roster — the audit determines this (likely the Froot staff
record; confirm how Square team members join to it). Admin-only write path.
Backfill in the migration: ON for anyone with salaried comp and anyone whose
role is ADMIN.

**Part 2 — server-side redaction.** Every API response that carries pay
numbers redacts them for non-ADMIN viewers when the person's flag is ON. The
weekly budget aggregate is computed **server-side from real values** and
returned as a total; only row-level numbers are masked. Masked values render
in the UI as "—" with a lock glyph or title-text explaining "Confidential —
visible to admins only". THE REDACTION MUST BE IN THE API RESPONSE, NOT THE
CLIENT. A manager reading the Network tab must find no confidential number in
any payload. This is the acceptance test that matters most.

**Part 3 — Labor page access permission.** A new capability in the registry
(`src/lib/permissions.ts`), named per existing registry conventions (something
like `labor.access` — match the house style, do not invent a new naming
scheme). Default ON for ADMIN and MANAGER; per-user override OFF-able in the
Edit User modal, which renders from the live registry (PERM-5 pattern —
confirm the new capability surfaces there automatically; if it does not, that
is a finding, not a thing to hack around). Enforcement in BOTH places: the
page(s) and every labor settings API route. Hidden sidebar link alone is not
enforcement.

## Phase A — Audit (no edits, no commits)

Produce an audit artifact per CLAUDE.md § Where documents live. It must map,
with `file:line` references:

1. **Every API route that returns pay or compensation numbers.** Positions
   roster, rate legend, staff endpoints, labor plan / weekly budget, reports —
   anywhere a wage, salary, or rate leaves the server. For each: who can call
   it today, and what the response shape is.
2. **Every place the client computes budget math from row-level pay.** If the
   weekly budget is currently assembled client-side from per-person numbers,
   redaction breaks it or leaks through it — the plan must move that math
   server-side and say exactly where.
3. **The model that carries the flag**, and how "Not in Froot" roster rows
   (Square team members with no Froot staff record) behave. Default lean:
   absent means not confidential, consistent with the default-false flag and
   the house "absent means zero" principle — but if the audit finds salaried
   comp on a not-in-Froot row, STOP and flag it; that is a hole the per-person
   flag cannot cover.
4. **The permissions registry and Edit User modal path** for Part 3: where the
   capability is declared, how per-user overrides store, whether the modal
   picks up a new capability without bespoke UI work, and the exact set of
   pages + API routes that constitute "the Labor page" surface (at minimum the
   labor settings page and its write routes; enumerate them).
5. **The Prisma nullable-boolean trap check:** the flag is non-null so
   `not: true` filters should be safe, but verify no query in the plan relies
   on Prisma filtering semantics that silently drop NULL rows. If any nullable
   boolean is involved anywhere, use explicit OR.

Then present: the audit findings, the build plan (files to be touched and
why, migration SQL draft, redaction approach per route), and any surprises.
**STOP. Wait for Gary's approval. Do not proceed on silence.**

## Phase B — Build (only after explicit approval)

Migration flow (additive only — no column drops, ever):

```
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script -o prisma/migrations/<timestamp>_comp_confidential/migration.sql
```

Review the SQL. Add the backfill statements to the same migration file
(seeding ON for salaried + ADMIN per ruling 1). Then, separately:

```
npx prisma db execute --file prisma/migrations/<timestamp>_comp_confidential/migration.sql
```

```
npx prisma migrate resolve --applied <timestamp>_comp_confidential
```

```
npx prisma generate
```

`applied_steps_count: 0` in `_prisma_migrations` is expected with this flow —
the schema probe is the evidence, not the ledger count. Never run migrations
against staging or production by hand; they apply via `prisma migrate deploy`
in the Vercel build.

Build gate: `next build` must pass. Two-commit pattern: work commit, then
roadmap recorder commit. Commits on `staging`. Do not push.

## Evidence requirements

- **Database evidence names the branch** — the `ep-` host or
  `current_setting('neon.branch_id')` in the same output. Dev is
  `br-broad-wave`; you have no direct connection to staging
  (`br-square-feather`) or production (`br-sparkling-block`) — deployed-DB
  reads go through Gary in the Neon console. Never run `vercel env pull`.
- **Browser evidence names the org ID and Clerk instance** in the same
  observation (org `org_3G02wO4QlVVSWppi8aqlnSZnsDa`, staging Clerk instance
  `verified-snapper-7`), and checks the `~staging` page badge.
- **Staging-SHA precondition** before any staging verification: deployed SHA
  must match local HEAD. Two commands, run them, show them.
- **The Network-tab test is mandatory evidence for Part 2:** logged in as a
  non-admin, capture the Positions/labor API response bodies and show that no
  confidential number appears anywhere in the payload while the budget total
  is still present and correct.
- A green result from an instrument that cannot detect the failure is not
  evidence — for each check, say what a failure would have looked like.

## Test instructions for Gary (write these out at the end, concretely)

Step-by-step, jargon-free, in this shape: what to click, what to expect, what
failure looks like. Cover at minimum:

1. As Karson (ADMIN, staging): open the labor positions page → confidential
   toggles are visible and flippable → flip one ON → the pay still shows for
   you (admins see everything).
2. As a MANAGER account (name which one after the audit — Gary confirms which
   staging login carries MANAGER): same page → the flagged person's pay shows
   "—", the weekly budget total is unchanged, and everything else still shows.
   Failure looks like: a dollar amount where the dash should be, or a budget
   total that dropped when the flag flipped.
3. As the same MANAGER: Edit User → turn "Access the Labor page" OFF for
   yourself is not possible (a manager should not un-gate themselves — confirm
   admin-only write on overrides per existing PERM-5 behavior); as ADMIN, turn
   it OFF for the manager → manager's sidebar loses Labor, direct URL to the
   labor page is refused, and a direct API call to a labor settings route
   returns a permission error, not data. Failure looks like: the link is gone
   but the URL still renders the page.

## End of session

Triage every loose end as FIX NOW / RULING NOW / COMMENT / ROW (ROW is last
resort). Compose the DEPLOY_LOG entry scaled to blast radius — this touches
permissions and adds a migration, so a full entry, not a one-liner — using the
Claude-authored terminal-command flow from CLAUDE.md (heredoc chunks, `wc -l`
checks, `grep -c "^## "` after the splice). Hand Gary the push-readiness
summary. Do not push.

## Out of scope

Anything found along the way that is not COMP-1 is written down as text in the
report, not fixed inline. One contained fix per row. In particular: DOC-4's
visibility-floor question, the global labor toggle in /settings, and any
Square-side pay data behavior stay untouched.
