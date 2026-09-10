> Renamed from STAGING_DEPLOY_LOG.md 2026-07-22 — logs both staging and prod deploys.

Deploy verification: 2026-07-02T22:00:05Z

## UNPROMOTED — 2026-09-09 — Take Photo: the button now opens a camera

**Work SHA:** `ce1cf9d` on `staging`, not pushed at the time of writing.
**Unpromoted — staging only.** The heading is stamped with the merge SHA at
promotion, from `git rev-parse`, never hand-typed.

**Payload:** **2 commits** on `staging` — the work and this docs commit. One
client component and **one new route**, `POST /api/upload/checklist-photo`.
**No schema change, no migration, no cron, no Square call, no Clerk change, no
new page route.** Writes to the **public** Blob store via the SDK default
`BLOB_READ_WRITE_TOKEN` — the same store `task-attachment` and
`message-attachment` already use. The private `froot-hr` and `froot-guide`
stores are not touched.

**What it does.** On `/store-view/checklist/[id]`, the Take Photo button on a
photo-required task now opens the phone's rear camera, downscales the shot to
JPEG on the device, uploads it, and writes it to `TaskLog.photoUrl` when the
task is ticked. It previously had no click handler at all and did nothing —
since `1cfdf76`, the first commit. Separately, a failed task tap now shows the
staff member why instead of leaving a tick with nothing behind it.

**New capability to watch on first deploy:** this is the first write to
`checklist-photos/` in the public Blob store. Nothing reads that prefix yet
except the thumbnail on this page.

**Rollback is code-only and needs no database step.** Reverting the work commit
restores the dead button. `TaskLog.photoUrl` rows written in the meantime stay
valid and simply stop being displayed; blobs already stored are orphaned but
harmless.

**Still open after this deploy:** `requiresPhoto` does not gate completion — a
photo task can still be closed with no photo. That is a ruling, filed on CHK-7,
not a regression from this deploy.

## UNPROMOTED — 2026-09-07 — Unassign training: the refusal is shown, not hidden

**Work SHA:** `75ff274` on `staging`, not pushed at the time of writing.
**Unpromoted — staging only.** The heading is stamped with the merge SHA at
promotion, from `git rev-parse`, never hand-typed.

**Payload:** **2 commits** on `staging` — the work and this docs commit. One
client component, and nothing else. **No route change, no schema change, no
migration, no cron, no Square call, no Clerk change, no new capability, no new
page route.**

**What it does.** On the `/staff/[id]` Training tab, the Remove control on a
training assignment is now always offered. An untouched assignment gets the
existing confirm and is deleted. One with progress against it gets a plain
sentence naming the reason — certified, lessons already marked complete, or the
quiz attempted — and a Close, with no destructive action in the footer.
Previously the control was rendered only when there was no progress, so a
started assignment showed no control and no explanation.

**The route was already correct and was not touched.** `DELETE
/api/hr/training/assignments/[id]` has enforced this since HR-7: any lesson
progress, any quiz attempt, a certification, or a certificate PDF returns 409
and the assignment is never deleted. This deploy changes what the manager is
told, not what the server allows.

**Rollback is code-only and needs no database step.** Reverting the work commit
restores the hidden-control behaviour; no data is written or migrated either
way, and the route's refusal is unaffected in both directions.

**Single assignment only. No bulk unassign** — not built, not scaffolded, not
half-wired.

**NOT VERIFIED IN A BROWSER.** Gate evidence only — scoped eslint clean (3
warnings, 0 errors, all three pre-existing) and `npm run build` green. Nothing
here has been deployed, and the refusal sentence reported at close was read off
the source, not seen on screen.

## UNPROMOTED — 2026-09-07 — Bulk assign: recipient rows carry position and store

**Work SHA:** `3978c02` on `staging`, not pushed at the time of writing.
**Unpromoted — staging only.** The heading is stamped with the merge SHA at
promotion, from `git rev-parse`, never hand-typed.

**Payload:** **2 commits** on `staging` — the work and this docs commit. One API
route, one client component. **No schema change, no migration, no cron, no
Square call, no Clerk change, no new capability, no new page route, and nothing
writes a row.**

**What it does.** Each person in the Individuals list of the Bulk assign
training dialog on `/hr/training` renders as `Name · Position · Store` instead
of name alone. A missing segment is omitted — no placeholder, no blank, no
em-dash — and the name is the only segment always present. Position is
`SquareTeamMemberWage.jobTitle`. Store is the one primary store via
`primaryStoreName()`, or the literal `Corporate` for `isCorporate` staff, who
never reach the resolver: Square expands them to every location, so their
assignment rows carry no home base (DEBT-9). Both are resolved server-side in
the route; the dialog renders what it is told.

**The wage-table select is exactly the join key and the title** — never a
spread, never `include`. That table is where pay lives (`hourlyRate`,
`annualRate`, `payType`, `compConfidential`) and it was split off `StaffMember`
so a wage column could not ride along on a route that spreads its row. No
`labor.costs.view` gate was added, because a job title is not pay — and the
narrow select is what makes that true rather than merely intended. **If a later
change widens it, the gate question reopens.**

**Rollback is code-only and needs no database step.** Two additive reads and a
row label. `RECIPIENT_SELECT` is unchanged, so the bulk write path and its
five-bucket response are untouched; reverting the work commit removes the two
segments and nothing else.

**NOT VERIFIED IN A BROWSER.** Gate evidence only — scoped eslint clean, `npm
run build` green. Nothing here has been deployed, and the row shapes reported
for this session were read off the render, not observed on staging.

## c870ba7 — 2026-09-06 — SEARCH-1: a global search bar in the sidebar

**Merge SHA:** `c870ba78947b8c42b6370379b5b98b2826f85df9`
**Promoted 2026-09-06.** Written the same day in the unpromoted state and
stamped here at promotion, never hand-typed. THE SHA IS THE `--no-ff` MERGE
COMMIT — parents `bf5a66f` and `6176de7` — and the rollback recipe reads the
merge, not the tip of `main`.
**STAMPED POST-MERGE ON `main`, WHICH IS THE POINT.** The promotion itself
skipped this step and the entry sat claiming "UNPROMOTED — staging only" while
the feature was live in production. Writing the stamp here, on `main`, after
the merge, is the half of DEBT-90's fix this promotion confirmed: the append
happens on one side only and so never enters the conflict region. Stamping on
`staging` and merging forward would re-create the competing top-of-file appends
that row exists to eliminate.

**Payload:** **5 commits** on `staging`, none pushed at the time of writing —
ba3d1e5 the feature, then two correction rounds: f964602 + 6430753, and 5b8cf5b
+ this docs commit. The earlier SHAs were not rewritten to produce a tidier
count. **No migration.** No schema change, no cron, no Square call, no Clerk change, no
new capability, no new page route. One API route, one client component, one lib
file, one new evidence script.

**What it does.** A search input pinned at the top of the `(app)` sidebar, above
Dashboard. Typing at least two characters shows a grouped dropdown; Enter or a
click navigates. ADMIN, MANAGER and STORE only — the `(my)` portal gets nothing.
On the 60px rail it collapses to a magnifier that opens the same panel.

**It shipped with two groups, not the three the prompt specified, and that is a
ruling.** The "Go to" group would have searched sidebar nav destinations. The nav
array lives inside a `"use client"` module and `isVisible()` is a closure over
component props, so neither is reachable from a route handler; lifting the array
into `src/lib` breaks the parser in `verify-nav1-url-sets.ts`, which is a done
criterion of this same phase. Gary dropped the group rather than accept either a
broken criterion or a third copy of the nav filter. Filed as **DEBT-91**.

**Rollback is code-only.** No migration, no data written, nothing to undo in any
database. Reverting the two commits removes the input and the route.

**The blast radius is one new URL.** `GET /api/search` is additive; nothing
existing calls it. `sidebar.tsx` gained an input and **no nav item**, so no
role's set of reachable URLs moved — asserted, not assumed, by
`verify-nav1-url-sets.ts` still reading `before=26 after=27`.

**Evidence.** `verify-search-scope.ts` green with the per-role table printed;
`verify-help-access.ts` green across the `GATED` table extraction;
`verify-help-routes.ts` green with `/api/search` asserted on all three of its
return paths, cache headers included; `verify-nav1-url-sets.ts` green and
untouched; `npm run build` green.

**What to look at on staging.** Sign in as Karson (ADMIN), Tommy Thomas (MANAGER)
and the STORE login. Search a term that hits both groups — "training" or
"cleaning" — and confirm the groups read **Training** then **Help**, that a
training result opens `/hr/training/<id>/preview` rather than 404ing, and that a
lesson-level match names the lesson under the module title. Then search a term
from a gated help section — "audience" or "detected" — and confirm MANAGER and
STORE get no `hr-documents` row from it. Collapse the sidebar and confirm the
magnifier opens the same panel and that rows are thumb-sized on an iPad.

---

## c870ba7 — 2026-09-06 — HR-33: a training lesson can carry one external destination

**Merge SHA:** `c870ba78947b8c42b6370379b5b98b2826f85df9`
**Promoted 2026-09-06.** Written 2026-09-05 in the unpromoted state and stamped
here at promotion, never hand-typed. The entry sat unpromoted for a day, which
the ritual treats as a valid state. THE SAME MERGE CARRIED SEARCH-1 — one
`--no-ff` merge, two entries, both stamped with this SHA.

**Payload:** **2 commits** on `staging`, neither pushed at the time of writing.
**One migration**, `20260906022810_hr33_lesson_external_link`: two nullable TEXT
columns, no index, no FK, no backfill, no drop. No cron, no Square call, no Clerk
change, no new capability, no new API route, no new page.

**What it does.** A training lesson can point at one external destination with
its own label — "Set up your Square account" → `squareup.com`, "Download the
Homebase app" → an app store. The driving case: Day 1 needs to send a new hire to
squareup.com, and the only field that took a URL was **Video URL**, so the
trainee was shown a **Watch video** button aimed at Square's homepage. It worked
and it told them the wrong thing.

**Rollback needs no database step, and the columns may stay.** Reverting the code
removes every surface; the columns go back to being unread. They are nullable
with no default, carry no index and no constraint, and nothing joins on them, so
leaving the migration applied is safe and is the cheaper path.

**This is not the HR-32 shape, and the difference is the design.** HR-32 links a
DOCUMENT — a thing with instructions, an audience, and a place in the Document
Library. This links a DESTINATION, which is none of those. So there is **no role
gate, no availability prop, no payload suppression and no query change** anywhere
in this row, and a destination is never routed through the Document Library to
become linkable. If you are looking for the suppression rule that HR-32's entry
spends four paragraphs on: there isn't one, on purpose. A gate with nothing
behind it is worse than no gate, because the next reader assumes it protects
something.

**The URL is validated and `videoUrl` still is not.** Both builder write paths
call `validateLessonExternalLinks` (`api/hr/training/access.ts`), which reuses
`isValidExternalDocumentUrl` from `lib/hr-documents.ts` rather than writing a
second URL check: **https only**, and **our own private blob host refused** so a
signed blob URL cannot be laundered into a link that reaches bytes without
passing the download route's audience check. Gary, 2026-09-05, adopted at
approval and **not** a ruling: "one rule for admin-supplied URLs in this feature,
not two." `videoUrl`'s own missing validation is a standing COMMENT ruled at
DOC-3 and was deliberately left alone.

**Evidence.** Migration verified on dev `br-broad-wave-a6vpjdw0` (host
`ep-late-water-a6k53nv2`, db `neondb`): 2 new columns, 3 lessons, 0 with a link.
The validator was probed **18/18 in both directions, positives included** — a
validator that refuses everything passes every negative test, so squareup.com, an
app-store deep path, a port+query URL and every absent form were checked as
ACCEPTED, alongside `javascript:`, `data:`, http, a bare hostname, our blob host
and garbage as REFUSED. A real lesson row was written through the shaping helper,
read back trimmed, and restored to NULL.

**What to look at on staging.** Edit a module, open a lesson, fill **External
link** with `https://squareup.com` and leave the label blank — the trainee view
should show a button reading `squareup.com` beside Watch video. Set the label and
it should read the label instead. Paste `http://squareup.com` and saving should
400 with "Enter a full https:// link for the lesson's external link".

**Known and deliberate:** the CSV round trip drops these columns (`csv.ts`
declares a fixed four-field lesson shape), so a JSON export re-imported comes back
with no external link. The JSON export itself carries them — they are plain
scalars and needed no code.

## f3f9d31 — 2026-09-05 — HR-32: a training lesson can point at one library document

**Merge SHA:** `f3f9d31eaf0dae45f9a8fd99aa78de58eb0ffa5e`
**Promoted 2026-09-05.** Written the same day in the unpromoted state and stamped
here at promotion, never hand-typed. THE SHA IS THE `--no-ff` MERGE COMMIT, not
the tip of `main`: `bc13251` sits on top of it as a single-parent hand edit
sharing the same commit message, and the rollback recipe reads the merge. That
hand edit is itself the subject of DEBT-90 — it damaged two sentences in this
file on `main` while removing a duplicate heading.

**Payload:** **5 commits** on `staging`, none of them pushed at the time of
writing. **One migration**, `20260905203838_hr32_lesson_linked_document`:
additive only — one nullable column, one index, one FK. No backfill, no drop, no
rewrite; every existing row is valid with NULL. No cron, no Square call, no
Clerk change, no new capability, no new API route.

**What it does.** A lesson in the training builder can point at one document
from the Document Library, and only a `kind: "Link"` — the I-9 on uscis.gov, a
state labor poster. The trainee opens it from the lesson. The driving case: an
employee filling out an I-9 on Day 1, where the form was already in the library
but the lesson had no way to point at it.

**Rollback needs no database step, and the column may stay.** Reverting the code
removes every surface; the column goes back to being unread. It is nullable with
no default and nothing else joins on it, so leaving the migration applied is
safe and is the cheaper path. If it is dropped instead, drop the FK constraint
and the index with it.

**The visibility rule, stated plainly.** A STORE login browsing the training
library does not see the block, and the suppression is in the QUERY — that
page's include does not join the document at all, so the title and the URL are
never in the payload. MANAGER and ADMIN see it. A trainee working their own
assigned module at `/my/training` sees it whatever their login's role is; that
was Gary's ruling on 2026-09-05 and it is the case the row exists for. Nothing
about document library membership, compliance denominators, or acknowledgments
changed — see `docs/DECISIONS.md`, 2026-09-05.

### Verified

- `npm run build` green before each of the five commits.
- Scoped `npx eslint` on every touched file: 0 errors. The warnings that remain
  are pre-existing and were checked against HEAD, not assumed.
- **Validator, fired against Neon branch `dev` / `br-broad-wave-a6vpjdw0`:**
  active Link same org → pass; Acknowledgment → 400; inactive Link → 400; Link
  under a different org id → 400; nonexistent id → 400; mixed payload → 400.
  The positive is what proves the check is not simply refusing everything.
- **Payload suppression, same branch:** with the STORE branch taken, the joined
  key is ABSENT from the lesson row entirely. With it not taken, the document is
  present and maps through. A deactivated document joins but maps to null.
- Probe documents were created for those runs and deleted after; Link rows
  remaining on `dev`: 0.

### Not verified — read this before trusting the list above

- **Nothing has run on the staging database.** The migration applies in the
  Vercel build, which has not happened, so the column does not exist there yet.
- **The route-level 400 has never been fired over HTTP.** It is proven at the
  function the routes call, not through `PATCH /api/hr/training/[id]` with a
  session. Route-level, signed in, is the check that counts — a signed-out probe
  404s at the proxy and answers the right thing for the wrong reason.
- **No browser has rendered the block.** Not the trainee's view, not the admin
  preview, and not the STORE case.
- **The STORE check, when taken, must be a POSITIVE under the role:** the same
  login seeing the lesson and its video while not seeing the linked-document
  block. A blank page cannot tell "correctly suppressed" from "this login sees
  nothing here at all".

## f863259 — 2026-09-05 — HELP-1a: the in-app help machine

**Merge SHA:** `f863259baa8bc2a3eb1bc775ffaceb0470eea1dd`
**Promoted 2026-09-05.** Written on 2026-09-04 in the unpromoted state and
stamped here from `git rev-parse` at promotion, never hand-typed. The entry sat
unpromoted for a day, which the ritual treats as a valid state.

**This promotion carried HELP-1b as well**, whose own entry exists ONLY on
`main` — it has never been on `staging`. That gap, and the fact that the
sentence you are reading was deleted on `main` by the `bc13251` hand edit
(leaving this paragraph starting mid-phrase there), are both DEBT-90.
**Both halves are now closed on `main`.** The deleted sentence is back — the
`staging` repair reached `main` in the `c870ba7` promotion — and the heading
above, which read UNPROMOTED while this body carried a real SHA, was stamped
`f863259` on 2026-09-06 in the same commit that stamped SEARCH-1 and HR-33.
The HELP-1b entry existing only on `main` is untouched and stays with DEBT-90.

**⚠ THE PROMOTION BLOCKER THIS ENTRY OPENED WITH IS CLEARED (2026-09-05).**
It read: do not promote, because `froot-guide` held no image and the document
library references one inside its gated section, so an ADMIN on production would
have seen a broken image — the route returning 404 by design, indistinguishable
from a legitimate refusal and therefore reporting nothing. The store is now
provisioned and the redacted capture is uploaded
(`hr-documents/document-detail-01.png`, 126 KB). Evidence item 4 passes 8 of 8.
**Marked rather than deleted**, per the in-place correction convention this log
uses: the blocker was real, it was the reason to hold, and a reader
reconstructing why this sat unpromoted needs to find it rather than a gap.

**The gated-section article changed after this entry was first written.**
Ingredients was replaced by the document library on 2026-09-04 — the inventory
module is on hold with no data in any environment, so that article documented a
feature nobody runs. The replacement gates its section on ADMIN rather than
MANAGE, so the section is hidden from three roles instead of one.

**Payload:** **5 commits** on `staging`. Two are already deployed to staging
(the machinery and its roadmap recorder, pushed 2026-09-04); three are not yet
pushed at the time of writing. **No schema change, no migration, no cron, no
Square call, no writes to any existing table.**

**Rollback is clean and needs no database step.** Nothing here writes a row and
nothing alters an existing one, so reverting the code removes the surface
entirely. The one thing to know: a new capability `help.view` is added, granted
to ALL. Reverting removes it along with the nav entry that reads it, and no
existing capability's role tier moved.

### What it does

Adds an in-app help surface: a pinned Help entry in both shells, an article
list, article pages, a per-request search index, and an authenticated image
route. Content is authored as `docs/guide/*.md` and compiled to a gitignored
module by a `prebuild`/`predev` generator, following the roadmap generator.

**Three articles ship, of a mapped 44.** That is deliberate — one per branch of
the machinery, so every path is exercised by real content rather than compiled
and assumed. The build log prints the remaining 59 routes on every build; that
list is HELP-1b's scope and it shrinks as articles land.

**What a reader sees is decided in exactly one place**, `src/lib/help-access.ts`,
which the search index, the section filter and the image route all defer to.
Three implementations of "what may this reader see" eventually disagree, and
every direction of disagreement leaks rather than merely looking wrong.

### The permissions change, stated plainly

**One new capability, `help.view`, granted to ALL.** The help surface itself is
for everyone; the articles inside it are what the confidentiality ruling gates,
one at a time, on the capability of the page each describes. No existing role
baseline moved.

It exists as a real capability rather than being ungated because
`scripts/verify-nav1-url-sets.ts` skips any nav item without one — an item with
no capability is invisible to the fixture, and a Help entry the fixture cannot
see could silently lose a role later with nothing reporting it. The nav item is
therefore a parseable literal and the fixture reports it as a gain for all four
roles, sanctioned explicitly in `SANCTIONED_ADDITIONS`. `BASELINE_REV` was not
edited.

### Verified

- Per-role article sets, section absence, search-index absence and image scope
  all asserted in `scripts/verify-help-access.ts` — green, both directions on
  every check.
- `scripts/verify-nav1-url-sets.ts` green.
- `npm run build` green.
- **On staging, SHA-matched first:** an ADMIN login rendered three articles and
  a STORE login rendered one. Recorded as a confirmation rather than formal
  evidence — no org id was captured, and the Browser Evidence precondition
  requires one.

### Not verified — read this before trusting the list above

- ~~The image route has never served bytes.~~ **CLOSED 2026-09-05** — the store
  round-trip asserts byte-identical delivery, and the stored blob URL is
  confirmed not fetchable without credentials.
- **Section-level rendering has never been seen in a browser.** It is asserted
  green route-level in both directions, but nobody has opened the Ingredients
  article as a STORE login to watch the contents list renumber.
- Nothing here proves browser rendering generally, and the assertions exercise
  the policy functions the routes call rather than HTTP responses over the wire.

## 849e410 — 2026-08-29 — PERM-8: the Square staff import becomes grantable to specific managers

