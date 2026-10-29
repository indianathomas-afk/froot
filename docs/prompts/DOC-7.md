Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/DOC-7.md and follow it.

# DOC-7 — Annual re-sign (signatures that expire)

**TIER 3** — schema + compliance math. Full ceremony: audit → **STOP for Gary's ratification** → build → **STOP after the migration is generated** → Gary applies it to dev → you verify on dev yourself → fixture → commit. Declare the tier before writing anything.

## Repo gate

1. Confirm you are in `/Users/garythomas/Claude_Projects/Froot/froot` (lowercase), on `staging`, and that `staging`, `main`, `origin/staging` and `origin/main` all point at `aeda979`. Tree clean except this prompt. If not, STOP and report.
2. Read `/Users/garythomas/Claude_Projects/Froot/froot/CLAUDE.md` and, in `/Users/garythomas/Claude_Projects/Froot/froot/docs/ROADMAP.yaml`, the DOC-7, DOC-8, DOC-13, DOC-6, HR-15b, HR-11k, MS-3 and NOTIFY-14 rows. If the DOC-7 row describes something other than periodic re-signing, STOP and report.

## What Gary wants

Today a signature is good forever. Some documents — a key agreement, a food-safety or allergen policy, a harassment policy — should be re-confirmed every year. DOC-7 lets an admin mark a document "Re-sign every N months." When a person's signature passes its anniversary, the document is owed again, with a due date on DOC-8's clock, and it shows everywhere DOC-8/DOC-13 already show due dates (and therefore in the NOTIFY-14 digest). Like a food handler card: certify, then renew.

## Draft rulings (Claude's leans from chat — NOT ratified; Gary ratifies in his own words at the audit STOP)

1. **Setting.** Per document, nullable = never expires (today's behaviour exactly). Choices 6, 12 or 24 months. Signature documents (Acknowledgment) only, like DOC-8 F8.
2. **Whose anniversary.** Each person's own latest signature on that document. Sign in March, renew next March — spreads the work out.
3. **Before the anniversary the signature still counts.** Compliance stays complete; nothing moves a percentage early (protects the Milestones raise gate). In the last 30 days the person and managers see an informational "Re-sign due in d days".
4. **Signing early renews.** Re-signing inside that 30-day window resets the anniversary from the new signature.
5. **After the anniversary** the document is owed again and overdue: "Was due {anniversary}" in red, counted like any overdue document — DOC-8 F4 representation, DOC-13 ordering, NOTIFY-14 digest.
6. **Launch-day grandfathering.** Turning the setting on for a document whose signatures are already older than N months must not make everyone overdue overnight. Each person's anniversary is the later of (their latest signature + N months) and (the date the setting was turned on + 30 days).
7. **History kept.** Each re-sign produces a new signed record; earlier ones stay in Signed Records. Nothing is erased.
8. **Interactions.** A rehire's new cycle (HR-15b) or a new version requiring re-sign (HR-11k Case A) produces a new signature, which restarts the annual clock from that signature.

## Phase 1 — Audit (read-only). Write `/Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/DOC-7_AUDIT.md`

Answer each with file paths and line references:

- **Representation:** how should an expired signature reopen the document — a new signing cycle (HR-15b's mechanism), a computed "expired" state inside `computeStaffComplianceDetails`, or something else? Pick the smallest change that keeps signed records append-only and keeps one source of truth for every compliance surface. Name what each option costs.
- **Clock:** how DOC-8's `documentDueState()` and `signWithinDaysSetAt` extend to an anniversary due date. Does the document's "Sign within" N play any part once a re-sign is due (lean: no — the anniversary IS the due date)? Whole member-local days, as DOC-8.
- **Rulings 3 and 4:** where the 30-day "Re-sign due in d days" notice renders without changing compliance totals; whether `/my` signing allows an early re-sign today or needs a path.
- **Every consumer:** `/hr/compliance` per-staff and By Document (DOC-2 invariant must hold), the `/dashboard` banner, `/staff` Compliance column, `/my`, `/my/documents`, `/staff/[id]` tabs (DOC-13 order), Milestones raise gate (MS-3), NOTIFY-14 digest. For each, what changes. Say explicitly whether the digest should list upcoming re-signs inside its 3-day window, given ruling 3 says they aren't owed yet — fork it.
- **Key holder register (DOC-6):** a Key Agreement with annual re-sign — does a re-sign signature count as a new issue under DOC-6's holding rule? It must not change who holds a key. Fork it if needed.
- **Signed Records (SIGNED-1):** multiple records per person per document — anything that assumes one.
- **Admin UI:** where the setting lives in the Edit dialog beside "Sign within"; help text for ruling 6.
- **Timezones:** anniversary math in member-local days; month arithmetic edge cases (signed Jan 31, Feb 29).

End with (a) forks needing a ruling, each with a lean; (b) build plan — migration statement(s), files, fixture checks; (c) anything contradicting a draft ruling.

**STOP after writing the audit.** Report a short summary and the forks. Do not commit. Wait for Gary.

Ratification rule: record only Gary's own words. Button text you drafted, or text he pasted from elsewhere (including from his planning chat), is not a ruling — offer to ask the forks one at a time.

## Phase 2 — Build (only after Gary ratifies)

1. Record his ratification in `/Users/garythomas/Claude_Projects/Froot/froot/docs/DECISIONS.md`, his exact words, newest-first.
2. Schema: additive, nullable only. Generate with `prisma migrate diff` (the only DB-touching command you may run). Name it `<timestamp>_doc7_annual_resign`. **STOP after generating it.** Report the SQL; Gary applies it to dev himself. Then verify the columns on dev yourself with a read-only check that prints the branch id — a typed "applied" is not proof.
3. Build. Before touching the engine, snapshot every dev org's compliance rollup; after, prove it is identical for documents without the setting (DOC-8's method).
4. Fixture: no setting = today byte-for-byte; valid signature inside the 30-day window still complete with the notice; early re-sign renews; anniversary passed → overdue with "Was due"; grandfathering floor; rehire and Case A restart; DOC-2 per-document = per-staff; DOC-6 holder unchanged by a re-sign; Jan 31 / Feb 29 anniversaries; digest behaviour per the ratified fork. Re-run DOC-8, DOC-13, DOC-2, NOTIFY-14 fixtures at their counts. Do at least one deliberate break per core rule and confirm the fixture catches it, then restore.
5. `npm run build` green; scoped eslint on changed files (bare `npm run lint` fails, DEBT-33).

## Commits (commit only, never push)

Stage only files you touched — no `git add -A`.

1. Work commit: `DOC-7: annual re-sign — signatures expire every N months`
2. Docs commit: DOC-7 row → `in_progress` with commits; the audit; DECISIONS entry; MIGRATIONS.md line; this prompt.

## Report

Tier, audit summary, ratified forks, migration (name + SQL), files changed, both SHAs, fixture and regression counts, build result, prisma commands run (verbatim), out-of-scope findings classified FIX NOW / RULING NOW / COMMENT / ROW, and a staging test plan for Gary (staging after push, never locally). Note in the plan that a real anniversary takes months, so the plan should set the setting on a test document whose signature is already old enough that the grandfathering floor applies — then he sees "Re-sign due in d days" now and overdue 30 days later, or say what quicker staging proof exists.
