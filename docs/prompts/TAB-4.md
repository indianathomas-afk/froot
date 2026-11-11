Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/TAB-4.md and run it.

# TAB-4: Per-person PIN on shared tablets (audit first, then STOP for Gary's rulings)

**TIER 3 (expected).** This phase adds a schema change, a new verification route, and a change to how a shared login records who did the work. Declare the tier before writing anything.

**THIS IS AN AUDIT-THEN-STOP PROMPT.** Gary has not ruled on any of this yet. Everything under "Leans" (§3) is the planning chat's recommendation, not a ruling.

1. Run §0–§2.
2. Write `docs/prompts/TAB-4_AUDIT.md`.
3. Put the leans to Gary in plain words, then STOP.
4. Build nothing and generate no migration until he answers.
5. Record only his actual words as rulings.

## 0. Repo gate

1. Confirm the working directory is the git root `/Users/garythomas/Claude_Projects/Froot/froot` (lowercase `froot`).
2. Confirm the branch is `staging`, the tree is clean, and `origin/staging` is at or after `f3e5695` (the TAB promotion docs pass). `main` is at `8417fc3`.
3. Paste `git log --oneline -5`.

If any check fails, STOP and report.

`docs/prompts/TAB-4.md` is expected to be untracked. Leave it unstaged for PRE-PUSH-CHECK.

## 1. Context

Tablet mode (TAB-1 → TAB-9) shipped to production in merge `8417fc3` on 2026-11-10.

TAB-1b gave the tablet attribution parity with desktop:

- The first tick opens "Who's completing these?" with the store's staff list, plus the generic "Team Member" and "Manager" options.
- Every tick then records that person in `completedByStaffId`.
- A "Completing as … · Change" chip carries the name forward. It clears on submit, on reload, and when the checklist changes.

The TAB-4 row was then narrowed to anything **beyond** parity, with a per-person PIN as the example.

**The gap:** on a shared counter iPad, anyone can tap anyone's name. Nothing proves who actually did the task. Server-side, `POST /api/checklists/[id]/task-log` accepts whatever `completedByStaffId` it is sent. That is true on desktop as well.

## 2. Audit (read-only)

Answer each point in `TAB-4_AUDIT.md`.

1. **Staff model.** What the staff record holds today. Which staff have their own logins and which don't. How the picker's list is built: active staff, assigned to the store, and org-scoped.
2. **Task-log write path.** How `completedByStaffId` is validated today. Does it check that the staff member belongs to the store or org? Where would a "proof" check have to sit so that it is actually enforced, not just a UI gate?
3. **Secrets and hashing without a new dependency.** What hashing is already available. Node's built-in `crypto.scrypt` is the lean. Which secret could sign a short-lived verification token, for example an existing server secret with HMAC from `crypto`.
4. **Rate limiting.** Is there an existing pattern for counting failed attempts or locking out? If not, what is the smallest schema that supports it?
5. **Where a PIN would be set.** Look at `/staff/[id]`, `/my`, and the existing capability model (PERM-8 / `grantedCapabilities`). Who can set or reset a staff member's PIN today?
6. **Settings home.** Which existing settings page an org-level "Require PIN on shared tablets" switch belongs on.
7. **Audit logging.** Can PIN set, reset, failure and lockout events go into the existing AuditLog without schema changes?
8. **Desktop picker.** Confirm desktop's "Who completed this task?" code path, so the build can leave it unchanged.

## 3. Leans for Gary (recommendations, not rulings)

Put each lean to Gary as a yes/no or a pick, then STOP.

1. **Off by default, per org.** A new org setting, "Require a PIN on shared tablets", defaults to off. Nothing changes for anyone until an ADMIN turns it on.
2. **Tablet only in v1.** It applies in Tablet mode only. The desktop picker is unchanged, because desktop is usually a personal login.
3. **The flow.** First tick → name sheet → tap a name → PIN pad (reuse the TAB-1 number pad) → verified → the "Completing as …" chip appears. Following ticks use the chip, as they do today.
4. **The PIN.** 4 digits, stored only as a salted `scrypt` hash (no new dependency), and never shown back to anyone.
5. **Who sets it.**
   - ADMIN, and MANAGER for staff in their own stores, can set or reset a staff member's PIN on `/staff/[id]`.
   - Staff who have their own login can change their own PIN on `/my`.
   - A reset forces a new PIN. Nobody can see an existing PIN.