**Merge SHA:** `849e41016d3a902500d1ca1227c153b10632fc9a`
**Written before the merge existed**, per the ritual — the heading's two tokens
and the Merge SHA line's one are stamped from `git rev-parse` and `date`, never
hand-typed. One occurrence each, on those two lines and nowhere else in this
entry; this entry never spells one out in prose, because a token written into a
sentence is a token the stamp substitutes into that sentence. An entry still
carrying them is written and unpromoted, which is a valid state.

**READ THIS FIRST IF YOU ARE ROLLING BACK.** This promotion carries a
PERMISSIONS change and an ADDITIVE MIGRATION. The migration is one `ADD COLUMN`
on `User` and reverting the code leaves it unread and harmless — do NOT drop it
(WORKFLOW.md § Rolling a promotion back). The permissions change is the part to
understand: it introduces the product's first mechanism for granting a user
MORE than their role allows.

**Payload:** **2 commits** on `staging` ahead of `main` — the work commit
`4e2d7e0` and its roadmap recorder — plus the promotion merge itself (staging →
main, `--no-ff`). **Prior main tip is `2a0e67a`.**

### What it does

`staff.sync.square` gated two routes that had to move in opposite directions:
the import READ, which Gary wanted grantable to a named manager, and the bulk
re-sync, which TERMINATES staff members and overwrites store assignments
org-wide and had to stay admin-only. One capability cannot be granted and
not-granted for the same person, so it split.

- **NEW `staff.import.square`** (ADMIN_ONLY) — the import read, the Import
  button, and the grid label "Import team members from Square". It is the sole
  entry in `GRANTABLE_CAPABILITIES`, grantable to **MANAGER only**.
- **`staff.sync.square`** keeps the bulk re-sync, stays ADMIN_ONLY, is **not
  grantable**, and is relabelled "Re-sync staff from Square".

**No role's baseline moved.** Both capabilities are ADMIN_ONLY, so nobody gains
anything from the deploy itself — only from an admin subsequently issuing a
grant in Edit User.

### The grant model, and the invariant it amends

`User.grantedCapabilities` (new column) plus an elevation branch in `can()`.
Precedence: **denied wins, otherwise baseline OR grant.** The denial check was
moved ABOVE the baseline test so that ordering is structural rather than
remembered.

PERM-1's rule — *"nothing here or in later phases may grant a user something
their role does not already allow today"* — stood absolute from 2026-07-25 until
this promotion. It is now narrowed, not deleted: elevation is possible ONLY for
a capability named in `GRANTABLE_CAPABILITIES` and ONLY for a role that list
names against it. **Appending to that list is a security change with the weight
of a baseline change.** The old comment in `permissions.ts` promising no such
code path was replaced rather than edited — it had become a security claim that
was false.

Pre-existing call sites are unaffected: a `{ role }` caller carries no grants
and cannot reach the elevation branch's true case.

### Enforcement, and what to test if this looks wrong in production

Enforcement is at the ROUTES, not the buttons:

| Route | Capability | A granted MANAGER |
|---|---|---|
| `GET /api/square/team-members` | `staff.import.square` | **200** |
| `POST /api/staff` | `staff.manage` | 201, own stores only |
| `POST /api/staff/sync-square` | `staff.sync.square` | **403** |

`PATCH /api/users/[id]` validates grants with the same `isGrantable()` that
`can()` consults, returning 400 on unregistered, not-grantable, or wrong-role —
so a hand-rolled request cannot write a grant the grid will not offer.

### Diff (code)

| file | + | − |
|---|---|---|
| `src/lib/permissions.ts` | 185 | — |
| `scripts/verify-perm8-grants.ts` | 117 | 0 |
| `src/app/(app)/users/user-actions.tsx` | 100 | — |
| `src/app/api/users/[id]/route.ts` | 61 | — |
| `src/app/(app)/staff/page.tsx` | 47 | — |
| `src/app/api/square/team-members/route.ts` | 32 | — |
| `src/lib/auth.ts` | 19 | — |
| `prisma/schema.prisma` | 18 | 0 |
| `src/app/api/staff/sync-square/route.ts` | 12 | 0 |
| `src/app/(app)/users/page.tsx` | 2 | 0 |
| `prisma/migrations/…_perm8_user_granted_capabilities/migration.sql` | 2 | 0 |

15 files, 966 insertions, 63 deletions including docs. **Schema: yes — one
additive `ADD COLUMN`. No env var, no cron.**

### Precondition checked before the work was built

The split would have WIDENED access for anyone already carrying
`staff.sync.square` as a denial: they would keep the sync denial but regain the
import read. **Zero such users exist on any branch.** Gary captured Neon console
evidence 2026-08-29 for `br-square-feather` (preview/staging) and
`br-sparkling-block` (production), branch identity visible in the same capture
as the result; dev (`br-broad-wave-a6vpjdw0`) measured 0 of 7 User rows.

### Verification status at the time of writing

`npm run build` green in the commit gate chain. `scripts/verify-perm8-grants.ts`
— 20 pure assertions, all green. COMP-1's `scripts/verify-comp-confidential.ts`
re-run green and untouched. **NO STAGING PASS HAD BEEN RUN WHEN THIS WAS
WRITTEN** — the five-part protocol against a MANAGER account is in the session
report and was unrun. Nothing here claims a deployed observation.

**ADDENDUM, 2026-08-29 (CLOSEOUT-2), stamping this entry.** The paragraph above
is a dated claim and stands: no staging pass existed when it was written. One
was run before the promotion, and **the results live in the PERM-8 row of
`docs/ROADMAP.yaml`** rather than being restated here. In short: the deployed
SHA was confirmed as `c3f08e6` before testing; a MANAGER account was refused at
the route with the grant off (403) and admitted with it on (200); and the bulk
re-sync route refused that same granted manager (403), which is the split this
promotion exists to create. **One protocol item was NOT run** — the hand-rolled
`PATCH` 400 — and is recorded as skipped-with-cover, not as passed. The row
carries the detail and the caveats.

## 2a0e67a — 2026-08-28 — COMP-1: compensation confidentiality, plus the HR-29 training reorder

**Merge SHA:** `2a0e67a11893b370b975ec5656f3f6a4faece58e`
**WRITTEN RETROSPECTIVELY, 2026-08-29, BY CLOSEOUT-2 — and that is the defect
this entry records as much as it is the entry.** Every other promotion entry in
this log was written between the merge and the push, per WORKFLOW.md §2. This
one was not: the session that promoted COMP-1 did not write it, the closeout
that would have (`docs/prompts/COMP-1_closeout.md`) ran before the promotion
existed and correctly stopped, and nobody resumed it. So the log had no record
of this promotion for a full day, and the ROADMAP row read `status: staging`
while the code was live in production. **The heading SHA and date here were
derived from git and verified, not remembered** — see the verification note
below, which exists because a retrospective entry cannot lean on the ritual that
normally guarantees them.

**Verification of the SHA, since this entry was not written by the promotion
itself.** `2a0e67a` is a two-parent merge; it is an ancestor of `origin/main`;
its second parent is `3f917e5`, COMP-1's own recorder commit. That it is the
merge which FIRST carried COMP-1 to main was proved separately, because any
later merge containing the work would satisfy an ancestry test equally well:
`a1c4e14` is an ancestor of `2a0e67a` and is NOT an ancestor of the preceding
merge `607926b`.

**READ THIS FIRST IF YOU ARE ROLLING BACK.** This promotion carries **TWO
ADDITIVE MIGRATIONS, BOTH WITH BACKFILLS**. Reverting the code leaves both
columns unread and harmless — **do NOT drop either** (WORKFLOW.md § Rolling a
promotion back). The backfills matter more than the columns:
`20260828120000_comp1_comp_confidential` SEEDS `compConfidential = true` for
salaried people and for admins, and `20260824210000_hr29_training_module_order_index`
seeds `orderIndex` from each org's existing `createdAt` order. A revert-then-
re-promote would re-run neither (both are already recorded in the ledger), and
both are idempotent by construction anyway — the COMP-1 backfill only ever sets
true, and the HR-29 one recomputes the same ROW_NUMBER from an immutable column.

**THE PROMOTION CARRIED MORE THAN COMP-1**, which the merge's own generic
message (`Merge branch 'staging'`) does not say. Seven non-merge commits:

| commit | what |
|---|---|
| `a1c4e14` | **COMP-1** — compensation confidentiality + `labor.access` |
| `3f917e5` | COMP-1's roadmap recorder |
| `f70ae90` · `a5799d3` · `47dbb00` | **HR-29** — TrainingModule `orderIndex`, endpoint, drag-to-reorder |
| `2438fef` · `bd99d98` | HR-29 roadmap records |
| `04a4bf4` | the previous promotion's own DEPLOY_LOG entry |

**Prior main tip was `607926b`.** 33 files, 3675 insertions, 90 deletions.

### What COMP-1 does

A per-person, admin-set confidentiality flag on compensation, plus the
capability that closes PERM-5C's Labor deferral.

- **`SquareTeamMemberWage.compConfidential`** — true means that person's pay is
  visible to ADMIN only. It lives on the WAGE row rather than on `StaffMember`
  deliberately: `getStoreRoster` reads the wage table as its row source, so a
  Square member Froot never imported still carries a wage and still needs a
  flag.
- **Redaction is server-side and by ABSENCE, not by hiding** — the number never
  reaches the payload, the props or the flight response. The flag itself IS
  sent, so the UI can draw the lock.
- **`labor.access`** — a new capability, MANAGE tier, gating the `/settings/labor`
  page and every labor settings route behind `requireLaborContext()`. It answers
  PERM-5C ruling 5 with a new capability rather than by promoting `labor.manage`,
  so that held-out list stays true.

**Why it existed:** on the first manager rollout, a MANAGER on `/settings/labor`
could see every person's compensation on the Positions roster — Administrator
and Manager salaries included. "See pay rates and tips" is all-or-nothing across
PEOPLE: a manager needs it ON to run their store, and ON exposed everyone. The
missing granularity was on the person, not the viewer.

Six rulings, Gary, 2026-08-28, verbatim in `docs/DECISIONS.md`. Audit:
`docs/prompts/COMP-1_AUDIT.md`.

### What HR-29 does

