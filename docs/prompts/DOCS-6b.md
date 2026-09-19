Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/DOCS-6b.md and execute it.

# DOCS-6b — Eight rows read staging/in_progress; their code is in production

**TIER 1 — docs only.** Rider on DOCS-6 (c41b647). No `src/`, no schema, no
prisma. One command at a time, no `&&`, stage only touched files, commit on
`staging`, never push.

**Save to:** `/Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/DOCS-6b.md`

## The finding (2026-09-19 read-only pass, this session)

STAFF-2, CHK-7, HR-29, HR-32, HR-33, HR-35, SEARCH-1, SELF-1 — 23 of 23
commits are ancestors of `main`. Every row's status says its code is not in
production. It is. DEBT-72a pattern, eight rows.

## Rule for this pass

`status` records where the code is, not whether the phase is finished. Code
on `main` → `shipped`. Work still owed goes in the row's `open:` or
`deferred:` list, not in the status. No row goes to `verified` — no smoke
test is recorded for any of them.

## Steps

1. For each of the eight rows, find the promotion merge that first carried
   its OLDEST commit onto main:

   ```
   git log --first-parent --merges --format='%h %ad %s' --date=short main
   ```

   Walk that list oldest-first and use `git merge-base --is-ancestor <sha>
   <merge>` until it says yes. That merge's date is the row's `shipped:`
   date. Do not guess it from the commit date.

2. In `docs/ROADMAP.yaml`, for each row: `status: shipped`, `shipped:
   <merge date>`, and PREPEND to notes a rider line:
   `── RIDER 2026-09-19 (DOCS-6b) ── REACHED MAIN <date> in promotion <merge
   sha>. Row read <staging|in_progress> while in production for <N> days
   (DEBT-72a pattern).`
   Where the existing notes say work is still owed, do not delete that
   text; if it is not already in `open:` or `deferred:`, add a one-line
   `open:` entry pointing at it.

3. Append to `debt:` (next free id — read the file): the eight-row
   staleness itself, as a record. What went wrong is not the rows; it is
   that six promotions since 2026-08-24 each had a docs pass owed and only
   the CAL one got it. FIX DIRECTION: PRE-PUSH-CHECK owns the staging flip
   (hardening 3, c41b647); the promotion ritual needs the matching shipped
   flip as a named step in `docs/PROMOTION.md` or wherever the ritual
   lives — read the file, name the exact section, propose the line, do not
   add it (Gary rules). Open, no status.

4. Run the generator, report phase counts. Expect staging 0, in_progress 0.

5. Commit:
   `docs(DOCS-6b): eight rows to shipped with promotion dates; staleness recorded`

## Report

1. Per row: promotion merge SHA, date, days stale.
2. The new DEBT id and the proposed ritual line, verbatim.
3. Generator counts.
4. Commit SHA. Prisma commands run: "No prisma commands run."
