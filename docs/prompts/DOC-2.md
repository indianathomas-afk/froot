# DOC-2 — Per-document compliance: who hasn't signed this document

**TIER 2.** Read-side only: no schema, no migration, no auth change. Build → commit (work + docs) → report. Commit only, never push.

**STOP condition:** stop if building this would need any new rule for who owes a document or what counts as signed (see "The one rule" below).

Repo: `/Users/garythomas/Claude_Projects/Froot/froot` · Branch: `staging`

## Repo gate

1. On `staging`, tree clean apart from this prompt.
2. `git log --oneline staging..main` must be empty (staging and main are both expected at `cf84237`). If not, STOP.
3. Read the DOC-2 row in `/Users/garythomas/Claude_Projects/Froot/froot/docs/ROADMAP.yaml` in full, including its dated notes. It holds the inherited rulings, and they bind this phase.

## What Gary asked for

Pick a category (e.g. "Logs") or a single document and see, for each document, **"X of Y signed"** and **who still owes it**, by person and store. His use case: everyone who hasn't signed the Key Agreement.

## The one rule: pivot, don't re-derive

Who owes a document, and whether they've signed, is already computed per person in `computeStaffComplianceDetails` / `getOrgComplianceRollup` (`src/lib/hr-compliance.ts`):
- the audience comes from `grantedToStaff`;
- the status comes from `documentCompletion` in `src/lib/hr-completion.ts`;
- the rulings behind it: ACTIVE staff only; R3 (store grants never reach corporate staff); R2/R3 (a prior-version signature counts, shown as "Signed vX"); HR-15 signing cycles.

DOC-2 **groups those same per-person document items by document**. It must not query acknowledgments or signed records itself, and must not restate any audience or completion logic. If the existing items lack a field the view needs (document id, category, store, signed version), **widen the existing select or return type**; don't add a parallel derivation. If that isn't enough, STOP and report.

Inherited and unchanged:
- Zero-audience documents are excluded; the Unassigned chip already covers them. Show a one-line note naming how many were excluded.
- Archived documents are excluded.
- A transferred signer stops counting but their record survives.

## Build

1. **Where it lives:** a **By Document** section on `/hr/compliance`, which is already ADMIN plus in-scope MANAGER. It must use the page's existing store scope: a MANAGER sees only their stores' people, in both X and Y. No new route and no new API unless the page needs a client fetch; if one is added, it carries the same guard as the page.
2. **Controls:**
   - category chips (the shared DOC-5 component, with counts of documents in scope);
   - a document select filtered by category;
   - an "Outstanding only" toggle, default on.

   URL state is `?category=&document=&outstanding=`.
3. **Per document:**
   - Show the title, category badge, current version, **"X of Y signed"** and a small progress bar.
   - Expand it to see people grouped by store (primary store, the existing convention), each with a status of Signed (with "vN" when signed on a prior version), In progress (with checkpoint count), Needs re-sign (rehire) or Not started.
   - Each person links to `/staff/[id]`.
   - Sort outstanding people first, then by name.
4. **Deep links:** on the Document Library row and on `/hr/documents/[id]`, add a "Signing status" link to `/hr/compliance?document=<id>`. Show it only where the viewer can open `/hr/compliance`.
5. **Guide:** add a "By Document" section to `docs/guide/hr-compliance.md` in the existing voice.

## Invariant (must be asserted)

- The sum over documents of Y must equal the total number of document items across all staff in the existing rollup.
- The same must hold for X against complete items.

This proves the pivot adds and drops nobody. The existing KPI cards, By Store, and Team Members numbers must not change.

## Verify

- Fixture `scripts/verify-doc2-by-document.ts` on dev, using a throwaway org, removed and **re-queried** afterward. Reuse DOC-1 C's roster shapes:
  - in-audience signer, transferred signer, non-signer, TERMINATED member;
  - corporate member holding an assignment on the granted store;
  - a prior-version signer and a rehire (needs re-sign);
  - documents: store-granted, staff-granted, company-wide, zero-audience, archived.

  Expected counts must be written from the rulings, not read back from the code under test.
- Assert the invariant.
- Assert MANAGER scope: pass a store subset and check that X and Y shrink together.
- Run `npm run build` **after the final commit**, exit 0, no error lines.
- Don't use a temporary public preview page. If you need a visual check, describe what you'd look at, and Gary checks on staging.

## Docs commit

- ROADMAP: DOC-2 set to `in_progress` with the work SHA, with a dated note at the top of its notes.
- Record the shape choice (a section on /hr/compliance plus deep links, not per-row counts on the library) as a DECISIONS draft for Gary to ratify at PRE-PUSH-CHECK. Cite DOC-1 B's finding on per-row reach counts as the reason.
- Stage only the files you touched.

## Out of scope

- Reminders (NOTIFY-3), due dates (DOC-8), export (DOC-9) and the key holder register (DOC-6).
- Agreement forms (still outside compliance per HR-8 b).
- Any change to compliance math.

Classify findings as FIX NOW / RULING NOW / COMMENT / ROW.

## Staging test plan (for the report)

As `indianathomas` on `/hr/compliance`:
1. By Document shows "Test - Handbook Regression" with X of Y matching its 2-person audience.
2. Expand it: people are grouped by store, with correct statuses, and names link to their profiles.
3. The Policy chip filters the list.
4. "Outstanding only" off shows signers too.
5. A document's "Signing status" link on the Library lands pre-filtered.
6. "HR Test Handbook" (Unassigned) is absent and counted in the excluded note.
7. The KPI cards and Team Members numbers are unchanged from before the deploy. Screenshot them before pushing.
8. As Tommy (STORE): `/hr/compliance` is still a 404.
