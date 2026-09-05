# HELP-1 — In-app help system — TIER 3 — **AUDIT ONLY**

TIER 3: structural. A new route in two shells, a build-time generator, a
sidebar item that trips an existing fixture, a per-request search index, and
static image assets whose auth status is currently unknown.

**This session writes no application code.** It answers questions, reports
findings, and stops. The build is a separate prompt written after Gary reads
this session's output.

Save as `docs/prompts/HELP-1_AUDIT.md`.

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
Tree clean, on `staging`. If anything is off, STOP and report.

---

## What HELP-1 is

An in-app help system covering every surface a user can reach: one article per
reachable route, written prose plus screenshots, searchable, reachable from a
pinned sidebar item and from a contextual `?` in page headers.

**Out of scope for the whole phase, not just this audit:** the onboarding
first-run card, any animated/video content, and the writing of article content
itself. HELP-1 builds the machine; the articles are filled in after.

## Rulings already made (Gary, in chat — **not yet ratified in DECISIONS.md**)

These are inputs to the audit, not questions for it. This session drafts them
as DECISIONS.md candidates; Gary rewrites them in his own words at commit time.

1. **Screenshots come from production, redacted by hand.** Not a seeded staging
   org.
2. **Module-gated articles render as upgrade previews** to orgs without the
   module — Inventory articles are visible to an org that hasn't bought
   Inventory, framed as a preview with a path to plans.
3. **Capability-gated articles stay hidden** from logins that cannot reach the
   page they describe. A STORE or STAFF login does not find compensation
   articles by searching. This is COMP-1's confidentiality expressed in the
   help surface, and it is the reason the search index is per-request rather
   than static (see question F).
4. **Search covers everything the reader can see** under rulings 2 and 3 —
   the whole org-purchasable surface, minus what their capabilities exclude.

---

## Constraints on this session

- **No database access of any kind.** No Neon console, no Prisma queries, no
  migrations. Nothing in this audit needs them.
- **No browser, no staging, no production.** Everything here is answerable
  from the repo at HEAD.
- **No file edits except the two commits named under Ceremony.**
- Where a question cannot be answered from the repo, say so plainly and name
  what would answer it. Do not infer and present the inference as a finding —
  see question A, where an existing repo note does exactly that.

---

## Question A — do static assets require auth? (**blocking**)

Ruling 1 puts redacted production screenshots on disk. Whether they end up
world-readable at guessable URLs depends entirely on this answer, and nothing
else in the phase can be designed until it is settled.

1. Read `src/proxy.ts`. Quote the matcher config verbatim.
2. Determine whether a request for `/guide/dashboard-01.png` — a file in
   `public/guide/` — is matched by that config or excluded from it.
3. Report the answer as one of: **matched** (asset requires a session),
   **excluded** (asset is public), or **cannot be determined from the repo**
   (name what would determine it — a specific request against a deployment,
   which Gary runs, not this session).

**Do not repeat `docs/PERMISSIONS_INVENTORY.md`'s `/robots.txt` reasoning as
evidence.** That note explicitly labels itself as unverified against a live
deployment. If your answer relies on it, your answer is that inference, not a
finding.

If the answer is **excluded**, the phase needs an authenticated image route
instead of `public/`, and question J's recommendation must reflect that.

---

## Question B — the real article surface

1. Reuse the parser in `scripts/verify-nav1-url-sets.ts` to produce the per-role
   destination URL sets at HEAD. Report the four counts. The NAV-1 row records
   ADMIN 26 / MANAGER 23 / STORE 12 / STAFF 6 — say whether HEAD still
   reproduces those, and if not, what changed.
2. Cross-reference against the PG- rows in `docs/PERMISSIONS_INVENTORY.md`.
   Report any route that appears in one and not the other, with a one-line
   reason (e.g. `/items` is a real page that is not in the nav at all).
3. Propose the article list: one row per article with `route`, `title`,
   `capability`, `module` (or none), and which roles reach it.
4. Report the total, and the per-role visible count under rulings 2 and 3.

This list is the phase's scope. An estimate is not acceptable here; it is
derivable and must be derived.

---

## Question C — redaction risk, sorted

Classify every article from B into exactly one bucket:

- **PII-bearing** — a screenshot of this page shows real names, wages,
  compliance state, or contact details. Expect roughly six: `/staff`,
  `/staff/[id]`, `/users`, `/labor`, `/settings/labor`, `/hr/compliance`.
  Confirm or correct that list from the actual page code — do not accept it
  because this prompt wrote it.
- **Structurally clean** — no person-identifying data renders on the page
  under any org state.
- **Conditional** — clean in general but can show person data in some state
  (e.g. an audit trail, a "last edited by" stamp). Name the condition.

The Conditional bucket is the one that matters. A page nobody thinks of as a
staff page, showing one name in a corner, is exactly the miss that ships.

---

## Question D — insertion points

