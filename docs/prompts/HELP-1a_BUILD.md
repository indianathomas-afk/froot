# HELP-1a — Help system: the machine — TIER 3 — BUILD

TIER 3: structural. New routes in two shells, a build-time generator, a new
capability helper with three callers, an authenticated image route on a new Blob
store, a sidebar item that trips an existing fixture, and a per-request search
index.

Save as `docs/prompts/HELP-1a_BUILD.md`.

**Read `docs/prompts/HELP-1_AUDIT_RESULTS.md` first and in full.** It is the
design document for this phase. Where this prompt and the audit disagree, the
audit is right and you should stop and say so — this prompt was written from a
summary of it.

---

## Repo gate (run first, paste results, one command at a time — no `&&` chains)

```
pwd
```
Must end in `Froot/froot`.

```
git remote -v
```
Must show `indianathomas-afk/froot`.

```
git status
```
Must be on `staging`, tree clean. If the tree is dirty or the branch is wrong,
STOP and report.

---

## What HELP-1a is, and what it is not

**Is:** the machinery — generator, access helper, two route shells, search index,
image route, sidebar entry, fixture exception, coverage gate — plus **exactly
three real articles** so every branch of that machinery is exercised by something
real rather than compiled and assumed.

**Is not:** the other 41 articles (HELP-1b), the onboarding first-run card, any
animated or video content, or any fix to `PERMISSIONS_INVENTORY.md`'s four
uncovered routes (a ROW, filed, untouched).

---

## The eight rulings this phase implements

All eight are recorded as drafts in the audit results, in Claude's words.
**They must be ratified in Gary's own words in `docs/DECISIONS.md` before the
docs commit.** Ask Gary for his wording; never write a ruling in his voice.

1. Screenshots come from production, redacted by hand.
2. Module-gated articles render as upgrade previews.
3. Capability-gated articles are hidden from logins that cannot reach the page.
4. Search covers everything the reader can see under 2 and 3.
5. Articles map to user tasks, not routes. Print and `/` exempt; sign-in and
   sign-up are one article.
6. Section-level capabilities. A section the reader lacks renders **nothing** —
   no heading, no greyed text, no gap, no renumbered list. Absent, per the
   `/settings/labor` precedent.
7. All guide images sit behind an authenticated route, gated at the **narrowest
   enclosing scope** — the section if the image sits in one, otherwise the
   article. Refuse with **404, not 403**: a 403 confirms a hidden section exists.
   `Cache-Control: private`, never shared.
8. Guide images get their **own Blob store and token**, not `froot-hr`. Pattern
   shared, blast radius not.

---

## Phase A — plan, then STOP

Present, before editing anything:

1. **The three articles**, chosen from the audit's §C buckets — not from this
   prompt's guesses. One per branch:
   - **clean, no images** — proves the basic path. Candidate: Messages or Reports.
   - **PII-bearing, with screenshots** — proves the image route serves real bytes
     and gives the redaction workflow a dry run. Candidate: the Staff directory.
   - **one gated section** — must be one of the three confirmed strict-inner
     mixed-gate articles. Candidate: Ingredients, with the restore-deleted
     section gated, since that is the worked example throughout the audit.
   Name your three and say why each is the best exerciser of its branch.

2. **Build order**, smallest verifiable steps, `npm run build` green after each.

3. **The coverage gate's launch mode.** 3 of 44 articles exist, so a failing gate
   blocks its own phase. Recommend how it is introduced — warn now, fail later,
   with the flip pinned to a named condition rather than a good intention.

4. **The contextual `?` decision.** Audit question D.4 established whether page
   headers share a component. If they are shared, build it. If they are
   hand-rolled per page, **defer to HELP-1b** and say so — thirty-five hand edits
   do not belong in the machine phase.

5. **Any place this prompt contradicts the audit.**

Then **STOP** and wait for Gary.

---

## Phase B — build (only after approval)

### B1 · `src/lib/help-access.ts` — build this first

One mapping from help resource to governing capability, three callers. The audit
names this as the phase's load-bearing abstraction; if it is built last, three
near-copies of the policy will already exist.

