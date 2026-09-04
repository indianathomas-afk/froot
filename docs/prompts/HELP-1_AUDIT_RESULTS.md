# HELP-1 — in-app help system — AUDIT RESULTS

Audit session, 2026-09-04. **No application code was written.** Run against
`staging` at HEAD `4a8be43`, working tree otherwise clean.

Every count in this document is derived by running something, not estimated.
Where a question could not be settled from the repo it says so and names what
would settle it.

---

## Repo gate

| Check | Result |
|---|---|
| `pwd` | `/Users/garythomas/Claude_Projects/Froot/froot` — correct (lowercase `froot`) |
| `git remote -v` | `indianathomas-afk/froot` — correct |
| `git status` | on `staging`; only untracked file was this prompt; ahead of `origin/staging` by 1 commit (a prior session's, unpushed — expected) |

---

## The short version

Nine of the ten questions are answered from the repo. The tenth — **question A,
the blocking one — is not fully answerable here, and I am not going to pretend
otherwise.**

The four things that actually change the shape of the phase:

1. **The matcher does not protect `.png`.** Mechanically tested, not eyeballed.
   As configured, a request for `/guide/dashboard-01.png` never reaches
   `auth.protect()`. What the repo cannot prove is the *deployed* behaviour —
   one command settles it (§ A). Either way the recommendation in § J is the
   same, so **the phase is not blocked on running it**, which is the one piece
   of good news in this section.
2. **The redaction risk list in the prompt was wrong in both directions.**
   `/labor` renders no person data at all, and four surfaces nobody flagged do —
   including `/dashboard`, which every one of the four roles can reach (§ C).
3. **68 routes, 44 articles.** The nav's 26 is the *nav*, not the reachable
   surface. Under your task ruling an article claims a set of routes, so the
   coverage gate checks that every route is **claimed by some article** — 65
   claimed, 3 exempt, 0 unclaimed (§ B.3).
4. **The `?` is one edit, not thirty-five** — but only if it mounts in
   `AppShell` rather than in page headers, which are hand-rolled 78 times over
   (§ D.4).

The decision forks I am deliberately leaving open for you are listed in
§ Decision forks at the end.

---

## A — do static assets require auth? **(blocking — partially answered)**

### The matcher, verbatim

From `src/proxy.ts`:

```ts
export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
}
```

And the guard it feeds:

```ts
export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect()
  }
})
```

### What the config does — tested, not read

I compiled both matcher patterns as anchored regexes and ran candidate paths
through them rather than reasoning about the alternation by eye:

| Path | pattern 1 | pattern 2 | middleware |
|---|---|---|---|
| `/guide/dashboard-01.png` | no | no | **does NOT run** |
| `/guide/dashboard-01.webp` | no | no | **does NOT run** |
| `/guide/dashboard-01.png?x=1` | no | no | **does NOT run** |
| `/guide/dashboard-01.PNG` | MATCH | no | **RUNS** (`auth.protect`) |
| `/guide/notes.txt` | MATCH | no | RUNS |
| `/staff` | MATCH | no | RUNS |
| `/api/help/search` | MATCH | MATCH | RUNS |

`.png` is inside the negative lookahead's extension list, so the lookahead
succeeds and the pattern fails to match — the request is excluded from
middleware entirely. Nothing else in the repo re-guards it: `next.config.ts`
declares only `serverExternalPackages` (no `headers`, `redirects` or
`rewrites`), `vercel.json` declares only `crons`, and a file in `public/` is
served as a static asset with no route handler in front of it.

### The answer

**Excluded — as configured.** A file at `public/guide/dashboard-01.png` is
served without a session check, per the middleware configuration committed at
HEAD.

**But the deployed fact is not verified, and I am flagging that rather than
rounding it up to a finding.** Two honest gaps:

- **Vercel Deployment Protection is not repo state.** It is a dashboard
  setting. If it is on for an environment, everything on that deployment
  requires auth regardless of what the matcher says, and nothing in the repo
  can tell me.
- **The repo's own working evidence exercises a different arm of the same
  lookahead.** `/logo.png` renders on `src/app/page.tsx` and on both
  sign-in/sign-up pages — all public, all reached with no session — so
  signed-out visitors demonstrably load it. That is tempting as proof, and it
  is not: `next/image` requests go out as `/_next/image?url=%2Flogo.png`, which
  is excluded by the **`_next`** alternative, not the extension alternative. So
  the sign-in page working proves the `_next` arm serves unauthenticated. It
  corroborates but does not establish the extension arm, which is the one that
  governs `/guide/*.png` at its direct path.

I have deliberately not used `docs/PERMISSIONS_INVENTORY.md`'s `/robots.txt`
reasoning as evidence anywhere above. That note labels itself unverified, and
it argues the same mechanism in the opposite direction (`.txt` absent from the
list ⇒ protected). Leaning on it would make this section that note's inference
wearing a finding's clothes.

### What would settle it — for you to run, not this session

One request against a **production** deployment while signed out, for a file
that exists in `public/` at its **direct** path (not through `next/image`):

```bash
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' https://<production-host>/logo.png
```

`200` with an empty redirect target ⇒ **excluded**, static assets are public,
and § J's recommendation stands as written. `307` to sign-in ⇒ **matched**, and
`public/guide/` becomes viable for PII-bearing articles (though § J still
recommends against it for a second reason).

Run it against production specifically — a staging alias can answer differently
because of Deployment Protection, which is exactly the trap that made the
`/robots.txt` note wrong the first time.

### Incidental finding, and it is a real one

**`.PNG` and `.png` behave oppositely.** The extension list is case-sensitive,
so an uppercase-suffixed capture is *protected* while its lowercase twin is
*public*. A capture workflow that produces `Screenshot.PNG` from macOS and
another that produces `.png` would ship two different auth postures from the
same folder, and nothing would report the difference. § J's workflow normalises
the extension for this reason.

---

## B — the real article surface

### B.1 — the four counts, re-derived at HEAD

Ran `npx tsx scripts/verify-nav1-url-sets.ts` unmodified (`BASELINE_REV`
untouched at `10439b3`):

```
ADMIN 26 · MANAGER 23 · STORE 12 · STAFF 6      PASS — every role's URL set is identical
```

**HEAD still reproduces the NAV-1 row exactly.** Nothing changed; the fixture is
green, all four scenarios identical.

Two observations that fall out of the full sets and matter later:

- MANAGER reaches `/settings/labor` but **not** `/settings`. The Labor config
  page is reachable by a role that cannot see the Settings hub it lives under.
- The STAFF set (6 URLs) is **computed but largely unreachable in practice**.
  `SH-2` in `(app)/layout.tsx` redirects a linked STAFF user with HR gates on to
  `/my`, so STAFF never enters the shell that renders this sidebar. The verifier
  is explicit that it proves nothing about what a browser renders; this is one
  of the places that bites.

### B.2 — nav vs. the actual page surface

68 `page.tsx` routes exist. The nav's ADMIN set is 26. Cross-referenced against
the PG- rows in `docs/PERMISSIONS_INVENTORY.md`:

**Reachable, real, and not in the nav at all:**

| Route | Why it is not in the nav | Inventory row |
|---|---|---|
| `/items` | Square catalog metadata page; PG-19 says outright "page not in nav at all" | PG-19 |
| `/internal/roadmap` | internal tool, `requireAdmin()` | **no row** |
| `/labor/inspector` | drill-down from `/labor`; `labor.manage` + Square-labor gates | **no row** |
| `/staff/engagement` | drill-down from `/staff`; `engagement.view` | **no row** |
| `/reports/operations` | drill-down from `/reports`; inherits the layout gate | **no row** |

**Four routes have zero mentions in `PERMISSIONS_INVENTORY.md`** —
`/internal/roadmap`, `/labor/inspector`, `/staff/engagement`,
`/reports/operations`. Three of them post-date the survey (ENG-1, L-2, R7), so
this is drift rather than an error, but the inventory is no longer a complete
index of the page surface and HELP-1 should not treat it as one. *(Filed under
§ Out-of-scope findings as COMMENT, not a row.)*

**In the nav and correctly covered:** all 26 ADMIN destinations map to a PG-
row. No nav entry points at a route that does not exist.

**One structural oddity:** `/inventory/orders/new` has a page but there is no
`/inventory/orders` parent page — the only route in the tree with no ancestor.
Under the task ruling this stops being a problem: it is part of the
purchase-order task and is claimed by article 35 (§ B.3). It may still be an
unlinked leftover worth deleting, but HELP-1 no longer needs a ruling on it.

### B.3 — the article list and the route→article mapping

**Granularity ruling (Gary, 2026-09-04): articles map to user tasks, not to
routes. A list page, its detail page and its `/new` sibling are normally one
article. Print routes get none.**

This changes the mapping from one-to-one to **one-to-many**: an article *claims*
a set of routes. The coverage gate in § G.3 therefore checks that **every route
is claimed by some article**, not that every route has its own — which is a
weaker and more honest condition, and the only one compatible with task-shaped
articles.

Derived by running the mapping against the filesystem route list:

```
ROUTES:   68
ARTICLES: 44
coverage: 68 routes = 65 claimed + 3 exempt + 0 UNCLAIMED
unclaimed:      none
double-claimed: none
phantom refs:   none
```

**Exempt — claimed by no article, deliberately (3):**

| Route | Why |
|---|---|
| `/print/checklist/[id]` | print view — Gary's ruling: print routes get none |
| `/print/template/[id]` | print view — Gary's ruling: print routes get none |
| `/` | public marketing landing; not an in-app surface |

`/` is my call, not yours — you ruled only on print. Flagged as fork 1 below.

#### The mapping

`•` marks the article's entry point (the route the `?` and search results link
to). Titles are placeholders for shape, not content — content is out of scope.

