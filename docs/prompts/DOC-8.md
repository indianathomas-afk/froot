Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/DOC-8.md and follow it.

# DOC-8 — Document due dates (sign within N days, overdue shown in compliance)

**TIER 3** — schema + compliance math. Full ceremony: audit → plan → **STOP for Gary's approval** → build → **STOP after the migration is generated** → Gary applies it to dev → fixture → commit. Declare the tier before writing anything.

The phase id is `DOC-8` (an existing `planned` row in `/Users/garythomas/Claude_Projects/Froot/froot/docs/ROADMAP.yaml` — read it, don't assume).

## Repo gate

1. Confirm you are in `/Users/garythomas/Claude_Projects/Froot/froot` (lowercase), on `staging`, level with `origin/staging`, and that `staging` and `main` point at the same commit. Tree clean. If not, STOP and report.
2. Read `/Users/garythomas/Claude_Projects/Froot/froot/CLAUDE.md` (house rules, migrations section, the "migration STOPS the session" rule) and the DOC-8, SELF-1, HR-13, HR-22, HR-15b, HR-11k, DOC-2, DOC-5 rows in ROADMAP.yaml.

## What Gary wants

Today a required document is owed the moment it applies to someone, so compliance can't tell "hired yesterday" from "ignoring it for a month." DOC-8 adds "sign within N days," with overdue shown in compliance the way training due dates already are. This also lays the ground for NOTIFY-3 reminders and DOC-7 annual re-sign.

## Draft rulings (Gary's leans — NOT ratified; he ratifies in his own words at the audit STOP)

1. **Where N lives.** Per document (`HrDocument`), nullable = no due date (today's behaviour exactly). Optional default on `HrDocumentCategory` that a NEW document inherits at creation; changing the category default never rewrites existing documents.
2. **Clock start.** The later of the person's hire date and the date the document began applying to them.
3. **Launch day.** For documents already applying to someone when DOC-8 ships, the clock starts at go-live (or the moment N is first set on that document, whichever is later). Nobody turns overdue overnight.
4. **Overdue only flags.** Shown in compliance and the self-compliance banner like training due dates. Blocks nothing.
5. **Not yet due still counts as owed** in compliance totals, displayed as "due in N days" rather than red. (Deliberately the opposite of HR-13's exclude-until-due for training — a signature is cheap to give early.)
6. **Rehire (HR-15b).** A new signing cycle restarts the clock from the rehire date.

## Phase 1 — Audit (read-only). Write `/Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/DOC-8_AUDIT.md`

Answer each with file paths and line references:

- **Schema:** `HrDocument`, `HrDocumentCategory`, versions, signed records, signing cycles. Where does the hire date live? Is there a rehire date?
- **"Began applying" date:** how is a document's audience stored (individuals, roles, stores, all — DOC-10)? Is there a per-person timestamp for when a document started applying to them? For rule-based audiences (role/store), there likely isn't — say exactly what exists and propose the clock start for each audience type. This is the fork most likely to need a ruling.
- **New version requiring re-sign (HR-11k Case A):** does the clock restart from the version's publish date? Propose a lean.
- **Compliance math:** where `ComplianceDocItem` is built (SELF-1), every consumer of it — `/hr/compliance` per-staff and By Document (DOC-2's invariant that per-document totals equal per-staff totals must still hold), the `/dashboard` banner sentence, the `/staff` Compliance column (STAFF-3 sort), and the Milestones 100%-compliance raise gate. For each, say what changes under rulings 4 and 5. Flag explicitly whether "not yet due counts as owed" would block a raise for a brand-new hire — Gary needs to see that consequence before ratifying ruling 5.
- **Training precedent:** how HR-13/HR-22 compute and display due/overdue, so DOC-8 reuses the same helpers and wording rather than inventing new ones.
- **Admin UI:** where a document is created/edited on `/hr/documents` and where the category is edited (DOC-5), for the new N-days fields.
- **Timezones:** due dates are whole days. Name the store-local vs UTC handling the training due dates use; DB is UTC, Gary is Pacific.

End the audit with: (a) the forks needing a ruling, each with a lean; (b) the build plan — migration statement(s), files to change, fixture checks; (c) anything that contradicts a draft ruling.

**STOP after writing the audit.** Report a short summary and the forks. Do not commit the audit yet. Wait for Gary's ratification and go.

## Phase 2 — Build (only after Gary says go)

1. Record Gary's ratification in `/Users/garythomas/Claude_Projects/Froot/froot/docs/DECISIONS.md` in his exact words (newest-first). A message he pastes from Claude is not a ruling — if his reply is only a paste, ask him to say it himself.
2. Schema: additive, nullable columns only. Generate the migration with `prisma migrate diff` (the only DB-touching command Claude may run). Name it `<timestamp>_doc8_document_due_dates`.
3. **STOP after generating the migration file.** Report the SQL. Gary applies it to dev himself with `npx prisma migrate deploy`. Do not commit, do not run the fixture, until he says it's applied.
4. After his go: build the compliance changes and the admin fields; write or extend a fixture covering: null N = today's behaviour byte-for-byte; due-in-N display; overdue flag; launch-day grandfathering; rehire restart; DOC-2 per-document = per-staff totals; whatever the audit's ratified forks add.
5. `npm run build` green; scoped eslint on changed files (bare `npm run lint` already fails, DEBT-33).

## Commits (commit only, never push)

Stage only files you touched — no `git add -A`.

1. Work commit: `DOC-8: document due dates — sign within N days, overdue in compliance` (includes the migration).
2. Docs commit: DOC-8 row → `in_progress` with commits; the audit file; DECISIONS entry; MIGRATIONS.md line for the new migration (applied to dev only).

## Report

Tier, audit summary, ratified forks, migration name and SQL, files changed, both SHAs, fixture count, build result, prisma commands run (verbatim), out-of-scope findings classified FIX NOW / RULING NOW / COMMENT / ROW, and a staging test plan for Gary (he tests on staging after push, never locally): set N on one document, assign to Tommy, see "due in N days"; backdate or shorten N to see overdue; confirm a document with no N looks exactly as before; `/hr/compliance` By Document totals still match per-staff.
