# Session: Roadmap Tier 0 (v2) — one source of truth for phase status

**Save to:** `docs/prompts/ROADMAP_TIER0_SESSION.md` (replaces the v1 of this file)
**Size:** S (docs only — no schema, no dependencies, no runtime code)
**Done criterion:** `next build` passes and `git status` shows only intended doc files changed.

---

## Why this exists

Phase status currently lives in **three** places that disagree:

1. An external tracking sheet (outside the repo).
2. The `## Phase Status` section in `docs/CLAUDE.md`, which still says
   **"Phase 2 — Not Started ❌"** and lists inventory routes as unbuilt. They
   shipped weeks ago.
3. `docs/ROADMAP.md` — a hand-maintained roadmap.

Three sources, none authoritative, and `CLAUDE.md` (read at the start of every
session) is the one actively misinforming work.

This session collapses all three into one machine-checkable file:
**`docs/ROADMAP.yaml`**. That file wins over the sheet, over `CLAUDE.md`, and
over `docs/ROADMAP.md`, and the latter two are retired to pointers.

**No application behavior changes.** No Prisma migration, no dependency, no
route changes.

### Path facts (do not get this wrong)

- The **git repo root is `froot/`**. All work happens here.
- Repo docs live in **`docs/`** and session prompts in **`docs/prompts/`**.
- There is a sibling folder `../froot_docs/` **outside** the repo. Do **not**
  write to it, read from it, or reference it. If any instruction seems to point
  there, it is wrong — everything is `docs/`.

---

## Audit first — edit nothing yet

Do all of the following and report back before touching a file:

1. **Read `docs/ROADMAP.md` in full.** This is your richest reconstruction
   source. List every phase it records, with status.
2. **Read `docs/CLAUDE.md`** and quote the exact start/end boundaries of the
   `## Phase Status` section.
3. **Read these if they exist and summarize each in one line:**
   `docs/WORKFLOW.md`, `docs/STAGING_SETUP.md`, `docs/DEPLOY_LOG.md`,
   `docs/MIGRATIONS.md`, `docs/DECISIONS.md`.
4. **List every file in `docs/prompts/`.** For each, give the phase id and a
   one-line summary of what it built. This is the definitive phase inventory —
   the roadmap must account for every prompt here.
5. **Run `git log --oneline -120`** and report it.
6. Confirm whether `docs/ROADMAP.yaml` already exists. If it does, **stop and
   report** — do not overwrite.

Then present a reconciliation plan: for every phase found across sources 1–5,
one row showing `id | title | status | source(s) | commit(s) if known`. Flag
every disagreement between sources rather than resolving silently.

**Wait for explicit approval before editing.**

---

## Known tracks the roadmap MUST cover

My seed YAML below covers inventory, forecasting, platform, nutrition, and the
signing thread. The following are known to exist (from `docs/prompts/`) but I do
**not** have their details — **reconstruct them from `docs/ROADMAP.md`,
`docs/prompts/*`, and `git log`. Do not invent specifics; leave fields empty and
flag them if a source doesn't give you the answer.**

- **Labor track** — `LABOR.md`, `L-3_Weekly`, `L-3_PROD`, and multiple
  `Labor_Phase*` prompts. Give these real ids (`L-1`, `L-2`, `L-3…`), titles,
  status, and commits.
- **UM-1** — user-management session (`UM-1_SESSION_PROMPT.md`).
- **STAFF-1** — `STAFF-1_SESSION_PROMPT.md`.
- **DOCS-1** — `DOCS-1_CONVENTIONS_PROMPT.md` (or similar).
- **BUG-1, BUG-2** — bug-fix sessions. Record as their own short entries with
  what they fixed, or fold into the phase they patched — your call, but don't
  drop them.
- **HR track, full** — `HR-8`, `HR-11`, `HR-11b`, `HR-11c`, `HR-15`, and any
  HR-9/HR-10/HR-11a in between. Use the corrected HR entries in the seed below
  as the starting point and fill the rest from sources.

If any phase exists in a prompt file but appears nowhere in `docs/ROADMAP.md` or
`git log`, list it under a `## Unaccounted` heading in your report.

---

## Task 1 — Create `docs/ROADMAP.yaml`