6. **Staff without a PIN, while PINs are required.** Their name shows greyed out with "No PIN — ask a manager", and it can't be picked.
7. **Generic options.** While PINs are required, "Team Member" and "Manager" are hidden, so every tick has a verified named person.
8. **Real enforcement, not just UI.**
   - A successful PIN check returns a short-lived signed token (HMAC, about 10 minutes) for that staff member and store.
   - While the org setting is on, the task-log route **refuses** a Tablet-mode tick unless it carries a valid token for the same `completedByStaffId`.
   - Tokens expire; they are not stored.
9. **Lockout.** 5 wrong PINs for one name locks that name for 5 minutes. Each lockout writes an AuditLog row. Successful checks write nothing (too noisy). Set and reset events write a row.
10. **Chip timeout.** Because a PIN proves identity, the "Completing as …" chip also clears after 5 minutes idle (the TAB-9 idle timer). The next person to walk up has to enter their own PIN.
11. **Messages unchanged.** Messages from the tablet still post as the logged-in account. A PIN on messages would be a separate row.

## 4. Build (only after Gary rules)

Build exactly what he ruled.

**Migration rule from CLAUDE.md:**

- Generate the migration with `prisma migrate diff` only.
- STOP after generating it. Gary applies it to dev himself before any commit.
- Never run `migrate dev`, `migrate deploy`, `migrate reset` or `db execute`.

**Fixtures.** Add `scripts/verify-tab4-pin.ts`. It must cover:

- hash and verify
- a wrong PIN
- lockout after 5 failures, and unlock after the window
- token sign, verify and expiry
- a token for another staff member or another store is refused
- task-log refused without a token while the setting is on, and accepted while it is off
- the generic options hidden while the setting is on

Re-run every existing tablet fixture at its current count.

**Local check.** Use a temporary mocked page and delete it before committing.

## 5. Rules

- No new dependencies.
- `npm run build` and scoped eslint must be green.
- Stage only the files this session touches.
- Commit, never push. Say "committed, NOT pushed".

## 6. Commits (after the build)

1. **Work commit**, including the migration.
2. **Docs commit:**
   - **`docs/ROADMAP.yaml`:** TAB-4 moves to the status the file's conventions give a phase that is built but not yet checked. Preserve and mark; delete nothing.
   - **`docs/DECISIONS.md`:** a DRAFT TAB-4 entry with Gary's rulings quoted, for ratification at PRE-PUSH-CHECK.
   - **`docs/MIGRATIONS.md`:** the new migration.

## 7. Report

**After the audit:** the path to `TAB-4_AUDIT.md`, the answers in brief, and the leans put to Gary. Then STOP.

**After the build:** the tier, both SHAs, the migration name and its exact `prisma migrate diff` command, the files touched, the findings, and the staging test list.

Draft staging tests (adjust to what was built):

1. **Setting off by default.** With the setting off, the tablet behaves exactly as today.
2. **Setting on.**
   - As ADMIN, set PINs for two staff on `/staff/[id]`.
   - Turn the setting on.
   - The generic options are gone.
   - A staff member with no PIN shows greyed out.
3. **Correct PIN.** Pick a name, enter the correct PIN, and the tick saves with that name (check it on desktop).
4. **Lockout.** Enter a wrong PIN 5 times. That name locks for 5 minutes, and an AuditLog row exists.
5. **Idle clear.** Leave the chip for 5 minutes. It clears, and the next tick asks for a name and PIN again.
6. **Messages.** Posting a message still works without a PIN.
7. **Desktop.** The desktop picker is unchanged.