| # | Article | Routes claimed | Gate | Module | A | M | S | St |
|---|---|---|---|:-:|:-:|:-:|:-:|:-:|
| 1 | Running the daily checklist | • `/store-view`<br>`/store-view/checklist/[id]` | `storeview.access` | — | ✓ | ✓ | ✓ | · |
| 2 | Reviewing completed checklists | • `/checklists` | `checklists.view` | — | ✓ | ✓ | ✓ | ✓ |
| 3 | Building checklist templates | • `/templates`<br>`/templates/[id]`<br>`/templates/[id]/edit`<br>`/templates/new` | `templates.manage` | — | ✓ | · | · | · |
| 4 | The dashboard | • `/dashboard` | `dashboard.view` | — | ✓ | ✓ | ✓ | ✓ |
| 5 | Team messages | • `/messages` | `messages.use` | — | ✓ | ✓ | ✓ | ✓ |
| 6 | Managing stores | • `/stores` | `stores.view` | — | ✓ | ✓ | · | · |
| 7 | Managing logins and invitations | • `/users` | `users.manage` | — | ✓ | · | · | · |
| 8 | The staff directory | • `/staff`<br>`/staff/[id]` | `staff.view` | — | ✓ | ✓ | · | · |
| 9 | Staff engagement | • `/staff/engagement` | `engagement.view` | — | ✓ | · | · | · |
| 10 | Settings and modules | • `/settings` | `settings.access` | — | ✓ | · | · | · |
| 11 | Signing in and accepting an invitation | • `/sign-in/[[...sign-in]]`<br>`/sign-up/[[...sign-up]]` | public | — | ✓ | ✓ | ✓ | ✓ |
| 12 | The internal roadmap page | • `/internal/roadmap` | ADMIN | — | ✓ | · | · | · |
| 13 | Sales reports | • `/reports` | `reports.view` | — | ✓ | ✓ | · | · |
| 14 | Operations reports | • `/reports/operations` | `reports.view` | — | ✓ | ✓ | · | · |
| 15 | Forecasting and goals | • `/forecasting` | `forecasting.view` | — | ✓ | ✓ | · | · |
| 16 | The weekly labor plan | • `/labor` | `labor.view` | labor | ✓ | ✓ | ✓ | ✓ |
| 17 | Inspecting a day's labor | • `/labor/inspector` | `labor.manage` | labor | ✓ | ✓ | · | · |
| 18 | Configuring the labor model | • `/settings/labor` | `labor.access` | labor | ✓ | ✓ | · | · |
| 19 | The Instagram feed | • `/instagram` | `instagram.view` | — | ✓ | ✓ | ✓ | ✓ |
| 20 | The HR hub | • `/hr` | `hr.access` | hr | ✓ | ✓ | ✓ | ✓ |
| 21 | Signing a document | • `/hr/acknowledge/[documentId]` | self or attest (PG-32) | hr | ✓ | ✓ | ✓ | ✓ |
| 22 | The document library | • `/hr/documents`<br>`/hr/documents/[id]` ⚠ | `hr.access` | hr | ✓ | ✓ | ✓ | ✓ |
| 23 | Building forms | • `/hr/forms`<br>`/hr/forms/[id]` | ADMIN | hr | ✓ | · | · | · |
| 24 | Running a supervised form | • `/hr/forms/[id]/submit` | ADMIN+MANAGER | hr | ✓ | ✓ | · | · |
| 25 | Building training modules | • `/hr/training`<br>`/hr/training/new`<br>`/hr/training/[id]/edit`<br>`/hr/training/[id]/preview` ⚠ | ADMIN | hr | ✓ | · | · | · |
| 26 | Signed records | • `/hr/signed-records` | ADMIN | hr | ✓ | · | · | · |
| 27 | The compliance rollup | • `/hr/compliance` | ADMIN+MANAGER | hr | ✓ | ✓ | · | · |
| 28 | Ingredients | • `/inventory/ingredients`<br>`/inventory/ingredients/deleted` ⚠<br>`/inventory/ingredients/duplicates` ⚠ | `inventory.nav.view` | inventory | ✓ | ✓ | ✓ | · |
| 29 | Sales items | • `/inventory/sales-items` | `inventory.nav.view` | inventory | ✓ | ✓ | ✓ | · |
| 30 | Recipes | • `/inventory/recipes`<br>`/inventory/recipes/[id]` | `inventory.assets.manage` | inventory | ✓ | ✓ | · | · |
| 31 | Storage areas | • `/inventory/storage-areas` | `inventory.storage.manage` | inventory | ✓ | ✓ | · | · |
| 32 | Running a count | • `/inventory/counts`<br>`/inventory/counts/[id]` | `inventory.nav.view` | inventory | ✓ | ✓ | ✓ | · |
| 33 | Adjustments — waste, transfers, comps | • `/inventory/adjustments` | `inventory.nav.view` | inventory | ✓ | ✓ | ✓ | · |
| 34 | Vendors | • `/inventory/vendors` | `inventory.assets.manage` | inventory | ✓ | ✓ | · | · |
| 35 | Purchase orders — creating, sending, receiving | • `/inventory/purchase-orders`<br>`/inventory/purchase-orders/[id]`<br>`/inventory/purchase-orders/new` ⚠<br>`/inventory/orders/new` ⚠ | `inventory.po.view` | inventory | ✓ | ✓ | ✓ | · |
| 36 | Expected stock | • `/inventory/expected` | `inventory.analytics.view` | inventory | ✓ | ✓ | · | · |
| 37 | Low-stock alerts | • `/inventory/alerts` | `inventory.analytics.view` | inventory | ✓ | ✓ | · | · |
| 38 | Inventory reports | • `/inventory/reports` | `inventory.analytics.view` | inventory | ✓ | ✓ | · | · |
| 39 | Menu items | • `/items` | any member (PG-19) | inventory | ✓ | ✓ | ✓ | ✓ |
| 40 | The staff portal | • `/my` | linked staff (PG-33) | — | ✓ | ✓ | ✓ | ✓ |
| 41 | My documents | • `/my/documents`<br>`/my/documents/[documentId]`<br>`/my/documents/records/[recordId]` | linked staff | hr | ✓ | ✓ | ✓ | ✓ |
| 42 | My training | • `/my/training`<br>`/my/training/[assignmentId]` | linked staff | hr | ✓ | ✓ | ✓ | ✓ |
| 43 | My messages | • `/my/messages` | linked staff | — | ✓ | ✓ | ✓ | ✓ |
| 44 | My Instagram | • `/my/instagram` | linked staff | — | ✓ | ✓ | ✓ | ✓ |

