# STAFF-1 — Staff-Role Experience — Session Prompt (audit-first)

Fresh Claude Code session on **UseFroot (Froot)**, store-operations SaaS for Square
merchants (reference store = Las Brisas / Keva Juice). Stack: Next.js 16 App Router,
React 19, TS, Prisma 7 on Neon, Clerk (roles ADMIN/MANAGER/STORE/STAFF), shadcn/ui,
Vercel. App root: `~/Claude_Projects/Froot/froot` (LOWERCASE `froot`).

Read first: `CLAUDE.md`, `AGENTS.md` (incl. the Next.js 16 docs requirement),
`docs/ROADMAP.md`, `docs/DECISIONS.md`, `docs/WORKFLOW.md`. Prompts live in
`docs/prompts/`. Numbering: this is the STAFF- scheme, phase STAFF-1. Do not use bare
"Phase N" numbers.

Branch rules: all work on `staging`; you NEVER push and NEVER touch `main` (main
auto-deploys to production instantly). Commit staging-only when told; the human pushes.
Additive-only migrations. `next build` must pass. package-lock.json committed with any
dependency change. Two-gate module pattern stays intact (HR_MODULE_AVAILABLE +
activeModules) — no new gates.

## Prerequisite

BUG-2 (staff profile email-matching) must be fixed and verified on staging BEFORE this
session runs, since testing the staff experience requires logging in as a linked staff
member. Confirm with the human that BUG-2 landed if there is any doubt.

## What this phase is

Today, a STAFF-role login sees a diluted admin experience: an empty dashboard (blank
cards), plus nav items that don't apply (Store View, Inventory, full Checklists).
STAFF-1 makes the staff login a purpose-built employee experience. Requirements from
the product owner:

1. **Staff dashboard**: replace the blank cards. Staff should see Team Messages,
   Corporate Messages, their open/unfinished compliance + training items (a
   "My Compliance & Training" card is acceptable), and Instagram prominently.
   Nothing rendered should be an empty placeholder — every card either has content
   or an intentional empty state.
2. **Checklists**: hidden for STAFF unless/until something is actually assigned to
   that staff member (future assignment feature may populate this — design the
   visibility check so it flips on when assignments exist).
3. **Store View**: not visible to STAFF.
4. **Inventory**: not visible to STAFF.
5. **Pending items surface on the dashboard**: any open compliance, training, or
   pending item (e.g. unsigned required doc, overdue training) appears on the staff
   dashboard with a direct link to complete it.
6. **HR nav item renamed to "My Documents" for STAFF only** (ADMIN/MANAGER keep "HR").

Plus: the staff experience must be **responsive** — genuinely usable on iPhone and
tablet as well as desktop (staff will mostly use phones). Follow existing responsive
patterns in the app (e.g. store-view mobile treatment) rather than inventing new ones.

## Phase 1 — Audit and plan (then STOP)

1. Map how role-based navigation and dashboard composition work today (sidebar config,
   role checks, dashboard card composition, how STORE role is handled — STAFF likely
   wants similar treatment). Identify why staff currently see blank cards (relate to
   BUG-1's diagnosis if applicable — read its DECISIONS.md entry).
2. Map what data exists for each proposed staff card (Team/Corporate Messages, the
   staff member's own compliance/training items — reuse the HR-8 per-staff computation
   from hr-compliance.ts rather than duplicating logic; Instagram feed component).
3. Present a plain-language plan: nav visibility matrix by role (before/after), dashboard
   card layout for STAFF (desktop + mobile), where the "My Documents" rename lives,
   how "checklists only if assigned" is detected, and a build order in small verifiable
   steps. Surface any decision forks (e.g. what Corporate vs Team Messages means in the
   data model; whether STORE role is affected by any shared change) rather than assuming.
4. STOP and wait for explicit approval before editing anything.

## Phase 2 — Build (only after approval)

Small steps, `next build` green after each. STAFF changes must not alter what
ADMIN/MANAGER/STORE see except where the plan explicitly says so. End with a staging
verification checklist covering: staff login sees the new dashboard with real content,
nav shows only Dashboard/Messages/Instagram/My Documents (+Checklists only when
assigned), admin/manager views unchanged, and the staff dashboard renders correctly on
a phone-sized viewport. Stop before commit; commit staging-only when told; human pushes.

## Scope containment

Do not modify HR-8 rollup logic, labor/forecast code, or admin surfaces beyond the nav
visibility matrix. Unrelated findings are written down as text. Docs at the end (when
told): ROADMAP.md (STAFF-1 row), DECISIONS.md (nav matrix + any fork rulings).
