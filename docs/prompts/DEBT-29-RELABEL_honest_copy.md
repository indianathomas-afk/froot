# DEBT-29-RELABEL — honest copy for the checklist availability window

Session prompt, saved verbatim before any work. 2026-08-02.

---

NEW SESSION — DEBT-29-RELABEL: stop the template form claiming the
availability window works. Copy change only. No behaviour change,
no schema, no migrations, NO DATABASE ACCESS. The implement-vs-
remove product decision is NOT this session and stays with me.

Save this prompt to docs/prompts/DEBT-29-RELABEL_honest_copy.md
before starting any work. If a file already exists at that path, do
NOT overwrite it — read it, report what it contains, and ask me
where this goes.

Read before doing anything: DEBT-29 IN FULL, including its
corrected line numbers (:936, :944, :969-979 — the row's originals
were :917/:925/:954-960 and were corrected 2026-08-02 by
DEBT-TRIAGE-1); src/app/(app)/templates/template-form.tsx in full;
src/app/api/checklists/route.ts; src/lib/messages.ts; DEBT-1 and
DEBT-32 (operationalPhase's one real consumer and the alias);
CLAUDE.md.

THE DEFECT. The form asks a REQUIRED question — "When is this
checklist available? *" — states "Availability calculated based on
each store's operating hours", collects operationalPhase +
startOffsetHours + endOffsetHours, and previews them back as a
sentence that reads like a guarantee. Nothing consumes any of it.
Checklist rows are created in exactly two places and neither
references phase or offsets; there is no cron generator; no code
path joins the offsets to StoreHours. An operator configures a
control with no effect and is told in writing that it works. That
is why this row is LIVE.

THIS SESSION FIXES THE CLAIM, NOT THE CONTROL. Implementing the
gate is a product decision I have not taken and can wait
indefinitely. The false statement cannot — it is on screen for
every operator today and costs one sentence to stop. Do not
implement, do not delete the fields, do not touch the write paths.

────────────────────────────────────────────────────────────────
PART ONE — audit and propose wording. Then STOP.
────────────────────────────────────────────────────────────────
1. Re-verify at HEAD: every string the row cites, every write path,
   and that nothing reads the offsets. Grep for
   startOffsetHours/endOffsetHours and report every hit with what
   it does — collection, transport, or consumption. Report drift.
2. WHAT operationalPhase ACTUALLY DOES, because the answer shapes
   the wording. DEBT-29 says its only functional consumer is
   handoff-note date resolution (src/lib/messages.ts). Verify that.
   The phase is therefore NOT inert the way the offsets are — it
   does something, just not what the form says. The new copy must
   not flatten that difference by implying both are decorative.
3. PROPOSE THE WORDING. I want three things from it:
   - honest: no claim the system gates anything
   - still meaningful: the phase is a LABEL for humans, telling
     staff when a checklist is meant to be run. "This does nothing"
     is honest and useless.
   - short. This is a form field, not a disclosure.
   Give me two or three alternatives with the trade-off between
   them, and RECOMMEND one. Include the field label, the helper
   text, and what happens to the preview sentence.
4. RULE ON THE OFFSETS, and recommend rather than decide: the two
   offset inputs collect numbers NOTHING reads, not even as a
   label. Options as I see them — (a) leave them and relabel, (b)
   hide the inputs while keeping the columns and the values, (c)
   something you see that I do not. (b) is a behaviour change to
   the form, so it needs my ruling. Say which you would take and
   what it costs if the gate is later implemented.
5. CHECK THE EXPORT/IMPORT ROUND TRIP before proposing anything
   that changes what the form writes. The row says the CSV export
   and import both carry these fields. If wording is all that
   changes, this is a no-op — confirm that.

────────────────────────────────────────────────────────────────
PART TWO — after I approve wording
────────────────────────────────────────────────────────────────
Apply it. Close DEBT-29 ON THE RELABEL HALF ONLY, in house style:
status, quoted commit, CLOSED preamble above the original text,
original preserved below the marker. The implement-vs-remove
decision does NOT close with it — split it out as its own row
marked AWAITING RULING, carrying the DEBT-1/DEBT-32 sequencing note
(implementing the gate makes a dirty phase string decide when a
checklist appears, so it must follow DEBT-1's soak). Same shape as
DEBT-5 splitting into DEBT-27.

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
- Audit first, propose, WAIT. Commit only when I say so. Never push.
- Gate: scoped `npx eslint <touched files>` then bare
  `npm run build`, chained, no pipes. No bare npm run lint
  (DEBT-33, ten errors).
- meta.updated is gone (DEBT-24, final).

REPORT BACK, part one
1. Every citation re-verified, drift called out; the full
   grep result with collection / transport / consumption per hit.
2. What operationalPhase actually does, verified.
3. Two or three wordings with trade-offs, and your recommendation.
4. Your recommendation on the offsets, and its cost if the gate is
   later built.
5. The export/import round-trip check.
6. The triage buckets with counts.