**The task ruling resolved the orphan.** `/inventory/orders/new` had no parent
page to fold into under the route-based model and needed a ruling of its own.
Under the task model it is simply part of the purchase-order task, claimed by
article 35. Fork 7 is closed by the ruling rather than by a decision.

**Three groupings are judgement calls, not mechanical:**

- **Articles 1 and 2** split `/store-view` from `/checklists`. Running a
  checklist and reviewing completed ones are different tasks by different people
  — and the roles differ (STAFF reaches `/checklists`, not `/store-view`).
- **Articles 23 and 24** split building a form from running one on a staff
  member. Different task, different audience, different guard (PG-26 ADMIN vs
  PG-27 ADMIN+MANAGER). The `/new`-sibling rule would have merged them; the
  task rule separates them.
- **Article 21** keeps the signing ceremony separate from the document library.
  Signing is the single most common task any staff member performs, and it is
  reached from `/my/documents` as often as from `/hr`.

Merge any of these and the count drops accordingly; they are the three places
where a different reading of "task" gives a different number.

#### ⚠ Mixed-gate articles (4) — a new consequence of the task ruling

Four articles claim routes whose guards are **stricter than the article's entry
point**:

| Article | Entry point reachable by | But also claims | Which requires |
|---|---|---|---|
| 22 The document library | any member with `hr.access` | `/hr/documents/[id]` | ADMIN (PG-25) |
| 25 Building training modules | ADMIN | `/hr/training/[id]/preview` | ADMIN **+ MANAGER** (PG-29 — *looser*, not stricter) |
| 28 Ingredients | STORE and up | `/ingredients/deleted`, `/duplicates` | ADMIN+MANAGER (PG-22) |
| 35 Purchase orders | STORE and up | both `/new` routes | ADMIN+MANAGER (PG-22) |

**This did not exist under the route-based model and needs a ruling.** Under
ruling 3 an article is hidden from someone who cannot reach the page it
describes — but a task article describes *several* pages with *different*
gates. A STORE login can reach `/inventory/ingredients` and so sees the
Ingredients article, which contains a section on restoring deleted ingredients
they cannot do.

Three options, in ascending cost:

1. **Gate on the entry point; write around the gaps.** The article is visible
   if its entry route is, and the prose simply does not promise the reader can
   do the manager-only parts. Cheapest; relies on the writer being careful.
2. **Gate on the entry point; hide sections per capability.** The article body
   carries per-section capabilities and renders only the ones the reader can
   act on. Honest, and reuses `visibleArticles()`'s machinery at section
   granularity.
3. **Split the mixed articles.** Four articles become eight; the task ruling
   gets partially undone in exactly the places it was most useful.

**Recommendation: option 2**, because it is the only one where the help surface
cannot promise something ruling 3 forbids, and the per-section capability is a
field in the frontmatter (§ G.2) rather than new machinery. Option 1 is
defensible if you would rather not carry section-level metadata; option 3 is
not, since it re-fragments precisely the tasks that most needed grouping.

### B.4 — totals

**68 routes. 44 articles.** 65 routes claimed, 3 exempt, 0 unclaimed, 0
double-claimed.

| Role | Visible articles | of which module-gated (upgrade previews under ruling 2) |
|---|---|---|
| ADMIN | **44** | 25 |
| MANAGER | **36** | 22 |
| STORE | **21** | 12 |
| STAFF | **15** | 7 |

Computed by calling the real `can()` per article, not counted by hand. Under
ruling 2 the module is not a filter, so these hold whether or not the org has
bought the modules; under ruling 3 the capability is, and it produces the
44 → 36 → 21 → 15 taper.

For comparison, the route-based model this replaces gave 41 articles and
41/33/19/13. The task model is *more* articles, not fewer, because it claims
the 27 routes the route model had folded away or excluded — the consolidation
it performs is more than offset by the coverage it gains.

The five `/my/*` articles remain the soft spot. PG-33 gates them on *being a
linked ACTIVE staff member*, which is orthogonal to role — an ADMIN with a staff
link reaches them and an ADMIN without one does not. I have scored them visible
to all four roles, the generous reading. Making them STAFF-only in the help
surface drops ADMIN/MANAGER/STORE by 5 each and leaves STAFF unchanged. Flagged
as a fork rather than resolved.

---

## C — redaction risk, sorted

I checked the actual page and client code for every article rather than
accepting the prompt's list. **The prompt's list was wrong in both directions**,
which is the result worth having.

### Corrections to the prompt's predicted six

| Prompt predicted | Verdict | Evidence |
|---|---|---|
| `/staff` | **confirmed** PII-bearing | names + wage column (`canSeeWages`-gated), `staff/page.tsx:111,152,203` |
| `/staff/[id]` | **confirmed** (folds into `/staff`) | PG-10; wage, legal name, notes, documents |
| `/users` | **confirmed** PII-bearing | `displayName`, `fullName`, `email` selected and rendered, `users/page.tsx:68` |
| `/labor` | **WRONG — structurally clean** | `weekly-plan-client.tsx` renders store names only; no staff name field anywhere in the file. It is an hours-and-cost model, not a named roster. |
| `/settings/labor` | **confirmed** PII-bearing | roster of names + `defaultHourlyRate`, `settings/labor/page.tsx:130-132`, hidden wholesale without `canSeeWages` |
| `/hr/compliance` | **confirmed** PII-bearing | `compliance-staff-table.tsx:119` renders `{r.name}` per row with compliance state |

So five of six confirmed, one wrong. And four surfaces the prompt did not list
are person-bearing.

### Buckets, in article terms (44 articles)

Re-expressed against the task-based article list. **A second sweep found two
things the first one missed** — my original pattern did not include
`displayName` / `fullName`, which is how this codebase names people. Both
corrections are below and both move an article *toward* risk, which is the
direction that matters:

- **`/store-view/checklist/[id]` renders a staff picker** — `{s.displayName}`
  over every staff member at the store (`checklist-execution-client.tsx:423`).
  That moves article 1 from Conditional to **PII-bearing**: assigning a task to
  a person is core to the task the article documents, so the names are not an
  edge case, they are the screenshot.
- **`/hr/signed-records` selects `displayName` and `fullName`**
  (`signed-records/page.tsx:31`) — **PII-bearing**, not clean as first scored.

(The same sweep threw 71 hits across `/inventory/*`, all false positives:
`displayName` there is the *ingredient* or *sales-item* name, not a person.
Inventory stays clean.)

### PII-bearing (17)

Real names, wages, compliance state or contact details render as a matter of
course.