1. `src/components/layout/sidebar.tsx`: report where a pinned Help item goes
   (bottom, above the Clerk user button, outside the accordion groups) and what
   the item shape must be. **Note specifically how the Settings entry is
   rendered** — `verify-nav1-url-sets.ts` records that it is hand-written JSX
   rather than an item literal, which means Help has two possible shapes and
   they have different consequences for question E.
2. Report how the item renders in the 60px collapsed rail.
3. `src/app/(my)/layout.tsx`: STAFF never enters the app shell. Report what the
   `(my)` portal's navigation looks like and where a Help entry attaches there.
4. Report whether page headers share a component or are hand-rolled per page.
   This single fact decides whether the contextual `?` is one edit or thirty-five.

---

## Question E — the NAV-1 fixture will go red

Adding a Help URL is a **gained URL for every role**, which
`scripts/verify-nav1-url-sets.ts` is built to fail on.

1. Report how the existing `/settings/labor` sanctioned exception is expressed
   in that file today.
2. Propose the wording and mechanism for a Help exception in the same shape.
3. **Do not edit `BASELINE_REV`.** The file's own header forbids updating it to
   turn a red run green, and this is precisely the situation it anticipated.

If the answer to D.1 is that Help should be hand-written JSX like Settings, note
that the fixture may not see it at all — and say whether that is acceptable or
whether Help should be a parseable literal specifically so the fixture governs it.

---

## Question F — the per-request search index

Ruling 3 means the index cannot be a static build artifact: a client-side index
containing all articles is readable in devtools regardless of what the UI filters.

1. Confirm `can()` and `overridesFrom` in `src/lib/permissions.ts` can be called
   from a route handler, and report the call path that loads a user's overrides
   per request (PERM-5B threaded this — report where).
2. Confirm that a per-user `labor.access` denial is expressible, since a static
   four-variant-per-role index could not represent it.
3. Report the payload shape: titles, summaries and keywords only, bodies fetched
   per article through the same check. Estimate the size for the article count
   from B.
4. Report where the filtering should live so there is exactly one place it can
   happen — the NAV-1 `isVisible()` precedent.

---

## Question G — the generator

P-3 already solved build-time generation from files outside the import graph.

1. Read `scripts/generate-roadmap.mjs`. Report the pattern: `prebuild`/`predev`
   hook, gitignored `src/generated/` output, the never-silent fallback chain,
   the `yaml` dependency.
2. Propose the frontmatter schema for `docs/guide/*.md` — at minimum `route`,
   `title`, `roles`, `capability`, `module`, `order`, `images`.
3. Propose the coverage gate: `next build` fails, or warns loudly, when a route
   in B's list has no article. Recommend fail or warn, with a reason. A gate
   that fails on day one when zero articles exist is a gate nobody can ship past
   — say how the gate is introduced without blocking its own phase.

---

## Question H — the upgrade preview

1. Report how `requireModule` and `activeModules` are read, and what a page does
   today when a module is off (`docs/prompts/INITIAL_BUILD_PROMPT.md` § 6c
   describes an upgrade-prompt card — report whether that card actually exists
   in the code or only in that prompt).
2. Propose the article-level preview state under ruling 2, reusing that card if
   it exists rather than inventing a second one.

---

## Question I — search library

MiniSearch and FlexSearch were both floated. Report whether either is already a
dependency, their bundle cost, and recommend one with a reason. If the index is
small enough per question F.3 that neither is needed, say that instead.

---

## Question J — image storage

Recommend one of `public/guide/`, an authenticated route, or Vercel Blob
(already in the stack). **The recommendation must follow from question A's
answer** — if static assets are public, `public/guide/` is off the table for
the PII-bearing articles from C regardless of redaction, because redaction
failure is silent and git history is permanent.

Also propose the capture workflow: an untracked staging directory, a review
pass, then commit — so a missed redaction is caught before it enters history.

---

## Deliverable

A single written plan covering A–J, saved as `docs/prompts/HELP-1_AUDIT_RESULTS.md`.
Plain English first, technical detail second. Every count derived, not estimated.
Surface decision forks rather than resolving them.

Also draft the four rulings as DECISIONS.md candidates in a clearly marked
section — **flagged as drafts for Gary to rewrite in his own words.** A ruling
is only official once it is in Gary's words in `docs/DECISIONS.md`.

Then **STOP.** No application code, no schema, no sidebar edit. Wait for Gary.

---

## Ceremony

- No `npm run build` gate — this session changes no application code.
- Two commits, staging only:
  1. `docs/prompts/HELP-1_AUDIT.md` (this prompt file — commit it; a prompt
     that ran but was never committed is a session nobody can reproduce).
  2. `docs/prompts/HELP-1_AUDIT_RESULTS.md` plus the ROADMAP.yaml HELP-1 row
     recording the audit. Short SHAs quoted in YAML.
- **Commit only. Gary runs all pushes.** No exceptions.
- Out-of-scope findings: FIX NOW / RULING NOW / COMMENT (not a row) / ROW —
  row is the last resort.
