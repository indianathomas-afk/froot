# SEARCH-1 — Global search bar — TIER 2

TIER 2: contained. One new API route, one new client component, one mount point
in `sidebar.tsx`, one new evidence script. **No schema changes. No new
capability. No new page route.** Brief audit, then build.

Save as `docs/prompts/SEARCH-1_global_search_bar.md`.

---

## Repo gate (run first, paste results, one command at a time — no `&&` chains)

```
pwd
```
Must end in `Froot/froot` (lowercase `froot` — the capital-F parent is a trap).

```
git remote -v
```
Must show `indianathomas-afk/froot`.

```
git status
```
Must be on `staging`, tree clean. If the branch is wrong or the tree is dirty,
STOP and report.

```
git rev-list --left-right --count main...staging
```
If `staging` is behind `main`, STOP and report.

---

## What SEARCH-1 is

A search input pinned at the top of the `(app)` sidebar. Typing shows a grouped
dropdown of results. Enter or click navigates. That is the whole feature.

**It searches exactly three sources and nothing else:**

1. **Go to** — sidebar nav destinations
2. **Training** — `TrainingModule` titles/subjects/descriptions and
   `TrainingLesson` titles
3. **Help** — the existing HELP-1 article index

**It is ADMIN, MANAGER and STORE only.** The `(my)` portal gets nothing this
phase. STAFF is out of scope entirely.

### What it does NOT search, and this is a ruling not an omission

Staff members. HR documents. Manager notes. Wages or anything comp-adjacent.
Staff document uploads. Signed records. Certificates. Messages. Stores.
Checklist templates. Checklist instances. Inventory items.

The first seven are personal data and are excluded permanently under the ruling
below. The last five are merely deferred and could return as an additive row.

**The guarantee this phase makes is structural, not procedural.** Search reads
three sources, so it cannot leak a wage or a manager note, because it never
queries the tables they live in. Do not add a fourth source to "round it out".
Do not add a blocklist — a blocklist implies the query could reach those tables,
and it must not.

---

## Rulings to ratify (Gary's words — do not paraphrase, do not write in his voice)

Both go in `docs/DECISIONS.md` at the docs commit. **Ask Gary to confirm wording
before committing.** Ruling 1 is his verbatim from 2026-09-06.

**1 — Training content vs training records:**

> Training material is how you do the job, same as a checklist task. Anybody
> working a shift can read it. Who's been assigned what, who passed the quiz,
> how many hours they logged, who got certified — that's about a person, and it
> stays with managers and admins.

This ruling **records existing behaviour rather than changing it**, the same
shape as the `/settings/labor` entry ratified under NAV-1. Verified on staging
2026-09-06: a STORE login (`corporate@keva.com`) reaches `/hr/training` and gets
a read-only viewer — module cards, categories, a Read button, and no Edit,
Duplicate, Assign, Create, Import, Export or Manage Categories, no assignment
status, no progress, no quiz result. It is written down now because SEARCH-1 is
about to depend on it.

**2 — Search never surfaces personal data:**

Gary's wording to be supplied. Substance: search covers Froot features, help
articles and training topics. It does not surface anything about a specific
person, for any role.

---

## Phase A — audit (report, then build; no STOP unless something below stops you)

### A1 · The training gate — blocking

`/hr/training` renders read-only for STORE on staging. **Find out what makes
that true at HEAD.** Report the file:line and the exact shape:

- a `can(actor, …)` call — name the capability
- a raw role-string comparison — the DEBT-85 shape
- a layout-level gate
- data scoping with no page gate — the DEBT-87 shape

Search must ask the **same question the page asks**. If that question is a raw
role string, say so and ask it the same way rather than inventing a capability;
a new capability that disagrees with the page is DEBT-85 made worse.

**STOP and report** if the gate turns out to be ADMIN-only in code and the
staging observation cannot be reconciled. The premise of this phase would be
wrong.

### A2 · The Read destination — blocking

The card list rendering for STORE does not prove the lesson detail route does.
**Every training search result points at that route.** Report:

- its path
- its gate, in the same terms as A1
- whether a STORE-scoped request reaches it

**STOP and report** if the list is reachable but the detail route is not. A
result that 404s is worse than no result, and the fix would be a different
phase.

### A3 · Store scoping of modules

Report how `appliesTo` / `TrainingModuleStoreAssignment` is applied on the
read-only surface today, and how `getUserStoreScope()` resolves for a STORE
login. Search must reuse that filter, not re-derive it.

### A4 · The help index

Confirm at HEAD:

- the exact export signature of `helpScope` and `searchIndex` in
  `src/lib/help-access.ts`
- that `searchIndex()` returns rows already filtered for the actor
- the `surface` argument's accepted values

### A5 · The nav item source

Confirm the sidebar item array in `src/components/layout/sidebar.tsx` and its
`isVisible()` filter can be reached from the search code **without a circular
import and without pulling a client component into a route handler.** If it
cannot, report that before building — the fix is to lift the array into
`src/lib`, which is a shape change worth naming rather than doing silently.

### A6 · Collisions

Confirm nothing named `/api/search` exists. Report any existing global search
attempt, keyboard shortcut handler, or command palette in the tree.

---

## Phase B — build

### B1 · `src/lib/search.ts`

One exported function:

```ts
searchAll(actor, org, storeScope, query): Promise<SearchGroup[]>
```

It is **the only place** the three sources are assembled. Result rows carry:

```ts
{ group: "goto" | "training" | "help", id, title, subtitle, href, preview?: boolean }
```

Nothing else. No entity bodies, no counts, no status.

**Go to** — reuse `isVisible()` verbatim against the nav array. No second copy
of the nav filter.

**Training** — `ILIKE` on `TrainingModule.title`, `subject`, `description` and
`TrainingLesson.title`, scoped to `organizationId`, `isActive: true`,
`isArchived: false`, plus the A3 store filter. **A lesson hit rolls up to its
module**: the result is the module, and `subtitle` names the lesson that
matched. Never return assignment, progress, quiz or certification fields — do
not `select` them at all, so a later refactor cannot leak them.

**Help** — call `helpScope(actor, org, GUIDE_ARTICLES, { surface: "app" })` and
its `searchIndex()`. **Do not read `GUIDE_ARTICLES` directly and do not filter
articles here.** That is DECISIONS.md ruling 4 of 2026-09-04: one place decides
who sees what. Precedent for why: adding a `routes` field to the help index row
shipped `/inventory/ingredients/deleted` to STORE readers, and
`verify-help-access.ts` caught it, not review. Carry the `preview` flag through
so a module-preview article does not look like a broken link.

### B2 · `GET /api/search`

Thin. Resolves the actor via `actorFor()`, calls `searchAll`, returns groups.

- 2-character minimum; below that return empty groups, not an error
- cap 5 rows per group, 15 total
- **`Cache-Control: private, no-store` on every return path, including the
  early return and the `catch`.** `verify-help-routes.ts` found the help search
  route answering 200 with no cache directive on exactly those two paths. An
  empty index is not a disclosure, but an empty index heuristically cached under
  that URL and served to a reader entitled to a full one is silent breakage with
  nothing in any log.

### B3 · `<GlobalSearch>`

Pinned at the top of the `(app)` sidebar, directly under the org switcher, above
Dashboard. On the 60px rail it collapses to a magnifier that opens the same
panel.

- 250ms debounce, aborts in-flight requests
- arrow keys move, Enter navigates, Esc closes, click outside closes
- groups render in order: **Training, Go to, Help**, each with a header, empty
  groups omitted
- **44px minimum tap targets** — STORE logins are shared iPads
- no Cmd+K dependency; the input must be reachable by touch alone
- existing design tokens only. No new colours, no new spacing system.

Dropdown only. No `/search` results page this phase.

### B4 · `scripts/verify-search-scope.ts`

Pure, in the shape of `verify-perm8-grants.ts` and `verify-help-access.ts`. It
must assert:

1. **Per-role visible result sets** for ADMIN, MANAGER and STORE against a
   fixture query set, computed through the real `can()` / `isVisible()` /
   `helpScope()`.
2. **The gated-section assertion, run against the global payload.** Import the
   `GATED` table from `verify-help-access.ts` and assert that no gated section's
   vocabulary reaches a global search result for a reader who cannot see the
   section. Without this the search bar is a second door around the HELP-1
   section ruling.
3. **The excluded-source assertion.** Grep `src/lib/search.ts` and fail if it
   references `staffMember`, `hrDocument`, `managerNote`, `squareTeamMemberWage`,
   `staffDocument`, `trainingAssignment`, `trainingQuizAttempt` or
   `teamMessage`. This is the structural guarantee made testable rather than
   promised.

Also add `/api/search` to `scripts/verify-help-routes.ts` so its cache headers
are asserted on every return path by invoking the real handler.

---

## Evidence (done criteria)

Route-level, not button-level. Assertions in code, not claims in prose.

1. `verify-search-scope.ts` green, with the per-role table printed.
2. `verify-help-access.ts` green — unchanged behaviour on the help side.
3. `verify-help-routes.ts` green, including the new route.
4. **`verify-nav1-url-sets.ts` green.** Adding an input to `sidebar.tsx` adds no
   item literal and must not change any role's URL set. If it goes red, the
   parser broke — fix the code, **do not touch `BASELINE_REV`**.
5. `npm run build` green.

**Not verified here, and Gary's after the push:** a request-level pass on
staging as Karson (ADMIN), Tommy Thomas (MANAGER — deliberately, per PERM-8) and
the STORE login, searching a term that hits all three groups and one that hits a
gated help section. Claude never pushes, so staging does not have this code.

---

## Ceremony

- `npm run build` gates the commit. Lint does not (DEBT-33) — run scoped
  `npx eslint` on touched files only.
- Two-commit pattern: work commit, then docs commit citing the work SHA.
- Roadmap row: **read the highest existing id from `docs/ROADMAP.yaml` at
  session time and take the next one.** Do not trust any "next free" note in the
  file (DEBT-84). No `SEARCH` row exists as of 2026-09-06.
- `docs/DECISIONS.md`: both rulings above, in Gary's words, confirmed with him
  before the docs commit.
- `docs/DEPLOY_LOG.md`: entry scaled to blast radius. This is one route, one
  component and one lib file. Keep it short.
- Out-of-scope findings: FIX NOW / RULING NOW / COMMENT / ROW triage. ROW last.
- **Commit only. Gary runs all pushes.**
