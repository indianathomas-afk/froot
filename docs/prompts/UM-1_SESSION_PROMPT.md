# UM-1 Session Prompt — User Management Fixes (/users)

**Read this entire prompt before touching anything. Audit first, plan, get approval, then edit. Staging only. Commit only on my explicit word. Claude Code does not push.**

---

## Context

UseFroot repo: `~/Claude_Projects/Froot/froot` (lowercase `froot` is the repo). Next.js 16 App Router, React 19, TS, Prisma 7 on Neon (staging branch), Clerk multi-tenant auth (roles: ADMIN / MANAGER / STORE / STAFF), shadcn/ui, Vercel (staging branch auto-deploys to staging env).

Read before starting:
- `docs/WORKFLOW.md` (session rules)
- `docs/DECISIONS.md` — especially the BUG-2 entry (commit `3c7d0a0`): Clerk `public_user_data.identifier` must never be trusted as an email; the shared helper `src/lib/clerk.ts` (`normalizeEmail`, `getClerkPrimaryEmail`) now exists and must be used for any email resolution.
- The Clerk webhook at `src/app/api/webhooks/clerk/route.ts` — it derives Froot `User.role` from the Clerk org membership role (`org:admin` → ADMIN, `org:member` → STAFF) and its upsert now self-heals email and role on membership events.

## The problem (UM-1)

The `/users` page (User Management) has three defects, all confirmed in real use:

1. **No names.** The member list shows emails only. Users have names (via linked `StaffMember` records and/or Clerk profile data) that should be displayed.
2. **Edit User dialog has no STAFF option.** Roles can be edited but STAFF is missing from the role selector, so a user can be upgraded but never downgraded to STAFF. This is not hypothetical: during BUG-2 investigation, a test user was upgraded to ADMIN on this page and could not be downgraded, causing a Froot-vs-Clerk role divergence that cost real debugging time.
3. **CRITICAL — role edits don't touch Clerk.** This is the root defect behind #2's blast radius. The BUG-2 session proved that the Clerk org membership role is the effective source of truth: the webhook rewrites `User.role` from the Clerk membership on every membership event, and the upsert now self-heals role. **Any role change made only in the Froot DB will be silently overwritten by the next webhook event.** Role changes on /users MUST update the Clerk organization membership role via the Clerk Backend API (and may update the local row optimistically), or they are lies.

## Hard requirements

- **Clerk is the source of truth for roles.** The Edit User flow must call the Clerk Backend API to update the org membership role (`org:admin` for ADMIN; `org:member` for MANAGER / STORE / STAFF — note Froot's finer-grained roles below), then update the Froot row. If the Clerk API call fails, do not update the Froot row; surface the error.
  - **Open question you must resolve in the audit before proposing a fix:** Clerk memberships only carry `org:admin` / `org:member`, but Froot has four roles. Determine how MANAGER / STORE / STAFF are currently distinguished (Froot DB only? Clerk metadata?) and confirm what the webhook actually overwrites. If the webhook only maps admin↔member and the finer roles live purely in Froot's DB, document exactly which transitions are webhook-safe and which aren't, and design accordingly. Do not guess — read the code and report.
- **Demotion to STAFF requires a linked, ACTIVE StaffMember.** A user cannot be set to STAFF unless a `StaffMember` row exists in the org with `userId` linked to them (or linkable by normalized email match using the `lib/clerk.ts` / `lib/hr.ts` helpers). If none exists, block with a clear message directing the admin to the Staff directory invite flow. Rationale: STAFF users are person-scoped throughout HR; an unlinked STAFF user is a broken state.
- **Last-admin guard.** Block any change (demotion or deletion) that would leave the organization with zero ADMIN users. Server-side enforcement, not just UI.
- **Names display.** Show a display name alongside the email for each member. Resolution order: linked `StaffMember` name → Clerk user first/last name (if cheaply available from data already fetched) → fall back to email only. Do NOT add a per-member Clerk API call on every render; if Clerk names require per-user API calls, use StaffMember names only and note the limitation.
- **All email handling** goes through `normalizeEmail` / existing helpers. Never read or persist `public_user_data.identifier` as an email (BUG-2 rule).
- **Server-side authorization:** only ADMIN can change roles; a user cannot change their own role (prevents self-demotion lockout combined with last-admin edge cases — enforce and test both).

## Scope containment

- **In scope:** `/users` page and its API routes (`api/users/*`), the Edit User dialog, role-change server logic, names display.
- **Out of scope — do not touch:** the Clerk webhook (just fixed in BUG-2; read it, don't edit it), the staff directory / invite flow, HR module pages, STAFF-1 dashboard work, `organization.deleted`/`user.deleted` fossil cleanup (that's HR-14 territory). Anything else you notice: note as text, don't fix.
- **No schema changes expected.** If you believe a migration is required, stop and present the case before writing it. Additive-only rules apply regardless.

## Phases

**Phase 1 — Audit (read-only).** Read the /users page, its API routes, the Edit User dialog, and the webhook's role-derivation path. Answer the open question above (how the four Froot roles map onto Clerk's two membership roles, and exactly what the webhook overwrites). Produce: current-state description, the role-mapping truth table, and a concrete fix plan with file list. **Stop and wait for my approval.**

**Phase 2 — Implement** per the approved plan. `next build` must pass.

**Phase 3 — Verification plan.** Give me a manual test checklist I can run on staging, covering at minimum:
- Names render for members with linked StaffMembers; email-only fallback works.
- Upgrade STAFF → MANAGER → ADMIN and back down to STAFF; after each change, confirm the Clerk dashboard membership role agrees AND that a subsequent webhook event (e.g., trigger a membership update) does not revert the role.
- Demotion to STAFF blocked when no linked StaffMember exists, with the correct message.
- Last-admin guard: attempt to demote/delete the only ADMIN — blocked server-side.
- Self-role-change blocked.

**Done criteria:** build green, Phase 3 checklist delivered, session notes drafted for DECISIONS.md (including the role-mapping truth table). Commit only when I say so, staging only. I run the push.