Create the file from the seed below, then extend it with the reconstructed
tracks above. Two rules:

- **`commits: []`** — backfill SHAs only where `git log` makes them unambiguous.
  Never guess. Leave empty and say so in the report otherwise.
- Where the seed and a source disagree, the seed is a starting guess, not
  gospel — correct it to match `docs/ROADMAP.md`/`git log` and flag the change.

```yaml
# Froot roadmap — single source of truth for phase status.
# Supersedes docs/ROADMAP.md, the old CLAUDE.md "Phase Status" section, and the
# external sheet. If any of those disagree with this file, this file wins.
#
# UPDATE RULE: every Claude Code session updates its phase's entry here before
# the session is done. See docs/WORKFLOW.md / session completion rules.
#
# status: planned | in_progress | staging | shipped | verified
#   staging  — merged to `staging`, on Vercel preview, NOT in prod
#   shipped  — merged to `main`, live in prod
#   verified — shipped AND smoke-tested against real store data
#
# blockers — live problems in a phase regardless of status (unset env vars,
#            prod-promotion gates, unverified pixel work). Anything here blocks.
# deferred — scope intentionally cut.
# open     — unresolved questions that aren't yet blockers.
# tags     — [pre-launch] must close before external merchants.

meta:
  updated: 2026-07-24
  sources_retired: [docs/ROADMAP.md, "CLAUDE.md#Phase Status", external sheet]

phases:

  # ---- Inventory ----
  - { id: I-1,  track: inventory, size: M-L, status: shipped, shipped: 2026-07-05, commits: [],
      title: "Sales item sync + Ingredient library",
      notes: "v2 rebuild — SalesItem vs Ingredient split, units.ts, CSV import." }
  - { id: I-1b, track: inventory, size: M, status: shipped, shipped: 2026-07-06, commits: [],
      title: "Ingredient parity, lifecycle & duplicates" }
  - { id: I-2,  track: inventory, size: M-L, status: shipped, commits: [],
      title: "Vendors, POs & Receiving" }
  - { id: I-3,  track: inventory, size: S-M, status: shipped, commits: [432a30e],
      title: "Storage areas" }
  - { id: I-4,  track: inventory, size: M, status: shipped, commits: [eb816db],
      title: "Physical counts" }
  - { id: I-5,  track: inventory, size: M-L, status: shipped, shipped: 2026-07-06, commits: [b3cb378],
      title: "Sales sync + COGS & analytics" }
  - { id: I-6,  track: inventory, size: L, status: shipped, shipped: 2026-07-06, commits: [4947def],
      title: "Recipes + needs-attention + adjustments" }
  - { id: I-7,  track: inventory, size: M, status: shipped, shipped: 2026-07-07, commits: [1020b9e, 5380324],
      title: "Reorder points & alerts" }
  - id: I-14
    track: inventory
    size: M-L
    status: shipped
    shipped: 2026-07-09
    commits: []
    title: "Team Messaging (Phase 1)"
    deferred: [Read acknowledgements, Twilio SMS delivery, Shortage alerts in feed]

  # ---- Platform / dashboard ----
  - { id: D-1, track: platform, size: M, status: shipped, shipped: 2026-07-06, commits: [1b8160f],
      title: "Dashboard redesign" }
  - { id: P-1, track: platform, size: S, status: shipped, shipped: 2026-07-09, commits: [251c3a6],
      title: "Templates export/import" }
  - { id: P-2, track: platform, size: S, status: shipped, shipped: 2026-07-10, commits: [],
      title: "Sales-metric accuracy pass" }
  - { id: X-1, track: platform, size: S, status: planned, tags: [pre-launch],
      title: "Activation & QA" }

  # ---- Forecasting ----
  - id: F-1
    track: forecasting
    size: S-M
    status: shipped
    shipped: 2026-07-08
    commits: [b7feecb]
    title: "Forecasting — sales-data foundation"
    blockers:
      - "CRON_SECRET not set in Vercel — nightly reconcile cron is not running in
         prod; forecasting accuracy silently degrades until set."
  - { id: F-2, track: forecasting, size: M, status: shipped, shipped: 2026-07-08, commits: [11f0b47],
      title: "Goal engine + Forecasting page" }
  - { id: F-3, track: forecasting, size: M, status: shipped, shipped: 2026-07-08, commits: [11f0b47],
      title: "Forecasting overrides + import" }
  - id: F-4
    track: forecasting
    size: S
    status: shipped
    shipped: 2026-07-08
    commits: [96bc048]
    title: "Dashboard live pacing (partial)"
    deferred: [Square order webhooks, All-locations rollup, Store ranking]
  - { id: F-5, track: forecasting, size: S, status: planned, tags: [pre-launch],
      title: "Forecasting polish — behind-pace notifications, CSV export, goal-edit audit log" }

  # ---- HR / signing (corrected sequence) ----
  # RECONSTRUCT HR-0..HR-10, HR-11a, HR-15 from docs/ROADMAP.md + docs/prompts/ + git log.
  - id: HR-8
    track: hr
    size: M
    status: planned            # VERIFY — set from source; may have shipped
    commits: []
    title: "PLACEHOLDER — compliance rollup dashboard (verify status)"
  - id: HR-11
    track: hr
    size: L
    status: shipped
    commits: []
    title: "Signing ceremony — 4-phase flow, inline pdf.js viewer, per-page initialing, real per-interaction timestamps"
  - id: HR-11b
    track: hr
    size: M
    status: shipped
    commits: []
    title: "Field anchoring + inline stamping"
    notes: >
      Server-side anchor detection at upload, admin confirm/mapping UI,
      checkpoint generation from confirmed anchors, stamping onto PDF body.
  - id: HR-11c
    track: hr
    size: M
    status: staging            # committed 8a4335f, pushed origin/staging, NOT in prod
    commits: [8a4335f]
    title: "Signing ceremony fixes — dedup, affordance-at-line, identity chips"
    notes: >
      Item 3 — dedupeAnchors collapses coincident duplicates (page + normText +
      markType, |Δx|,|Δy| ≤ 3, deterministic survivor; far-apart preserved),
      fixture 35/35. Item 2 — "Sign here"/initials render at anchor via
      rotation-aware pdf.js transform. Item 1 — read-only name/date/store chips
      at anchors during review. Decisions recorded in docs/DECISIONS.md.
    blockers:
      - "Certificate shows 'Microsoft' as org name — hard prod-promotion gate."
      - "Visual QA unverified — lift offsets (−118% buttons, −90% chips) need a
         tuning pass on staging /my mobile before promotion to main."
    open:
      - "Does v5 handbook carry persisted duplicate anchors? If yes, upload a
         fresh handbook version to verify dedup (G1: don't touch v5's confirmed
         anchors)."
  - id: HR-15
    track: hr
    size: M
    status: planned            # VERIFY from source
    commits: []
    title: "PLACEHOLDER — fill from HR-15_SESSION_PROMPT.md"

  # ---- Labor ----  RECONSTRUCT ENTIRELY from LABOR.md + Labor_Phase*/L-3 prompts + git log.
  - id: L-RECONSTRUCT
    track: labor
    status: planned
    title: "PLACEHOLDER — replace with real L-1..L-n from sources; there is a full labor track"

  # ---- Standalone sessions ----  RECONSTRUCT from prompts + git log.
  - { id: UM-1,   track: platform, status: planned, title: "PLACEHOLDER — user management (UM-1_SESSION_PROMPT.md)" }
  - { id: STAFF-1, track: platform, status: planned, title: "PLACEHOLDER — STAFF-1_SESSION_PROMPT.md" }
  - { id: DOCS-1, track: platform, status: planned, title: "PLACEHOLDER — docs conventions (DOCS-1)" }

  # ---- Migration / nutrition ----
  - { id: M-1, track: migration, size: M, status: planned,
      title: "Keva data migration (optional; templates-only script exists)" }
  - { id: N-1, track: nutrition, size: M, status: planned,
      title: "Nutrition — schema & menu item manager (models scaffolded, no UI)" }
  - { id: N-2, track: nutrition, size: M, status: planned, title: "Nutrition — facts editor + label preview" }
  - { id: N-3, track: nutrition, size: M, status: planned, title: "Nutrition — public menu page (SSR, iframe-embeddable)" }

debt:
  - id: DEBT-1
    title: "operationalPhase string inconsistency"
    notes: >
      "During the Day" vs "During Hours". Audit-then-fix prompt saved in
      docs/prompts/. Neon is source of truth; SQL approval before any mutation.
  - id: DEBT-2
    title: "sectionName vs section field ambiguity"
    notes: "Next candidate for the same audit-then-remediate treatment."

bugs:
  # RECONSTRUCT from BUG-1_SESSION_PROMPT.md, BUG-2_SESSION_PROMPT.md + git log.
  - { id: BUG-1, title: "PLACEHOLDER — what it fixed", commits: [] }
  - { id: BUG-2, title: "PLACEHOLDER — what it fixed", commits: [] }
```

