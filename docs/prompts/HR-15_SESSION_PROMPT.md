# HR-15 Session Prompt — Rehire / Reactivate Terminated Staff

**Read this entire prompt before touching anything. Audit first, plan, get approval, then edit. Staging only. Commit only on my explicit word. Claude Code does not push.**

---

## Context

UseFroot repo: `~/Claude_Projects/Froot/froot` (lowercase `froot` is the repo). Next.js 16 App Router, React 19, TS, Prisma 7 on Neon (staging branch), Clerk multi-tenant auth (ADMIN / MANAGER / STORE / STAFF), shadcn/ui, Vercel (staging auto-deploys).

Read before starting:
- `docs/WORKFLOW.md` (session rules)
- `docs/DECISIONS.md` — the HR-7 entry (termination security model: terminated-not-deleted, Clerk access revoked on termination, access gated on ACTIVE StaffMember status) and the BUG-2 entry (never trust `public_user_data.identifier`; email resolution via `src/lib/clerk.ts` helpers; the staff-directory invite → PendingInvite → webhook-link flow is the canonical STAFF entry point)
- The UM-1 changes in `froot/src/app/api/users/[id]/route.ts` (STAFF demotion requires linked ACTIVE StaffMember — rehire must produce a state consistent with that rule)

## The problem (HR-15)

There is no way to bring back a terminated staff member. Termination is (correctly) not deletion — the StaffMember row, HR records, signed documents, and training history all survive — but no reactivation path exists. Real juice shops rehire constantly: seasonal staff, boomerang employees. Concretely: test employee **Tommy Thomas** (Las Brisas) was terminated on staging and now cannot be reactivated, which also blocks UM-1 verification (he is the only linkable STAFF test user).

## Product intent

A **Reactivate** action on a terminated staff member that:
1. Returns the StaffMember to ACTIVE status.
2. Offers to send a fresh login invite (staff-directory flow, so the PendingInvite carries role STAFF + store assignment and the fixed webhook links on acceptance). Rehire and invite are separable — a manager may rehire someone days before re-issuing a login — but the default happy path is "reactivate + invite" in one motion.
3. Preserves all history: prior signed documents, training records, and acknowledgments remain attached and visible. Nothing is cloned or reset. (Whether re-signing is *required* after rehire is a compliance-policy question — see Fork 2 below — but the records themselves are never touched.)

## Hard constraints

- **Terminated-not-deleted stays inviolate.** Reactivation flips status; it never creates a duplicate StaffMember, never touches existing HrSignedRecord / FormSubmission / training rows.
- **Old logins stay dead.** Termination revoked Clerk access (and in Tommy's case the Clerk account no longer exists). Reactivation must NOT resurrect any old User-row linkage: audit what `StaffMember.userId` holds after termination and ensure the rehire path results in a clean re-link via the invite flow, not a stale pointer to a dead/revoked account. If a stale userId link survives termination, clearing it on reactivation (or on termination — your call, present it) is in scope.
- **All email handling** through `normalizeEmail` / existing `lib/clerk.ts` + `lib/hr.ts` helpers (BUG-2 rule). Never `identifier`.
- **AuthZ:** ADMIN and MANAGER can reactivate (mirror whoever can terminate today — audit and match; if today termination is ADMIN-only, keep reactivate ADMIN-only and say so).
- **No schema changes expected.** If status enum or audit fields genuinely need additions, stop and present the case first; additive-only regardless.

## The Square question (audit this carefully — likely the main fork)

Square sync maps Square-INACTIVE team members to terminated in Froot. The audit must answer:
1. Where does that sync run (webhook? on-demand "Import/Sync from Square"?) and what field(s) does it write?
2. **The re-termination race:** if I manually reactivate Tommy in Froot but his Square team-member record is still inactive (or absent), will the next sync immediately terminate him again? If yes, propose the smallest resolution — options to evaluate, not prescriptions: only auto-terminate on an observed ACTIVE→INACTIVE *transition* rather than on absolute state; or a `manuallyReactivatedAt` timestamp the sync respects; or surface a warning in the reactivate dialog ("this person is inactive in Square — reactivate there too or they may be re-terminated on next sync"). Recommend one with rationale.
3. Does rehire-in-Square (INACTIVE→ACTIVE) currently flow into Froot at all? If Square rehire already auto-reactivates in Froot, the feature may be smaller than assumed — report what exists before building.

## Fork 2 — compliance policy on rehire (present, don't decide)

When someone is rehired, are their old handbook acknowledgments and agreements still "current," or does rehire reset their compliance state (they must re-sign)? This changes HR-8 dashboard math (a rehired person with old signatures could show compliant when policy says they shouldn't). Audit how compliance status is computed relative to StaffMember status, present the options plainly, and stop for my decision — do not implement a policy choice unilaterally. (Likely answer: re-signing on rehire is the safe default for agreements with re-sign cadences, but I want to see what the data model makes natural.)

## Scope containment

- **In scope:** the Reactivate action (staff directory UI + API route), termination-path audit as needed to place it, the Square-sync interaction fix chosen from the fork, stale-userId hygiene on terminate/reactivate.
- **Out of scope — do not touch:** the Clerk webhook's email-resolution logic (BUG-2, just fixed — read, don't edit; if the chosen Square-sync fix requires webhook changes, present that explicitly before writing them), UM-1's /users routes, HR dashboard computation changes beyond what Fork 2's *approved* decision requires, STAFF-1 work, prod anything. Other findings: note as text.

## Phases

**Phase 1 — Audit (read-only).** Map the termination path end-to-end (manual terminate + Square-sync terminate): what fields change, what happens to `userId`, Clerk revocation mechanics, and the three Square questions above. Present current-state, both forks with recommendations, and a fix plan with file list. **Stop for approval.**

**Phase 2 — Implement** per approved plan. `next build` must pass.

**Phase 3 — Verification checklist** for staging, which must include the Tommy end-to-end: reactivate Tommy Thomas (Las Brisas) → send invite to corporate@keva.com → I accept → confirm STAFF role, `StaffMember.userId` linked, store assignment applied, PendingInvite consumed, history intact (prior signed docs visible), and — per the Square fork's chosen fix — a sync run does NOT re-terminate him. Note: this then unblocks the outstanding UM-1 checks (names display on /users, role round-trip with Clerk agreement).

**Done criteria:** build green, checklist delivered, DECISIONS.md session notes drafted (including both fork decisions and the Square-sync behavior). Commit only on my word, staging only. I run the push.
