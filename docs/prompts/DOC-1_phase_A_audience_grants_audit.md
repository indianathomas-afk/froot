# DOC-1 Phase A — Document audience grants: schema + policy choke point

TIER 3 — structural. Plan-first with hard stops. One phase, no riders.

## What this session is

The document library (`/hr/documents`) is moving from "every document is
visible to every org member" to "a document is visible to its assigned
audience." This is Phase A of three: the grant table, the backfill posture,
and the audience-aware rewrite of the read-policy choke point. No UI in this
phase — the assign dialog is Phase B, the read surfaces and audience-scoped
signing counters are Phase C.

Work on `staging`. Do not push — Gary runs all pushes. Two-commit pattern:
work commit, then docs commit citing the work SHA. `npm run build` gates
commits; lint does not (DEBT-33). Two untracked draft files exist in
`docs/prompts/` (`CLAUDE_md_session_tiers_DRAFT_1.md`,
`FROOT_planning_chat_template.md`) — leave them untouched and unstaged.

Starting state, verified 2026-08-12: all four refs level at `b853787`
(HEAD -> staging, origin/staging, origin/main, main).

## Ratified rulings (Gary, 2026-08-12 — transcribe from ROADMAP.yaml if the
board wording differs; the board wins)

1. **Standing grants, not snapshots.** Store and company grants resolve
   through the staff roster at read time. New hires and transfers pick up
   the correct documents automatically. No materialized assignment sweep.
2. **Fresh start, verified.** No backfill migration is expected to be
   needed — Gary states no production documents exist. This claim is
   verified, never trusted (see hard stop 4).
3. **Assignment is ADMIN-only for v1**, built on the canManage/canAssign
   seam pattern from `/hr/training` so a later widening to MANAGER is a
   gate change, not a rewrite. Manager attest-signing privileges unchanged.
4. **Signed records are permanent** regardless of later grant changes (G1
   culture extended). Signing-status counters will count the assigned
   audience, not the org (Phase C implements; Phase A must not preclude).
5. **Grants target staff members only.** COMPANY and STORE grants resolve
   through the roster. STORE login accounts (shared iPads) display store-
   and company-granted Reference documents and may display Acknowledgment
   documents read-only; the signing act stays in the existing per-person
   flows.
6. **Corporate staff (no store home base) are never reached by STORE
   grants.** COMPANY grants cover them; individual STAFF grants always
   available. Identical to the training bulk-assign rule.
7. **For Acknowledgment documents, assignment = obligation to sign.** One
   lever; no separate must-sign list. Compliance denominators follow the
   roster.
8. **No hard delete.** Visibility uses the existing `isActive` pattern —
   hide, never shred, especially anything ever signed.

## Scope of Phase A

1. **Audit (read-only, before any plan):**
   - Read `prisma/schema.prisma` — `HrDocument`, `HrDocumentVersion`,
     acknowledgment/checkpoint models, staff/store/roster models, and how
     STORE-role users are scoped to a store.
   - Enumerate EVERY call site of `canReadHrDocument` in `src/lib/hr-files.ts`
     and every HR read path that delivers document metadata or bytes:
     the `/hr/documents` page query, `[id]/download`, the signing surfaces,
     `/my` staff-portal reads, and any manager attest path. For the attest
     path specifically, confirm whose access is checked — the rule going
     forward is the STAFF MEMBER's grant, not the manager's.
   - Any read path that does NOT route through `canReadHrDocument` (or a
     single equivalent choke point) is a RULING NOW: stop, report the path,
     wait.
2. **Plan (hard stop before any file is written):** propose
   - The grant table. Expected shape, adjust to fit the real schema:
     `HrDocumentGrant` — `id`, `documentId`, `granteeType`
     (`COMPANY | STORE | STAFF`), nullable `storeId`, nullable
     `staffMemberId`, `createdById`, `createdAt`, with uniqueness per
     (documentId, granteeType, storeId, staffMemberId) and check-style
     integrity (STORE rows carry storeId only, STAFF rows staffMemberId
     only, COMPANY rows neither). Additive only — no column drops, no
     alterations to existing tables beyond relations.
   - The policy rewrite: `canReadHrDocument` (or its successor) becomes
     audience-aware. Design honestly around the sync/async question — the
     current function is synchronous and pure; grant resolution needs data.
     Prefer: load the document's grants alongside the document at each call
     site (or via one shared loader) and keep the policy function pure,
     taking `(doc, grants, viewer)` — so the choke point stays a single
     testable function. If a different shape fits the codebase better,
     propose it with reasons; do not silently fork the policy into
     per-route logic.
   - Semantics the policy must implement: COMPANY grant → every org member
     with a linked staff record, plus corporate staff; STORE grant → staff
     whose current roster store matches, and STORE-role logins scoped to
     that store (Reference display + Acknowledgment read-only per ruling 5);
     STAFF grant → that staff member and their linked user. ADMIN retains
     full read (document config is already ADMIN territory per HR-2).
     A document with ZERO grants is visible to ADMIN only — this is the
     deliberate default for newly uploaded documents until Phase B's dialog
     assigns an audience.
   - Behavior flag / sequencing: because Phase B (assign UI) and Phase C
     (read surfaces) land later, state explicitly in the plan how staging
     behaves between phases — with zero grants on the test documents, the
     staging library will appear empty to non-admins after Phase A. That is
     expected and acceptable on staging; say so in the plan so nobody
     "fixes" it.
3. **Execute after approval:** migration + policy rewrite + call-site
   updates. No UI changes, no new routes.

## Hard stops (each one ends in a report to Gary and a wait)

1. After the audit, before the plan is written.
2. After the plan, before any file is touched.
3. Before any migration runs: present the exact SQL, then echo the database
   host and confirm it is the staging direct endpoint (no `-pooler`
   suffix). Staging branch is `br-square-feather`. NEVER touch
   `preview/main` — it is a fossil.
4. Before Gary promotes (note for the promotion checklist, not this
   session): run on PRODUCTION (`br-sparkling-block`)
   `SELECT count(*), current_database() FROM "HrDocument";` with the branch
   column in the same output. Zero → fresh-start ruling holds and no
   backfill ships. Nonzero → STOP; a COMPANY-grant backfill for existing
   rows becomes a RULING NOW back in planning chat.

## Evidence rules (absolute)

- Every database result must carry the branch identity in the same output —
  dev `br-broad-wave` / staging `br-square-feather` / production
  `br-sparkling-block`. Row IDs alone never identify a branch.
- Browser observations name the org id (`org_3G02wO4QlVVSWppi8aqlnSZnsDa`)
  and Clerk instance (`verified-snapper-7`), captured before testing.
- No `&&` command chains; commands one at a time, results read before
  proceeding. Re-measure, don't cite.

## Session end

Scope triage before the report: FIX NOW / RULING NOW / COMMENT NOT A ROW /
ROW. New rows are the last resort. Report in plain English first, with the
work SHA and docs SHA named. Do not push.