- `helpScope(actor, org)` exposing at minimum `visibleArticles()`,
  `visibleSections(article)`, `canReadImage(imageRef)`.
- `canReadImage` is **not a separate policy** — it resolves the image to its
  section or article and defers to the same check (ruling 7).
- Uses the real `can()` and per-user overrides from `src/lib/permissions.ts`,
  loaded once per request. Module state (ruling 2) resolves here too.

### B2 · Generator

`scripts/generate-guide.mjs` → `src/generated/guide.ts`, following
`scripts/generate-roadmap.mjs` exactly: `prebuild`/`predev` hook, gitignored
output, never-silent fallback chain.

Frontmatter per the audit's schema: `routes` (list), `entry`, `title`, `summary`,
`keywords`, `capability`, `module`, `order`, `sections[]`. **A `sections` entry
without a `capability` is a parse error**, not an ungated section (audit §G).
The exempt route list lives in the generator, not frontmatter.

### B3 · Route shells

`(app)/help` and `(app)/help/[slug]`; `(my)/help` and `(my)/help/[slug]`. One
shared renderer, two thin shells — STAFF never enters the app shell.

Section filtering happens **server-side**: a hidden section is absent from the
payload, not hidden with CSS. Any table of contents renumbers so no gap shows.

### B4 · Search index route

Per-request, filtered through `helpScope`. Titles, summaries and keywords only;
bodies fetched per article through the same check. **A hidden section's text
never enters the index** — the index is built from the reader's filtered
article, not the raw file. No search library (audit measured 5.5 KB gzipped at
44 rows); if you disagree after building it, say so rather than adding one.

### B5 · Image route

New Blob store and token (ruling 8), reusing the `src/lib/hr-files.ts` shape:
private store, authorize-then-presign, short signed URL, cached delegation token,
`?stream=1` same-origin path for `<img>` with identical authorization on both
paths. 404 on refusal. `Cache-Control: private`.

### B6 · Nav

Sidebar item pinned at the bottom, above the Clerk user button, outside the
accordion groups; renders in the 60px rail. Plus the `(my)` portal's equivalent
per audit D.3. Help itself is never capability-gated — the articles inside it are.

### B7 · NAV-1 fixture exception

Per audit §E, in the same shape as the `/settings/labor` exception.
**Do not edit `BASELINE_REV`.** `verify-nav1-url-sets.ts` must be green.

### B8 · The three articles

Draft each from the page code, then hand to Gary for correction — you know what
the buttons do, he knows why Keva does it that way. Capture screenshots for the
PII-bearing one into an **untracked** directory; Gary reviews redaction before
anything is committed. Images never enter git (ruling 8 puts them in Blob).

---

## Evidence (done criteria)

Route-level, not button-level. Assertions in code, not claims in prose.

1. **Per-role visible article sets**, computed through the real `can()` and
   presented as a table, roles as columns. Modelled on
   `verify-nav1-url-sets.ts`.
2. **The gated section is absent from a STORE-scoped article payload** — asserted
   against the response, not observed in a browser.
3. **The gated section's text is absent from a STORE-scoped search index
   payload.** This is the assertion that proves ruling 6 end to end; a hidden
   section that is still findable by search defeats the ruling silently.
4. **The gated section's image returns 404 to a STORE-scoped request and bytes to
   an ADMIN-scoped one.** Both directions — a route that 404s for everyone passes
   half this test while being broken.
5. `verify-nav1-url-sets.ts` green.
6. `npm run build` green. Lint is not a gate (DEBT-33).

State plainly what was **not** verified. Nothing here proves browser rendering,
and a green result from an instrument that cannot see the failure is not evidence.

---

## Ceremony

- `npm run build` gates the commit.
- Two-commit pattern: work commit, then docs commit citing the work SHA —
  ROADMAP.yaml HELP-1a row, DECISIONS.md entries in **Gary's ratified wording**,
  short SHAs quoted in YAML.
- Commit this prompt file as part of the session.
- **Commit only. Gary runs all pushes.**
- DEPLOY_LOG entry before the push, scaled to blast radius.
- PRE-PUSH-CHECK session after the build phase.
- Out-of-scope findings: FIX NOW / RULING NOW / COMMENT / ROW.
