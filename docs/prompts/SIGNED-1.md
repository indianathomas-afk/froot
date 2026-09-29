# SIGNED-1 — Signed Records: filter by category and document, sort by date, lift the 50 cap

**TIER 2.** No schema, no migration, no auth change. Build → commit (work + docs) → report. Commit only, never push. Stop only on something unexpected.

Repo: `/Users/garythomas/Claude_Projects/Froot/froot` · Branch: `staging`

## Repo gate

1. On `staging`, tree clean apart from this prompt file.
2. `git log --oneline staging..main` must be empty. That proves the DOC-5 promotion docs pass is merged back. If it isn't empty, STOP and report.
3. Read `/Users/garythomas/Claude_Projects/Froot/froot/docs/ROADMAP.yaml` and confirm `SIGNED-1` is free. If it's taken, use the next free id and say so.

## What Gary asked for

On `/hr/signed-records`:
- filter records by **document category** (DOC-5's managed categories);
- narrow to a **single document**;
- **sort by completed date**, newest first or oldest first.

His use case is pulling every Key Agreement record (category "Logs") in date order.

## Build

1. **Filters live on the server.** The page currently loads "the 50 most recent" records. Filtering those 50 in the browser would silently drop older matches, so every filter goes into the Prisma `where`:
   - category: `version.hrDocument.categoryId`, with an explicit Uncategorized option (`categoryId: null`);
   - document: `version.hrDocument.id`;
   - sort: `completedAt` asc or desc, with `id` as a deterministic tie-break.
2. **Lift the cap** with cursor-based "Load more", 50 per page. Keep the same filter and sort across pages. The header text must stop claiming "50 most recent" and say what's shown, e.g. "Showing 50 of 212".
3. **URL state.** Keep `category`, `document` and `sort` in the query string so a filtered view survives reload and back, and can be linked.
4. **Controls:**
   - Category chips styled like the Document Library's (DOC-5 badge component, colored dot, count of matching records);
   - a document select filtered by the chosen category;
   - a Newest/Oldest toggle.

   Counts come from the server (`groupBy` or `_count`), not from the loaded page.
5. **Records never disappear:**
   - archived documents and their records stay filterable, with the document select marking them "(archived)";
   - terminated staff's records stay listed.

   A record's category is its document's **current** category (records pin a version; the category lives on the document). Put that in a code comment.
6. **Row display:** add the category badge to each row. Download behavior, the ADMIN-only access and everything else on the page stay untouched.
7. **Scope check first:** confirm whether this page lists `HrSignedRecord` only or also form submissions. Build for whatever it lists today and report which. Don't add form submissions.

## Verify

- A fixture (`scripts/verify-signed1-filters.ts`) on dev, using a throwaway org, removed and **re-queried** afterward. It checks:
  - more than 50 records across two categories;
  - the category filter returns only matching records, including ones beyond the first 50;
  - asc and desc orders are correct, and the cursor pages don't overlap or skip;
  - Uncategorized works;
  - an archived document's records remain;
  - counts match the filtered totals.
- `npm run build` **after the final commit**, exit 0, no error lines.

## Docs commit

- ROADMAP: row SIGNED-1 `in_progress` with the work SHA.
- File the planned rows below from Gary's 2026-09-28 message ("Agreed" to each). **First search ROADMAP for rows that already cover each one.** Where a row exists, append a dated note with Gary's agreement instead of filing a duplicate. Report which were new and which were existing.
  - **Key holder register.** Who currently holds a key: issue recorded by the signed Key Agreement, plus a return event. Needs a ruling on how a return is recorded, since an Acknowledgment records issue only. Also covers the offboarding return list.
  - **Annual re-sign for policies.** Likely the existing Case A re-verification toggle (HR-11k Phase B); a per-category default re-sign interval.
  - **Document due dates.** "Sign within N days of assignment/hire", with overdue shown in compliance the way training due dates already are.
  - **Audit export.** A zip of signed-record PDFs plus a CSV index, scoped by the SIGNED-1 filters.
  - **HR reminders.** Nudge people with outstanding documents; check the existing reminder/NOTIFY rows first.
- DOC-2 already exists. Append a dated note: Gary agreed to build it next, with a category filter, so "Logs" shows everyone who hasn't signed the Key Agreement, by person and store.
- Stage only the files you touched; never `git add -A`.

## Out of scope

- DOC-2 and every row filed above.
- A store filter or name search on this page.
- Any change to compliance math.

Classify out-of-scope findings as FIX NOW / RULING NOW / COMMENT / ROW before the report.

## Staging test plan (for the report)

As `indianathomas` on `/hr/signed-records`:
1. Pick the Handbook chip: only handbook records show, and its count matches.
2. Toggle Oldest: the earliest signature is first.
3. Click Load more: no duplicates.
4. Reload: the filters persist.
5. Pick the Logs chip: Key Agreement records only, or an empty state until Will assigns and people sign.