---

## Task 2 — Retire `docs/ROADMAP.md`

Do **not** leave two roadmap files. Replace the entire contents of
`docs/ROADMAP.md` with a pointer:

```markdown
# Roadmap

Phase status now lives in `docs/ROADMAP.yaml` — the single source of truth.
This file is retired. Do not add status here.
```

If `docs/ROADMAP.md` contains history or context not captured in the YAML
(narrative notes, rationale), **tell me what would be lost before deleting it** —
I'll decide whether it moves into `docs/DECISIONS.md` or stays.

---

## Task 3 — Replace the stale section in `docs/CLAUDE.md`

Delete the whole `## Phase Status` section (both `### Phase 1 — Complete ✅` and
`### Phase 2 — Not Started ❌` and their route lists). Replace with:

```markdown
## Phase Status

Phase status lives in `docs/ROADMAP.yaml` — the single source of truth. Do not
track status here, in docs/ROADMAP.md, or in any external sheet.

**Read `docs/ROADMAP.yaml` at the start of every session.** Check the `blockers`
and `deferred` fields of any phase you touch or build on.

**Update it before the session ends** (see session completion rules).

## Module Gating

Modules are gated per-org via `activeModules` on the `Organization` record. Some
add a second server-side env gate (e.g. `HR_MODULE_AVAILABLE`) so in-development
work can't surface in prod even if an org toggles it on.

Before building any gated route:

    import { requireModule } from "@/lib/auth"
    await requireModule("inventory") // or "nutrition", "hr"

Feature-gated sidebar link: show a lock icon if the module isn't in
`activeModules`; clicking opens the upgrade prompt instead of navigating.
```