| # | Article | What renders |
|---|---|---|
| 1 | Running the daily checklist | staff assignment picker by name; handoff-note authors |
| 5 | Team messages | author name on every message + free-text bodies |
| 7 | Managing logins and invitations | display name, full name, **email** |
| 8 | The staff directory | names, wages (`canSeeWages`), Square link state |
| 9 | Staff engagement | `{r.name ?? r.email}` **and** the email beneath it |
| 17 | Inspecting a day's labor | a named person's whole day + paid hours |
| 18 | Configuring the labor model | name + `defaultHourlyRate` roster |
| 21 | Signing a document | signer name, legal name, signature |
| 22 | The document library | audience assignment lists |
| 24 | Running a supervised form | the staff member being walked through |
| 25 | Building training modules | bulk-assign staff lists |
| 26 | Signed records | `displayName` + `fullName` per record |
| 27 | The compliance rollup | per-person compliance state by name |
| 40 | The staff portal | greets the reader by name — *"Hi, {displayName}"* |
| 41 | My documents | the reader's own documents and legal name |
| 42 | My training | the reader's own assignments |
| 43 | My messages | author names |

`/labor/inspector` (17) deserves a note: its own header says *"this page puts a
named person's whole day on screen. Wages, rates, tips and pay data NEVER appear
here."* Names-and-hours, not names-and-money — a redactor should know the pay
columns are already absent rather than hunting for them.

Article 5 is the one I would most expect to be under-rated: reachable by **all
four roles**, an author name on every message, and bodies that are free text
staff wrote, which can contain anything.

### Conditional (4) — the bucket that matters

Clean in general; shows person data in a named state.

| # | Article | Condition |
|---|---|---|
| 4 | The dashboard | the labor-coverage card's **"on floor" popover** lists staff names + title + clock-in time (`labor-coverage-card.tsx:627`). Closed by default — a plain dashboard shot is clean, a shot *demonstrating that card* is not. Separately, the corporate-updates feed renders `{m.author.name}` whenever an update exists (`dashboard-client.tsx:721`). |
| 6 | Managing stores | `contactEmail` / `phoneNumber` are business fields that in practice hold a manager's personal mobile (`store-actions.tsx:275-280`) |
| 15 | Forecasting and goals | the **F-5 edit-history audit log** renders `{e.user?.name \|\| e.user?.email \|\| "Unknown user"}` with a timestamp (`forecasting-client.tsx:354`) |
| 32 | Running a count | the submitted-count **summary view** renders `{c.userName}` — who performed the count — when non-null (`counts/[id]/summary-view.tsx:205`) |

**Articles 4 and 15 are the two that would have shipped.** Neither is a staff
page, neither was in the prompt's predicted list, both put a real identity in a
corner of the frame, and the dashboard is the single most likely page to be
screenshotted first because it is where every other guard redirects to.

The forecasting one is worse than it looks: the fallback chain reaches for
**`email`** when `name` is null, so the *less* configured the org, the *more*
identifying the screenshot.

### Structurally clean (23)

No person-identifying data under any org state: 2 (reviewing checklists), 3
(templates), 10 (settings), 11 (signing in), 12 (roadmap), 13 (sales reports),
14 (operations reports), 16 (weekly labor plan), 19 (Instagram), 20 (HR hub),
23 (building forms), 28–31 and 33–38 (all ten remaining inventory articles),
39 (menu items), 44 (My Instagram).

Verified rather than assumed — `/checklists` and `/reports` came back with store
names only under a deliberately broad sweep, and the `displayName` re-sweep
above cleared inventory explicitly.

**17 + 4 + 23 = 44.** Every article is in exactly one bucket.

---

## D — insertion points

### D.1 — where a pinned Help item goes in the sidebar

`src/components/layout/sidebar.tsx`, 527 lines. Bottom-of-file structure:

```
<nav>            ← visibleStructure.map(...)  — the accordion groups + top-level items
{canSeeSettings && <div className="px-2 py-2"> ... Settings ... </div>}
<div className="border-t ..."> ← user info + Sign out
```

**Help goes between the `</nav>` close and the Settings block** — outside the
accordion groups, above Settings, above the user block. It is the only position
that is pinned, always-visible, and not inside a collapsible group.

**How Settings is rendered — and it matters.** Settings is **hand-written JSX**
(`sidebar.tsx:474-491`), not a `NavItem` literal. It is gated by a separately
computed `canSeeSettings = can(actor, "settings.access")` at line 280, and it
carries its own bespoke active-state logic at 283-284 (`/settings` highlights
unless a more specific item like `/settings/labor` matches). This is exactly why
`verify-nav1-url-sets.ts` has to hard-code it:

```ts
// The Settings entry is hand-written JSX in both revisions, not a literal.
out.push({ href: "/settings", capability: "settings.access", ... })
```

So Help has two possible shapes:

- **Shape 1 — a `NavItem` literal** appended to `navStructure`. The parser sees
  it, the fixture governs it, and it inherits the standard capability filter.
  Consequence: **the fixture goes red** (§ E).
- **Shape 2 — hand-written JSX** like Settings. The parser's `LINE` regex never
  matches it, so the fixture is **blind to it** and stays green.

**Recommendation: shape 1, the literal — and take the red run.** Shape 2 is
tempting precisely because it dodges § E, and that is the reason to refuse it. A
help entry that the URL-set fixture cannot see is a help entry that can silently
lose a role later with nothing reporting it. The fixture exists to make nav
changes visible; routing around it to avoid a red run is the failure mode its
own header warns about one paragraph above `BASELINE_REV`.

Item shape, if shape 1:

```ts
{ href: "/help", label: "Help", icon: <LucideIcon>, capability: "help.view" }
```

`capability` is required by the `NavItem` type and by the parser (`if (!cap)
continue` — an item without one is silently skipped). A new `help.view`
capability granted to ALL is the honest expression of "everyone gets help";
reusing `dashboard.view` would work today and would be a lie the moment
`dashboard.view` is denied to anyone.

### D.2 — the 60px collapsed rail

The rail collapses to `w-[60px]` (line 349). Every item follows the same
pattern: `justify-center px-2`, icon only, label suppressed via
`{!collapsed && ...}`, and the text moved to a native `title` tooltip
(`title={collapsed ? label : undefined}`). Settings does exactly this at
477-489.

Help must therefore **carry its own icon** — the `icon` field is optional in
`NavItem` only because the inventory children fall back to their group's icon,
and a pinned top-level item has no group to fall back to. The file says so
directly: *"a 60px rail with no glyph is a blank."* `HelpCircle` from
`lucide-react` is the obvious choice and matches the contextual `?` in D.4.

### D.3 — the `(my)` portal

**`src/app/(my)/layout.tsx` has no navigation at all** — 16 lines, a background
div, `{children}`, and the ENG-1 `UsageBeacon`. It is presentation only and is
the wrong place to attach anything.

The portal's real chrome is **`src/app/(my)/my/my-shell.tsx`**, and it is a
clean single insertion point: all **8** `/my/*` pages import and wrap in
`MyShell`, with no exceptions. It renders a slim header (logo left, Clerk
`SignOutButton` right) and a **fixed bottom tab bar** driven by a `NAV` array of
4 entries — Home, Messages, Instagram (conditional on connection), Documents.

**Recommendation: Help goes in the header, not the tab bar.** The bar is
`flex-1` across its items and already flexes between 3 and 4 tabs depending on
Instagram; a fifth tab makes each one ~20% narrower on the smallest phone this
portal is explicitly built for ("mobile-first, ≥44px targets"). A `?` icon
button in the header beside Sign out costs no tab width, matches where the `?`
lives in the admin shell under D.4, and is one edit in one file.

Note this is a **second** insertion point, not a shared one — the admin sidebar
and `MyShell` have no common ancestor. Two edits, by design.

### D.4 — do page headers share a component?

**No. They are hand-rolled per page, 78 times.**

- `src/components/layout/` contains exactly three files: `app-shell.tsx`,
  `sidebar.tsx`, `use-sidebar-collapsed.ts`. There is no `PageHeader`.
- `<h1>` appears **78** times across `(app)`, in **10** distinct className
  shapes. The dominant one accounts for 52 of them
  (`text-2xl font-bold text-[var(--color-foreground)]`), so there is a
  convention — just not a component.