`TrainingModule.orderIndex` — a GLOBAL per-org ordering (never per-category,
Gary's ruling 2026-08-24) with drag-to-reorder on `/hr/training`. The backfill
seeds from today's `createdAt asc`, so the deploy changed no visible order
anywhere until somebody dragged.

### Diff (code), the COMP-1 half

| file | ± |
|---|---|
| `src/app/(app)/settings/labor/labor-settings-client.tsx` | 215 |
| `src/app/api/labor/salaried/route.ts` | 129 |
| `src/lib/labor-roster.ts` | 85 |
| `src/lib/labor-salaried.ts` | 81 |
| `src/lib/permissions.ts` | 72 |
| `src/lib/comp-confidential.ts` | 65 (new) |
| `src/app/(app)/staff/page.tsx` | 41 |
| `src/app/api/square/labor/roster/[id]/route.ts` | 28 |
| `src/lib/labor-access.ts` | 24 (new) |
| `src/lib/labor-roster-hours.ts` | 21 |
| `src/lib/labor-costs.ts` | 16 |
| `src/app/(app)/staff/[id]/page.tsx` | 14 |

**Schema: yes — one additive `ADD COLUMN` + backfill. No env var, no cron.**

### Verification status — stated honestly, because this entry is retrospective

**COMP-1'S ACCEPTANCE RESULTS WERE ASSERTED BUT NEVER CAPTURED, and this entry
will not launder the one into the other.** `docs/prompts/COMP-1_closeout.md` —
the prompt for the closeout that never ran — states in its Context section that
COMP-1 was *"staging-tested (all eight acceptance steps passed), promoted to
production, and spot-checked on production against real data."* No session ever
wrote those results down: not in the ROADMAP row, not in this log, not in an
artifact. So what exists is an assertion in an instruction file, not evidence.
DEBT-37's rule — an observation living only in a transcript does not exist —
applies equally to one living only in a prompt's preamble.

The ROADMAP row is therefore closed at `shipped`, **not `verified`**. If the
spot check did happen as the prompt says, `verified` is right and Gary can say
so; this entry records the gap rather than resolving it in either direction.
A retrospective entry is precisely where someone would be tempted to promote an
assertion into a finding.

What IS known: the code is in production (SHA verification above), and
`migrate deploy` ran in the Vercel build as part of this promotion, which is how
both columns reached the production database.

**The COMP-1 fixture `scripts/verify-comp-confidential.ts` was re-run green on
2026-08-29** during the PERM-8 build, against the same code that is in
production. That is a code-level regression net, not a production observation,
and the distinction is the point.

## 607926b — 2026-08-24 — DOC-3: a library document can be a link, and any document can carry instructions

**Merge SHA:** `607926bb5f9d0201b9f60c706eddb03ca4588abc`
**Written before the merge existed.** The heading's SHA and date and the Merge
SHA line above are stamped by the promotion ritual from `git rev-parse` and
`date`, never hand-typed. Three placeholder tokens, all of them on the heading
and the Merge SHA line above and nowhere else in this entry — this entry
deliberately never spells one out in prose, because a token written into a
sentence is a token the stamp substitutes into that sentence. An entry still
carrying them is written and unpromoted, which is a valid state rather than a
mistake.

**THIS ENTRY REPLACES A SUPERSEDED ONE FURTHER DOWN THIS FILE**, written at
`751a24c` and marked rather than deleted. That entry described this same
promotion and two of its claims were false — see § The defect below. It is left
in place because what a session believed at the time is the part worth keeping.

**Payload:** 8 commits on `staging` ahead of `main` at the time of writing —
`648e6da`, `aa4fc1b`, `234834f`, `1b7600b`, `dc99289`, `4f87e22`, `751a24c`,
`4708779` — plus the commit carrying this entry (staging → main, `--no-ff`).
`648e6da` is the re-level merge that followed the BUG-14 promotion and carries
no work of its own; `aa4fc1b`…`dc99289` are DOC-3 Phases 1–4; `4f87e22` and
`751a24c` are bookkeeping; **`4708779` is the fix described below and is the
reason this entry exists at all.**
**Prior main tip:** `25ba98f`
**Diff (code):** 12 files, 877 insertions, 53 deletions — including `prisma/`.
`documents-client.tsx` +289, `document-instructions.tsx` +157 (new),
`api/hr/documents/route.ts` +119, `(my)/my/documents/page.tsx` +83,
`lib/hr-documents.ts` +81, `api/hr/documents/[id]/route.ts` +62,
`(app)/hr/documents/page.tsx` +19, `hr/documents/[id]/page.tsx` +15,
**`lib/hr-documents-access.ts` +16 — the fix**, `api/hr/documents/access.ts` +10.
Docs: 5 files, 869 insertions.

**THIS PROMOTION CARRIES A SCHEMA MIGRATION.**
`prisma/migrations/20260824193000_doc3_document_links_and_instructions/` adds
three nullable TEXT columns to `HrDocument` — `externalUrl`,
`instructionsHtml`, `instructionsVideoUrl` — then a hand-written CHECK,
`hrdoc_link_shape`, below a marked line in the same file. Production applies it
through `prisma migrate deploy` in the Vercel build, on its own Neon branch.
**No env var, no cron.** Additive only, no backfill.

**It cannot fail on existing data.** `hrdoc_link_shape` asserts
`kind = 'Link'` ⇔ `externalUrl IS NOT NULL`. Every pre-DOC-3 row is
Acknowledgment, FillableForm or Reference with a NULL `externalUrl`, so both
sides read FALSE and FALSE = FALSE is TRUE. The expression is total — `kind` is
NOT NULL and `IS NOT NULL` never yields NULL — so there is no third value for
the CHECK to pass silently.

### What shipped

DOC-3's two capabilities, and the row moves to `verified` in this promotion.

- **A library document can be a link instead of a file.** `kind: "Link"`, a
  nullable `externalUrl`, and **zero** `HrDocumentVersion` rows. Audience uses
  the existing store and person grants, so a Colorado store gets the Colorado
  link and a Nevada roster does not. **This bullet was in the superseded entry
  and was FALSE when written** — it is true as of `4708779` and was measured, not
  assumed.
- **Any document can carry instructions**: `instructionsHtml`, sanitized
  server-side through HR-28's `sanitizeRichText` before write, and
  `instructionsVideoUrl`, rendered through `canonicalYouTubeUrl` as an embed or
  else a plain link. Applies to every kind.
- **`instructionsVideoUrl` and `externalUrl` share one exported validator** —
  https, parses, not our own blob host. One function, two callers.
- **A Link can never reach the signing ceremony** and this needed no new code:
  all five signing surfaces already carry `kind: "Acknowledgment"` in their
  `where`, and `requiresAcknowledgment` derives from kind.
- **`/hr/documents/[id]` gained a kind guard** — that page had no `kind` filter,
  so an ADMIN typing a Link's id reached the versions-and-checkpoints manager
  for a document that has neither. It did not crash; it rendered a coherent,
  empty, meaningless screen, which is worse.

### The defect this promotion nearly shipped, and why the first pass missed it

**`canReadHrDocument`'s `switch (doc.kind)` had no `"Link"` case**
(`src/lib/hr-documents-access.ts:136`). A Link fell to `default: return false`
**for every non-ADMIN**, so a STORE login granted the I-9 could not see it.
ADMIN returns true at `:133` without reaching the switch — which is why the
surface looked correct to the person configuring it and wrong to everyone it was
configured for. Found by Gary on staging at `4f87e22`, after four commits, a
written promotion entry, and a reported-complete verification pass.

**It was a SIXTH kind allow-list.** The audit listed four sites; the plan's own
table found a fifth and called the rest kind-agnostic. This one decides READ
ACCESS. The file was read during the audit — at `:129` and `:175-180` — for the
question of which logins can see a document, and never asked whether the kind
switch admits Link. Wrong question, right file.

**It failed silently by design.** `staffAudienceWhere` / `viewerAudienceWhere`
are deliberately kind-blind, so the database returned the row and the in-memory
re-filter at `(app)/hr/documents/page.tsx:61` dropped it. That re-filter's own
comment says it exists "so the fragment and the function cannot disagree in the
caller's favour" — it was built to catch the FRAGMENT being LOOSER. This was the
reverse. It fails closed, and `kind` is typed `string`, so no compiler check
exists either. The fix adds a comment at the switch saying exactly this.

**THE VERIFICATION PASS REPORTED IT WORKING, AND THAT IS THE PART TO LEARN
FROM.** The first §4h run recorded the store-login positive as passed. It was
taken from `indianathomas@live.com`, an **ADMIN** session — confirmed by Gary —
which short-circuits above the switch and renders the row correctly. The check
named a role it did not exercise.

**And every negative check passed for the wrong reason.** Measured against the
pre-fix predicate, a Link returned false for the granted store, the other store,
**and** corporate. So the corporate-negative that was run — and the other-store
negative the plan asked for and did not get — would BOTH have passed on the
broken code. **The only check in the whole of §4h capable of detecting this was
the store-login POSITIVE.** A negative cannot distinguish "correctly excluded"
from "excluded because nobody can see it", and a substituted negative was flagged
at the time as the risk when it never was.

### The staging pass — Gary, on the deployment at `4708779`

SHA precondition satisfied before any observation: local `HEAD`
`4708779eaf2384595b4eb4a153f6f3067fe38ecd`, `origin/staging` the same, and
`vercel inspect` on the staging alias resolving to
`froot-a3jextz4e-…` — the same deployment
`vercel ls --meta githubCommitSha=<full>` returns.

- **Store-login positive** — `corporate@keva.com` (STORE, Las Brisas) sees the
  I-9 Link with **Open** and **Instructions**, and no Sign, no Download, no
  audience chip, no versions gear. **The same login was blind on `4f87e22`**,
  which is what makes this a differential rather than an assertion.
- **Typed-URL probes, signed in as ADMIN** (`indianathomas@live.com`) —
  `/hr/documents/cmt7hwu8r000004ic7o3oofw6` → in-app 404 (the detail-page kind
  guard); `/api/hr/documents/cmt7hwu8r000004ic7o3oofw6/download` →
  `{"error":"Document not found"}` (the route's `:31`, no version row). **Signed
  in is load-bearing**: `src/proxy.ts` wraps non-public routes in
  `auth.protect()`, which 404s an unauthenticated request, so signed out both
  probes return the right answer for an unrelated reason.
- **§4f, both halves.** Server: a console POST with `kind:"Link"` and no
  `externalUrl` → **400**. Client: with `required` stripped from the URL input,
  an empty submit produced a **visible error and no row**. Both were needed —
  the client half alone cannot fail while `required` holds, and the server half
  alone says nothing about what the operator sees.
- **SQL on `br-square-feather`** — one Link row, `version_rows = 0`,
  `has_instructions` true. The zero-versions invariant holds in the database, not
  merely in the route that writes it.

### Rollback

```bash
git revert -m 1 <merge sha>
```

on `main`, then push. **The migration does not roll back with it**, and does not
need to: the three columns are nullable and unread by reverted code, and
`hrdoc_link_shape` constrains only rows with `kind = 'Link'`, which reverted code
can no longer create. Leave both in place — dropping the constraint by hand would
take the `0_init` re-append checklist out of sync with the database for no gain.

### `hrdoc_link_shape` is invisible to the schema and a baseline squash drops it

Same hazard class as `hrdoc_grant_shape`. `0_init` is regenerated FROM
`prisma/schema.prisma`, Prisma has no CHECK support, so a database rebuilt from
the baseline comes up with this **missing and nothing failing loudly**. Listed in
`docs/MIGRATIONS.md` § Protected indexes and in that file's `0_init` re-append
checklist, both added in `aa4fc1b` — the same commit as the constraint.

### The feature is inert in production until an admin creates a Link

No `HrDocument` row on production has `kind = 'Link'`; the kind did not exist
there until this promotion. Nothing changes for any existing document. **A quiet
production therefore proves the migration applied and nothing regressed — it does
NOT prove the Link path renders**, which was demonstrated on staging and cannot be
demonstrated on production until somebody creates one. Given what this row's
history already shows about checks that pass without exercising the thing they
name, that distinction is worth holding onto.

## SUPERSEDED — never promoted — DOC-3: a library document can be a link, and any document can carry instructions

> **⚠ SUPERSEDED 2026-08-24 — DO NOT PROMOTE THIS ENTRY AS WRITTEN.** A defect
> was found on staging at `4f87e22` after this entry was written: a STORE login
> granted the I-9 could not see it, because `canReadHrDocument`'s kind switch
> (`src/lib/hr-documents-access.ts:136`) had no `"Link"` case and fell to
> `default: return false` for every non-ADMIN. Marked, not deleted, per the
> in-place correction convention this log already uses — the body below records
> what was believed at the time, and that is the part worth keeping.
>
> **Two claims in the body are now false.** The "What shipped" bullet saying a
> Link's audience works "exactly as today — a Colorado store gets the Colorado
> link" was wrong: no non-ADMIN could read a Link at all. And the staging-pass
> section lists "the granted store's login seeing the document" as passed; on
> the code as deployed at `4f87e22` that outcome was not reachable. See the
> DOC-3 row for the analysis of how the pass was recorded.
>
> **The fix is one case in one switch**, committed with this marking. A rewritten
> entry — new payload, new diff, the corrected staging pass — is owed before any
> promotion, and is deliberately NOT written yet: the row is back to
> `in_progress` and the store-login check has to be re-run on a new deployment
> first. Nothing below this banner has been edited.

**Merge SHA:** none — this entry was never merged. See the DOC-3 entry at the top of this file.
**Written before the merge existed.** The heading's SHA and date and the Merge
SHA line above are stamped by the promotion ritual from `git rev-parse` and
`date`, never hand-typed. Three placeholder tokens, all of them on the heading
and the Merge SHA line above and nowhere else in this entry — this entry
deliberately never spells one out in prose, because a token written into a
sentence is a token the stamp substitutes into that sentence. An entry still
carrying them is written and unpromoted, which is a valid state rather than a
mistake.
**Payload:** 6 commits on `staging` ahead of `main` at the time of writing —
`648e6da`, `aa4fc1b`, `234834f`, `1b7600b`, `dc99289`, `4f87e22` — plus the
commit carrying this entry (staging → main, `--no-ff`). `648e6da` is the
re-level merge that followed the BUG-14 promotion and carries no work of its
own; the four `aa4fc1b`…`dc99289` are DOC-3 Phases 1–4; `4f87e22` records a
process deviation and corrects a wrong claim in the DOC-3 row.
**Prior main tip:** `25ba98f`
**Diff (code):** `src/app/(app)/hr/documents/documents-client.tsx` +289/−0 net
across the row, dialog and edit dialog, `src/components/hr/document-instructions.tsx`
+157/−0 (new), `src/app/api/hr/documents/route.ts` +119/−0 net,
`src/app/(my)/my/documents/page.tsx` +83, `src/lib/hr-documents.ts` +81,
`src/app/api/hr/documents/[id]/route.ts` +62,
`src/app/(app)/hr/documents/page.tsx` +19,
`src/app/(app)/hr/documents/[id]/page.tsx` +15,
`src/app/api/hr/documents/access.ts` +10 — 861 insertions, 53 deletions over 11
files including `prisma/`.

**THIS PROMOTION CARRIES A SCHEMA MIGRATION, AND THE PREVIOUS ONE DID NOT.**
`prisma/migrations/20260824193000_doc3_document_links_and_instructions/` adds
three nullable TEXT columns to `HrDocument` — `externalUrl`,
`instructionsHtml`, `instructionsVideoUrl` — and then a hand-written CHECK,
`hrdoc_link_shape`, below a marked line in the same file. Production applies it
through `prisma migrate deploy` in the Vercel build, on its own Neon branch,
exactly as staging did. **No env var, no cron.** Additive only: every column is
nullable, no column is dropped or retyped, and no backfill runs.

**THE MIGRATION CANNOT FAIL ON EXISTING DATA, and that is a property of the
constraint rather than a hope.** `hrdoc_link_shape` asserts
`kind = 'Link'` ⇔ `externalUrl IS NOT NULL`. Every pre-DOC-3 row is
Acknowledgment, FillableForm or Reference with a NULL `externalUrl`, so both
sides of the equality read FALSE, and FALSE = FALSE is TRUE. The expression is
also total — `kind` is NOT NULL and `IS NOT NULL` never yields NULL — so there
is no third value for the CHECK to pass silently.

### What shipped

DOC-3's two capabilities, link-first then instructions, and the row moves to
`verified` in this promotion.

- **A library document can be a link instead of a file.** `kind: "Link"` with a
  nullable `externalUrl` and **zero** `HrDocumentVersion` rows. The driving case
  is the I-9. Audience is unchanged — the existing store and person grants — so
  a Colorado store gets the Colorado link and a Nevada roster never sees it.
- **Any document can carry instructions**: `instructionsHtml`, sanitized
  server-side through HR-28's `sanitizeRichText` before it is written, and
  `instructionsVideoUrl`, rendered through `canonicalYouTubeUrl` as an embed or
  else as a plain link. Reference, Acknowledgment and Link alike.
- **The kind allow-lists were widened by hand in four places and for free in
  five.** Named in the DOC-3 row; the free ones ride `[...HR_DOCUMENT_KINDS]`,
  and the audience route was the one that mattered — without it a Link could be
  created and never granted to anybody.
- **`instructionsVideoUrl` and `externalUrl` share ONE exported validator**
  (Gary's amendment at plan approval): https, parses, and not our own private
  blob host. One function, two callers.
- **A Link can never reach the signing ceremony**, and this needed no new code:
  all five signing surfaces already carry `kind: "Acknowledgment"` in their
  `where`, and `requiresAcknowledgment` derives from kind.
- **`/hr/documents/[id]` gained a kind guard.** That page had no `kind` filter
  at all, so an ADMIN typing a Link's id reached the versions-and-checkpoints
  manager for a document that has neither. It did not crash — it rendered a
  coherent, empty, meaningless management screen, which is worse.

### The staging pass — Gary, on the deployment at `4f87e22`

Run against `froot-git-staging-…`, whose alias resolved to
`dpl_2L6kLqjLnR6TWkwdAsVutmZn9moE`, the same deployment
`vercel ls --meta githubCommitSha=<full>` returned for the local tip. The
migration is confirmed applied to the staging database from that deployment's
own build log: datasource `ep-odd-rain-a6gr4xmm` (no `-pooler`, so BUG-3's
routing held), `All migrations have been successfully applied`, no P1002.

Passed: the ADMIN row render; **Open** landing on uscis.gov; instructions and
the video embed rendering; the granted store's login seeing the document; a
corporate login not seeing it; both typed-URL 404 probes **signed in**; both
halves of the dialog-agreement check; and the SQL on `br-square-feather`
returning `version_rows = 0` for the Link row.

**THE TYPED-URL PROBES WERE RUN SIGNED IN, AND THAT IS THE LOAD-BEARING WORD.**
`src/proxy.ts` wraps every non-public route in `auth.protect()`, which **404s**
an unauthenticated request rather than redirecting or 401ing. Signed out,
`/hr/documents/<link-id>` and `/api/hr/documents/<link-id>/download` both return
404 for a reason that has nothing to do with DOC-3 — indistinguishable from the
404 the kind guard and the missing version row are supposed to produce. Run
signed out they are a green result from an instrument that cannot fail. The
DOC-3 row carries the same warning for whoever re-runs them.

### One §4h check was not the one §4h specified

The approved plan's §4h asked for the **other store's** login
(`tommy@keva.com`, STORE/MANAGER) to be confirmed blind to a document granted to
one store. What was run and reported is a **corporate** login not seeing it.
Both are real negatives and the corporate one exercises R3's exclusion, but they
are different assertions: corporate-negative does not demonstrate that a STORE
grant scopes BY STORE, which is the entire I-9 argument — Colorado sees it,
Nevada does not. The store-scoping predicate itself is unchanged by this row and
long-standing (DOC-1 A), and the granted store's login WAS confirmed positive,
so nothing here is suspected broken. It is recorded because the check that would
have closed the row's own driving case is the one that was substituted, and a
future reader counting "§4h passed" should know which negative was taken.

### The Phase 1 gate ran as a review, not as a gate

Phase 1's four evidence items were pasted for Gary AFTER `aa4fc1b` was
committed rather than before it. The checks all ran before the commit and it
passed its own build gate; what did not happen is the evidence reaching Gary
while the commit was still preventable. Not re-gated retroactively — the row
records that SHA and three phases sat on top of it. Marked on the DOC-3 row in
`4f87e22` rather than quietly closed, because a reviewer cannot decline a commit
that already exists.

### `hrdoc_link_shape` is invisible to the schema and a baseline squash will drop it

Same hazard class as `hrdoc_grant_shape`. `0_init` is regenerated FROM
`prisma/schema.prisma`, Prisma has no CHECK support, so a database rebuilt from
the baseline comes up with this constraint **missing and nothing failing
loudly**. It is listed in `docs/MIGRATIONS.md` § Protected indexes and in that
file's `0_init` re-append checklist, both added in `aa4fc1b` — the same commit
as the constraint, deliberately, because a CHECK absent from that table is worse
than no CHECK.

### The feature is inert in production until an admin creates a Link

**No `HrDocument` row anywhere has `kind = 'Link'` on production**, because the
kind did not exist there until this promotion. Nothing in the reader paths
changes for any existing document: a Reference still renders its file line and
its Download, an Acknowledgment still reaches the ceremony. **A clean production
surface after this promotion therefore proves the migration applied and nothing
regressed — it does NOT prove the Link path renders**, which was demonstrated on
staging and cannot be demonstrated on production until somebody creates one. Do
not read a quiet production as a pass for the half that has no data yet.

### Rollback

```bash
git revert -m 1 <merge sha>
```

on `main`, then push. **The migration does not
roll back with it**, and it does not need to: the three columns are nullable and
unread by reverted code, and `hrdoc_link_shape` constrains only rows with
`kind = 'Link'`, which reverted code can no longer create. Leave both in place;
dropping the constraint by hand would take the re-append checklist out of sync
with the database for no benefit.

## 6256d5f — 2026-08-23 — BUG-14: the engine's admission rule becomes shared, and a discarded row finally says so

**Merge SHA:** `6256d5fe5424988b0c128b79cd5ca89c294111df`
**Written before the merge existed.** The heading's SHA and date and the Merge
SHA line above are stamped by the promotion ritual from `git rev-parse` and
`date`, never hand-typed. Three placeholder tokens, all of them on the heading
and the Merge SHA line above and nowhere else in this entry — this entry
deliberately never spells one out in prose, because a token written into a
sentence is a token the stamp substitutes into that sentence. An entry still
carrying them is written and unpromoted, which is a valid state rather than a
mistake.
**Payload:** 11 commits on `staging` ahead of `main` at the time of writing —
`7533613`, `af407b3`, `66f0b59`, `6ef1bd0`, `2813018`, `aa8052a`, `6e0fd2b`,
`658d9db`, `352d4c5`, `e4cc40d`, `54f67ae` — plus the commit carrying this entry
(staging → main, `--no-ff`). `7533613` is the re-level merge that followed the
R7-E promotion and carries no work of its own; `af407b3` is Gary's R7-C blocker
ruling, written before this session opened.
**Prior main tip:** `57e7764`
**Diff (code):** `src/lib/store-hours-window.ts` +129/−0 (new),
`scripts/verify-store-hours-engine.ts` +160/−0 (new),
`scripts/sweep-store-hours.ts` +110/−11, `scripts/generate-roadmap.mjs` +81/−0,
`src/app/(app)/stores/page.tsx` +39/−0,
`src/app/(app)/stores/store-hours-button.tsx` +29/−0,
`src/lib/labor-plan.ts` +24/−24, `src/lib/store-hours-validate.ts` +13/−6,
`src/lib/checklist-lifecycle.ts` +7/−2. **No schema, no migration, no env var, no
cron** — `prisma/` is absent from the diff entirely.

### What shipped

BUG-14's items (a), (b) and (c), and the row moves to `shipped` in this
promotion. The defect: a `StoreHours` row the labor model discards was invisible
at every layer. The dialog showed the hours, the store card showed the hours, and
the engine planned the day from sales inference instead. Nothing anywhere said so.

- **The admission rule moved out of `labor-plan.ts` into a new dependency-free
  module, `src/lib/store-hours-window.ts`**, which now owns `parseHourStart`,
  `parseHourEnd` and the `e > s` predicate. `labor-plan.ts` imports the rule and
  RE-EXPORTS the parsers, so every existing call site is unchanged.
- **Why it had to move rather than be read where it stood.** The surfacing has to
  ask the ENGINE's question — the editor's is a different and looser one — and the
  asker is a client component, while `labor-plan.ts` imports prisma on its first
  line. A second spelling of `e > s` in a component would have been
  BUG-11/BUG-12 a third time, on the row whose own module exists to honour that
  precedent.
- **The signal, on both hours surfaces, through that one predicate.** The store
  card names the days whose visible hours the model will not read; the dialog says
  it against the offending row, recomputed from FORM state on every keystroke.
  The dialog asks ONLY where the editor is already satisfied — a half-filled day
  is already red on B2 — which leaves exactly the case the row exists for: the
  row accepted, and the model still not reading it.
- **A closed day and an empty day are never flagged.** The classifier has four
  answers — closed / undecided / used / discarded — and only `discarded` is a
  disagreement between what is shown and what is used.
- **Copy approved by Gary**, in one exported object so both surfaces inherit one
  edit. It says "unused", never "questionable": the hours are not wrong, and the
  engine's refusal to read an overnight window is the engine's limit (`CUTOFF-1`).
  "Saved, but " was dropped from the dialog line on measurement — the flag renders
  while the operator is still typing, and a successful save closes the dialog, so
  it is never on screen after one.
- **The sweep gained the ENGINE column** and reports a row when EITHER predicate
  has something to say, so a validator-clean overnight row now prints as
  `clean … DISCARDED -> sales inference`. That silence was the defect.
- **`scripts/generate-roadmap.mjs` warns** when a bare blocker entry opens with a
  closing verb and a date and carries no `resolved:` flag. Unrelated to store
  hours; it rides this promotion because it is on the branch.

### THE EXTRACTION MOVED NOTHING — the proof, and the proof that failed first

Moving a live predicate out of the engine is the risky half of this promotion, so
it was proved rather than argued.

**`verify-labor-budget.ts` was byte-identical either side — md5
`f0ce67bd3b9ddb557a974dbe7fa16914` — AND IT PROVED NOTHING.** That fixture
imports `labor-budget.ts` and nothing else; the predicate is not in its
dependency graph. Demonstrated rather than assumed: with `engineOpenWindow`
sabotaged to discard every row — every store on sales inference — it still emits
the same bytes and the same md5. A green result from an instrument that cannot
detect the failure is not evidence, and it is recorded here because it looked
like evidence.

**The proof that does bind is a differential over the decision itself** — typed
hours versus sales inference, which sets the open window and feeds the day split.
The old inline predicate was run against the new shared one over **2,074,842
input pairs**: every minute of the day against every other minute (1440 × 1440),
plus nulls, empty strings, `24:00`, `8:00`, `08:0`, `abc`, `99:99` and
`08:00:00`. **Zero disagreements.** The decision vector — window or
SALES-INFERENCE for every pair — hashes to
`f74111242928a692f2acf640544cd7d0` on both sides.

**The control side was not retyped.** Its parsers were imported from a verbatim
copy of `labor-plan.ts` at `af407b3`, and its admission expression was EXTRACTED
FROM THAT FILE'S OWN TEXT at line 286 and compiled, so no transcription sits on
the side the new code is being judged against.

**And the harness was shown SENSITIVE** by flipping `e > s` to `e >= s`, which
diverges the md5 immediately. Its silence therefore means something. The standing
replacement is `scripts/verify-store-hours-engine.ts`, which asserts the same
predicate through `labor-plan`'s re-export on every run — 24 assertions, shown
failing before it passed.

**The ten executable lines of the two parsers are byte-identical**, md5
`f18cf4f1f58a8e51e1baaa42ef77bcb3`. Two COMMENT lines differ: the moved copy
drops a `, :286` line citation and reflows around it, because the rule is no
longer at that line of that file. An earlier claim that they moved "verbatim,
comments and all" was overstated and is corrected here rather than quietly
narrowed.

### THE DEPLOYED SWEEP — production, `ep-green-smoke`, 2026-08-23

Ten of twelve stores had never been swept. Read through the Neon console per the
credential rule; **no deployed credential was pulled.** Gary ran the row export
and the per-store census and transcribed both by hand.

    store        day  open   close  VALIDATOR       ENGINE
    Las Brisas   Sun 09:00  20:00  clean           USES 9-20
    Las Brisas   Mon 07:00  21:00  clean           USES 7-21
    Las Brisas   Tue 07:00  21:00  clean           USES 7-21
    Las Brisas   Wed 07:00  21:00  clean           USES 7-21
    Las Brisas   Thu 07:00  21:00  clean           USES 7-21
    Las Brisas   Fri 07:00  21:00  clean           USES 7-21
    Las Brisas   Sat 08:00  21:00  clean           USES 8-21
    Southgate    Sun 09:00  20:00  clean           USES 9-20
    Southgate    Mon 08:00  21:00  clean           USES 8-21
    Southgate    Tue 08:00  21:00  clean           USES 8-21
    Southgate    Wed 08:00  21:00  clean           USES 8-21
    Southgate    Thu 08:00  21:00  clean           USES 8-21
    Southgate    Fri 08:00  21:00  clean           USES 8-21
    Southgate    Sat 08:00  21:00  clean           USES 8-21
    UNR          Sun 10:00  17:00  warn W4:close   USES 10-17
    UNR          Mon 08:00  21:00  clean           USES 8-21
    UNR          Tue 08:00  21:00  clean           USES 8-21
    UNR          Wed 08:00  21:00  clean           USES 8-21
    UNR          Thu 08:00  21:00  clean           USES 8-21
    UNR          Fri 08:00  21:00  clean           USES 8-21
    UNR          Sat 10:00  17:00  warn W4:close   USES 10-17

**THE VERDICT: 21 rows, ZERO DISCARDED, 3 of 12 stores with hours.** Zero
blocking, zero unparseable. Every shape this row was written about is ABSENT from
production — no overnight window, no zero-length day, no one-sided row, and no
midnight close either.

**The two warnings are both UNR and neither is an error.** UNR closes at 17:00 at
weekends against a 21:00 midweek median, outside W4's three-hour tolerance — a
campus store keeping short weekend hours, which is exactly what W4 was built to
ASK rather than block. **No data was corrected**, per the row's standing rule
that a wrong row is the operator's to fix in the UI. The engine uses both rows
regardless, and that pair is **the first live case of the two predicates
diverging in the HARMLESS direction**: everything recorded on this row until now
has been the validator silent while the engine discards. "Clean" and "used" are
independent in both directions, and the estate has now demonstrated it rather
than a fixture asserting it.

### SIX LIVE STORES RUN ON SALES INFERENCE

Nine of twelve stores hold **no `StoreHours` rows at all**: Cafe De Keva Cart,
Carson, Keva Kiosk, Meadowood Mall, Rohan's Restaurant, South Reno, Spanish
Springs, Sparks, University Village. Rohan's is unlinked (`squareLocationId`
null, per F-4's blocker) and Keva Kiosk and Cafe De Keva Cart are the seasonal
pair named in `store-hours-validate.ts`, which leaves **SIX LIVE STORES — Carson,
Meadowood Mall, South Reno, Spanish Springs, Sparks, University Village —
planning their coverage entirely from `inferOpenWindowsByWeekday`.**

**This is the PRE-BUG-14 state, not a defect and not a regression.** It is what
the whole estate looked like before 2026-08-23, and nothing in this promotion
changed it. It is recorded because **a store with no rows is silent on every axis
the sweep measures** — no blocking issue, no warning, no engine discard — and
that silence is not the same as being fine. A clean sweep over three stores says
nothing about the other nine.

Until `e4cc40d` the sweep could not see them at all. The export's query
inner-joins `Store` to `StoreHours`, so a store with no rows contributes none and
the sweep counted stores from the export itself: it would have printed **"3 / 3"**
for an estate that is 3 of 12. The census is now an optional second argument, the
zero-row stores are named under the table, and without a census the sweep reports
the count as UNKNOWN rather than claiming coverage it cannot see.

### THE SURFACING IS A LATENT GUARD — do not read the clean sweep as proof it works

**Zero discarded rows estate-wide means NO DATA EXISTS TODAY THAT WOULD RENDER
IT.** Not on production, not on staging, not on dev. The note has therefore never
been observed on screen and cannot be, until the data changes. **A CLEAN SWEEP
PROVES THERE IS NOTHING TO SURFACE, NOT THAT THE SURFACING RENDERS** — those are
different claims and only one of them has been checked. What is established is
the predicate underneath it: `verify-store-hours-engine.ts`, 24 assertions, shown
failing before it passed, plus the pages compiling. **Its first real test is the
day someone enters an overnight window.** A future reader must not promote this
promotion's cleanliness into a claim about the signal.

**The sweep is also a MEASUREMENT OF THE TRANSCRIPT, not of the database.** The
export and census were hand-transcribed from the Neon console, so every
conclusion above inherits that. A shape audit ran first — field names and types,
`HH:MM` on every time, `dayOfWeek` in range, no duplicate `(store, dayOfWeek)`
pair against the schema's `@@unique`, a complete Sun..Sat per store, and the
census summing to exactly 21 — and it caught nothing. **A valid-but-wrong value
would pass every one of those checks:** `07:00` typed where the console said
`17:00` is well-formed, in range, unique and complete. The transcript files were
deleted rather than committed; production store hours do not belong in the repo,
and the queries that regenerate them are in BUG-14's record.

### The flag audit, and DEBT-84

`docs/ROADMAP.yaml`'s header says only the `resolved:` flag is read, but PERM-6's
older convention — closing a blocker by PREPENDING a note above it — never went
away, so an entry closed in prose keeps counting LIVE on `/internal/roadmap`.
R7-C carried one for a day. **All 56 blocker entries across 21 phases were swept:
22 resolved, 3 narrowed, 31 bare, and NOT ONE bare entry is an unflagged
closure.** The inverse — flagged resolved with unsupporting prose, the direction
that HIDES a blocker — also came back zero. **Nothing was flagged**; five entries
announce a closure and every one names a surviving remainder in its own text, and
Gary ruled them correct as written.

**The over-count is real but structural, and it is filed as `DEBT-84`.** A
prepended closure note is a new ARRAY ENTRY and the panel counts array entries,
so closing a blocker by the prepend convention ADDS one to the live count at the
moment it removes one. **Eight of the 31 live entries are such notes** — F-4
carries 3 of its 5, L-2 carries 4 of its 6, IG-1 carries 1 of 3 — so F-4 reads as
five live gates when it has two gates and three notes about them. Nothing is
mis-flagged and the count is still wrong. Not fixable by flagging: the notes
carry live remainders too.

The generator's new warning is **not** the prefix detection P-4 rejected. P-4
rejected prefix matching as a CLASSIFIER, on the evidence that F-5's live blocker
opens "VERIFIED STILL TRUE"; a warning never closes anything and fails toward
asking. It requires the closing verb to be IMMEDIATELY followed by a date, so
both of P-4's counter-examples are structurally out of range. **Backtested before
being built:** against `7533613` it fires once, on the exact entry `af407b3`
found by hand, and exits 0; against HEAD it fires zero times.

### Rollback

```
git revert -m 1 <merge sha>
```

**No schema, no migration, nothing to un-drop.** Reverting restores the inline
`e > s` in `labor-plan.ts` and removes `store-hours-window.ts` along with both
surfaces' notes — which is a no-op in visible behaviour today, because zero rows
estate-wide trigger the note. It also removes the sweep's ENGINE column and its
census argument, and the generator's warning. **No data written under the new
behaviour needs unwinding, because none is written** — every part of this
promotion reports and nothing persists. The differential above is the reason a
revert is not expected to be needed for the extraction: the admission decision is
identical across 2,074,842 inputs.

### Post-deploy check

A glance, not a procedure. **Everything here should be UNCHANGED** — that is the
expected result, not a weak one, because production carries no row that the new
signal fires on.

- **`/stores` renders identically.** Las Brisas, Southgate and UNR show their
  hours as before, with **no** "not being used" note on any of them. A note
  appearing on a store today means the predicate is not what this entry claims.
- **`/labor` at Las Brisas and UNR is unchanged** — same windows, same Suggested,
  same hourly heads. The extraction is proved behaviour-identical and this is the
  confirmation on real data.
- **A store with no hours — Carson or Sparks — is identical**, and still shows
  CHK-4's existing "No hours set" note. The two notes are different subsystems
  and only the old one has anything to say there.
- **The hours dialog still saves.** Open it on any store, change nothing, save.
  The validator's B and W codes behave exactly as before.
- **The Vercel build log carries no `[roadmap] WARNING` line.** If one appears, a
  blocker entry has been closed in prose without its flag.

**IF A "not being used" NOTE APPEARS ANYWHERE ON PRODUCTION TODAY, THAT IS A STOP
AND A REVERT.** The sweep says zero rows qualify; a note on screen means the
component and the engine disagree, which is the exact defect this promotion
exists to make impossible.

### Known open at promotion

Read off `docs/ROADMAP.yaml` at the time of writing, not copied forward from the
previous entry.

- **The surfacing has never been seen render** — see the latent-guard section
  above. This is the single most important thing to carry forward from this
  promotion.
- **Six live stores hold no hours at all** and run on sales inference. Not a
  defect; not addressed here; named above so it is visible rather than assumed.
- **`DEBT-84`** (`planned`, filed here) — a prepended closure note is counted as a
  blocker in its own right, so `/internal/roadmap` over-states live gates even
  when every flag is correct. LATENT, process not product.
- **`CUTOFF-1`** (`planned`) — the per-store business day cutoff. Until it exists,
  a genuine overnight window is still discarded by the engine, and the note
  shipped here is all that stands between an operator and a silent discard.
- **`DEBT-64`** — day close and labor still read an overnight row differently.
  This promotion did NOT close it; it only made labor's half visible.
- **`DEBT-83`** (`planned`) — the band's real default is the hardcoded `14`.
  Closes with L-4 by Gary's ruling.
- **`BUG-4`, `BUG-13`, `DEBT-75`, `DEBT-80`, `DEBT-81`** — all untouched by this
  promotion and all still open.
- **`DEBT-41`/`DEBT-42`** — the partial-closure vocabulary and the `deferred`/`open`
  fields carrying resolved entries. `DEBT-84` is adjacent to both and is not
  either of them.
- **`scripts/promote.sh` remains unbuilt.** Every promotion is still a hand-run
  ritual pasted from a session report. Not built here.

**CLOSED BY THIS PROMOTION:** BUG-14, on all three of its items — the shared
predicate, the surfacing, and the deployed sweep. It is the row's first promotion
since the sweep it had been waiting on since 2026-08-23.

## 817b3ef — 2026-08-23 — R7-E: manager on the floor — the band stops feeding the numbers

**Merge SHA:** `817b3efba1be1d42dbf86dd6ccddc029aded0522`
**Written before the merge existed.** The heading's SHA and date and the Merge
SHA line above are stamped by the promotion ritual from `git rev-parse` and
`date`, never hand-typed. Three placeholder tokens, all of them on the heading
and the Merge SHA line above and nowhere else in this entry — this entry
deliberately never spells one out in prose, because a token written into a
sentence is a token the stamp substitutes into that sentence. An entry still
carrying them is written and unpromoted, which is a valid state rather than a
mistake.
**Payload:** 5 commits on `staging` ahead of `main` at the time of writing —
`1b0f89d`, `b62f92f`, `7b4df17`, `e8c465c`, `d370191` — plus the commit carrying
this entry (staging → main, `--no-ff`). `1b0f89d` is the re-level merge that
followed the R7-D promotion and carries no work of its own.
**Prior main tip:** `79e4bc8`
**Diff (code):** `src/lib/labor-coverage.ts` +37/−5, `src/app/api/labor/weekly-plan/route.ts`
+19/−8, `src/lib/labor-plan.ts` +14/−1, `scripts/verify-labor-coverage.ts` +55/−2,
`weekly-plan-client.tsx` +9/−6, `labor-coverage-card.tsx` +3/−3,
`labor-settings-client.tsx` +2/−2. **No schema, no migration, no env var, no
cron** — `prisma/` is absent from the diff entirely.

### What shipped

Gary's ruling 2026-08-23, `DECISIONS.md` § "Manager on the floor — one guaranteed
number". Froot knows the manager is worth 20 hours a week at each of Las Brisas
and UNR and does **not** know WHICH 20 — that is L-4. So the drawn band stays at
its window and is demoted to an EXPECTATION, and every number reads her credited
hours instead.

- **`headcount` is HOURLY HEADS ONLY** (`labor-coverage.ts:111`). It read
  `hourly + (gm ? 1 : 0)`.
- **`suggestedHours` reads the day's CREDITED hours**, through a new pure export
  `suggestedHoursForDay(points, gmCreditHours)`, threaded into
  `buildComparison` from `plan.days` (`weekly-plan/route.ts`). It used to count
  ONE MANAGER BODY PER DRAWN BAND HOUR.
- **`points[].gm` is UNTOUCHED — the band still draws**, at the same window, with
  the same shape.
- **Peak is now the HOURLY peak.** Intended, with no compensating term.
  **Pinned by fixture `verify-labor-coverage.ts` §11, NOT by the capture below** —
  the capture does not assert it, and saying otherwise would overstate what was
  measured.
- **Six approved copy strings**, shipped exactly as Gary approved them: the
  settings label and helper, the coverage-card legend "(incl. manager)", the band
  legend "Manager expected {start}–{end}" at both sites, and the weekly-plan
  footnote. **Column and field names are unchanged by ruling** — after this,
  grepping `manager` does not find the setting that draws the band and grepping
  `gmOnFloor` does not find any words a user sees. That seam is deliberate.
- **A seventh string, approved separately and later:** the `supervisorGap` warning
  now reads "No hourly supervisory position is set up for this store." on both
  surfaces. The old wording — "No supervisory position covers the hours the GM is
  off the floor" — had been FALSE SINCE R7-D, which made `supervisorGap` simply
  `!hasHourlySupervisor`. That is a correction, not a rename.

**DEVIATION — `parseHourEnd("00:00")` NOW RETURNS 24, AND IT BREAKS R7-E's OWN
ZERO-DIFF RULE FOR `labor-plan.ts` ON PURPOSE.** The commissioning prompt says to
STOP if `labor-plan.ts` needs editing beyond reading `gmCreditHours` through.
Gary folded this fix into the phase after that prompt was written, so the STOP
condition was overridden by a later instruction rather than ignored. An
`18:00–00:00` day is now ADMITTED by the engine at `labor-plan.ts:286` instead of
silently discarded. **Exactly `"00:00"` and nothing wider** — `"00:30"` still
returns 1 and is still discarded, because that is a genuine overnight close and
overnight needs the per-store business day cutoff, ruled and deferred to
`CUTOFF-1`. Widening the special case would have built that cutoff by accident,
in the one place nobody would look for it. Recorded as a deviation on R7-E
(S5-D66), not done quietly.

### THE CAPTURE — measured BEFORE the merge, against PRODUCTION store hours

Both engine versions run over identical constructed inputs: pre-fix from
`git show 79e4bc8:src/lib/labor-coverage.ts`, post-fix from the tree. **PURE — no
database, no deployed credential, no network.** Production hours verified from
the DB by Gary 2026-08-23 (`dayOfWeek 0 = Sunday`, cross-checked against the store
card); weekly hourly pools are the PRODUCTION figures recorded at the R7-C
promotion 2026-08-22.

| store | B | Suggested BEFORE → AFTER | **ΔWEEK** |
|---|---|---|---|
| Las Brisas | 46 | 282.0 → 256.0 | **−26** |
| UNR | 38 | 117.0 → 99.0 | **−18** |
| a no-band store | 0 | 31 → 31 | **0** — full point arrays byte-identical |

**Confirmed by two independent paths that agree exactly:** the admission checker
run over the typed production rows, and the two-version capture.

**All 14 production rows are ADMITTED by the engine — 0 discarded, 0 closed,
every row `e > s`**, checked at `labor-plan.ts:286` using the engine's own
`parseHourStart`/`parseHourEnd` rather than a reimplementation. Neither of
BUG-14's known-bad rows is present at these two stores.

**COMPUTED PER DAY. NEITHER STORE HAS A UNIFORM WEEK**, and that is the assumption
that has failed repeatedly on this work:

- **Las Brisas** — Sun 09:00–20:00 (band 5h) · Mon–Fri 07:00–21:00 (7h) · Sat
  08:00–21:00 (6h). Three distinct day shapes.
- **UNR** — Sun and Sat 10:00–17:00 (4h) · Mon–Fri 08:00–21:00 (6h). Two.

### WHY THE DELTA IS TRUSTWORTHY EVEN THOUGH THE LEVELS ARE CONSTRUCTED

**Δ = K − G reads nothing on the hourly side.** The capture asserts, on every day
of both stores, that hourly heads, `points[].gm`, `usedHourlyHours`,
`understaffedBudget` and `supervisorGap` are byte-identical between the two engine
versions. The only thing that differs is the manager's contribution.

So the demand shape and the budget set the ABSOLUTE LEVEL and cannot touch the
DELTA. The BEFORE/AFTER totals above come from a constructed peak-at-12:00 shape
and are illustrative; **−26 and −18 are exact, and will hold on production even
where the levels differ.**

### WHAT MANAGERS WILL SEE, AND WHAT DID NOT MOVE

**Suggested falls about 9% at Las Brisas (282 → 256) and about 15% at UNR
(117 → 99). Nothing else on the labor surfaces moves.**

**RECOMMENDED HOURLY STAFFING DOES NOT CHANGE.** Not by one head, at any hour, at
any store. **No dollars move. No hourly pool changes. No persisted figure moves.**
`usedHourlyHours`, `understaffedBudget`, `supervisorGap`, the floor-of-one bump
and every `labor-plan.ts` budget figure are identical before and after — asserted
day by day in the capture, not assumed.

**What fell is the figure that was crediting the manager for hours she was never
covering.** The drawn band ran **46 hours a week at Las Brisas and 38 at UNR**
against a credited **20** at each. Suggested was counting one manager body per
drawn band hour, for a person who is 50% allocated to each store and works about
eight hours on about two and a half days at each.

**A SMALLER SUGGESTED DOES NOT MEAN FEWER PEOPLE ARE ALLOWED. If it is read that
way, the ruling has been inverted.** The number did not become stricter; it
stopped counting a body that was not there. The hours it withdrew were never
coverage — they were the band asserting presence it could not know about, which
is exactly what Gary's third ruling says the window must stop doing.

### WHAT THE PRE-REGISTRATION GOT RIGHT AND WRONG

Pre-registered at `08c2e6e`, before any engine edit, as **−29 and −22**. Actual:
**−26 and −18.**

**SURVIVED — the whole of the reasoning.** The box
(`ΔWEEK = min(B,C) − B = −max(0, B−C)`), `ΣK = min(B,C)`, `C = 20` at both stores,
the ten-store no-op, and **every falsifier it named**: no non-manager store moved,
no positive delta anywhere, no R7-D figure moved, `points[].gm` unchanged.

**FAILED — assumption 2's opening times, which are true Mon–Fri only.** Las Brisas
opens 09:00 Sunday and 08:00 Saturday; UNR opens 10:00 on both weekend days. **The
misses are exactly the weekend days: 3h at Las Brisas (Sun 2 + Sat 1) and 4h at
UNR (Sun 2 + Sat 2).** The pre-registration's own sensitivity rule — "each hour
later a store opens shrinks B by 7/week" — is uniform-week shaped too, and does
not apply to a per-day deviation.

**ASSUMPTION 1 SURVIVED, AND THE NOTE THAT CONTRADICTED IT WAS THE WRONG ONE.**
Both stores DO open 7 days. An intermediate finding on R7-E claimed UNR opens 5,
taken from dev's sales-inferred windows on a branch that holds no `StoreHours`
rows at all; it was withdrawn the same day. Dev's inference is what the engine
falls back to WHEN there are no hours — the opposite of evidence about what the
hours are. The original assumption was right from the start.

### S5-D10's SECOND CASE IS MEASURED NOT-LIVE

`capGmFloorCredits` returns the band UNSCALED when it totals less than the ceiling
(`labor-daily.ts:54`), which would make the window itself the credited number.
**B is 46 and 38 against C = 20 — nowhere near the `B ≤ C` boundary.** Real as a
mechanism, not firing today, and now measured rather than merely assumed distant.
It remains open by D19's ruling and pinned at
`verify-labor-position-hours.ts:146`.

### Rollback

```
git revert -m 1 <merge sha>
```

**No schema, no migration, nothing to un-drop.** Reverting restores the manager
being counted as a whole body in `headcount`, in `suggestedHours` and in the peak
— Suggested returns to 282 at Las Brisas and 117 at UNR on the capture's inputs.
It also restores `parseHourEnd("00:00")` to 0, so a midnight-close row goes back
to being silently discarded, and restores the two false copy strings. **No data
written under the new behaviour needs unwinding, because none is written** —
`computeDailyCoverage` reaches no budget, no persisted hours figure and no dollar.

### Post-deploy check

A glance, not a procedure. Open `/labor` at **Las Brisas** and **UNR** for the
current week.

- **The band draws exactly as before** — same window, same shape. Its legend now
  reads "Manager expected".
- **Suggested is lower** by roughly 26 hours a week at Las Brisas and 18 at UNR.
- **Hourly heads and the floor warnings are UNCHANGED from this morning.** This is
  the one that matters.
- **A no-band store — Carson or Sparks — is identical.**

**IF HOURLY HEADS MOVED ANYWHERE, THAT IS A STOP AND A REVERT.** This change is
display-side and touches the manager's contribution only; an hourly head that
moves means something crossed into the plan's arithmetic that the capture did not
catch.

### Known open at promotion

Read off `docs/ROADMAP.yaml` at the time of writing, not copied forward from the
previous entry.

- **BUG-14** (`in_progress`) — **the deployed sweep has still not been run, and
  the surfacing work is still first on that row.** This promotion discharges the
  discarded-row question for Las Brisas and UNR only: their 14 rows were checked
  and all 14 are admitted. **The other ten stores are unswept**, and a store whose
  typed hours the engine ignores still says nothing on screen.
- **CUTOFF-1** (`planned`) — the per-store business day cutoff, TIER 3, waiting on
  a store that crosses midnight, opening with the Square attribution question.
  The `00:00` fix in this promotion is explicitly NOT that work.
- **DEBT-83** (`planned`) — the band's real default is the hardcoded `14`, and it
  is what set B at 46 and 38 here. **R7-E makes this matter less, not more**: the
  band no longer feeds a number, so a wrong default now moves a drawn reminder
  rather than a recommendation. Closes with L-4 by Gary's ruling.
- **L-4** (`planned`) — which specific days and hours a named person works. Still
  the answer to the question this ruling deliberately does not answer.
- **R7-C's first blocker — the double-drawn band — IS REPORTED AND NOT FLIPPED IN
  THIS PROMOTION.** Its clearing condition and whether this ruling satisfies it is
  Gary's call and is outstanding at the time of writing. See the session report.
- **BUG-4** (`planned`) — the Labor Budget card and Weekly Plan disagree on
  schedulable hours. Untouched by this promotion and worth knowing about while
  reading either surface.
- **BUG-13** (`planned`) — the all-locations rollup still syncs inline.
- **DEBT-80** (`planned`) — a saved week's day-by-day plan is not stable; the same
  historical week can return different day hours.
- **DEBT-81** (`planned`) — a guaranteed weekly minimum for an HOURLY person has
  nowhere to live.
- **DEBT-75** (`planned`) — the ruled last-year same-weekday fallback is still
  absent.
- **`scripts/promote.sh` remains unbuilt.** Every promotion is still a hand-run
  ritual pasted from a session report. Not built here.

**CLOSED BY THIS PROMOTION, and worth naming because the previous entry listed it
as open:** the `:103`/`:107` ruling — whether the manager counts as a body for
`headcount` and for the peak. Open since 2026-08-20; answered by Gary on
2026-08-23 and shipped here. She does not, in either.

## 4d0edd4 — 2026-08-23 — R7-D: the GM no longer satisfies the floor of one body + BUG-14: store hours validation

**Merge SHA:** `4d0edd4698d4f52a97d382660299e412a850d0bc`
**Written before the merge existed.** The heading's SHA and date and the Merge
SHA line above are stamped by the promotion ritual from `git rev-parse` and
`date`, never hand-typed. Three placeholder tokens, all of them on the heading
and the Merge SHA line above and nowhere else in this entry, so the stamp is
three substitutions and touches no other line. An entry still carrying them is
written and unpromoted, which is a valid state rather than a mistake.
**Payload:** 4 commits on `staging` ahead of `main` at the time of writing —
`c91af6c`, `1588d31`, `1e7286b`, `6911469` — plus the commit carrying this entry
(staging → main, `--no-ff`).
**Prior main tip:** `505f4e6`
**Diff (code):** `src/lib/labor-coverage.ts` +23/−13, `src/lib/labor-plan.ts`
+10/−0 (comment only), `scripts/verify-labor-coverage.ts` +31/−0. No schema,
no migration, no env var, no cron.

### What shipped

Two gates in `src/lib/labor-coverage.ts`, and nothing else in the module moved.
Line numbers below are given **post-fix first, pre-fix in brackets**, because the
commissioning prompt and the R7-D row both cite the pre-fix numbering and a
reader at `main` will not find the code there:

- **The floor-of-1 bump — `:93` [pre-fix `:87`].** It read
  `hourly + (gmAt ? 1 : 0) < 1`, so during the GM band the hourly head count
  could be ZERO and the floor was still considered satisfied. It is now a floor
  of one **HOURLY** head: `if ((hourly.get(h) ?? 0) < 1) hourly.set(h, 1)`.
- **`supervisorGap` — `:116` [pre-fix `:107`].** It read
  `openHours.some((h) => !gmAt(h)) && !hasHourlySupervisor`, so a band spanning
  the whole open window cleared the flag outright. It is now
  `!hasHourlySupervisor`.

**`points[].gm` and the peak are untouched.** The band still draws (`:102`
[pre-fix `:97`]) and `peakHeadcount` (`:107` [pre-fix `:102`]) still counts the
GM as a body. Gating those would move `suggestedHours` as a POLICY change — see
WHAT WAS DELIBERATELY NOT FIXED below.

**`labor-plan.ts` carried ZERO DIFF in the work commit, byte for byte**, and
`scripts/verify-labor-budget.ts` produced byte-identical output before and after.
That pair is the proof that nothing crossed into the plan's arithmetic. The
`labor-plan.ts` +10 in the diffstat above is a COMMENT, and it rides the recorder
commit precisely so the work commit's zero-diff claim stays literally true
(DEVIATION R7-D/2 on the row).

**Fixture first, and shown FAILING before the change.** Section 10 of
`scripts/verify-labor-coverage.ts` — 4 checks failing against the unmodified
module, then passing. Case (a) puts every unit of sales weight after 2p so
largest-remainder places ZERO hourly heads inside an 8a–2p band; case (b) spans
the band across the whole open window with no hourly supervisor.

### THIS CHANGES AN ALERT MANAGERS ALREADY SEE

`understaffedBudget` is not new. It is on screen today, and this change makes it
fire on days it did not fire on before, at the two stores that draw a GM band —
Las Brisas and UNR. Recommended coverage also rises there during the band.
**That is the fix working:** those hours were always needed, and the GM — one
person the estate counts as present at two stores at once — was papering over
them. D28's precedent is the reason this has its own heading rather than a line
in a bullet list: a change to an existing alert gets a blast-radius note.

**The measured size, and it is SMALL.** Week of 2026-07-20, per-day real demand
shapes, both engine versions run side by side:

| store | suggestedHours BEFORE → AFTER | hours reclaimed inside the band | `understaffedBudget` flips false→true |
|---|---|---|---|
| Las Brisas | 275 → 277 (**+2** / week) | 2 (Thu, Sun) | **2 of 7** open days |
| UNR | 58 → 59 (**+1** / week) | 1 (Mon) | **1 of 5** open days |

`supervisorGap` is `false` before and `false` after, on every day, at both
stores — see WHICH OF THE TWO GATES IS LIVE below.

**UNR's flag does NOT flip most days**, and that is the sentence this entry
exists to be able to say. The earlier figure on the R7-D row — UNR 30 → 50, +4
per open day — was labelled a dev artifact when it was written and it is one:
dev holds no salaried rows, so UNR's `hourlyHours` is 0.0 all week there and
every single hour is a floor bump.

**WHY IT IS SMALL, which is the part worth carrying forward.** The GM band's
real default is `open.startHour → 14:00` (`labor-plan.ts:283-284`, the fallback,
because `gmOnFloorStartMinutes`/`EndMinutes` are unset — DEBT-83). Both stores
peak at 12:00. **The band therefore sits directly on top of the demand peak**,
and those are exactly the hours largest-remainder already gives heads to. The
hours that come out at zero are the thin ends of the day, and at both stores the
thin end is the late afternoon and evening — OUTSIDE the band, where the floor
bump fired before this change too. If a store's band ever moves off its peak, or
a store's peak moves into its morning, this number grows; the mechanism, not the
magnitude, is what governs.

**PROVENANCE, STATED PLAINLY — THIS IS A PREDICTION, NOT A STAGING READ.** The
demand shapes, open windows and day-of-week weights are the dev branch's real
Square sales (`br-broad-wave-a6vpjdw0`). The weekly HOURLY pools are the
PRODUCTION figures recorded at the R7-C promotion on 2026-08-22 — Las Brisas
227.5 (247.5 total − 20 salaried), UNR 34.0 (54.0 − 20). The band is the
`labor-plan.ts:283-284` fallback overlaid on those windows. **No deployed
credential was used and none was pulled** (CLAUDE.md § Environment Variables).
The staging/production confirmation is owed and is listed under KNOWN OPEN.

**THE WEEK IS 2026-07-20, NOT THE CURRENT WEEK, AND THAT IS DELIBERATE.** Dev's
`SalesHourlyCache` stops at 2026-08-13 for Las Brisas and 2026-07-25 for UNR, so
the current week has no template dates at all, `getDemandShape` returns `[]`, and
`computeDailyCoverage` falls back to a FLAT `1/openHours` weight. A flat shape
spreads heads evenly and yields a delta of exactly zero at both stores — the
mirror-image artifact of the zero-budget run that produced +20. Neither is the
answer. 2026-07-20 is the most recent week both stores have complete hourly
actuals for, so every day of it takes its own real curve.

### WHICH OF THE TWO GATES IS ACTUALLY LIVE TODAY

**Only the floor gate. `supervisorGap` (`:116` [pre-fix `:107`]) is INERT on
present data, and it is inert twice over.**

1. **`hasHourlySupervisor` is TRUE.** Measured, not read off the seed file: the
   Keva Juice org carries Assistant Store Manager, Lead Supervisor and
   Supervisor, all `payType HOURLY`, all `isSupervisory true`, all `active`. The
   predicate at `labor-plan.ts:255` is therefore true, so `supervisorGap` is
   `!true` = `false` — before the change and after it.
2. **Even if it were false, the old clause it removed never fired.** The removed
   term was `openHours.some((h) => !gmAt(h))`. The band ends at 14:00 and both
   stores close later — Las Brisas 20:00–22:00 by weekday, UNR 16:00 — so there
   is always an open hour outside the band and that term is always `true`. A
   band that spans the WHOLE open window is what the old code needed in order to
   suppress the flag, and no store in the estate has one.

This is worth recording because it narrows the promotion: the `supervisorGap`
half is a **latent** correction, priced at zero today. It becomes live the moment
an org deactivates its hourly supervisory positions, or a store's hours shrink
inside its band.

### suggestedHours RISES, AND THAT IS EXPECTED

The prompt that commissioned the fix predicted a delta of ZERO and called a
non-zero delta a leak and a STOP condition. **THE PROMPT WAS WRONG AND THE
SESSION WAS RIGHT TO OVERRIDE IT.** `suggestedHours` is Σ `points[].headcount`
over open hours (`weekly-plan/route.ts:163-167`, ratified 2026-08-20), and
`headcount` is `hourly + gm` (`:103` [pre-fix `:98`]). That line is genuinely
untouched — it reads a value the floor gate legitimately changed upstream. So
raising the floor NECESSARILY raises Suggested; a zero delta would have meant the
fix did not work. The relationship is exact, not approximate:

> **Δ suggestedHours = Δ usedHourlyHours = the number of open hours inside the
> band that had zero hourly heads.** Items 1 and 3 of the measurement are the
> same number by construction.

Verified over a 40,000-day randomised sweep running BOTH module versions side by
side (pre-fix from `git show`, post-fix from the tree) with zero violations, and
alongside three companions: `understaffedBudget` is true exactly when the day has
at least one floor bump (`usedHourlyHours = round(budget) + bumps`, and
`round(B) − B` is in `(−0.5, 0.5]`, so one bump is always enough);
`supervisorGap` differs before/after ONLY when the band spans every open hour AND
there is no hourly supervisor; and **with no band at all the change is a
byte-for-byte no-op**, which is ten of twelve stores.

Recorded here, and ratified by Gary 2026-08-23, so a later reader who finds the
STOP condition in `docs/prompts/R7D_GM_FLOOR_SAFETY.md` does not conclude it was
ignored carelessly.

### What does NOT move

**No dollars. No hourly pool. No persisted hours figure.**

`computeDailyCoverage` has ONE production caller — `computeDayCoverage`
(`labor-plan.ts:411`, the function body at `:419`) — consumed by exactly two GET
routes, `/api/labor/coverage` and `/api/labor/weekly-plan`. **Neither writes a
row.** That is call-site exhaustion, re-verified for this promotion rather than
carried forward on trust. Coverage output is DISPLAY-ONLY: it reaches no budget,
no persisted hours figure and no dollar. `blendedHourlyRate`, the promotion
canary, is not in this change's blast radius at all.

`totalLaborBudget`, `salariedCost`, `salariedHours`, `hourlyHours`, the
floor-first split and every `WeeklyDayHours` override are produced upstream in
`labor-plan.ts`, which this promotion does not change.

### What was deliberately NOT fixed

**`:103` [pre-fix `:98`] headcount and `:107` [pre-fix `:102`] peak stay as they
are.** Both still count the salaried GM as a whole body on the floor. Gating them
would move `suggestedHours` as a POLICY change rather than a safety correction,
and it would leave Gary's 2026-08-20 whole-crew ruling with **zero live cases**,
since both GM stores are under 100% allocation. That is a ruling, it is still
open, and it is not this promotion's to make.

Also untouched: the band's WIDTH and day-shape (L-4's job — which specific days
and hours a named person works), and any allocation-fraction threading, which was
WITHDRAWN on the R7-D row because the measurement showed the weekly-cap gap
dominates the allocation gap.

### Rollback

```
git revert -m 1 <merge sha>
```

**No migration, no schema, nothing to un-drop.** Reverting restores the GM
satisfying the floor of one body and restores the band's power to suppress
`supervisorGap`. `understaffedBudget` returns to its pre-promotion firing
pattern at Las Brisas and UNR and is unchanged everywhere else. No data written
under the new behaviour needs unwinding, because none is written.

### Known open at promotion

Read off `docs/ROADMAP.yaml` at the time of writing, not copied forward from the
previous entry.

- **The staging/production confirmation of the numbers above is OWED.** The table
  is a prediction assembled from dev shapes and recorded production pools. It has
  never been run against a branch that carries both the allocations and the
  forecasts. `vercel env pull` is banned repo-wide, so this is a Neon-console
  read and it is Gary's to run.
- **DEBT-83** (`planned`) — the GM on-floor window is a per-store setting whose
  real default is a hardcoded literal, and the two halves of that default fall
  back independently. Unset at eleven of twelve stores; set only at Southgate,
  where it is inert because Southgate draws no band. **R7-D is what makes this
  matter**: the band's edges now decide where a floor bump lands, and the reason
  this promotion is small is that a literal `14` happens to sit on the demand
  peak. Nobody chose that.
- **The `:103`/`:107` [pre-fix `:98`/`:102`] ruling** — whether the GM counts as
  a body for headcount and peak. Open since 2026-08-20, zero live cases while
  both GM stores are under 100%.
- **L-4** (`planned`) — the labor assignment layer. The coverage-shape half of R7
  is blocked behind it: with Kristie at 50/50, Las Brisas and UNR both draw a
  band from their own settings, on the same days, for the same person. The hours
  arithmetic is right (20 + 20 = 40); the coverage SHAPE is what is wrong, and
  which specific days and hours a named person works is L-4 by construction.
- **DEBT-80** (`planned`) — a saved week's day-by-day plan is not stable; asking
  for the same historical week twice can produce different day hours.
- **DEBT-81** (`planned`) — a guaranteed weekly minimum for an HOURLY person has
  nowhere to live.
- **DEBT-75** (`planned`) — the last-year same-weekday fallback is ruled binding
  and still absent, so a store with fewer than four completed same-weekdays in
  cache still gets "No sales shape to project".
- **BUG-13** (`planned`) — the all-locations rollup still syncs inline.
- **`scripts/promote.sh` remains unbuilt.** Every promotion is still a hand-run
  ritual pasted from a session report. Not filed as a row and not built here.

### Post-deploy check

A glance, not a procedure. Open `/labor` at **Las Brisas** and **UNR** for the
current week. Expect the GM band to draw exactly as it did before — this change
does not move it. Expect the Suggested curve to sit one head higher in at most a
couple of band hours across the week, and expect `understaffedBudget` to be
raised on one or two more days than before at each store. **A wall of red at UNR
is NOT the expected outcome**; if that is what appears, the prediction above was
wrong about the demand shape and the promotion should be reconciled against it
rather than explained away. Every other store should be byte-identical.

### AMENDED 2026-08-23, BEFORE THE MERGE — THIS PROMOTION ALSO CARRIES BUG-14

**Everything above this heading is unedited.** It was written when the payload
was R7-D alone, and it is still accurate about R7-D. This section is appended
rather than woven in, so the pre-merge measurement above stays readable as the
thing it was: a prediction made about a four-commit payload, not a summary
rewritten once the payload grew.

**THE ENTRY'S HEADING WAS EXTENDED AND THE `Payload:` LINE WAS NOT.** The
heading is this file's index — a reader scanning `grep "^## " docs/DEPLOY_LOG.md`
must be able to find BUG-14 — and it is machine-stamped at promotion anyway, so
it is a pointer and it was repaired. The `Payload:` line says "4 commits on
`staging` ahead of `main` **at the time of writing**"; that was true when written
and is a dated claim, so it stands untouched and is superseded by the count
below.

**THE THREE PLACEHOLDER TOKENS ARE UNCHANGED AND STILL UNIQUE.** The short-SHA
and date tokens on the heading, the full-SHA token on the Merge SHA line, one
occurrence each, nowhere else in this entry. **This section deliberately does
NOT spell any of the three out**, because a token written into prose is a token
the stamp substitutes into prose — the uniqueness the entry above relies on is a
property of the whole entry, not of its heading. The stamp is still three
substitutions touching two lines.

**Payload, reconciled:** **15 commits** on `staging` ahead of `main` —
`c91af6c`..`2871c19` — plus the commit carrying this amendment (staging → main,
`--no-ff`). **Prior main tip is unchanged at `505f4e6`.**

**Diff (code), combined across all 15:**

| file | + | − |
|---|---|---|
| `src/lib/store-hours-validate.ts` | 243 | 0 |
| `scripts/verify-store-hours.ts` | 126 | 0 |
| `scripts/sweep-store-hours.ts` | 119 | 0 |
| `src/app/(app)/stores/store-hours-button.tsx` | 73 | 27 |
| `src/app/api/stores/[id]/hours/route.ts` | 43 | 8 |
| `scripts/verify-labor-coverage.ts` | 33 | 1 |
| `src/lib/labor-coverage.ts` | 23 | 13 |
| `src/lib/labor-plan.ts` | 10 | 0 |

**Still no schema, no migration, no env var, no cron** — the R7-D line above
holds for the whole payload. `prisma/` is absent from the diff entirely.

**Two small reconciliations against the R7-D `Diff (code)` line above**, neither
a correction to it: that line described the R7-D **work commit** `1e7286b`, so
`verify-labor-coverage.ts` reads +31/−0 there and +33/−1 here (the recorder
`6911469` added +2/−1), and `labor-plan.ts` +10/−0 is the same comment-only
change in both.

### What BUG-14 shipped

**One pure module, two call sites.** `src/lib/store-hours-validate.ts` exports
`validateStoreHours(days) → { blocking, warnings }`, dependency-free on purpose,
and BOTH the dialog (`stores/store-hours-button.tsx`) and the write route
(`api/stores/[id]/hours` PUT, `:136`) run the same code. A form-only check is
not a check — BUG-11/BUG-12 are this house's precedent for an editor and a write
path each carrying a copy of one rule and drifting apart.

**The rule set.** BLOCK: `B1` open == close on a day not marked Closed; `B2` one
time filled and the other blank. WARN: `W1` over 16h, `W2` under 4h, `W3` opens
before 05:00, `W4` open or close more than 3h from the median of that store's
other filled days, needing 3 siblings before it can fire.

**Close < open is legal and never blocks or warns**, asserted explicitly in the
fixture on both lists. The dialog's helper text promises it
(`store-hours-button.tsx:242`) and the write route declined to order-check for
that reason. The obvious check is the wrong check.

**`W1`–`W4` warn and never block.** Rohan's Restaurant, Cafe De Keva Cart and
Keva Kiosk are seasonal and legitimately odd. R7-C's shape: assert, raise a
visible flag, never normalise. No time is auto-corrected, no AM/PM is swapped,
no intent is inferred — the fixture asserts the input object comes back
unmutated.

**Fixture first, shown failing.** `scripts/verify-store-hours.ts` was written and
run before the module existed, failing with `MODULE_NOT_FOUND`. 17 assertions.

### THIS PROMOTION CHANGES A WRITE PATH, NOT ONLY A FORM

`PUT /api/stores/[id]/hours` now returns **400** when `blocking` is non-empty
(`:144-147`), after the existing zod and duplicate-day checks. **An operator who
opens a store with an already-bad row and presses Save cannot save it back
unchanged** — they must fix the day or mark it Closed. That is the intended
behaviour and it is the first thing anyone will meet, so it is called out here
rather than left to be discovered.

**No data was corrected, deliberately.** A wrong row is Gary's to fix in the UI,
which is also the first live test of the editor's new behaviour. **Warnings are
not persisted** — no column, no flag; they are computed at render and at write,
the route discards them, and a warned save succeeds.

**The deployed sweep has NOT been run.** `scripts/sweep-store-hours.ts` takes a
Neon-console JSON export as an argument and validates it with the same module
rather than reimplementing the rules in SQL. The dev branch holds ZERO
`StoreHours` rows, so the sweep exercised the code and tested no data. Gary's
rows live on a deployed branch, and `vercel env pull` is banned repo-wide, so
this is a console read and it is Gary's to run. **It is owed, and it is listed
under KNOWN OPEN below.**

### THE FINDING BUG-14 PRODUCED, AND THE RULING IT FORCED

**The validator certified overnight rows clean, and the engine throws them
away.** `labor-plan.ts:273` admits a stored window only when
`s != null && e != null && e > s`, otherwise falling through to sales inference.
`parseHourStart("22:00")` is 22 and `parseHourEnd("02:00")` is 2, so every
overnight row fails. `parseHourEnd("00:00")` is 0, so an ordinary **midnight
close** fails too. The row saves, the dialog displays it, and the engine runs on
a window nobody typed.

**Three parts of the system disagreed about one row.** The dialog promises
overnight works; the write route declines to order-check *because* of that
promise; the new validator asserts overnight is clean on both lists; the engine
discards it. The validator is not wrong — **"clean" means the EDITOR accepts the
row, not that the ENGINE uses it**, and those were assumed to be the same
predicate when the rule set was written.

**Gary ruled it the same day** (`docs/DECISIONS.md` § "Overnight hours are a
business day cutoff, and the model is ruled now"): overnight hours ARE supported,
the dialog's promise stands, and the mechanism is a per-store **business day
cutoff** defaulting to midnight, which must agree with Square's or it does not
ship. **The build is deferred to `CUTOFF-1`** (phase, TIER 3, `planned`) and
waits for a real store that crosses midnight.

**NONE OF THAT IS IN THIS PROMOTION.** What ships is the measurement and the
ruling. The surfacing work, the `00:00` parse fix and the cutoff itself are all
after this merge.

### TWO RATIFIED RULINGS SHIP AHEAD OF THEIR BUILDS, AND A READER AT `main` WILL FIND BOTH

This is the one thing about this payload that could mislead someone reading
`DECISIONS.md` at `main` and looking for the code.

- **"Manager on the floor — one guaranteed number"** (`ddba758`) is ratified and
  its copy is approved (`a8b7ab2`), but **the build did not happen.** It is
  Phase 3 of the 2026-08-23 session and it was gated on exactly this promotion:
  R7-D pushed, staging level with main. It runs after the merge, not before it.
- **"Overnight hours are a business day cutoff"** (`2871c19`) is ratified and
  deliberately unbuilt — that is the ruling's own content, and `CUTOFF-1` carries
  the deferral with a named trigger.

The first is *not yet built*; the second is *ruled not to be built yet*. They
look identical in the log and they are not the same state.

### Rollback — the BUG-14 half

```
git revert -m 1 <merge sha>
```

Same single revert as the R7-D half; there is one merge. **Still no migration,
no schema, nothing to un-drop, and no rows written under the new behaviour** —
the validator persists nothing. Reverting restores an editor and a write route
that accept `B1`/`B2` rows in silence. **Any bad row an operator FIXED while the
validation was live stays fixed**, because those are ordinary `StoreHours`
writes; the revert removes the guard, not the corrections.

### Known open at promotion — added by this amendment

The R7-D list above still stands in full. These are additional.

- **BUG-14 (`in_progress`) — the surfacing work is FIRST on the row and is not
  in this promotion.** A discarded-row check keyed to the ENGINE's admission rule
  (`labor-plan.ts:273`) rather than the editor's, visible where the hours are, so
  a store whose typed hours are being ignored says so on screen. Until it lands,
  an operator entering a real overnight window still gets a successful save and
  hours that drive nothing — which the dialog's promise makes worse, not better.
- **The deployed sweep is OWED and is the other half of BUG-14.** Neon console
  export → `scripts/sweep-store-hours.ts`. Gary's to run. Two real errors are
  known to be in the data — a Mon–Fri `08:00`–`08:00` and a Sunday `01:00` open —
  and neither is corrected by this promotion.
- **The `00:00` parse fix is NOT in this payload.** `parseHourEnd("00:00")` must
  yield 24, not 0. It rides Phase 3. Measured at HEAD: `parseHourEnd` is exported
  but has exactly ONE consumer in the tree, so it is a one-line blast radius.
- **`CUTOFF-1` (`planned`)** — the business day cutoff, TIER 3, opening with an
  audit whose first task is the Square question: does Square expose a
  business-day cutoff, and what does it attribute a 1am sale to? If Square does
  not own it, that is a larger decision than the ruling settles.
- **A line-number drift is recorded rather than repaired.** BUG-14's prose cites
  `labor-plan.ts:272` three times for the admission rule; `:272` is the
  `parseHourEnd` call and the predicate is `:273`. Named on the row and in the
  ruling, not edited, because that prose is a claim.

### Post-deploy check — the BUG-14 half

A glance, not a procedure, and it is a **two-minute UI check, not a query.**

Open **Stores → any store → Hours**. Expect the dialog to render as before with
validation attached. Then, on a store you are willing to touch:

1. Set one day's open and close to the **same time** and try to Save. Expect Save
   **disabled** with `B1` named against that day. Expect the same rejection from
   the API (400) if it is reached directly.
2. Clear **one** of the two boxes on a day. Expect `B2` naming the **empty box**,
   not the day — that was a deliberate fixture correction, recorded on the row.
3. Enter a legitimate **overnight** window, say `22:00`–`02:00`. Expect it to save
   **silently and successfully** — no block, no warning. **That is correct today
   and it is also the open defect**: the engine will ignore it. Do not read the
   clean save as the engine accepting it.
4. Enter a day under 4h or over 16h. Expect a **visible warning and a working
   Save** — warnings never block.

**Gary's two real errors are the live test.** Fixing them in the UI is the first
exercise of the new behaviour and is the reason no data was corrected here.

## 35d002a — 2026-08-22 — R7-C: per-person salaried allocation, exempt, and the absent-means-zero re-baseline

**Merge SHA:** `35d002a2d466e9d0dff853b37de87d76b0b3efca`
**Payload:** 19 commits, `9baaa55`..`3d95df5` (staging → main, `--no-ff`)
**Prior main tip:** `7ab8525`
**Diff:** 31 files, +6,590 / −10 · two additive migrations
**Signed manifest:** `docs/prompts/r7c_production_manifest_2026-08-22.md`

### THIS PROMOTION DELIBERATELY MOVES NINE STORES

Not an invariant-holding deploy. One org-wide `LaborPosition` archetype — General Manager, SALARIED, $20/hr, 40 implied weekly hours — charged every store $800/week for a manager who does not work there. Nine production stores carried it.

Exactly one salaried person works in stores: Kristie Connolly, $52,000/yr = $1,000/wk, 40 hrs, split 50/50 between Las Brisas and UNR. Kelton Thomas, Karson Thomas and Taylin Thomas are executives Square forces onto store rosters and who must never be counted.

Estate-wide: **$7,200/week of phantom salaried cost becomes $1,000/week of real allocated cost.** The $6,200/week difference becomes hourly hours — roughly $322,000/year moving from an archetype nobody staffs into hours a store can actually schedule. UNR's hourly pool goes from 13.5 hours a week to 34.0.

Cafe De Keva Cart and Keva Kiosk carry no forecast and do not move.

### What shipped

- **R7-C** — `LaborSalariedPerson` and its allocations, a NEW FROOT TABLE keyed by `squareTeamMemberId`. Not columns on `SquareTeamMemberWage`: dropping every Square-labor table must leave salary, hours, exempt and allocations intact, so L-2's boundary test passes verbatim and needs no restatement. Karson and Taylin have no `StaffMember` row and were not imported — importing manufactures HR obligations to solve a labor problem.
- **weeklySalary is Froot-owned**, seeded once from Square's `annualRate ÷ 52` and never live-synced. `squareAnnualRateSeen` records what Square said so a divergence can be shown and never acted on. Reading `annualRate` live would let a Square wage edit move two stores' budgets with nothing on screen.
- **The 100% invariant** is enforced at write, on the whole person atomically, so a half-edited person is unreachable rather than validated against. Read asserts and never normalises: a stored non-100% set allocates exactly what is stored and raises `hasIncompleteAllocation`, rather than silently rebalancing 50/40 into 55.6/44.4 the way `LaborDaySplit` does.
- **Exempt** gates who enters allocation. An exempt person is outside the system, not allocated 0%. NULL means not reviewed and PARTICIPATES.
- **The NULL bug (12a0738).** `exempt: { not: true }` emits SQL `exempt <> true`, and `NULL <> true` is NULL — so every unreviewed person was silently dropped from the engine while the card rendered them correctly. Prisma's negation is not NULL-aware on a nullable Boolean; `NOT: { exempt: true }` fails identically. The only correct spelling is an explicit `OR`, and the four-way comparison table sits at the call site.
- **R7-B — `LaborPositionStoreHours` is RETIRED** by Gary's allocation ruling: a per-store hours declaration is a hand-typed derived figure. Preserved and marked, never dropped, never read. Its migration still ships and the table ships empty. The SALARIED archetype row must NOT be deleted — a live `onDelete: Cascade` would silently cascade-delete every declaration row.

### Verified on staging before promotion

Kristie entered at $1,000/wk, 40 hrs, 50/50. Las Brisas landed at 213.5 hourly hours and UNR at 34.0, both with `salariedCost` 500 and `salariedHours` 20 — matching staging's manifest exactly. Carson, Meadowood and South Reno did not move, so one person's allocation reached only her own stores. `blendedHourlyRate` stayed 14.5 everywhere.

The UI blocks a non-100% allocation outright — "Totals 90.00% — must be exactly 100%", Save disabled. The never-normalise read path is the backstop for a direct API write and is fixture-proven only.

Three exempt people render no allocation rows and cannot be allocated.

Production's numbers differ from staging's because forecast goals are per-environment: staging had 5 budgeted stores of 12, production has 9 of 11, and Las Brisas' conservative sales differ. The signed manifest was computed against production's own BEFORE capture, not staging's.

### Production sequence

Kristie's allocation cannot exist before the code, because the tables and the card ship with it. The window between deploy and data entry is accepted and closed by hand: enter Kristie and mark the three executives exempt immediately after the deploy reads Ready. During that window Las Brisas and UNR read as though a real manager vanished; the other seven stores are already correct.

### Rollback

    git revert -m 1 35d002a2d466e9d0dff853b37de87d76b0b3efca

The migrations are additive, so a code revert leaves both tables in place, unread and harmless. Do not drop them. Reverting restores the phantom $800/week at nine stores.

### Known open at promotion

The GM on-floor window stays per-store, so Las Brisas and UNR each draw Kristie's band from their own settings on the same days, each capping at its own 20 hours independently — hours correct, coverage shape not (L-4, filed). DEBT-80 (day-split drift) · DEBT-81 (guaranteed hourly minimums) · DEBT-82 (verify-f5-polish nondeterminism) · BUG-6 and DEBT-28 still reading `staging` from older promotions · S5-D15..D17 unrecorded · `/api/cron/labor-scheduled-shifts` shipped but unscheduled.

## c183331 — 2026-08-21 — Roster hours editor (BUG-11, BUG-12) + forecastExempt ruling and R7

**Merge SHA:** `c1833313a29b63adf11be5d9e20b744f9797599d`
**Payload:** 6 commits, `4ef2cea`..`041bfaa` (staging → main, `--no-ff`)
**Prior main tip:** `3d10d46` (overlay track promotion, same day)
**Diff:** 7 files, +1,229 / −35 — no schema, no migration, no env, no cron

### What shipped

- **BUG-11** — WK HRS on `/settings/labor` → Positions appeared inert. Three causes stacked: Square's `weekly_hours` was the input's placeholder, so an empty box displayed a grey 40 exactly where a typed value sits and could not be deleted; a same-value guard compared `null === null` so clearing an already-unset field never issued a request; and the error branch was cleared by the `load()` that followed it, so a failed PATCH reported nothing. Square's figure now renders beside the box, never inside it.
- **BUG-12** — explicit per-row Save. Enter commits the focused row, blur also saves, `0` is a savable value distinct from blank, and each row reports Saving / Saved / Not saved. New `src/lib/labor-roster-hours.ts` (client-bundle-safe) holds the parse and the PATCH schema so fixtures import the same code the UI calls.
- **forecastExempt** — Gary's ruling ratified into DECISIONS.md: forecast participation is a property of the person, not of an hours value. The audit that followed found the flag would suppress nothing.

### R7 — opened, unruled

`weeklyHoursOverride` has five touch points and none reach a calculation: the column (`schema.prisma:2606`), the sync that omits it (`labor-roster.ts:230`), the read (`labor-roster.ts:370`), the write (`route.ts:65`), and the settings card. `getStoreRoster` has one caller.

The forecast engine cannot read a person even in principle. `labor-plan.ts:150`'s eight reads are sales caches, store, laborPosition, laborDaySplit, laborDayAdjustment, weeklyDayHours, storeHours. The three core engines (`labor-budget`, `labor-coverage`, `labor-daily`) contain no prisma reference at all. `budget.salariedHours` sums `LaborPosition` rows only (`labor-budget.ts:74-77`) — org-wide archetypes with no `storeId` and no relation to `StaffMember`.

So a `forecastExempt` flag would leave every forecast figure byte-identical while displaying a badge asserting an effect that does not exist. What is actually in the arithmetic is one org-wide row — General Manager / SALARIED / `impliedWeeklyHours: 40` — applied to every store, naming nobody.

**R7 is open with no recommendation.** Gary's ratified ruling is implementable only if the forecast gains a per-person input, which crosses L-2 seam (b) (DECISIONS.md 2026-08-05). Two rulings disagree; that is Gary's to settle. `StaffMember.isCorporate` already exists and would need settling alongside. Kristie Connolly's split across Las Brisas and UNR is unexpressible under every option but the per-person one.

### Field verification (staging, 2026-08-21)

Kelton Thomas at Las Brisas renders an empty box with "Square 40" beside it. Typing a value and saving persists it. Clearing to blank persists as blank. `0` saves and reads back distinct from blank. Enter commits the focused row without a click. Per-row status text observed ("Saved" on Karson Thomas).

Note: the first verification pass was run against production by mistake and reported the fixes as failing. The `~staging` badge is the tell — fourth recorded instance of this trap.

### Rollback

    git revert -m 1 c1833313a29b63adf11be5d9e20b744f9797599d

No schema change, so a revert is clean.

## 3d10d46 — 2026-08-21 — Advanced Labor schedule overlay track (OVL-S2…S5 + CRON-1 + BUG-10)

**Merge SHA:** `3d10d461fdec2cdfe241fc20a833dbde7e109a79`
**Payload:** 29 commits, `a56a2e8`..`8f763da` (staging → main, `--no-ff`)
**Prior main tip:** `3cec6b8` (docs-only)
**Diff:** 38 files, +9,046 / −60

### What shipped

- **OVL-S2** — Square scheduled-shift ingest. New tables `SquareScheduledShift`, `SquareScheduleSyncState`, `SquareJobColor`; `src/lib/labor-schedule.ts`. Fetch protocol is law: one location per request, weekly windows, cursor never followed, limit 50, `assertFilterApplied` tripwire. Square's `ScheduledShift` pagination is silently lossy.
- **OVL-S3** — Coverage card overlay. Scheduled|Clocked-in toggle, per-position colours (deterministic + `SquareJobColor` override, editor at `/settings/labor`), `labor.schedule.view` capability (OPERATIONAL, deniable, STORE-visible by default).
- **OVL-S4** — `/labor` scheduled-vs-suggested comparison, legend click-to-toggle, clocked-in roster popup (three-field contract; `squareTeamMemberId` never on the wire).
- **CRON-1** — `/api/cron/labor-timecards` activated in `vercel.json`, `30 11 * * *` (11:30 UTC / 4:30a Pacific). Vercel crons fire on Production only — this promotion is its first live run. `CRON_SECRET` held by Gary. Payload also carries `/api/cron/labor-scheduled-shifts`; confirm whether it is scheduled.
- **BUG-10** — late clock-outs after the day's final dashboard-triggered sync froze as phantom opens (Las Brisas Aug 19; UNR still carrying one at 22.9h as of promotion). The cron is the systemic fix and flips on this deploy.
- **OVL-S5** — Day Inspector at `/labor/inspector`. Per-person daily timeline with ghosted schedule behind, six variance flags, manager/admin only via `labor.manage`, read-only, no wages, no break rendering.
  - **A12** — NO-SHOW gains an evaluation horizon: `shift.start + 20min <= min(now, lastTimecardSyncOkAt)`. Fixes false no-shows on shifts not yet started and on windows the sync had not reached.
  - **A13** — explanatory notices composed server-side into `notices: {code,text}[]`; the client maps and filters nothing. Closes the class where a correct payload field is unreachable because its render condition lives where no fixture looks.

### Schema

S2's migration `20260820170000_ovl_s2_scheduled_shift_ingest` rides this deploy. Additive only — no column drops, no hard deletes. Staging and production Neon branches are separate; code promotion migrates no data. Production `SquareScheduledShift` and `SquareTimecard` start empty and accumulate from the first sync.

### Production env — verified before merge

`SQUARE_LABOR_AVAILABLE=true` · `LABOR_MODULE_AVAILABLE=true` · `CRON_SECRET` present. `SQUARE_LABOR_INTERNAL_ORG_IDS` not needed — `SQUARE_LABOR_AVAILABLE` is the direct path. Without these the cron returns `ok:true, stores:0`, which reads as success.

### Field verification (staging, 2026-08-21)

Proven live with real data: A1 unbounded open-card read with `startedOn` labelling across day boundaries · OPEN-STALE on a 22.9h phantom · A12 suppression (zero false no-shows at 07:17 with three future shifts) · A13 horizon sentence rendering with store-local timestamp · a genuine NO-SHOW firing (Meadowood Mall, Aug 20) · UNMAPPED · UNSCHEDULED · paid totals · both per-store freshness stamps · reconciliation sentence · per-position colours · unassigned shifts firing no NO-SHOW · single Las Brisas in the picker (DEBT-78 fossil absent) · chip/roster/curve agreement on the dashboard.

Fixture-proven only, recorded as gaps: DOUBLE overlap rendering (no real overlapping pair exists in staging data) · stale-sync suppression render · capability-denied renders · the unassigned-shift notice variant.

### Rollback

    git revert -m 1 3d10d461fdec2cdfe241fc20a833dbde7e109a79

`-m 1` keeps main's side as the parent. The migration is additive, so a code revert leaves the new tables in place, unread and harmless. Do not drop them.

### Known open at promotion

DEBT-75 · DEBT-76 (hr8 fixture, exactly nine known failures) · DEBT-77 · DEBT-78 (duplicate unlinked Las Brisas Store row; inspector picker filters it, other pickers do not) · DEBT-79 (cross-store DOUBLE not implemented) · S5-D10 (two independent 40s: `WEEKLY_GM_CAP_HOURS` hardcoded vs `budget.salariedHours` summed — they agree at UNR by coincidence) · the GM-hours whole-crew ruling ratified but not built (thirteen surfaces, audit filed) · vocabulary defect: "Recommended" / "Suggested" / "the forecast" all name the same chart while "Forecast" elsewhere is a dollar amount · UNR past-day coverage window terminating at the old close time (Q2, unaudited) · deletion-blindness `labor-actuals.ts:749-753` still theoretical and unruled.

---

## 3cec6b8 — 2026-08-20 — Docs-only: S1b schedule-overlay rulings + CLAUDE.md corrections

Promotion merge `3cec6b8` (`--no-ff` from `staging`, subject "promote: S1b
schedule-overlay rulings + CLAUDE.md corrections (docs only)"), pushed
2026-08-20. **DOCS ONLY — no code changes, no migration, production behavior
unchanged.** Three files: `CLAUDE.md`, `docs/DECISIONS.md`, and one new file
under `docs/prompts/`. Nothing touches `prisma/`, so the Vercel build's
`migrate deploy` is a no-op and no schema change reaches any Neon branch. No env
var, no cron, no webhook, no `GoalPlan` data — nothing to regenerate per
environment, and nothing to check on the site afterwards.

**Commits carried — THREE, not the two the promotion was described with.**
`git log fec487f..3cec6b8` is the authority and it lists:

- `6e1510f` — the staging probe exception ruling, recording Gary's one-time,
  narrow exception to the Neon-console-only rule so the S1b `ScheduledShift`
  probe could read the staging org's id and `squareAccessToken` in a single
  SELECT and use that token for read-only Square calls. Scope limits are part of
  the ruling; it covers that probe only.
- `0f8706c` — the S1b rulings entry (effective shift = published else draft;
  `SquareJobColor` keyed `(organizationId, squareJobId)`; shift notes synced but
  never selected into an overlay payload; the fetch protocol as law — one
  `location_id` per request, windows sized to never paginate, the cursor never
  followed, `limit` cap 50; `is_deleted` tombstones filtered on read), the two
  `CLAUDE.md` corrections, and the filed S1 scout prompt.
- `de8e7cf` — the original schedule/actual overlay scope rulings, **which had
  not previously reached `main`** and rode along on this push. It was written
  before the S1b session and was not named when this promotion was described.
  Named here because that is what this log is for.

**What the `CLAUDE.md` corrections change for a reader.** Both are marked
`(corrected 2026-08-20)` in place. The Square Integration bullet claimed
`TIMECARDS_READ` and `TIMECARDS_SETTINGS_READ` were "deliberately DORMANT"
because `SQUARE_VERSION` was "still pinned at `2024-01-17`" — below the
`2025-05-21` floor the Timecard endpoints require. SQ-VER-1 cleared that floor
months ago (`src/lib/square.ts:13` is `2026-01-22`) and `labor-actuals.ts` has
been reading timecards on that scope in production since; scheduled-shift reads
ride the same one, verified against the live grant on 2026-08-20. The stale
paragraph would have told a future session that a shipped feature was
impossible. `TIMECARDS_SETTINGS_READ` is genuinely still unread by any code, and
the consent-economics reasoning is kept as the standing rule for future scopes.
Separately, the Environment Variables section called the `vercel env pull` ban
total, which contradicted the exception recorded in `6e1510f`; it now points at
it and restates that the exception covers that one probe only.

**The merge was AMENDED before it was pushed.** Its first message was reused
from the `248a80b` promotion and named the wrong work. The amend rewrote the
message only — same tree, same parents. **`3cec6b8` is the only SHA that ever
reached the remote**, so a reader reconciling push history will not find a
superseded merge SHA and should not go looking for one.

**This entry cannot carry its own SHA.** It is a docs commit on `staging` made
after `3cec6b8`, so like the `248a80b` bookkeeping commit above it, it needs its
own follow-up merge to reach `main` — resolvable as the commit above this entry
in `git log --oneline -- docs/DEPLOY_LOG.md`. **`main` therefore reaches
production one merge ahead of `3cec6b8`.**

**Rollback:** `git revert -m 1 3cec6b8`. Reverting is docs-only and cannot affect
running code; it would restore the two stale `CLAUDE.md` paragraphs and remove
three rulings from `DECISIONS.md`, which is the reason not to.

## 248a80b — 2026-08-20 — Same-day coverage shape fix + the ruling that governs it (BUG-9, POLISH-1, DEBT-75 filed)

Promotion merge `248a80b` (`--no-ff` from `staging`, subject "promote: same-day
coverage shape fix + ruling addenda (BUG-9, DEBT-75)"). **EIGHT commits, and the
merge subject names only two rows — so this entry names all eight**, which is the
half a merge message does not carry:

- `7f1fb3b` — BUG-9 work. `getDemandShape` classified `date <= today`, so the
  current day took its own `SalesHourlyCache`, which holds only ELAPSED hours;
  the pure coverage engine then spread the whole day's hourly budget across the
  morning. Boundary is now `date < today` (store-local) → that date's own cache,
  `date >= today` → the 4-week same-weekday template. The template walk-back also
  moved to start at YESTERDAY, so no window contains today's partial day —
  a deliberate output change for future days sharing today's weekday, ratified
  by Gary in the addenda below. Hours/budget/split untouched.
- `366839b` — the BUG-9 row.
- `41f9fab` — DECISIONS.md addenda (completed-weekday window, last-year fallback
  held binding, shape-source labeling deferred to the overlay), the DEBT-75 row,
  and the bookkeeping prompt filed.
- `04d79e1` — the original same-day ruling + the fix session prompt.
- `0e9d6cb` — POLISH-1, display-only: the Monthly Goal card's MTD labor % now
  reads at the size of the extrapolated month-end figure (`prominent` prop on
  `LaborPctLine`, default false, one call site). **Its row did not exist when
  this merge was made** — filed 2026-08-20 in the bookkeeping commit below.
- `50833fe`, `aded82d`, `cbc35e1` — docs/roadmap only: session prompts filed,
  L-2 marked shipped (5e2f4d7) with CRON-1 filed and the phase map moved to
  production, and BUILD-3 filed as withdrawn.

**Rows this promotion moves:** BUG-9 → `shipped` (2026-08-20), POLISH-1 → filed
and `shipped` (2026-08-20), DEBT-75 → filed `planned` and NOT built — the
last-year same-weekday fallback is ruled binding and still absent, so a store
with fewer than four completed same-weekdays in cache still gets "No sales shape
to project" after this deploy. That is a known, recorded gap, not a regression
from this promotion.

**A DOCS FOLLOW-UP MERGE RIDES THE SAME PUSH.** The three row/log changes above
are not inside `248a80b` — they are one bookkeeping commit on `staging`, merged
to `main` as "promote: deploy bookkeeping for 248a80b". Neither that commit nor
that merge can carry its own SHA here; both resolve as the two commits above
this entry in `git log --oneline -- docs/DEPLOY_LOG.md`. **`main` therefore
reaches production two merges ahead of `248a80b`**, and a reader reconciling the
push history should expect both.

**NO MIGRATION.** Nothing in the eight commits touches `prisma/`, so the Vercel
build's `migrate deploy` is a no-op on this promotion; no schema change reaches
any Neon branch. No env var is added or changed, no cron or webhook is touched,
and no `GoalPlan` data is involved — nothing to regenerate per environment.

**Standing note: nothing new is owed.** No bullet has been added to the section
below since 2026-08-15, that one was discharged by the 2026-08-17 retroactive
entry, and the docs-only merges were reconciled by `90a8eca` on 2026-08-18.

**Post-deploy check** (a glance, not a procedure): the dashboard Labor Coverage
card for TODAY should render a full-day curve with an afternoon peak rather than
a morning-loaded one flattening to 1 after the current hour, and it should not
change shape as the day goes on. Same curve in the Weekly Plan day detail, which
rides the same route. The Monthly Goal card's labor % should read at the larger
size; the All Locations summary should be unchanged.

**Rollback:** `git revert -m 1 248a80b` (revert the bookkeeping merge first if it
is already in, or accept that the rows will read `shipped` against reverted
code and fix them in the same session).

## 5e2f4d7 — 2026-08-19 — Advanced Labor Phases 1–3

Promotes the full Advanced Labor build: AL-1 (be705a2), AL-2 (8a28f61, f47e3bd), AL-3 (fa86bae). Staging verified 2026-08-19: roster renders real names/pay post staff-import, seam holds toggle-off, STORE privacy check passed (tommy@keva.com saw no wage/tips). Post-deploy: SQUARE_LABOR_AVAILABLE=true on Production, enable Advanced Labor, staff import + roster/timecard syncs per store, repeat STORE privacy check on production.

## 90a8eca — 2026-08-18 — Square read-only + labor scopes + version 2026-01-22
Promotes the full Square track: read-only ruling enforced (write-back removed),
TIMECARDS_READ + TIMECARDS_SETTINGS_READ added to the OAuth request,
SQUARE_VERSION bumped to 2026-01-22 at all three sites (two hardcoded literals
replaced with the shared constant), and the /api/square/labor/verify probe.
All four staging checks passed 2026-08-18, including the first successful
labor read ({"ok":true,"httpStatus":200,"hasData":true}).
Post-deploy: production re-consent required (six permissions), then the same
four checks on usefroot.com.
Per the standing note below: this promotion also reconciles the docs-only
merges 65abb74 and f318d2e (2026-08-10) and the staging docs commits they
carried, which had no entries of their own.
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
- **Added 2026-08-15 (HR-11j signed-truth session).** The next real PRODUCTION
  promotion's entry must also name this session's commits, since only one of
  them is a work commit and the rest would otherwise ride in unnamed:
  `32205a4` (R1 work), `2afcf0f` (R4 gate + A3 guard + Q2 copy + the CLAUDE.md
  rule) — both work commits, listed so the reconciliation list stays the one
  complete place — plus the docs-only commits `887ee14` (session prompt + Item 1
  audit), `72e4adc` (the reproduction fixture PDFs, ~30 MB, a permanent
  addition to every clone), `c15b54d`, `717f37b`, `17524c0` and `523a35a` (the
  four HR-11j recorder commits), and the commit that adds THIS LINE, which
  cannot carry its own SHA and resolves as
  `git log --oneline -- docs/DEPLOY_LOG.md`.
- **DISCHARGE, added 2026-08-16 (BUG-7 closure + DEPLOY_LOG reconciliation
  session).** Extending the list by dated line per the preserve-and-mark bullet
  above; **nothing above is edited or deleted.** Every obligation this section
  carried is marked below against the retroactive entry that now names it. The
  promotions were all fast-forwards and all five entries were written on
  2026-08-16, three to five days after the fact.
  - **Discharged by the *2026-08-11 (morning)* entry, promotion `882d6c3`:**
    `65abb74` and `f318d2e` (the two 2026-08-10 docs-only `--no-ff` merges —
    named by the first real promotion to follow them, which is what the
    obligation asked for); `35a25c6` (training audit + session prompt);
    `683d33a` (the 2026-08-10 training-filing docs commit, which could not
    carry its own SHA); `0a745c3` + `bf42bae` (HR-20 work + docs);
    `a56c905` + `a369107` (HR-21 work + docs); `bd63da7` + `0273c98` (HR-22
    work + docs).
  - **Discharged UNMET, same entry:** the HR-20 bullet asked the promotion entry
    to *confirm the `20260810194426_hr20_training_category_entity` applying-line
    in the production build log*. It was not confirmed at the time and cannot be
    reconstructed retroactively. **Marked discharged-as-unmet rather than
    quietly dropped** — the obligation was real, it was missed, and recording it
    as met would be false.
  - **Discharged by the *2026-08-12 (midday)* entry, promotion `b853787`:**
    `cc75949` (training access audit, docs-only); `f5d2883` + `5c01807` (HR-25
    work + docs); `0b1cf51` + `0ec4f20` (HR-24 work + docs); `7048504` +
    `1892b3a` (HR-26 work + docs). **The promotion-order constraint those three
    bullets carried — HR-24 not ahead of HR-25, transitively HR-26 — HELD:** all
    three rode one promotion and HR-25 is the oldest commit in it. All three
    were named as access-control changes on a confidential-content surface, as
    instructed.
  - **`HR_MODULE_AVAILABLE` — READ THE *2026-08-12 (midday)* ENTRY BEFORE
    REPEATING THE CLAIM THAT HR IS DARK IN PRODUCTION.** It is not, and has not
    been since 2026-07-24. That correction is recorded on that entry.
  - **STILL OPEN — the 2026-08-15 HR-11j bullet is NOT discharged.** All eight
    of its commits (`32205a4`, `2afcf0f`, `887ee14`, `72e4adc`, `c15b54d`,
    `717f37b`, `17524c0`, `523a35a`) were checked against `origin/main` on
    2026-08-16 with `git merge-base --is-ancestor`: **none is on production.**
    They remain on staging awaiting a promotion, and that obligation carries
    forward to whichever entry records it.
  - **WHAT THIS SECTION DID NOT CATCH, which is worth more than what it did.**
    Two of the five promotions — `ce036f9` (DOC-1 A/B/C, including a migration
    and an access-control change) and `06dc830` (BUG-6, BUG-7, F-4's production
    webhook) — carried **no standing-note obligation at all**, because the
    sessions that produced them never added a bullet here. This list only ever
    contains what someone remembered to write into it, so **it cannot be read as
    a complete inventory of what is awaiting promotion.** `git log
    origin/main..staging` can; this section cannot.
- **DISCHARGE, added 2026-08-17 (DEBT-72a board-currency session).** Extending
  the list by dated line per the preserve-and-mark bullet above; **nothing above
  is edited or deleted.**
  - **The 2026-08-15 HR-11j bullet — the one item left STILL OPEN by the
    2026-08-16 pass — is DISCHARGED by the *2026-08-17* entry, promotion
    `7e77ea6`.** All eight commits (`32205a4`, `2afcf0f`, `887ee14`, `72e4adc`,
    `c15b54d`, `717f37b`, `17524c0`, `523a35a`) were re-checked against
    `origin/main` on 2026-08-17 with `git merge-base --is-ancestor`: **all eight
    are now on production**, and all eight sit inside `06dc830..7e77ea6`.
  - **This section now carries no open obligation.** It also carries no bullet
    from any session between 2026-08-15 and today, which is the same gap the
    2026-08-16 pass named at the end of its own discharge: the list contains
    only what someone remembered to write into it, so an empty list is not
    evidence that nothing is awaiting promotion. `git log origin/main..staging`
    is.

## 2026-08-17 — PRODUCTION promotion (HR-11d Phase 1 + HR-11j's R1/R4/A3 + HR-11m + HR-11n Phase A + HR-11o + HR-11k Phase A/B and Case A + DEBT-70a/70b) — RETROACTIVE ENTRY, written 2026-08-17 by the DEBT-72a session

- **Merge SHA:** `7e77ea6` — full:
  `7e77ea6ad213832760685315861b5e1ea13d3fa8`. **A REAL `--no-ff` MERGE, TWO
  PARENTS, DERIVED NOT ASSUMED** (`git rev-list --parents -n 1 7e77ea6`):
  parent 1 `06dc830805254d5225b61ec8cac819366b5d4846` (the previous production
  tip — the 2026-08-14 promotion) and parent 2
  `d65e941b77d6fce666c9098615d4a2c45e8cf74c` (the staging tip).
- **FIRST PROMOTION SINCE `d19cca6` (2026-08-10 evening) TO LEAVE A REVERTABLE
  MERGE ARTIFACT.** The five promotions in between — `882d6c3`, `ec42265`,
  `b853787`, `ce036f9`, `06dc830` — were all fast-forwards and are recorded in
  their own retroactive entries below as "first of five" through "fifth of
  five". Counting every push to `main` in that window rather than every
  promotion gives seven, since the two 2026-08-10 docs-only merges `65abb74`
  and `f318d2e` also sit in it. **`git revert -m 1` applies to this promotion
  again**, for the first time in a week.
- **NO PRE-MERGE TAG WAS CREATED.** `git tag --list "pre-staging-merge-*"`
  returns exactly two tags, `pre-staging-merge-20260724-2107` and
  `pre-staging-merge-20260727-1427`, neither from this promotion. The
  convention is not being followed; recorded rather than asserted either way.
  Parent 1 above is the equivalent anchor.
- **FORTY-SEVEN commits**, `06dc830..7e77ea6` (`git rev-list --count`), oldest
  `7fbf618`, newest `7e77ea6` itself. **Not 48** — the `DEBT-72_promotion_gate`
  prompt said 48 and its audit corrected it; re-measured here and it is 47.
  The range contains one internal merge, `c22ecd8`
  ("merge(staging): reconcile duplicate HR-11o record, local supersedes").
- **THREE TIMES, THREE DIFFERENT EVENTS. All UTC.**
  - **Merge commit written:** 2026-08-17 **02:47:13 UTC** (author and committer
    dates identical; `--date=format-local` with `TZ=UTC`).
  - **Push:** **NOT RECORDED.** Git stores no push time and no reflog entry
    survives for it. It is bounded by the two events either side — after
    02:47:13 UTC and before 02:50:05 UTC — and is deliberately left unstated
    rather than conflated with either.
  - **Deploy — the only one of the three that touched production:**
    2026-08-17 **02:50:05.387 / 02:50:05.776 / 02:50:06.152 UTC**, read from
    `_prisma_migrations` on the Neon `production` branch. The three stamps sit
    inside **765 ms**, which is the batch signature of one `migrate deploy`
    rather than three separate events.
- **ROLLBACK — the three-line recipe, not one line** (WORKFLOW.md §2;
  `git revert -m 1` alone conflicts on `docs/DEPLOY_LOG.md` every time,
  structurally):

  ```bash
  git checkout main
  git revert -m 1 --no-commit 7e77ea6ad213832760685315861b5e1ea13d3fa8
  git checkout HEAD -- docs/DEPLOY_LOG.md   # KEEP the log
  git commit -m "Revert the 2026-08-17 promotion"
  git push origin main
  ```

  Faster posture if the site is actively broken: Vercel → promote the `06dc830`
  production deployment back to current, then revert at leisure. **The three
  migrations stay either way** — reverting the code leaves three unread columns,
  which is harmless; dropping them is a destructive migration against production
  for no benefit.
- **THREE MIGRATIONS, ALL APPLIED TO PRODUCTION**, folder names computed from
  `git diff --name-only 06dc830..7e77ea6 -- prisma/migrations/`:
  - `20260815150000_hr11n_checkpoint_retirement` (introduced by `72df99a`,
    HR-11n Phase A) — `ALTER TABLE "HrDocumentCheckpoint" ADD COLUMN
    "retiredAt" / "retiredByUserId" / "retiredReason"`. Three **nullable**
    columns, no default and none needed.
  - `20260816120000_hr_document_version_requires_reacknowledgment` (introduced
    by `bf7cd28`, HR-11k Phase B / Case A) — `ADD COLUMN
    "requiresReacknowledgment" BOOLEAN NOT NULL DEFAULT false`.
  - `20260816180000_organization_timezone` (introduced by `623acb6`, DEBT-70a)
    — `ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'America/Los_Angeles'`.

  All three are `ADD COLUMN` and nothing else — **additive, no drop, no rename,
  no data movement.** The two NOT NULL columns carry defaults; the SQL was read,
  not assumed.
- **A MIGRATION THIS PROMOTION DID *NOT* CARRY, worth recording because it makes
  a point about DOC-1.** `20260812171500_doc1a_document_audience_grants` has
  been on the production database since **2026-08-13 04:50:22 UTC** — it rode
  the `ce036f9` promotion. So DOC-1's schema and parts of the code that use it
  reached production in **different** promotions. Additive; nothing broke.
- **THIS PROMOTION CARRIED SIGNING-BEHAVIOUR AND ACCESS-CONTROL CHANGES ONTO A
  LIVE HR MODULE, and that is the fact this entry exists to record.** HR is
  **not** dark in production and has not been since 2026-07-24, when
  `HR_MODULE_AVAILABLE=true` was added to the Vercel **Production** scope. Org
  `cf888f2d-f234-48c7-8097-fd5b44b5b3dd` (Keva Juice) runs
  `activeModules = {inventory, labor, hr}` with six non-admin principals.
  **Any note claiming HR is dark in production is stale** — this is the second
  entry to have to say so; see the 2026-08-12 (midday) entry.
- **POST-PROMOTION CHECK, ALREADY RUN AND CLEAN.** Production `HrSignedRecord`
  holds **five rows, five distinct `staffMemberId` values, all
  `signingCycle: 1`.** Two were signed 2026-08-17, after the deploy — **first-time
  signings by two different people, not re-acknowledgments.** Nobody was sent
  back to re-sign by the `requiresReacknowledgment` column landing at
  `DEFAULT false`, which is the one production consequence this promotion's
  schema could have had.
- **STANDING-NOTE OBLIGATION DISCHARGED — the 2026-08-15 HR-11j bullet.** It was
  the only item left open by the 2026-08-16 discharge pass. All eight of its
  commits are now on `origin/main`, each checked with
  `git merge-base --is-ancestor`, and all eight are inside this promotion's
  range: `32205a4` (R1 work), `2afcf0f` (R4 gate + A3 guard + Q2 copy + the
  CLAUDE.md rule), `887ee14` (session prompt + Item 1 audit), `72e4adc` (the
  R1/R4 reproduction fixture PDFs), and the four HR-11j recorder commits
  `c15b54d`, `717f37b`, `17524c0`, `523a35a`. **The standing-note list is now
  empty of open obligations.**
- **What shipped**, by theme — read off the 47 commit subjects, not from memory:
  - **HR-11d Phase 1 — hollow signed records** (`576fc4e` items 2a–2e,
    `6ff7ea6` item 2f, plus `7fbf618`, `2212a1e`, `82713ea`, `a79047a`,
    `5ecceb3`, `9c85651`, `ba1f38b`). The signing path refuses to mint a signed
    record that no checkpoint backs, and the certificate now states which mode
    produced it (R3(ii)). **Phase 2 — the staging browser walk — is not done**,
    and the row says so.
  - **HR-11j — the four rulings** (`32205a4` R1: completion derives from the
    signed record, not checkpoints; `2afcf0f` R4 assignability gate + A3
    ceremony guard + admin-facing refusal copy; docs `887ee14`, `72e4adc`,
    `c15b54d`, `717f37b`, `17524c0`, `523a35a`, `78a045b`). **R1 changes what
    "complete" means on a signing surface** — an access-and-truth change, not a
    display one.
  - **HR-11m — Signature checkpoint duplication** (`974bf49`, `eab6254`,
    `7ee53f5`). Checkpoints are reused across versions by `pageRef` + ordinal
    instead of re-minted.
  - **HR-11n Phase A — checkpoint retirement** (`72df99a`, `26aa21d`,
    `0e49bdb`), with the migration above. Forward-only and reversible; the
    anchor column was withdrawn to Phase B and Phase B is not built.
  - **HR-11o — three certificate/reader display defects** (`7456565`,
    `68c5a2d`, `7198f77`, `6e3b9eb`, `614dc8d`), verified on staging before
    the promotion.
  - **HR-11k / R2 — a prior version's signature satisfies the current one**
    (`457a57f` Phase A, `6b2054f` display follow-ups, `bf7cd28` Phase B /
    Case A with the migration above, `4363e3b` the Case A toggle fix; docs
    `f17010c`, `6abe2f6`, `a4a87d2`, `4d92fe7`; and the internal merge
    `c22ecd8`). **This changes who is asked to sign again**, which is why the
    `HrSignedRecord` check above was run. The row records that the 409 is still
    owed and that Phase B was never observed on staging.
  - **DEBT-70a / DEBT-70b — dates render the store-local day** (`623acb6` the
    inline `Date:` stamp with the `Organization.timezone` migration, `cc144dc`
    the 22 server date displays; docs `b2f6b44`, `71e12ce`, `f7723fe`,
    `d65e941`). Both verified on staging before the promotion.
  - **BUG-7 closed and F-4's blocker resolved** (`165bcb8`, `cecd218`) — the
    same commit that wrote the **five retroactive DEPLOY_LOG entries** for the
    2026-08-11 and 2026-08-12 and 2026-08-14 fast-forward promotions.
- **WHAT THIS ENTRY IS NOT.** It was **not** written between the merge and the
  push, which is what WORKFLOW.md §2 asks for. The promotion ran on 2026-08-17
  at 02:47 UTC and this entry was written later the same day by a different
  session. **Recorded as a gap rather than presented as compliance** — that is
  DEBT-38's exact mechanism, and this is its recurrence in a promotion that
  otherwise did everything right.
- **BOARD CURRENCY AT THE TIME OF THIS PROMOTION — the reason DEBT-72a exists.**
  Three rows this promotion carried (HR-11d, HR-11k, HR-11n) read `in_progress`
  on the board while their code was live in production. Backfilled to `shipped`
  by the same session that wrote this entry; evidence in
  `docs/prompts/DEBT-72a_BACKFILL.md`. Eight further rows were found stale from
  the three promotions *before* this one.
- **TODO: production verification.** No smoke pass against production is
  recorded for this promotion. The `HrSignedRecord` count above is a data check,
  not a walk of the signing ceremony, the certificate, the retirement control or
  the store-local dates on a real production login. Gary's to run and to write.
- **TODO: what the promotion means in Gary's words.** The theme list above is
  computed from commit subjects. The judgement — whether the R1/R2 signing
  changes behaved as intended for the six live principals, and whether anything
  needs watching — is not derivable from git and is deliberately left blank
  rather than guessed.
- **TODO: ruling — whether the missing pre-merge tag matters.** The convention
  has now been skipped on every promotion since 2026-07-27. Either it is dead
  and should be struck from the record, or it should be revived; a convention
  observed twice in three weeks is neither.

## 2026-08-15 — STAGING deploy + HR-11j acceptance pass — NOT a promotion

- **Staging SHA:** `717f37b` — full:
  `717f37bb432778c22c5671edb486a4af1f3ec88b`. Pushed to `origin/staging`
  2026-08-15 by Gary. **`origin/main` remains `06dc830` — nothing was promoted
  to production.**
- **Deployed SHA confirmed** on
  `froot-git-staging-indianathomas-2483s-projects.vercel.app` →
  `dpl_8dqx2ay7Hx3rWAFxqkXgSvTTmUJj` (`froot-gthvkp3w8`), created 2026-08-15
  09:45:13 PDT, READY. Method as corrected on 2026-08-02: `vercel inspect` on
  the alias to get the deployment id, then
  `vercel ls --meta githubCommitSha=<FULL 40-char sha>` returning that same
  deployment. **Confirmed independently by the session rather than transcribed
  from the report of the push** — the entry records it as a claim, so it was
  re-run.
- **Migration applied by the build: NONE.** No schema change was needed at any
  point in this session, and none was written. `prisma migrate deploy` had
  nothing new to replay.
- **What shipped to staging.** R1 — completion status now derives from the
  existence of an `HrSignedRecord` for (version, staff member, signing cycle),
  through one exported pure predicate (`src/lib/hr-completion.ts`) replacing
  six independently written derivations. R4 — a document whose current version
  has detected fields and none confirmed can no longer be granted an audience.
  The staff-portal ceremony gained the readiness guard it never had. The
  signed-record route's refusal copy now branches on whether the caller is
  acting on their own record.
- **ACCEPTANCE PASS — all four checks, verified by Gary on the deployment
  above.** Org `org_3G02wO4QlVVSWppi8aqlnSZnsDa`, Clerk instance
  `verified-snapper-7`, database branch `br-square-feather-a63z92vz` /
  `neondb`. Document `cmstv3r1s000004jxdcyhkbui`.
  1. **R1 regression — PASS.** Gdogg's `/my/documents` shows the document under
     TO SIGN reading "In progress — ask your manager." **The day before, the
     same screen showed it under COMPLETED as "Signed v2" in green.** The check
     was specified as that before/after comparison rather than a lone
     screenshot, because the completion screen is the thing that lied.
  2. **A3 guard — PASS.** Opening the document lands on the refusal screen, not
     the reader. This is the entry point that had no readiness call at all, and
     the one the original signer walked in through.
  3. **R4 gate — PASS.** The assign dialog refuses with "Confirm this
     document's fields before assigning it.", states 10 fields detected and
     none confirmed, links to the confirm screen, and disables Save.
     **Withdrawal confirmed still available** — the block-granting-never-
     revoking invariant held in the browser, not only in the unit sweep.
  4. **R1 positive — PASS.** Tommy's v1 signed record is intact and
     downloadable. Nothing in R1 reached backwards into a record already made.
- **Pre-check measured before the pass**, `preview/staging`
  (`br-square-feather-a63z92vz` / `neondb`), read-only SELECTs run by Gary in
  the Neon console — CLAUDE.md § Environment Variables forbids pulling deployed
  credentials and says read-only is explicitly not an exception. v2 current
  with 0 confirmed / 10 unconfirmed anchors, 7 acknowledgments, 0 signed
  records; v1 with 10 confirmed anchors and 1 record; 7 required checkpoints of
  7 total. Full figures and the predicted surface output are on the HR-11j row.
- **One finding filed, not fixed.** Tommy's row reads "Needs current version" —
  correct under HR-11f and incorrect under R2, which supersedes it. Deliberately
  not reworded: the copy is accurate for the rule the code still implements.
  Filed as `HR-11k`.
- **Unpromoted stack: 17 commits**, `7fbf618..523a35a` inclusive — `7fbf618`
  itself is not an ancestor of `origin/main`. Spans HR-11d Phases 0 and 1 (the
  hollow-signed-record work) and all of HR-11j. The production promotion entry,
  with its own SHA and verification list, is owed separately when that happens.
- **Two commits were unpushed when this entry was written** — `17524c0` and
  `523a35a`, both HR-11j recorders — plus the commit carrying this entry.
  Gary pushes them together with it; the acceptance above was run against
  `717f37b`, and the three that follow it are docs-only.

---

> **THE FIVE ENTRIES BELOW WERE WRITTEN RETROACTIVELY ON 2026-08-16**, in the
> BUG-7 closure session (`docs/prompts/BUG-7_CLOSURE_AND_DEPLOY_LOG_RECONCILIATION.md`
> + Addendum A). They record five consecutive fast-forward promotions — 43
> commits, 2026-08-11 to 2026-08-14 — that reached production with **no entry
> between them**. Reconstructed from `git reflog show main --date=iso` and
> `git log f318d2e..06dc830`, not from memory. This is DEBT-38's **second
> genuine recurrence**; the mechanism is on that row.
>
> **They sit here, below the 2026-08-15 staging entry, because this file is
> reverse-chronological and all five predate it.** The session prompt said to
> put them "at the top of the file"; that instruction was wrong and Addendum A
> § A3 corrected it. Following it literally would have placed Aug-11-to-14
> entries above an Aug-15 one — the same ordering misreading that produced the
> withdrawn DEBT-23.
>
> **Every heading below is dated by the instant `main` MOVED, not by when its
> tip commit was authored.** For four of the five those fall on the same day;
> for `06dc830` they do not, and reading the commit time as the promotion time
> is what put the wrong date in the session prompt. Both times are given on
> every entry.

## 2026-08-14 — PRODUCTION promotion (BUG-6's two fixes + BUG-7's guarded upsert + F-4's production webhook — the sales-sync concurrency system changed in three directions in one push) — RETROACTIVE ENTRY

- **Promotion SHA:** `06dc830` — full:
  `06dc830805254d5225b61ec8cac819366b5d4846`. **`main` moved 2026-08-14
  08:05:16 PT = 2026-08-14 15:05:16 UTC** (PDT = UTC−7; conversion stated per
  CLAUDE.md § Database Evidence). **Its tip commit was authored 2026-08-13
  21:20:08 PT** — the work was finished one evening and promoted the next
  morning, ~10 h 45 m later. This is the one promotion of the five where those
  two timestamps fall on different days.
- **FAST-FORWARD, not a merge.** `ce036f9` is an ancestor of `06dc830` and the
  set is contiguous; no merge commit exists, so **`git revert -m 1` does not
  apply.** Fifth of five consecutive `--no-ff` violations — see DEBT-38.
- **TEN commits**, `ce036f9..06dc830`. Oldest `37361ba`, newest `06dc830`.
- **Rollback = revert all 10 in reverse order**, then push main:
  `06dc830 9021caa 728638d 801dceb 00881dc 588206c 92de25f b77082e cc58ff7
  37361ba`
- **THIS SINGLE PUSH CHANGED THE SALES-SYNC CONCURRENCY SYSTEM IN THREE
  DIRECTIONS AT ONCE**, and that is the fact this entry exists to record:
  - **More racers** — `37361ba` and `b77082e`, BUG-6's two fixes. The poll they
    introduced means one store switch can schedule up to **8** syncs for a
    single store-day where it previously scheduled 2.
  - **A new guard** — `00881dc`, BUG-7's `INSERT ... ON CONFLICT DO UPDATE ...
    WHERE stored.syncedAt < EXCLUDED.syncedAt`.
  - **A new continuous writer** — `06dc830` itself, F-4's production webhook
    subscription, which adds a writer at transaction rate.
  Each was individually reasoned; the combination was not promoted as a
  combination, because nothing in a fast-forward promotion pauses to ask what
  the set does together.
- **`00881dc` WENT TO PRODUCTION WHILE ITS OWN ROADMAP ROW READ `in_progress`
  AND "NOT YET VERIFIED ON STAGING".** Stated as fact, not as objection.
- **THE ORDERING FACT, RECORDED WITHOUT SOFTENING IT.** The `ORDERING:` line on
  the BUG-7 row read: *verify BUG-6 on staging → verify BUG-7 on staging →
  register the Square subscriptions → verify F-4.* BUG-6 **was** verified on
  staging — `728638d` says so and it stands. **BUG-7 was not.** The webhook was
  registered about two hours later anyway (`728638d` 20:25 PT, `06dc830`
  21:20 PT). One missing step in a three-step chain. Nothing was overruled and
  no check was bypassed: the promotion procedure has never read
  `docs/ROADMAP.yaml`, so the gate was never consulted. That mechanism is
  `docs/DECISIONS.md` 2026-08-16 and DEBT-72.
- **HOW IT TURNED OUT, since this entry is written with three days' hindsight
  and hiding that would be its own distortion:** BUG-7 was **verified in
  production 2026-08-16** — ~55 `discarded ... superseded by a newer fetch`
  lines across nine stores, including collisions 70 ms and 270 ms apart — and
  F-4's remaining blocker closed on the same afternoon's evidence. **The
  unverified thing shipped and was right.** That is the outcome, not a
  vindication of the order; the guard could as easily have been wrong, and the
  webhook had by then made the race frequent instead of rare.
- **MIGRATION: NONE.** No schema change in any of the ten commits. BUG-7's fix
  relied entirely on constraints that already existed.
- **Also carried:** `588206c` (the BUG-7 audit, `docs/prompts/BUG-7_AUDIT.md`),
  `801dceb` (the BUG-7 row + `syncedAt` reader audit, recording `00881dc`),
  `92de25f` and `cc58ff7` (BUG-6 recorders), `9021caa` (BUG-6 closure recorder),
  `728638d` (BUG-6 verified and closed, BUG-8 filed).

## 2026-08-12 (evening) — PRODUCTION promotion (DOC-1 A/B/C — document audience grants, the assign dialog, and audience-scoped compliance) — RETROACTIVE ENTRY

- **Promotion SHA:** `ce036f9` — full:
  `ce036f9ba27d3b6a3771f6984d12dbba5b349772`. **`main` moved 2026-08-12
  21:50:11 PT = 2026-08-13 04:50:11 UTC.** Note the date change across the
  conversion: this is an Aug 12 promotion in Pacific and an Aug 13 one in UTC,
  which is exactly the midnight-crossing CLAUDE.md § Database Evidence warns
  about. Tip commit authored 2026-08-12 21:01:07 PT.
- **FAST-FORWARD, not a merge.** `b853787` is an ancestor of `ce036f9`, contiguous,
  no merge commit — **`git revert -m 1` does not apply.** Fourth of five.
- **SEVEN commits**, `b853787..ce036f9`. Oldest `d728da4`, newest `ce036f9`.
- **Rollback = revert all 7 in reverse order**, then push main:
  `ce036f9 bb95ed7 9133dcf 0ebe4d4 e18dd54 3222188 d728da4`
- **What shipped**, by theme:
  - **DOC-1 A** (`d728da4`) — document audience grants and an audience-aware
    read policy. **This is an access-control change on HR documents**, not a UI
    addition, and it is the reason this promotion is not a routine one.
  - **DOC-1 B** (`e18dd54`) — the document assign dialog, visibility toggle and
    audience chips.
  - **DOC-1 C** (`9133dcf`) — audience-scoped compliance denominators.
  - **Docs** (`3222188`, `0ebe4d4`, `bb95ed7`, `ce036f9`) — the three DOC-1
    audits, roadmap rows, permissions rows, the migration entry, and the DOC-1
    session prompts and working drafts.
- **MIGRATION — one, applied on this promotion:**
  `20260812171500_doc1a_document_audience_grants`. Additive. Applied to
  production by `prisma migrate deploy` during the Vercel build. **The build
  log's applying-line was NOT confirmed at the time** — this entry is
  retroactive and that confirmation is not reconstructable after the fact.
  Recorded as a gap rather than asserted. **On rollback: do NOT drop the
  table/columns** — reverting the code leaves additive schema unread, which is
  harmless.

## 2026-08-12 (midday) — PRODUCTION promotion (the HR-24/25/26 training access-control chain + HR-28 rich text) — RETROACTIVE ENTRY

- **Promotion SHA:** `b853787` — full:
  `b8537876aa0ce787de53d31aa2feeb44c5bb8fa7`. **`main` moved 2026-08-12
  12:33:26 PT = 2026-08-12 19:33:26 UTC.** Tip commit authored 11:58:03 PT.
- **FAST-FORWARD, not a merge.** `ec42265` is an ancestor of `b853787`,
  contiguous, no merge commit — **`git revert -m 1` does not apply.** Third of
  five.
- **THIRTEEN commits**, `ec42265..b853787`. Oldest `cc75949`, newest `b853787`.
- **Rollback = revert all 13 in reverse order**, then push main:
  `b853787 e9a717c 985507f 340f99b 964b906 142e858 1892b3a 7048504 0ec4f20
  0b1cf51 5c01807 f5d2883 cc75949`
- **THREE ACCESS-CONTROL CHANGES ON A CONFIDENTIAL-CONTENT SURFACE**, which the
  standing note above insisted the promotion entry say rather than listing them
  as training tweaks:
  - **HR-25** (`f5d2883`) — completed training **stops** being served its
    attached files. A narrowing.
  - **HR-24** (`0b1cf51`) — **STORE** admitted to the training library as a
    reader: `requireHrTrainingReadAccess`, a new trimmed `GET
    /api/hr/training/library`, authoring affordances suppressed behind
    `canManage`. A widening.
  - **HR-26** (`7048504`) — **MANAGER** admitted as reader and assigner. A
    second widening, extending HR-24's guard and route.
- **THE PROMOTION-ORDER CONSTRAINT WAS SATISFIED.** The standing note required
  that HR-24 not reach production ahead of HR-25, transitively including HR-26,
  and that "one promotion carrying all of them, or HR-25 first" were the only
  correct orders. **All three rode this single promotion, and within it HR-25 is
  the oldest commit.** Both conditions hold. Recorded explicitly because it was
  satisfied by the build order rather than by anyone checking at promotion time —
  no fast-forward promotion in this set consulted a constraint written in a
  document.
- **CORRECTION TO A CLAIM MADE ABOUT THIS PROMOTION, and it is the reason this
  entry is longer than its siblings.** The session prompt that commissioned
  these entries stated that the HR access-control work reaching production
  unlogged was "a **governance failure, not a live exposure**", because "HR is
  dark in production (`HR_MODULE_AVAILABLE` unset)". **THAT PREMISE IS FALSE.**
  `HR_MODULE_AVAILABLE=true` was added to the Vercel **Production** scope on
  **2026-07-24** — nineteen days before this promotion — and the fact is
  recorded in this very file, in the *2026-07-24 — PRODUCTION promotion (HR-11b
  + HR-11c) + HR LAUNCH* entry below, under the heading **HR LAUNCH**. So these
  two widenings reached a **LIVE production HR module**, gated only by each
  org's `activeModules` "hr" toggle.
  **What this entry does NOT claim:** that anyone was actually over-served. That
  depends on which production orgs have `hr` active, which STORE and MANAGER
  principals exist on them, and what training content is attached — none of
  which this docs-only session measured, and production reads are Gary's to run
  in the Neon console. **The governance-vs-exposure question is therefore OPEN,
  not answered in the reassuring direction.** It is flagged for a ruling rather
  than resolved here.
- **Also shipped:** **HR-28** (`142e858`) — rich text editor for training module
  descriptions — plus two same-day follow-ups: `340f99b` (keep
  `isomorphic-dompurify` external to the server bundle) and `e9a717c` (replace
  it with `sanitize-html` outright). `964b906` carries the HR-28 row and audit
  artifact; `b853787` corrects the HR-28 fix claim. `cc75949` is the training
  access audit (`docs/prompts/2026-08-11_TRAINING_ACCESS_AUDIT.md`), docs-only.
- **MIGRATION: NONE.** HR-24, HR-25, HR-26 and HR-28 were all code-and-UI only;
  HR-20's entity, unique constraint and `dueDate` already existed.

## 2026-08-11 (afternoon) — PRODUCTION promotion (bulk-assign dialog scroll fix + the CLAUDE.md Session Tiers section) — RETROACTIVE ENTRY

- **Promotion SHA:** `ec42265` — full:
  `ec422654591f3e7b7ec793e1d5b46adbf1e1bd7d`. **`main` moved 2026-08-11
  16:27:24 PT = 2026-08-11 23:27:24 UTC.** Tip commit authored 16:11:02 PT.
- **FAST-FORWARD, not a merge.** `882d6c3` is an ancestor of `ec42265`,
  contiguous, no merge commit — **`git revert -m 1` does not apply.** Second of
  five.
- **TWO commits**, `882d6c3..ec42265`. Oldest `4836912`, newest `ec42265`.
- **Rollback = revert both in reverse order**, then push main:
  `ec42265 4836912`
- **What shipped:** `ec42265` — the HR-22 Bulk Assign dialog no longer scrolls
  past the viewport. `4836912` — the **Session Tiers** section added to the top
  of `CLAUDE.md` (TIER 1/2/3, the what-does-NOT-tier-down list, and the
  one-way-escalation rule). The second is process documentation with no runtime
  effect; it is named because it reached production unlogged like the rest.
- **MIGRATION: NONE.**
- **The smallest promotion of the five**, and worth noting as such: a two-commit
  fast-forward is exactly the size that feels too small to log, and it is
  logged here on the same terms as the thirteen-commit one.

## 2026-08-11 (morning) — PRODUCTION promotion (the HR-20/21/22 training trilogy + the training pre-phase audit) — RETROACTIVE ENTRY

- **Promotion SHA:** `882d6c3` — full:
  `882d6c3e1e36f5b472347ce08020f9c25a41d48f`. **`main` moved 2026-08-11
  10:24:36 PT = 2026-08-11 17:24:36 UTC.** Tip commit authored 09:26:53 PT.
- **FAST-FORWARD, not a merge.** The previous production tip `f318d2e` (full:
  `f318d2e58fe7613802e5af090df1342459fe4622`, `main@{5}`, the last **real**
  merge on this branch) is an ancestor of `882d6c3` and the set is contiguous;
  no merge commit exists, so **`git revert -m 1` does not apply.** **First of
  five** — and the first promotion after `7d984be` made `--no-ff` the rule,
  which is what makes DEBT-38's recurrence a violation rather than a gap.
- **ELEVEN commits**, `f318d2e..882d6c3`. Oldest `35a25c6`, newest `882d6c3`.
  The exclusive range is correct here — `f318d2e` was itself already on
  production.
- **Rollback = revert all 11 in reverse order**, then push main:
  `882d6c3 a4d2637 0273c98 bd63da7 4207be0 a369107 a56c905 bf42bae 0a745c3
  683d33a 35a25c6`
- **What shipped**, by theme:
  - **HR-20** (`0a745c3`) — the `TrainingCategory` entity and its additive
    migration.
  - **HR-21** (`a56c905`, `4207be0`) — Category management UI, badges, filter
    chips, card/list toggle, the three-tab Active/Inactive/Archived partition
    on `/hr/training`, and the Category picker coloured with its badge preset.
  - **HR-22** (`bd63da7`) — bulk training assignment with due-date
    carry-through: the bulk assign route and recipients endpoint, the Bulk
    Assign dialog, and `skipDuplicates: true` on the single-assign POST.
  - **Docs** (`35a25c6`, `683d33a`, `bf42bae`, `a369107`, `0273c98`, `a4d2637`,
    `882d6c3`) — the training pre-phase audit and its session prompt, the
    training filing (rulings R-a..R-f, DEBT-68 filed, HR-23 filed), the three
    board amendments, and the HR-22 follow-up audit that found `skipDuplicates`
    load-bearing and voided its own Phase 2.
- **MIGRATION — one, applied on this promotion:**
  `20260810194426_hr20_training_category_entity`. Additive. Applied to
  production by `prisma migrate deploy` during the Vercel build. **The build
  log's applying-line was NOT confirmed at the time**; this entry is
  retroactive and that confirmation cannot be reconstructed. The standing note
  above explicitly asked the promotion entry to confirm it, and **that
  obligation is discharged as UNMET, not as met.** **On rollback: do NOT drop
  the table** — additive schema left unread is harmless.

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
