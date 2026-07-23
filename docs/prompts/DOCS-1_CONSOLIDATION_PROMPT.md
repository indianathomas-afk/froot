# DOCS-1 — Consolidate Documentation into `docs/` — Session Prompt (audit-first)

> **Completed 2026-07-22.** Docs consolidated into `docs/` (prompts under `docs/prompts/`),
> `STAGING_DEPLOY_LOG.md` renamed to `docs/DEPLOY_LOG.md`, references updated. The instructions
> below are preserved verbatim as the historical record of this session — the paths they cite
> (root-level docs, `STAGING_DEPLOY_LOG.md`) reflect the pre-consolidation layout.

You are working in a fresh Claude Code session on **UseFroot (Froot)**. This is a small,
scoped housekeeping session: consolidate all project documentation into a single `docs/`
tree inside the repo, preserving git history. No feature work.

**App root:** `~/Claude_Projects/Froot/froot` — the LOWERCASE `froot`. The capitalized
parent `Froot` is NOT the repo (no `.git`). Run everything from the lowercase `froot`.

**Branch rules:** all work on `staging`. You never push, and you NEVER touch `main`
(main auto-deploys to production). Commit only when the human says commit. The human
runs the push.

## Why this session exists

Docs currently live in two places:
1. **Inside the repo** at the app root (`ROADMAP.md`, `DECISIONS.md`, `LABOR.md`, etc.)
2. **Outside the repo** at `~/Claude_Projects/Froot/froot_docs/` — a parent-level folder
   that is NOT under git. Files there are unversioned and invisible to sessions.

Goal: one predictable, versioned home inside the repo so future sessions never hunt.

## Target structure

```
froot/
├── CLAUDE.md          ← STAYS at root (Claude Code auto-reads it)
├── AGENTS.md          ← STAYS at root (same reason)
├── README.md          ← STAYS at root (repo convention)
├── docs/
│   ├── ROADMAP.md
│   ├── DECISIONS.md
│   ├── MIGRATIONS.md
│   ├── LABOR.md
│   ├── FORECASTING.md
│   ├── WORKFLOW.md
│   ├── STAGING_SETUP.md
│   ├── DEPLOY_LOG.md            ← RENAMED from STAGING_DEPLOY_LOG.md (see below)
│   ├── TEMPLATES_IMPORT_EXPORT.md
│   └── prompts/
│       ├── HR-8_SESSION_PROMPT.md
│       ├── L-3_PROD_PROMOTION_PROMPT.md
│       ├── (all Labor_Phase_*_Session_Prompt.md files)
│       └── (any other *_Prompt.md / *_PROMPT.md session prompts at the root)
```

Notes:
- **The rename:** `STAGING_DEPLOY_LOG.md` → `docs/DEPLOY_LOG.md`. It already logs both
  staging and production events (see its 2026-07-21 prod-promotion entry and the flag
  inside it recommending this rename). Add a one-line note at the top of the file:
  "Renamed from STAGING_DEPLOY_LOG.md 2026-07-22 — logs both staging and prod deploys."
- **Files from the parent `froot_docs/`:** copy in any session-prompt or doc `.md` files
  that belong to this project (e.g. `HR-8_SESSION_PROMPT.md`, `claude_prompt.md`,
  `L-3_Weekly_*_Prompt.md`) into `docs/prompts/` — these are new adds to git, not moves.
  Leave images (.webp), main.css, the dashboard-design folder, and the .docx brief where
  they are — they are reference assets, out of scope. List what you found and what you
  are and are not bringing in as part of your plan.
- If you find root-level `.md` files not on the list above (other than CLAUDE/AGENTS/
  README), include them in your plan with a proposed destination — don't silently skip
  or silently move them.

## Phase 1 — Audit (read-only, then STOP)

1. List every `.md` file at the app root and in the parent `../froot_docs/`.
2. Grep the repo for references to each filename being moved or renamed
   (`grep -rn "STAGING_DEPLOY_LOG\|ROADMAP.md\|DECISIONS.md\|MIGRATIONS.md\|LABOR.md\|FORECASTING.md\|WORKFLOW.md\|STAGING_SETUP.md\|TEMPLATES_IMPORT" --include="*.md" --include="*.ts" --include="*.tsx" --include="*.json" .`
   plus check `scripts/` and `package.json` for any path references).
3. Present the full move map: old path → new path for every file, every reference that
   needs updating (file + line), and the parent-folder files you propose to bring in.
4. **STOP and wait for explicit approval.**

## Phase 2 — Execute (only after approval)

1. `mkdir -p docs/prompts`
2. Use **`git mv`** for every tracked file (preserves history). Plain `mv` + `git add`
   for the parent-folder files coming into the repo (they're untracked).
3. Do the `STAGING_DEPLOY_LOG.md` → `docs/DEPLOY_LOG.md` rename and add the header note.
4. Update every reference found in the audit — including references inside the moved
   docs themselves and inside the session prompts (e.g. HR-8_SESSION_PROMPT.md says docs
   are "at the app root"; update it to point at `docs/`).
5. Verify: `git status` shows renames (R) not delete+add; `next build` passes (docs
   moves shouldn't affect the build, but confirm nothing imports from a moved path).
6. Present the full diff/status summary and STOP. Commit only when told — one commit,
   `staging` only, suggested message:
   `docs: consolidate all documentation into docs/, rename deploy log`
   The human pushes.

## Scope containment

This session moves and re-references files. It does not edit doc content beyond the
DEPLOY_LOG header note and reference-path updates. Anything else you notice, write it
down as text for the human — do not fix it.
