NEW SESSION — PERM-6d: move PERM-6's status rationale out of
`blockers` and into `notes`, then mark the entry resolved.
ROADMAP.yaml only. No code, no schema, no env changes, NO DATABASE
ACCESS.

Save this prompt to docs/prompts/PERM-6d_rationale_relocated.md
before starting any work. If a file already exists at that path, do
NOT overwrite it — read it, report what it contains, and ask me
where this goes.

Read before doing anything: PERM-6 blockers entry (1) IN FULL, as
PERM-6c left it; PERM-6's notes; DEBT-41 (both exemplars and its
"two is thin" argument); P-4's phase row and the BlockerEntry type
in src/lib/roadmap.ts; roadmap-client.tsx's resolved handling;
CLAUDE.md.

THE RULING, reversing mine of a few hours ago. PERM-6c recommended
the entry stay a bare string and I agreed. That was wrong, and the
evidence arrived immediately: I opened /internal/roadmap, saw
PERM-6 listed under "Blockers & gates — what's stopping promotion",
and concluded the session had failed. Nothing is stopping PERM-6;
all four items in that entry are closed. A panel that makes its
owner misread his own project is not paying for itself, and
"the panel over-reports by one, which is the cheaper error" was
wrong about which error is cheaper.

The rationale is a note ABOUT STATUS. `notes` is where notes go.

TASKS
1. Move the status-rationale content out of entry (1) into PERM-6's
   `notes`, preserving every word. Where it lands in notes is your
   call — say why. It must remain findable by someone asking "why
   is PERM-6 shipped and not verified".
2. Mark entry (1) resolved under P-4's BlockerEntry scheme
   ({ resolved: true, text: ... }). Everything else in it — items
   (1)-(4), their closures, the ORIGINAL TEXT blocks, the
   WHAT REMAINS UNCOVERED list — stays in the entry, unedited, and
   moves into the "Resolved gates" disclosure with it. NOTHING IS
   DELETED ANYWHERE.
3. Add a line at the top of the relocated rationale recording WHY
   it moved and that the earlier ruling was reversed the same day,
   with the reason (the panel misread). The reversal is the durable
   part; a decision that changed within hours should say so rather
   than look like it was always this way.
4. DEBT-41 — this is the cost, and it must be paid honestly rather
   than quietly. Exemplar (a) is being removed by this relocation:
   the half-closed entry is becoming a cleanly-resolved one.
   Update the row to record that (a) was RESOLVED BY RELOCATION,
   not by the vocabulary problem being solved — the entry needed a
   third state and got a different field instead. Keep the full
   description of what (a) WAS, so the row still has two worked
   examples described even though only BUILD-1 remains live. State
   plainly whether you think DEBT-41 still stands on one live
   exemplar, and recommend — do not decide — whether it should be
   downgraded, kept as-is, or closed.
5. Confirm the byte-preservation the way P-4 did: parse before and
   after, assert every pre-existing sentence survives, and report
   it. Entry (1) is ~12k chars of record; a botched move is the
   expensive failure here.
6. Report the panel numbers before and after. I expect 11 live
   across 6 phases → 10 live across 5 phases, resolved 8 → 9, and
   PERM-6 leaving the live list entirely. Confirm or correct.

STANDING RULES
- Treat every claim here as UNVERIFIED at HEAD.
- Audit first, plan, wait for my approval, then edit. Commit only
  when I say so. Never push.
- Gate: docs-only, eslint skipped unless you touch a code file.
  Bare npm run build, chained, redirect not pipe.
- meta.updated is gone (DEBT-24, final).
- PERM-6 and PERM-7 both stay `shipped`. This is a field move, not
  a status change, and it must not become one.

REPORT BACK
1. Where the rationale landed in notes and why.
2. Byte-preservation result.
3. Panel numbers before → after.
4. Your DEBT-41 recommendation.
5. Bare build green. The unpushed-commits line — I run all pushes.