Preserve the rest of `CLAUDE.md`. If the `requireModule` snippet or sidebar-lock
convention already appears elsewhere, don't duplicate — tell me where it lives.

---

## Task 4 — Add the update rule to the workflow doc

`docs/WORKFLOW.md` exists — add this section to it (if it's not the right home,
tell me which file is and why before editing):

```markdown
## Session completion rules

A session is not done until all are true:

1. `next build` passes.
2. This phase's entry in `docs/ROADMAP.yaml` is updated:
   - `status` reflects reality (e.g. in_progress → staging → shipped)
   - `commits` lists this session's SHAs
   - `shipped` dated if it reached prod
   - `blockers` lists anything left broken/unset/unverified in prod, including
     required env vars not yet set and prod-promotion gates
   - `deferred` lists scope explicitly cut
3. Bugs noticed but not fixed go in the `debt:` (or `bugs:`) block in
   ROADMAP.yaml as text — not fixed inline.
```

---

## Constraints

- **Docs only.** No `.ts`/`.tsx`, no Prisma, no dependency or `package.json`
  changes.
- **Nothing parses the YAML yet** — intentional. A later phase adds a parser and
  an `/internal/roadmap` route; that will be the first dependency change, and
  `package-lock.json` must be committed with it. Flag it then.
- Do not touch `../froot_docs/` (outside the repo) or the external sheet.
- Where YAML and `git log` disagree, **report it — don't silently correct.**

---

## Report back

1. The full reconciliation table from the audit, with every source disagreement.
2. The complete phase inventory from `docs/prompts/`, including the Labor track,
   UM-1, STAFF-1, DOCS-1, BUG-1/2, and full HR — with anything `Unaccounted`.
3. SHAs backfilled vs left empty.
4. Anything that would be lost by retiring `docs/ROADMAP.md`.
5. `next build` result.