**But the contextual `?` is still one edit, if it mounts in the right place.**
`src/components/layout/app-shell.tsx` is a single 15-line wrapper that every
`(app)` page renders inside:

```tsx
<main className={...}>
  <div className="max-w-6xl mx-auto px-8 py-8">{children}</div>
</main>
```

A `?` affordance mounted here, keyed off `usePathname()` against the article
list, reaches all 36 `(app)` articles in **one edit** and needs no page touched.
The trade is placement: it floats at a fixed position in the content area rather
than sitting inline beside each `<h1>`.

**Recommendation: mount in `AppShell`.** One edit, no risk of the 42-page sweep
missing pages, and no forced adoption of a new `PageHeader` component across 78
call sites — which would be a refactor phase of its own wearing HELP-1's badge.
If inline-beside-the-heading is non-negotiable aesthetically, that is a
`PageHeader` extraction phase to schedule *before* HELP-1, not inside it.

---

## E — the NAV-1 fixture will go red

### E.1 — how the `/settings/labor` exception is expressed today

**It is not an allowlist. There is no exception mechanism in the file at all.**

The sanctioned drop is expressed as a **scenario** — the fourth of four
`compare()` calls:

```ts
compare("labor.access DENIED per-user (the sanctioned drop)", ["labor.access"], env)
```

`compare()` runs the *same* denial against *both* revisions. `/settings/labor`
disappears from the before set and the after set together, so the two sets stay
identical and the run stays green. The exception works because the condition is
applied symmetrically to both sides — not because the URL is exempted.

**This is why Help cannot reuse the shape.** A gained URL is asymmetric by
construction: the baseline revision `10439b3` has no Help item under any `env`,
any `denied` list, any scenario. No symmetric condition can make it appear on
the before side. `compare()` has no vocabulary for "this URL is new and that is
correct."

### E.2 — proposed wording and mechanism

Add a **sanctioned-additions set**, subtracted from `gained` only, in the same
spirit as the existing scenario comments — narrow, named, and documented at the
site so the next person sees why it exists:

```ts
// NAV-1 SANCTIONED ADDITIONS. The URL-set comparison is otherwise absolute:
// a gained URL is a defect. HELP-1 adds a pinned Help entry to every role's
// nav, which is a GAIN FOR ALL FOUR ROLES by design and cannot be expressed
// as a scenario — the baseline revision has no Help item under any env, so
// no symmetric condition makes it appear on the before side (the mechanism
// /settings/labor uses does not reach this case).
//
// THIS LIST IS NOT A PLACE TO PUT A URL THAT WENT MISSING. It only suppresses
// GAINED, never LOST — a lost URL still fails, which is the regression this
// fixture exists to catch. Adding an entry here is a ruling, not a fix: it
// asserts that a human decided this destination should appear for these roles.
// One line per URL, with the phase that sanctioned it.
const SANCTIONED_ADDITIONS: Record<string, string> = {
  "/help": "HELP-1 — pinned help entry, all roles, docs/DECISIONS.md <date>",
}
```

and in `compare()`:

```ts
const gained = a.filter((u) => !b.includes(u) && !(u in SANCTIONED_ADDITIONS))
```

Three properties worth being deliberate about:

1. **It suppresses `gained` only.** `lost` is untouched, so the regression the
   fixture was built for still fails loudly. The asymmetry is the safety.
2. **It does not touch `BASELINE_REV`.** Confirmed not edited by this session;
   the value at HEAD is `10439b3` and stays there.
3. **The value is a reason string, not a boolean.** A bare `Set` would let
   someone add a URL with no argument attached. Requiring prose makes an
   unjustified entry visibly unjustified.

### E.3 — literal vs. hand-written JSX, revisited

Per D.1: if Help is hand-written JSX like Settings, the parser's `LINE` regex
never matches it and the fixture never sees it — the run stays green with no
exception needed.

**That is not acceptable, and § E.2 should be built instead.** The reasons:

- The fixture's stated purpose is that a destination cannot quietly stop being
  reachable for some role. A Help entry invisible to it gets exactly the
  silence the fixture exists to prevent — and Help is pinned for *every* role,
  so it is the entry with the widest blast radius if it regresses.
- Settings is hand-written for a reason that does not apply to Help: its
  bespoke active-state precedence over `/settings/labor` (line 283). Help has no
  sub-routes and needs no such logic.
- The parser's own guard (`before.length < 20 || after.length < 20`) exists
  because *"a parser that silently matches nothing would report two empty sets
  as identical — the failure mode that makes a green run worthless."* Choosing
  a shape the parser cannot see is a small, deliberate instance of that same
  failure mode.

**Make Help a parseable literal specifically so the fixture governs it**, and
pay for that with the four-line `SANCTIONED_ADDITIONS` entry.

---

## F — the per-request search index

### F.1 — can `can()` / `overridesFrom` be called from a route handler?

**Yes, unambiguously.** `src/lib/permissions.ts` is 883 lines with **zero
imports** — no Prisma, no Clerk, no `next/*`, no `server-only`. It reads no
database and stores nothing (its own header says so). It is callable from a
route handler, a server component, or a client component alike; `sidebar.tsx`
already imports it into a `"use client"` file and 25 API route files sit on the
same layer.

**The per-request override load path (PERM-5B), named:**

`getCurrentUser()` in **`src/lib/auth.ts:116`** is the single load point. The
comment there is explicit — *"THE LOAD POINT. can() is synchronous and overrides
live in the database, so the set is resolved ONCE here — on the row this
function already fetched, costing no extra query — and threaded to every call
site as `actor`."*

The chain is:

```
getCurrentUser()                       src/lib/auth.ts:116
  └─ actorFor(dbUser)                  src/lib/auth.ts:121-138
       ├─ overridesFrom(dbUser.deniedCapabilities)   → PERM-5 denials
       └─ grantsFrom(dbUser.grantedCapabilities)     → PERM-8 grants
  → returns { userId, org, dbUser, actor }
```

A help-search route handler calls `getCurrentUser()`, takes `actor`, and calls
`can(actor, cap)` per article. **25 API route files already do exactly this**,
so there is no new plumbing.

**One thing the prompt did not account for: there is now a PERM-8 *grant* layer
as well as the PERM-5 denial layer.** `actorFor` populates both `overrides` and
`grants`. The index must be built from `can(actor, …)` — which consults both —
and never from `role` plus a denial list, which would miss a granted capability
and hide an article from someone entitled to it. Passing `actor` through
wholesale is the only correct move.

### F.2 — is a per-user `labor.access` denial expressible?

**Yes.** `labor.access` is a member of `ENFORCED_CAPABILITIES` in
`src/lib/permissions.ts` (26 entries), which is the *deniable* set —
`PATCH /api/users/[id]` enforces that list, so only capabilities on it can be
denied per user.

This settles the architectural question the prompt raised. A static index with
four role variants cannot represent it: two MANAGERs in the same org, same role,
same modules, differ in whether `/settings/labor` (and its article) exists for
them. **The index must be per-request.** There are 26 such capabilities, so the
static variant count is not 4 — it is 4 × 2²⁶ in the worst case, which is the
formal way of saying "not enumerable."

### F.3 — payload shape and size

Shape — **titles, summaries and keywords only, no bodies:**

```ts
type HelpIndexRow = {
  route: string        // "/inventory/purchase-orders"
  title: string
  summary: string      // ~160 chars, the search snippet
  keywords: string[]
  module: string | null
  preview: boolean     // true ⇒ upgrade preview under ruling 2
}
```

Measured, not estimated — 44 rows with realistic prose entropy:

| | bytes | |
|---|---|---|
| raw JSON | 16,707 | 16.3 KB |
| gzipped | 5,676 | **5.5 KB** |
| per article | ~380 raw | |

