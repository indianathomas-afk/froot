# SEC-1 — Square OAuth callback hardening

**Track:** `SEC-` (new track — security fixes)
**Modules:** Square integration (`/api/square/*`)
**Roadmap:** New entry `SEC-1` — "Square OAuth callback org binding + state nonce" — status `in_progress`
**Target:** staging only. **Commit when I ask. Never push. I run all git commands.**

---

## Read first

- `docs/PERMISSIONS_INVENTORY.md` — §2 security-gap list, items on the Square surface
- `docs/ROADMAP.yaml`
- `docs/WORKFLOW.md`
- `docs/DECISIONS.md`
- `src/app/api/instagram/auth/route.ts` and `src/app/api/instagram/callback/route.ts` —
  the working reference implementation in this codebase

---

## The problem

Established by the PERM-1 audit:

- `GET /api/square/auth` sets `state = ${orgId}` — the Clerk org id verbatim. Not random,
  not signed, not persisted anywhere.
- `GET /api/square/callback` reads `code` + `state`, exchanges the code, and writes tokens
  with `where: { clerkOrgId: state }`. It never calls `auth()`. The session's org is never
  compared to `state`.
- `GET /api/square/auth` has **no role check**. Instagram's equivalent is `requireAdmin`.
- `POST /api/square/disconnect` requires only a session — no role check.

Consequence: any signed-in user of any org can complete an OAuth grant for their own Square
account with `state` set to another org's `clerkOrgId`, overwriting that org's Square tokens.
Cross-tenant credential planting, no elevated role required.

Single-tenant in production today, which is why this is a scheduled session and not a hotfix.
It is a hard blocker on onboarding a second merchant.

---

## Scope — do both parts

### Part A — org binding (match Instagram)
The callback must call `auth()` and reject before any token exchange unless the session's org
matches the org the tokens would be written to. Mirror Instagram's check.

### Part B — real state nonce
Neither flow has actual CSRF protection today; Instagram's equality check is a mitigation, not
a nonce. Replace the predictable `state = orgId` with a random, persisted, single-use value:

- Generated server-side at `/api/square/auth`, cryptographically random.
- Persisted server-side with the initiating org id and an expiry (short — minutes, not hours).
- Validated on callback: exists, not expired, not already consumed, and its stored org matches
  the session org.
- Consumed/deleted on use, and on failure.

**Storage is a fork — present options, don't pick.** A signed httpOnly cookie needs no schema.
A table needs an additive migration. Give me both with tradeoffs and wait for my call.

### Part C — role checks
Bring the Square surface in line with Instagram: `/api/square/auth` and
`/api/square/disconnect` should require ADMIN. Confirm against the inventory's contradiction
list (§3, the Square-vs-Instagram admin tier row) before changing, and tell me if anything in
the app currently depends on a non-admin reaching either route.

**Note:** Parts A and B preserve behavior for legitimate users. Part C *changes* behavior — a
MANAGER who could previously connect Square no longer can. That is the intent, but call it out
explicitly in your report as the one behavior change in this session.

### Also
`/api/square/auth` builds its URL from `NEXT_PUBLIC_SQUARE_APP_ID` while the callback exchanges
with `SQUARE_APPLICATION_ID` — two env vars for one application id. Report what each is set to
in staging and whether they match. **Do not change env vars.** If they diverge, tell me.

---

## Constraints

- Audit-first. Present a plan, wait for my explicit approval before editing.
- If Part B needs schema: **SQL first, for my approval, additive only.**
  **Echo the database host before running any migration.** Staging Neon branch only.
- Do not touch the Instagram routes. They're the reference, not the target.
- Do not fix anything else from `PERMISSIONS_INVENTORY.md` §2. The other gaps stay logged.
- Do not migrate any call site to `can()`. PERM-2 is a separate phase and the contradicted
  call sites are awaiting my rulings.
- No new dependencies without a presented case.
- `package-lock.json` committed with any dependency change.
- Never write to the sibling `froot_docs/` folder.

---

## Report back

1. What changed, file by file.
2. The state-nonce design that was implemented, and the failure modes it now rejects
   (replayed state, expired state, wrong-org session, missing state).
3. The Part C behavior change, stated plainly.
4. Env var finding — what each is set to, whether they match.
5. Whether an org with Square already connected is affected in any way by these changes
   (existing tokens must keep working — reconnect must not be required).
6. Out-of-scope findings, as text only.

---

## Done criterion

- `next build` passes.
- `docs/ROADMAP.yaml` `SEC-1` entry updated.
- `docs/PERMISSIONS_INVENTORY.md` §2 updated to mark the Square items resolved, with a
  reference to SEC-1. Leave every other §2 item untouched.
- `docs/DECISIONS.md` records the state-nonce approach chosen and why.
- Verified on staging: a legitimate ADMIN Square connect still completes end to end, and an
  already-connected org is unaffected.
