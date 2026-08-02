# DEBT-13-FIX — Roster omission: manager's /staff silently drops out-of-home-store staff

Session prompt, saved 2026-08-02.

---

NEW SESSION — DEBT-13-FIX: a MANAGER's /staff roster silently omits
staff who work at their store but are homed elsewhere. Display
change only. No permissions change, no schema, no migrations, NO
DATABASE ACCESS.

Save this prompt to docs/prompts/DEBT-13-FIX_roster_omission.md
before starting any work. If a file already exists at that path, do
NOT overwrite it — read it, report what it contains, and ask me
where this goes.

Read before doing anything: DEBT-13 IN FULL, including the four
pre-existence checks and the FIX DIRECTION paragraph; DEBT-9 (the
primary-store fallback, same data); src/app/(app)/staff/page.tsx in
full; src/lib/auth.ts getUserStoreScope; CLAUDE.md.

THE BUG, per the row and to be re-verified at HEAD: the page groups
members by their PRIMARY store (member.storeAssignments[0].store,
~:78) and then renders only groups whose store is in the caller's
scoped list (stores.filter(s => byStore.has(s.id)), ~:118). The
QUERY is correct — getStaffData fetches any member with `some`
assignment in the caller's stores — so the member is fetched and
then silently discarded at render. Jordan Pippenger is assigned to
Carson AND Las Brisas, both of a test manager's stores, but homed
at UNR, and appears nowhere on that manager's roster. His detail
page loads fine by direct URL, so he is reachable but not
discoverable — nothing signals he is missing.

THE ROW FORBIDS ONE FIX, and I am upholding it: do NOT change the
grouping key to "first in-scope assignment". That moves the member
under a heading contradicting the Primary star shown on their own
row and chips. The row names two acceptable directions — render a
member under EVERY in-scope store they are assigned to, or add an
"Also works here" line per store group.

PART ONE — AUDIT AND RECOMMEND, then STOP.
1. Re-verify the bug at HEAD: the grouping line, the render filter,
   and that the query genuinely returns the omitted member. Report
   drift; the row's line numbers are from 2026-07-27.
2. Establish who is actually affected on preview/staging WITHOUT a
   database — from the row's own recorded data plus anything the
   code implies. Say plainly whether Jordan Pippenger is still the
   only example you can evidence, and that you have not measured it.
3. RECOMMEND ONE of the two permitted directions, with the
   trade-off. I care about: does an ADMIN's view change (it must
   not — they already see everyone); does a member appear twice and
   is that confusing or correct; what the Primary star means on a
   duplicated row; and what the store-group member COUNT should say
   when someone is counted in two groups.
4. Say what a MANAGER should see that tells them the roster is
   complete. The row's sharpest point is that nothing signals the
   omission — a fix that quietly adds people without changing how
   the page reads has fixed the data and not the trust problem.
5. Give me the diff you propose, quoted, before writing it.

PART TWO — after I approve the direction
Implement it. One file if possible; report if not. No permissions
change — the query already returns the right people, so this is a
render decision. Close DEBT-13 in house style: status, quoted
commit, CLOSED preamble above the original, original preserved
below the marker.

BEFORE YOU REPORT — triage what you found. For each thing found
and not fixed, tell me which it is:

FIX NOW — small, inside the code you already touched, and I can
approve it in this session. Propose it; do not apply it.

RULING NOW — needs a decision from me, not work. Ask the question
in one sentence. If I answer it here, it never becomes a row.

COMMENT, NOT A ROW — cost NONE with no named trigger. It goes as a
comment at the site. A row would only be read by someone already
reading the roadmap; a comment is read by whoever opens the file.

ROW — real deferred work, or a hazard with a named trigger.

Default to the first three. A row is the last resort, not the
first. Tell me the count in each bucket.

STANDING RULES
- Treat every claim here and in the row as UNVERIFIED at HEAD.
- Audit first, recommend, WAIT. Commit only when I say so. Never
  push.
- Gate: scoped `npx eslint <touched files>` then bare
  `npm run build`, chained, no pipes. No bare npm run lint
  (DEBT-33, ten errors).
- meta.updated is gone (DEBT-24, final).

REPORT BACK, part one
1. The bug re-verified, drift called out.
2. Who is affected, and what you have NOT measured.
3. Your recommended direction with the trade-off, and answers to
   the four questions in item 3.
4. The proposed diff, quoted.
5. The triage buckets with counts.
