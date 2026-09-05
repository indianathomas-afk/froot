# HELP-1b — Help articles — TIER 2 — BUILD (reusable, one batch per run)

The machine shipped in HELP-1a and is verified. This phase writes articles into
it. **This prompt is run repeatedly — once per batch.** Nothing in it is
batch-specific; Phase A picks the batch.

Save as `docs/prompts/HELP-1b_BATCH.md`.

**Read first, in full:** `docs/prompts/HELP-1_AUDIT_RESULTS.md` (the article
list and §C risk buckets) and the eleven HELP-1 entries in `docs/DECISIONS.md`.
Where this prompt disagrees with either, they win — stop and say so.

---

## Repo gate (one command at a time, no `&&` chains)

```
pwd
```
Must end in `Froot/froot`.

```
git status
```
`staging`, tree clean. Anything else, STOP.

---

## Scope

**In:** articles for modules that are live — HR, checklists, stores, staff,
users, reports, forecasting, messages, settings, and the `/my` portal.

**Out, deliberately:** every `module: inventory` article. That module is on
hold, its pages are empty, and articles written against it would go stale before
anyone read them. They are a later batch tied to the module returning — not a
gap to be filled. Do not write them, and do not treat their coverage warnings as
a problem to solve.

Derive the in-scope count from the audit's own route→article mapping. Do not
take a number from this prompt; the estimate has been wrong twice.

---

## Batch size

Six articles per run, grouped by module so vocabulary and screenshots stay
consistent within a batch. **HR first** — it is live, it has real content, and
HELP-1a built two articles against it, so the patterns are fresh.

---

## What HELP-1a learned, that this phase must carry

These are not background. Each one is a way an article silently leaks or breaks,
and this phase writes twenty more chances to repeat them.

**1 · Three fields leak a gated section, and none of them looks like a
permission surface while you type it.**
- `routes` — a route string discloses a page exists exactly as a heading does.
  `/inventory/ingredients/deleted` reached STORE readers this way.
- `keywords` — the word `audience` reached three roles the section was hidden
  from.
- `summary` — "set who it goes to" did the same in prose.

For every gated section, list its vocabulary and assert none of those terms
appears in any article-level field. The verifier already has this shape; extend
it per article rather than trusting a read-through.

**2 · Two permission gates `permissions.ts` cannot see.**
- HR-7's shell-level redirect in `(app)/layout.tsx`, which bounces linked STAFF
  out of the whole app shell.
- `/hr/documents/[id]`'s raw `role !== "ADMIN"` check rather than a capability.

`helpScope` models the first as `surface`. The second is unmodelled and merely
happens to agree today. **When an article's page has a gate, check the page
code — do not infer the gate from `permissions.ts` alone.** Expect more of
these; report each one on the row.

**3 · Captures are from production, and the host is checked before shooting.**
Staging renders identically. It is a Neon branch forked from production, so a
staging capture carries person data whose provenance cannot be reconstructed
afterwards — a redaction pass cannot catch what it cannot tell apart.

---

## Phase A — propose the batch, then STOP

1. The six articles, with module, entry capability, gated sections if any, and
   §C risk bucket for each.
2. Which need screenshots and which do not. **Prefer none where prose suffices**
   — every image is a redaction pass and a permanent maintenance obligation.
3. The routes each claims, and the exact number the unclaimed-route warning
   should drop by when the batch lands.
4. Anything in the six whose page gate is not expressible through `can()`.

Then STOP.

---

## Phase B — draft, then STOP

Draft all six from the page code. Plain English, task-shaped: what the person is
trying to get done, then how. Not a tour of the buttons.

House voice: short sentences, no marketing, no "simply" or "just". Assume a
smoothie-shop manager on an iPad mid-shift, not a software person.

Frontmatter per the ratified schema — `routes` as a list, `entry`, `sections[]`
each with a `capability` (a section without one is a parse error).

Then **hand all six to Gary for correction and STOP.** You know what the buttons
do; he knows why Keva does it that way. This is the step the phase exists for —
do not skip it, do not proceed on assumed approval.

---

## Phase C — screenshots, verify, commit

Only after Gary returns corrections.

**Screenshots**, for the ones Phase A named. Gary captures and redacts; you
supply the capture spec — page, what must be in frame, and what to redact,
naming the specific fields that render person data. Then he uploads with
`scripts/upload-guide-image.mjs` and you verify.

**Extend `verify-help-access.ts`** for each new article: per-role visible
counts, gated-section absence in every direction, and the leak-term assertions
from finding 1.

**Evidence, all green before commit:**

1. `verify-help-access.ts` — all assertions, including the new ones.
2. `verify-guide-image.ts` — 8 of 8 if the batch added images.
3. `verify-nav1-url-sets.ts` — unchanged, still IDENTICAL.
4. The unclaimed-route count dropped by **exactly** the number Phase A
   predicted. A different number means an article claims routes it does not
   document, or documents routes it does not claim.
5. `npm run build` green.

State plainly what was not verified.

---

## Ceremony

- Two-commit pattern: articles, then docs citing the work SHA.
- ROADMAP row per batch, not one row for the phase — a row that stays open for
  twenty articles tells you nothing about progress.
- DEPLOY_LOG scaled to blast radius. Articles are content; a batch does not earn
  what HELP-1a earned.
- **Commit only. Gary runs all pushes.**
- Out-of-scope findings: FIX NOW / RULING NOW / COMMENT / ROW.
