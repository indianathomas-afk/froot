# BUG-1 — Intermittent Dashboard Card Loading — Session Prompt (diagnose-first)

You are working in a fresh Claude Code session on **UseFroot (Froot)**, a store-operations
SaaS for Square merchants (juice/smoothie shops; reference store = Las Brisas). Stack:
Next.js 16 App Router, React 19, TypeScript, Prisma 7 on Neon Postgres, Clerk, shadcn/ui,
Vercel.

**App root:** `~/Claude_Projects/Froot/froot` — the LOWERCASE `froot`. The capitalized
parent `Froot` is NOT the repo (no `.git`). Run everything from the lowercase `froot`.

## Where the docs live (consolidated 2026-07-22 — do not hunt elsewhere)

All project documentation is in `docs/` inside the repo:
- `docs/ROADMAP.md`, `docs/DECISIONS.md`, `docs/MIGRATIONS.md`, `docs/WORKFLOW.md`,
  `docs/LABOR.md`, `docs/FORECASTING.md`, `docs/DEPLOY_LOG.md` (renamed from
  STAGING_DEPLOY_LOG.md — logs both staging and prod deploys), `docs/STAGING_SETUP.md`
- Session prompts (including this one) live in `docs/prompts/`
- `CLAUDE.md`, `AGENTS.md`, `README.md` stay at the repo root. Per AGENTS.md, read the
  Next.js 16 docs in `node_modules/next/dist/docs/` before writing any Next.js code —
  this session is ABOUT rendering/loading behavior, so that reading is not optional.

## Branch & deploy model — memorize, do not ask the human to re-explain

- `staging` branch → auto-deploys to the STAGING environment
  (froot-git-staging-*.vercel.app). All work happens here.
- `main` branch → auto-deploys to PRODUCTION (live at usefroot.com) the instant a push
  lands. No preview gate. **You never push to main. Ever.** Prod promotion is a separate,
  deliberate audited session.
- **The human runs all pushes.** You prepare commits and present commands; pushes are
  the human's keystroke. Commit to `staging` only, and only when told.
- Additive-only Prisma migrations (this session should need NONE — it is a
  rendering/data-loading bug, not a schema issue; if you conclude otherwise, STOP and
  explain before proposing any migration).
- `next build` must pass before any commit is proposed.
- `package-lock.json` must be committed with any dependency change.

## Current repo state (context, do not disturb)

- HR-8 (compliance rollup) just landed on staging as commit `61eea85` and is undergoing
  its human staging pass. Do not modify HR-8 surfaces in this session.
- L-3 (Weekly Plan) is live in production. HR is enabled on staging, dark in prod.

## The bug

On the **staging** deployment, dashboard cards intermittently fail to load their data.
Symptom as reported by the human: on page load, some cards render as empty/placeholder
blocks and never fill in; refreshing the page — sometimes several times — eventually
shows the data. Observed on `/dashboard` (e.g. sales KPIs, Labor Coverage, Shift
Checklist, Instagram cards), but the human has not systematically mapped which cards or
which pages. Frequency is intermittent, not constant.

It is UNKNOWN whether this is:
- a rendering issue (Suspense/streaming boundaries that never resolve, client hydration
  errors killing islands, error boundaries swallowing failures silently),
- a data issue (Neon cold starts, connection pool exhaustion, Prisma timeouts, slow
  queries racing a timeout),
- an external-fetch issue (e.g. the Instagram feed or Square calls blocking or failing),
- a caching/revalidation issue (stale or failed RSC payloads),
- or something else entirely.

Do not assume. Diagnose.

## Phase 1 — Investigate (read-only on the codebase; STOP before any fix)

1. Read the dashboard and its cards end to end: `src/app/(app)/dashboard/` and every
   component/data-fetch it renders. Map how each card gets its data (server component
   direct fetch? client fetch? Suspense boundary? loading.tsx? error boundary?).
2. Identify every pattern that could produce "empty card until refresh":
   unhandled promise rejections, fetches without error states, Suspense fallbacks with
   no error path, `try/catch` blocks that return null/placeholder silently, missing
   `loading`/`error` files, hydration mismatches, uncached external calls on the
   render path (Instagram, Square), Prisma client instantiation issues, connection
   limits with Neon serverless.
3. Check Vercel runtime logs for the staging project for errors/timeouts correlated
   with dashboard loads (present the commands or steps for the human to pull logs if
   you cannot access them directly).
4. Where feasible, reproduce locally: `next dev` and `next build && next start`,
   hard-refresh the dashboard repeatedly, watch the terminal and browser console.
   Document what you observe, including anything you could NOT reproduce.
5. Present a plain-language diagnosis:
   - What you believe is happening and the evidence for it
   - Which cards/routes are affected and why those specifically
   - Ranked likely root cause(s), with confidence levels
   - What you ruled out
6. Propose a fix plan: smallest change that addresses the root cause, stated as
   scoped steps. If the honest answer is "need more evidence," say exactly what
   instrumentation or logging you'd add (as its own small approved step) to get it.
7. **STOP. No edits of any kind before the human approves a fix plan.**

## Scope containment

- This session touches ONLY what the approved fix plan covers. Unrelated issues
  noticed along the way are written down as text, not fixed.
- Do not modify HR-8 files, labor/forecast logic, or anything in `docs/` except (at
  the end, when told) a DECISIONS.md entry recording the root cause and fix.
- If the root cause implicates production too (likely, since prod runs the same code),
  SAY SO explicitly in the diagnosis — but the fix still ships to staging only in this
  session; prod promotion is a separate decision.

## Phase 2 — Fix (only after explicit approval of the plan)

Implement the approved plan in small steps. `next build` green. Present a staging
verification checklist specific to this bug (how the human confirms the cards now load
reliably — e.g. N hard refreshes across the affected pages with zero empty cards).
Stop before commit; commit to staging only when told; the human pushes.