**5.5 KB on the wire for the full ADMIN index.** Smaller for every other role.
That is a rounding error against any page in this app.

Bodies are fetched per article through the same `can()` check on a second
request. This is not only a size decision — it is the confidentiality boundary.
A summary is written to be safe in a search result; a body is not.

### F.4 — where the filtering lives

**One place: a single `visibleArticles(actor, org)` function, and every consumer
calls it.** The NAV-1 precedent is `visible()` in the verifier and the per-item
filter in `sidebar.tsx` — permission filtering is per item, never per group, and
computed in one pass.

Three consumers must share it or the confidentiality claim is false:

1. the search index route handler,
2. the article body route handler (fetching a body must re-check, not trust that
   the client only asks for what it was shown),
3. the article list / sidebar Help landing page.

The failure this prevents is the one PERM-5C called out by name: a hidden entry
over an API that still answers. If the body route does not re-run the same
check, a STORE login can `GET` a compensation article by guessing its route and
ruling 3 is decorative.

`visibleArticles()` should take `actor` and return rows already carrying the
`preview` flag from ruling 2 — so "can they see it" and "do they see it as a
preview" are answered together, in the one place, and cannot drift apart.

---

## G — the generator

### G.1 — the P-3 pattern, as built

`scripts/generate-roadmap.mjs`, 243 lines:

| Element | Detail |
|---|---|
| **hooks** | `"predev": "node scripts/generate-roadmap.mjs"` and `"prebuild": "..."` in `package.json` — every Vercel build and every local `npm run dev` regenerates |
| **output** | `src/generated/roadmap.ts`, **gitignored** at `.gitignore:47` with a comment naming the generator |
| **input** | `docs/ROADMAP.yaml` — outside the import graph, which is reason 1 in the header for doing this at build time (no `outputFileTracingIncludes` needed) |
| **dependency** | `yaml` `^2.9.0`, already a prod dependency |
| **fallback chain** | `gitCommitDate()` → `meta.updated` → `"unknown"`; each step logs which source won, and the two fallbacks are labelled `(FALLBACK — …)` in the Vercel build log. *"a silent fallback is auditable there too"* |
| **hard failure** | exactly one: `throw new Error('expected a top-level "phases" list')` — malformed input fails the build; missing *optional* data degrades with a loud label |
| **warn-not-fail precedent** | the unflagged-closure check at 213-243 `console.warn`s and never exits non-zero |

Reason 2 in the header is worth carrying forward: *"There is no .git directory
in a lambda"*. Anything HELP-1 wants from git (a doc's last-updated date, say)
is obtainable only at build time too.

### G.2 — proposed frontmatter for `docs/guide/*.md`

`docs/guide/` does not exist yet.

**The task ruling changes this schema in one structural way: `route` becomes
`routes`, a list.** An article claims a set of routes, and that list is what
the § G.3 gate unions and diffs. A singular `route:` cannot express the mapping
and would make the gate uncheckable.

```yaml
---
id: inv-po                          # required — stable slug, the article's identity
title: Purchase orders — creating, sending, receiving
entry: /inventory/purchase-orders   # required — where the ? and search results link
routes:                             # required — EVERY route this article claims
  - /inventory/purchase-orders
  - /inventory/purchase-orders/[id]
  - /inventory/purchase-orders/new
  - /inventory/orders/new
summary: >                          # required — the search snippet, ~160 chars
  Create a purchase order against a vendor, send it, then receive it line
  by line so expected stock stays accurate.
roles: [ADMIN, MANAGER, STORE]      # required — informational; can() is the truth
capability: inventory.po.view       # required, or `null` — the ENTRY point's gate
module: inventory                   # required, or `null`
order: 30                           # required — sort within its section
keywords: [po, vendor, receiving]   # optional — search synonyms
sections:                           # optional — only for mixed-gate articles
  - heading: Creating a purchase order
    capability: inventory.po.manage # hidden from readers without it (§ B.3)
images:                             # optional
  - src: purchase-orders-01.png
    alt: A draft purchase order with three line items
---
```

Four schema rulings I would build in rather than leave to convention:

- **`routes` is the gate's input and `entry` is the UI's.** They are different
  questions — "what does this article cover" and "where does the button go" —
  and collapsing them is what forces one-to-one mapping back in. `entry` must
  be a member of `routes`; fail the parse if it is not.
