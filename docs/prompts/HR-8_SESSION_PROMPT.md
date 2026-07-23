# HR-8 — Compliance Rollup Dashboard — Session Prompt (audit-first)

You are working in a fresh Claude Code session on **UseFroot (Froot)**, a store-operations
SaaS for Square merchants (juice/smoothie shops; reference store = Las Brisas, plus Keva
Juice Carson City context). Stack: Next.js 16 App Router, React 19, TypeScript, Prisma 7 on
Neon Postgres, Clerk (multi-tenant, roles ADMIN/MANAGER/STORE/STAFF), shadcn/ui, Vercel.

**App root:** `~/Claude_Projects/Froot/froot` — the LOWERCASE `froot`. The capitalized
parent `Froot` is NOT the repo (no `.git`). Run everything from the lowercase `froot`.

## Read these repo docs FIRST (they are the source of truth, not this prompt)

At the app root: `CLAUDE.md`, `AGENTS.md` (heed the Next.js 16 warning — read
`node_modules/next/dist/docs/` before writing Next.js code). In `docs/`: `ROADMAP.md`,
`DECISIONS.md`, `MIGRATIONS.md`, `WORKFLOW.md`, `LABOR.md` (for conventions, not scope), and
any HR-specific docs you find (check `docs/` and `hr_research/`). Also read the existing HR
module code before proposing anything.

**Numbering:** HR work uses the **HR-N** scheme (HR-0 … HR-7 are complete; this session is
**HR-8**). Labor uses **L-N**. Never introduce bare "Phase N" numbering.

## Branch & deploy model — memorize this, do not ask the human to re-explain

- `staging` branch → auto-deploys to the STAGING environment. This is the working branch.
  All HR-8 work happens here.
- `main` branch → auto-deploys to PRODUCTION (live at Las Brisas) the moment a push lands.
  There is NO preview gate and NO manual promote step on main.
- Therefore: **you never push to `main`. Ever.** Promotion to prod is a separate, deliberate
  session with its own audit (see `../DEPLOY_LOG.md` for the L-3 promotion pattern).
  In THIS session you commit to `staging` only, and even then only when the human says to.
- **The human runs pushes.** You prepare commits and present commands; pushes to origin are
  the human's keystroke.
- Keep `main` close to `staging`: `../DECISIONS.md` records that main once drifted 53 commits
  behind and a "small" promotion carried the whole backlog. Don't let HR-8 sprawl.
- **Prod and staging are separate Neon branches.** Stored/generated data (plans, forecasts,
  rollup snapshots if any) exists per-environment. Code promotion never migrates data.
  If HR-8 introduces any generated/stored data, flag its per-environment implications.

## Feature gates (two-gate pattern)

The HR module is gated by (1) server-side env flag `HR_MODULE_AVAILABLE` and (2) the org's
`activeModules` containing `'hr'`. HR is currently **enabled on staging, dark in
production** — and it stays dark in prod. HR-8 ships behind these existing gates; do not
add new gates and do not touch production config.

## Hard constraints (non-negotiable)

- **Audit-first:** read existing files and present a plan BEFORE any edit. Explicit human
  approval required before touching anything.
- **Additive-only Prisma migrations.** No column/table drops, ever.
- **`next build` must pass** before any commit is proposed.
- **Commit to `staging` only, and only when the human says commit.** No pushes by you.
- **`package-lock.json` must be committed with any dependency change.**
- **No sensitive payroll data** — the HR module complements Square Payroll and never
  collects SSN, W-4, I-9, or bank data. Nothing in HR-8 may surface or store these.
- **Org scoping:** every query scoped to `organizationId` per CLAUDE.md conventions.
  Respect role scoping — the rollup is an ADMIN/MANAGER view.
- **Scope containment:** unrelated bugs you notice get written down as text, not fixed.
- **Decision forks:** if you hit a genuine design fork, STOP and present it in plain
  language. The human will take it away, decide, and come back with an answer.

## What HR-8 is

HR-0 through HR-7 built the HR module: manager notes, employee handbook acknowledgment,
fillable agreement forms (`FormSubmission` owns its signed PDF; agreements are re-signed
multiple times per year), and trackable training — with staff access gated on active
`StaffMember` status. HR-8 is the **compliance rollup dashboard**: a single
ADMIN/MANAGER-facing view answering "who is compliant, who is not, and where are the
gaps" across handbook acknowledgments, agreement/form submissions, and training —
per employee and rolled up per store/org.

## Phase 1 — Audit and plan (do this, then STOP)

1. Read the docs above and the existing HR module code: models (StaffMember,
   FormSubmission, handbook/training records, HrSignedRecord if present), routes, pages,
   and how the existing dashboard/reports pages compute compliance (see
   `src/app/(app)/dashboard/page.tsx` and `src/app/(app)/reports/page.tsx` for the
   established KPI-card and reports patterns).
2. Present a plain-language plan for HR-8 covering:
   - What "compliant" means per record type (acknowledged? current version? signed this
     cycle? training complete?) — surface any definitional ambiguity as a decision fork
     rather than assuming.
   - Data approach: computed live from existing records vs any new schema. Prefer
     computing from existing records; propose new schema only if genuinely needed
     (additive-only if so).
   - UI: where the rollup lives, what the ADMIN/MANAGER sees per store and per employee,
     drill-down behavior, and how it follows the existing design system.
   - Build order in small verifiable steps.
3. **STOP and wait for explicit approval before editing anything.**

## Phase 2 — Build (only after approval)

Work the approved plan in small steps. `next build` must pass. When done, present a
staging verification checklist (what the human should click and confirm on the staging
deploy), then wait. Commit only when told, to `staging` only, and let the human push.

## Docs to update at the end (when the human says the staging pass is clean)

- `../ROADMAP.md` — HR-8 status.
- `../DECISIONS.md` — any design decisions made (especially the compliance definitions).
- `../MIGRATIONS.md` — if any migration was added (additive-only).
- Note: `../DEPLOY_LOG.md` (renamed from STAGING_DEPLOY_LOG.md) logs both staging and prod
  events — follow its existing format if you log anything.
