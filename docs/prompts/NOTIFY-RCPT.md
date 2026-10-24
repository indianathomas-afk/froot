Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/NOTIFY-RCPT.md and execute it.

# NOTIFY-RCPT — per-email-type recipients + org address book

**TIER 3** (schema + recipient logic). This session runs **Phase 1 (audit) only**, writes the audit file, and **STOPS**. Nothing is built until Gary rules on the forks and says go.

## Why
Today each email type decides its own recipients its own way: signed acknowledgments use the org list `Organization.hrAckRecipients`; pace alerts and milestones are role-based (admins + the relevant store's managers) with per-user denial via `notify.*.receive` capabilities. Gary plans many more email types and 100+ orgs. Goal: **one recipient model every email type plugs into**, set by each org's ADMIN on `/settings/notifications`, with no per-org setup outside the app.

## Target model (draft — the audit tests it against the code)
- **Email-type registry in code** (not the DB): key, label, role default (which roles, store-scoped or org-wide, or none), whether "also send to" is allowed. Adding an email type = one registry entry.
- **Per org, per email type:** an "Also send to" list (up to 10) drawn from the org address book and/or Froot users.
- **Org address book:** named outside contacts (name + email) any email type can pick — corporate@, an accountant, an owner who never logs in. Entered once, reused everywhere.
- **Per-user denial stays as is** (NOTIFY-2c, Edit User dialog). Standing rule holds: `notify.*` keys only remove a person from an email, never add one.
- **One email per address per send** after merging role default + extras − denials.
- Every send's audit metadata records each recipient and why they got it (`role`, `extra-user`, `extra-contact`).
- UI: each email-type card on `/settings/notifications` gets a Recipients section — read-only role-default line (link to Users), "Also send to" picker, and one "Contacts" card on the hub to manage the address book. ADMIN only.

## Phase 1 — audit (read-only)

### Repo gate (report each, stop on surprise)
1. `git rev-parse --abbrev-ref HEAD` → `staging`
2. `git status --short` → clean
3. `git log --oneline -1` → expect `cd62c36`; `git log --oneline main..staging` and `git log --oneline staging..main` → both empty

### Read and report
1. **Every email consumer.** Grep for every caller of the sender in `src/lib/notify.ts` (and anything that builds an `EmailMessage`). For each: file, trigger (event/cron/route), how recipients are computed today (quote the query or function), whether it is store-scoped, which `notify.*` capability gates it if any, and where its org-level on/off toggle lives.
2. **`hrAckRecipients`** — every read and write (schema, routes, settings UI, HR-15b rehire path, R1 `recordMissing` path, fixtures). Current row count with a non-empty list: give Gary the SQL to run in the Neon console on `br-square-feather` and `br-sparkling-block`; do not connect yourself.
3. **Capabilities** — list every `notify.*` key in `ENFORCED_CAPABILITIES` / `GRANTABLE_CAPABILITIES` and where `can()` filters recipients. Confirm whether milestone emails have their own denial key.
4. **`/settings/notifications`** — current card structure, the ADMIN gate, and which components/routes would host a Recipients section.
5. **Recent emails** — what metadata the Notification AuditLog rows store today, so the "why" field is additive.
6. **Schema landing spot** — propose table and column names (e.g. a contact table, a per-org-per-type setting table, a join for picks). Note cascade behaviour when an org, user or contact goes away, and how a departed user (DEBT-106) would show up in a pick list.
7. **ROADMAP** — next free NOTIFY id and next free DEBT id (read the file; never assume). Note any planned row this overlaps.
8. **Dev migration level** — run `npx prisma migrate diff` the way prior TIER 3 audits did and report whether it is empty. If it is not empty, STOP and tell Gary which migration dev is missing. Never run `migrate dev`, `deploy`, `reset` or `execute`.

### Forks for Gary (state each with the lean; add any the code raises)
- **F1 — existing `hrAckRecipients`.** Lean: the migration backfills each address into the org address book and into the signed-ack type's "Also send to"; the old column stays in place but is no longer read (preserve-and-mark, drop later with a row).
- **F2 — can "Also send to" pick Froot users, or only contacts?** Lean: both. A user pick is stored by user id, so it follows their Clerk email.
- **F3 — a user who is denied but also picked as an extra.** Lean: denial wins — one off switch per person.
- **F4 — store-scoped emails (pace alerts) and extras.** Lean: extras get every store's alert; per-store extras deferred.
- **F5 — deleting a contact.** Lean: archive, not hard delete (audit rows keep meaning); archived contacts drop out of every pick list and stop receiving.
- **F6 — can an org switch off a type's role default** ("pace alerts only to Jennifer")? Lean: not in this phase; per-user denial already covers it person by person. File as deferred.
- **F7 — who manages contacts and picks.** Lean: ADMIN only, same as the existing settings.

### Out of scope (file as ROW only if the audit proves it's needed)
Scheduling (send time, days, frequency, digests) — the next NOTIFY phase, built on top of this. Employee-facing emails. Reply-to. DEBT-120 console-mode warning.

### Output
Write `/Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/NOTIFY-RCPT_AUDIT.md` with the findings, the proposed schema, the forks with leans, and the build plan below adjusted to what you found. Commit nothing. Report a short summary in chat and **STOP**.

## Build plan (for after Gary rules — do not start)
1. Schema + migration via `prisma migrate diff` only. **STOP** — Gary applies it to dev with `npx prisma migrate deploy` and says go.
2. Registry + one recipient resolver that every consumer calls (replace each consumer's own recipient code; behaviour for an org with no extras must be byte-identical to today).
3. Hub UI: Recipients section per card + Contacts card.
4. Fixture: every consumer through the resolver; no-extras orgs unchanged; extras deduped; denial beats extra; archived contact excluded; backfilled ack list matches the old column exactly.
5. Commits: work, then docs (ROADMAP row, DECISIONS.md draft rulings for Gary to ratify). Scoped `git add`. Never push. PRE-PUSH-CHECK is a separate session.
