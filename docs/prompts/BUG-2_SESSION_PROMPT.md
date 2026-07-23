# BUG-2 — Staff Profile Linking Fails on Sign/Acknowledge — Session Prompt (diagnose-first)

Fresh Claude Code session on **UseFroot (Froot)**. App root: `~/Claude_Projects/Froot/froot`
(LOWERCASE `froot`; the capitalized parent is not the repo). Docs live in `docs/`
(ROADMAP, DECISIONS, MIGRATIONS, DEPLOY_LOG, WORKFLOW); prompts in `docs/prompts/`.
Read `CLAUDE.md` and `AGENTS.md` at root; per AGENTS.md read the Next.js 16 docs in
`node_modules/next/dist/docs/` before writing Next.js code.

Branch rules: all work on `staging`; you NEVER push and NEVER touch `main` (main
auto-deploys to production instantly). Commit to staging only when told; the human pushes.
Additive-only migrations (none expected here). `next build` must pass.

## The bug (reproduced on staging, commit 61eea85 era)

Setup: admin set StaffMember "Tommy Thomas" email to corporate@keva.com and sent the
invite. Invite email arrived, Accept worked, account created, user logged in successfully
as corporate@keva.com (Clerk account displays name "corporate").

Repro: logged in as that account, visiting /hr/acknowledge/[id] (also reachable via the
Sign link on /hr/documents) shows "No staff profile linked — Signing requires a staff
profile matching your email **(tommythomas)**".

The smoking gun: the identifier shown in the error is **"tommythomas" — a username-like
string, not an email address**. The lookup appears to be matching StaffMember.email
against the wrong Clerk identifier (username / firstName+lastName slug / some non-email
field) instead of the account's primary email address. If so, staff-profile linking can
never succeed for anyone, which blocks the entire HR signing flow (HR-7) and HR-8
checklist item 4.

Alternative hypotheses to check rather than assume: the StaffMember email save silently
failed or is whitespace/case-mismatched; the lookup uses primaryEmailAddress vs
emailAddresses[0] inconsistently; org-scoping excludes the record; the invite flow
created/linked a different identifier than the sign flow reads.

## Phase 1 — Diagnose (read-only, then STOP)

1. Find the staff-profile resolution code used by /hr/acknowledge and the Sign flow
   (likely in src/lib/hr*.ts or the route/page for acknowledge). Identify exactly which
   Clerk field it reads and how it matches StaffMember.
2. Compare with how OTHER staff-linked surfaces resolve the current user (e.g. /my/*
   routes or store-view attribution) — is there an inconsistent duplicate implementation?
3. Check what the error message interpolates — confirm what "(tommythomas)" actually is
   (username? identifier? name slug?).
4. Verify the data side: does the StaffMember row for Tommy actually hold
   corporate@keva.com (present the query; the human approves any direct DB reads per
   workflow — reads are fine, no writes).
5. Present a plain-language diagnosis: root cause, evidence, whether it affects
   production code paths too (it almost certainly ships with any promotion — say so
   explicitly), and the smallest fix. Case-insensitivity and trimming of email
   comparison should be considered as part of the fix if not already present.
6. STOP. No edits until the human approves the fix plan.

## Phase 2 — Fix (only after approval)

Smallest change that makes email matching correct and consistent everywhere staff
resolution happens (one shared helper preferred over patching one call site, if the
audit shows duplication). No schema changes expected. `next build` green. Present a
staging verification script for the human: log in as the Tommy account, Sign link on
/hr/documents resolves to the acknowledgment flow, complete SOME checkpoints (leave
mid-signing for HR-8 item 4), confirm /staff list + profile tabs reflect in-progress.
Stop before commit; commit staging-only when told; human pushes.

## Scope containment

Fix the linking bug only. Do NOT touch: HR-8 rollup logic, dashboard cards, staff
navigation/visibility, or anything from the upcoming staff-experience redesign
(STAFF-1) — those are separate phases. Unrelated findings are written down, not fixed.
At the end (when told), add a DECISIONS.md entry: root cause + fix, and note it was
caught by the HR-8 staging pass.