- **`capability` is the ENTRY point's gate, not the union.** Sub-routes may be
  stricter (§ B.3's four mixed-gate articles); that is what `sections` is for.
  Deriving the article's capability from the strictest claimed route would hide
  the Ingredients article from every STORE login over two admin sub-pages.
- **`capability` and `module` are required, with an explicit `null`** rather
  than omittable. An absent key and a deliberate "this page is unrestricted"
  look identical otherwise, and the difference is exactly ruling 3's blast
  radius. Fail the parse on a missing key; accept `null` as an answer.
- **`roles` is informational and `capability` is load-bearing.** The generator
  should *verify* `roles` against `can()` for each role at build time and warn
  on disagreement, never let `roles` drive filtering. Two sources of truth for
  who sees what is how ruling 3 gets quietly broken.

### G.3 — the coverage gate

**Recommend: warn, not fail. Permanently — not as a temporary concession.**

The repo already made this exact call once, in the same file, and wrote down
why: *"a classifier that is wrong fails toward UNDERSTATING, which is worse than
the bug it fixes, while a warning that is wrong only asks a human to look"*, and
*"A NOISY CHECK WOULD BE WORSE THAN NONE."*

Applied here:

- A coverage gate that **fails** makes every future route-adding phase into a
  route-adding-plus-article-writing phase. The next person adding
  `/inventory/orders/new` gets a red build for not having written help content,
  and the pressure is to write a stub article that says nothing — which
  satisfies the gate and defeats it.
- A **warn** that names the uncovered routes by path in the build log is
  actionable, survives the zero-article day, and cannot be gamed by a stub.

**How it is introduced without blocking its own phase** — the warn form needs no
special handling at all. On day one it prints all 65 claimable routes as
unclaimed, which is accurate and is the phase's own to-do list rendered by the
build. It shrinks as articles land. There is no threshold to tune, no
`--allow-empty` escape hatch to remember to remove, and no moment where the gate
has to be disabled and then re-enabled — which is the moment such gates usually
die.

Mirror the existing warning's format so the build log stays consistent:

```
[guide] WARNING — 12 of 65 claimable routes are not claimed by any article,
[guide]   so a reader on those pages gets no help:
[guide]   /inventory/counts/[id]        (nearest article: inv-counts)
[guide]   /templates/new                (nearest article: templates)
[guide]   …
[guide]   3 routes are exempt by ruling and not counted: /print/…, /
```

**The gate checks claiming, not one-to-one coverage** — that is what your
ruling requires. Each article's frontmatter carries a `routes:` list; the
generator unions them and diffs against the filesystem route list. Concretely
it needs four checks, and only the last is fatal:

| Check | Severity | Why |
|---|---|---|
| a route is claimed by **no** article | **warn** | the reader gets no help there — the day-one state, and the phase's to-do list |
| a route is claimed by **two** articles | **warn** | ambiguous `?` target; usually a copy-paste, occasionally deliberate |
| an exempt route is claimed anyway | **warn** | the ruling and the frontmatter disagree; a human should say which is right |
| an article claims a route that **does not exist** | **FAIL** | typo or deleted page; produces a help article pointing at a 404 |

Only the last hard-fails, mirroring the roadmap generator's single `throw`. A
phantom route is unambiguous and cannot be a work-in-progress state; the other
three all describe legitimate mid-phase conditions.

The exempt list lives in the generator, not in frontmatter — an article cannot
exempt a route by declining to mention it, or the gate would be satisfied by
forgetting.

---

## H — the upgrade preview

### H.1 — how module gating is read today

`requireModule` (`src/lib/auth.ts:21-26`) is blunt:

```ts
export async function requireModule(module: "inventory" | "nutrition" | "hr" | "labor") {
  const org = await getOrganization()
  if (!org.activeModules.includes(module)) {
    throw new Error(`MODULE_NOT_ACTIVE:${module}`)
  }
}
```

It **throws**; it renders nothing. It is used on API routes and on
`/staff/[id]`'s HR section. `activeModules` is read directly in **90** places
across `src`.

**Does the upgrade-prompt card from `INITIAL_BUILD_PROMPT.md` § 6c actually
exist in code? Yes — and that is the more useful half of the answer.**

It exists in **14 pages**, as **copy-pasted inline JSX with no shared
component**:

`/hr`, `/items`, and twelve `/inventory/*` pages
(`adjustments`, `alerts`, `counts`, `expected`, `ingredients`, `orders/new`,
`purchase-orders`, `recipes`, `reports`, `sales-items`, `storage-areas`,
`vendors`).

The canonical shape, from `inventory/vendors/page.tsx:15-34`:

```tsx
if (!org.activeModules.includes("inventory")) {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center max-w-md">
        <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-[var(--color-primary)]/10 …">
          <Truck className="h-6 w-6 text-[var(--color-primary)]" />
        </div>
        <h1 className="text-xl font-bold …">Inventory Management</h1>
        <p className="text-sm …">Track vendors, purchase orders, and receiving —
          upgrade to the Inventory add-on to unlock this page.</p>
        <Link href="/settings" …>Upgrade Plan</Link>
      </div>
    </div>
  )
}
```

Per-page variation is the icon, the `<h1>`, and one sentence of copy. Structure
and classNames are identical across all 14.

### H.2 — the article-level preview state

Ruling 2 says a module-gated article is visible to an org without the module,
framed as a preview with a path to plans. Reusing the existing card is right —
**but "the card" is not currently a thing that can be reused.** It is 14 copies.

Two options, and this is a genuine fork:

- **H2-a — extract `<ModuleUpgradeCard module icon title blurb />` first, adopt
  it in the 14 pages, then use it in Help.** One definition; the help preview
  and the page a reader lands on are visibly the same object, which is what
  makes the preview honest. Cost: touching 14 files in what is meant to be a
  help phase, and 14 files that HELP-1 has no other reason to touch.
- **H2-b — make a 15th copy inside the help surface.** Zero risk to existing
  pages, ships faster, and adds one more copy of a block already duplicated
  fourteen times.

**Recommendation: H2-a, but as a separate commit inside HELP-1, landed before
the help work.** A pure extraction with no behaviour change is reviewable on its
own, and 14 identical blocks is already past the point where a 15th should be
added without comment. If that feels like scope creep, H2-b is defensible — but
then the duplication should be recorded as debt in the same commit rather than
left silent.

For the article body itself, the preview state needs one thing the page card
does not have: **the article's own prose stays readable.** Ruling 2's value is
that a prospective buyer can read what Inventory *does*. A preview that renders
only the upgrade card teaches nothing and is just a paywall. Suggested shape:
the article renders in full, with the upgrade card **pinned above it** and any
in-article deep links to the gated routes rendered inert.

---

## I — search library

**Neither MiniSearch nor FlexSearch is a dependency.** Checked the full
dependency list; there is no search library of any kind (no `fuse`, `lunr`,
`orama` either).

**Recommendation: add neither. `cmdk` is already in `package.json`.**

`cmdk` `^1.1.1` is present and ships `dist/command-score.js` — a 1.4 KB fuzzy
scorer — alongside the command-palette UI. It gives filtering and the palette in
one piece.

Two caveats, both worth stating plainly:

- **`cmdk` is currently an unused dependency.** Nothing in `src` imports it —
  no `components/ui/command.tsx`, no `from "cmdk"`. So it costs nothing in the
  bundle today, and adopting it *does* add real bytes (installed footprint
  116 KB; the shipped runtime is a fraction of that, but it is not free). The
  honest framing is "already approved and vendored", not "already paid for".
- **Even `cmdk` is more than the data needs.** Per § F.3 the full ADMIN index is
  **44 rows / 5.5 KB gzipped**. A `String.prototype.includes()` filter over
  title + summary + keywords is O(44) per keystroke and will feel instant.
  MiniSearch and FlexSearch are built for thousands-to-millions of documents;
  at 44 they are pure overhead — the index-building cost exceeds the search cost.

So: **no search library.** Use `cmdk` if you want the palette *UI* (⌘K, keyboard
nav, a11y roles) and are willing to adopt the dependency properly; use a plain
substring filter if you want the smallest possible surface. Either way the
ranking problem does not exist at this scale, and if the article count ever
passes ~500 this decision is worth revisiting — it will not, since it is bounded
by the route count.

---

## J — image storage

### The recommendation

**Vercel Blob, private, served through an authenticated route** — for the
PII-bearing and Conditional articles from § C. `public/guide/` is acceptable
**only** for articles in the Structurally clean bucket, and only if you want
the split.

**Simplest defensible answer: put all guide images in Blob and have no split at
all.** The split saves nothing operationally and creates a classification
decision per image, which is a decision that will eventually be made wrong at
speed.

### Why this follows from § A

§ A's answer is **excluded (as configured), deployed behaviour unverified**.
Both branches lead here:

- **If excluded** (the configured reading, and the likely one): `public/guide/`
  is world-readable at guessable URLs. `/guide/staff-01.png` is a trivial guess.
  For the 9 PII-bearing and 6 Conditional articles that is disqualifying on its
  own.
- **If it turns out matched**: `public/guide/` would require a session — but
  **git history is still permanent**. A missed redaction committed once is in
  the repo forever, recoverable by anyone who can clone it, and no auth setting
  reaches backwards into history. That is the second, independent reason, and it
  is the one that does not depend on § A at all.

Which is why **the phase is not blocked on the curl**: the recommendation does
not change either way. Run it to close the question, not to unblock the build.

`@vercel/blob` `^2.5.0` is already a dependency and is already used for
staff-document uploads, so the authenticated-download precedent exists in this
repo: **PL-20**, `staff/[id]/documents/[docId]/download` — manage-tier, or the
staff member themself when `teamVisible`. A guide-image route is the same shape
with a simpler check: `getCurrentUser()` → `actor` → `can()` against the owning
article's capability → stream from Blob. It reuses § F.4's
`visibleArticles(actor, org)` so an image cannot be reachable by someone who
cannot reach its article.

The cost is honest and should be said: Blob images are not statically
optimisable the way `public/` assets are, so they will be slower and will not
benefit from `next/image`'s build-time work. For screenshots in a help article
that is an acceptable trade.

### The capture workflow

Designed so a missed redaction is caught **before** it can enter history — the
`.gitignore` doing the work rather than a human remembering.

1. **Capture to an ignored directory.** Add `/docs/guide/_raw/` to `.gitignore`
   in the same commit that creates the directory. Unredacted production
   screenshots land here and **cannot be committed by accident** — not by
   `git add -A`, not by a wildcard. This is the single most important step; it
   is the only one that is structural rather than procedural.
2. **Redact into a sibling.** Redacted output goes to `docs/guide/_review/`,
   also gitignored. Redaction is by hand per ruling 1.
3. **Normalise the extension.** Lowercase every `.PNG` to `.png` at this step.
   Per § A this changes the auth posture of the file, and macOS screenshot
   tooling produces both. Two files that differ only in case must not end up on
   two sides of the middleware boundary.
4. **Review pass against the § C bucket.** For each image, name the article and
   its bucket. PII-bearing and Conditional images get a second look with the
   specific condition from § C in hand — *"the forecasting audit log shows an
   email when the name is null"* is a thing a reviewer must be told, because it
   is not visible as a risk when you are looking at a chart.
5. **Upload to Blob from `_review/`.** The image reaches the app without ever
   being a tracked file. `docs/guide/*.md` references it by its Blob key in the
   `images:` frontmatter.
6. **Nothing in `docs/guide/` is a binary.** Only `.md` files are tracked there.
   That is checkable in one line, and worth adding to the generator as a warning
   so it stays true.

Steps 1 and 6 together mean **a redaction failure is a live-site bug you can
fix, not a history rewrite.** That is the whole point of the workflow, and it is
the property `public/guide/` cannot have at any level of care.

---

## Decision forks — left open on purpose

| # | Fork | My lean |
|---|---|---|
| 1 | Which routes are exempt from coverage. You ruled print gets none; I also exempted `/` (marketing landing). Sign-in/sign-up I gave an article. | confirm or overrule the two I decided |
| 2 | `/my/*` articles: visible to all roles with a staff link, or STAFF-only in help | all roles — matches PG-33 |
| 3 | Help sidebar entry: parseable literal (fixture governs, run goes red) vs hand-written JSX (fixture blind) | **literal** (§ E.3) |
| 4 | Contextual `?`: mount once in `AppShell` vs extract a `PageHeader` and edit 78 sites | **`AppShell`** (§ D.4) |
| 5 | Upgrade card: extract the shared component first vs make a 15th copy | **extract**, separate commit (§ H.2) |
| 6 | Search: adopt `cmdk` for the palette UI vs plain substring filter | either; no search library (§ I) |
| 7 | Mixed-gate articles (4): gate on entry point and write around gaps, hide sections per capability, or split | **hide sections per capability** (§ B.3) |
| 8 | Blob for all guide images vs split clean-to-`public/` | **all Blob** (§ J) |

---

## Out-of-scope findings

Triaged per the ceremony. **No rows filed** — a row is the last resort and
nothing here earns one.

**COMMENT (not a row):**

1. **`PERMISSIONS_INVENTORY.md` has drifted from the page surface.** Four
   reachable routes have zero mentions: `/internal/roadmap`, `/labor/inspector`,
   `/staff/engagement`, `/reports/operations`. Three post-date the survey, so
   this is expected drift, but the doc can no longer be used as a complete
   index — which is how this audit was tempted to use it in § B.2.
2. **The upgrade card is duplicated 14 times** with identical structure. Noted
   in § H.1; the extraction is § H.2's recommendation and belongs to HELP-1 if
   H2-a is chosen, or to nobody in particular if H2-b is.
3. **`cmdk` is an unused dependency.** In `package.json`, imported nowhere. If
   § I lands on the plain-filter option it should probably be removed rather
   than left as a decoy.
4. **`/inventory/orders/new` has no parent `/inventory/orders` page.** The only
   route in the tree with no ancestor. Possibly an unlinked leftover; worth a
   look independent of HELP-1.
5. **One `<h1>` uses `text-gray-900` instead of the CSS variable**, so it will
   not follow the theme. Cosmetic, found incidentally while counting headers in
   § D.4.

**RULING NOW:** none — the four rulings below are the phase's rulings and are
already drafted.

**FIX NOW:** none. This session writes no application code.

---

# DECISIONS.md candidates — ⚠️ DRAFTS FOR GARY TO REWRITE ⚠️

> **These are drafts in Claude's words, not Gary's.** They are written in the
> house format so the shape is right, and they are **not official until Gary
> rewrites them in his own words in `docs/DECISIONS.md`.** Nothing in the repo
> should cite these as ratified. Per the log's own convention, the wording is
> drafted here and confirmed by Gary at commit.

---

## 2026-09-04 — HELP-1: help screenshots come from production, redacted by hand

HELP-1 (2026-09-04): Help article screenshots are captured from **production**
and redacted by hand. They are not generated from a seeded staging org.
(1) Production is the only environment whose screens show what a customer
actually sees — a seeded org produces screenshots that teach the seed data
rather than the product, and its emptiness is itself misleading. (2) Redaction
is manual per image; there is no automated redaction step and none should be
introduced, because a redactor that is wrong fails silently and invisibly.
(3) Raw captures never enter git history: they land in a gitignored directory,
are redacted into a second gitignored directory, and reach the app by upload —
so a missed redaction is a live-site bug that can be fixed, not a permanent
history entry that cannot.

**Ruling 3 is structural and is the reason the other two are safe.** Manual
redaction will eventually miss something; that is a property of manual work, not
a reason to avoid it. What makes the miss survivable is that no unredacted file
is ever a tracked file. `docs/guide/` holds `.md` only — checkable in one line,
and the generator should warn when it stops being true.

---

## 2026-09-04 — HELP-1: module-gated articles render as upgrade previews

HELP-1 (2026-09-04): An article for a module the org has not bought is
**visible**, framed as an upgrade preview with a path to plans. Inventory
articles are readable by an org without Inventory. (1) The module is not a
filter on the help surface — module-gated articles appear in search and in the
article list for every org. (2) The preview renders the article's prose **in
full**, with the upgrade card above it; a preview that shows only a paywall
teaches nothing and defeats the purpose of showing it at all. (3) Links from a
preview article into the gated routes render inert rather than navigating to a
page the reader cannot use.

**This ruling is about sales, not permissions, and the distinction is the whole
point.** Module gating answers "has this org paid for it"; capability gating
answers "is this person allowed to know it". They point in opposite directions
here — the first opens the help surface up and the second closes it down — and
they must stay separate mechanisms, exactly as nav visibility and API access are
kept separate in `permissions.ts`.

---

## 2026-09-04 — HELP-1: capability-gated articles stay hidden

HELP-1 (2026-09-04): An article describing a page a login cannot reach is
**hidden from that login entirely** — absent from search, absent from the
article list, and not fetchable by route. A STORE or STAFF login does not find
compensation articles by searching. (1) There is no locked state, no greyed
entry and no "ask your administrator" placeholder; a visible lock advertises
what COMP-1 exists to keep confidential, which is the same reasoning already
ruled for the `/settings/labor` nav entry under NAV-1. (2) Visibility is decided
by `can(actor, …)` — the same call the page itself makes — so a per-user
override or grant moves the page and its article together. (3) The article
**body** re-runs the check on fetch; the index filtering the list is not
sufficient, because an index the client holds can be read past.

**This ruling is why the search index is per-request and cannot be a build
artifact.** `labor.access` is one of 26 capabilities that can be denied per
user, so two managers in the same org with the same role and the same modules
can have different visible article sets. A static index has no way to represent
that, and a client-side index containing every article is readable in devtools
no matter what the UI filters — the filtering would be decoration.

---

## 2026-09-04 — HELP-1: search covers everything the reader can see

HELP-1 (2026-09-04): Help search covers the **whole org-purchasable surface**,
minus what the reader's capabilities exclude. (1) Module-gated articles are in
scope and searchable regardless of what the org has bought, per the upgrade
preview ruling. (2) Capability-hidden articles are out of scope and unsearchable
for that reader, per the hidden-articles ruling. (3) Search matches titles,
summaries and keywords only — bodies are fetched per article through the same
check, so what is searchable and what is readable can never disagree.
(4) Filtering happens in exactly one place, shared by the index, the article
list and the body fetch; there is no second implementation of who-sees-what.

**Ruling 4 is the operative one.** Two places that decide visibility will
eventually disagree, and the direction of the disagreement is a
confidentiality failure rather than a cosmetic bug — the precedent is NAV-1's
single `isVisible()` pass and PERM-5C's rule that a hidden page must never sit
over an API that still answers.

---

*End of audit. No application code, schema, sidebar or `(my)` layout was
touched. `BASELINE_REV` in `scripts/verify-nav1-url-sets.ts` was not edited.*
