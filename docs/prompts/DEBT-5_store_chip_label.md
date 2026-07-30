NEW SESSION — DEBT-5, the LABEL HALF ONLY. Do not carry assumptions
from any prior session; the last two closed DEBT-7 (705584f, a2356d5)
and DEBT-3 + DEBT-25 (6b36471, 5b1e377), all pushed. They are
finished. DEBT-26 and phase L-1's missing commits field are logged
and waiting — do not action, do not contradict.

Save this prompt to docs/prompts/DEBT-5_store_chip_label.md before
starting any work. If a file already exists at that path, do NOT
overwrite it — read it, report what it contains, and ask me where
this goes.

Read before doing anything: docs/ROADMAP.yaml row DEBT-5 (and DEBT-4,
PERM-3, which it cross-references); CLAUDE.md;
src/app/(app)/users/page.tsx in full. This message is the task order.

STANDING RULES
- Treat this prompt's claims AND the ROADMAP row's claims as
  UNVERIFIED. Re-verify every file:line against the current checkout.
  If a reference has drifted, report the real location rather than
  following it silently. The row's own citation is KNOWN stale — see
  below.
- No database access of any kind — no Neon, no `vercel env`. The fix
  must render correctly whatever storeNumber data holds, so nothing
  here needs a database. If you find yourself wanting one, stop and
  report why.
- The ONLY files you may modify: src/app/(app)/users/page.tsx,
  docs/ROADMAP.yaml, and the prompt file save above. The eight
  precedent files listed below are READ-ONLY this session — verify
  them, do not "align" them. No prisma/, no env changes. Anything
  else you think needs fixing goes in the report as text.
- Audit first, plan, wait for my approval, then edit. Commit only
  when I say so. Never push.
- Chain build and commit as ONE command — `npm run build && git
  commit ...` — never two lines. A reported build is not a gate.
- `meta.updated` no longer exists (DEBT-24, final). Do not bump it,
  do not re-add it.

EXPLICITLY OUT OF SCOPE: the storeNumber backfill. That is a DATA
change on 10 of 12 stores, gated on the migration policy, and it is
not this session. Only the render is in scope. If you find yourself
writing SQL or touching prisma/, stop and report.

────────────────────────────────────────────────────────────────
THE TASK — make two store chips match the house label idiom
────────────────────────────────────────────────────────────────
THE ROW'S file:line HAS DRIFTED — verify and report the real ones.
The row cites src/app/(app)/users/page.tsx:199. That is stale. As of
2026-07-30 the number-or-name chips are at :252 (members table,
`a.store.storeNumber`) and :301 (pending invites, `s.storeNumber`).
The row describes ONE site; there are TWO, with different data shapes.
Confirm both before editing and report if they have moved again.

The pattern in both:
    {a.store.storeNumber ? `#${a.store.storeNumber}` : a.store.name}
Store number IF PRESENT, otherwise the name, never both. Because only
Carson #0034 and Las Brisas #0014 carry a storeNumber, the Location
Access column labels two stores BY NUMBER and ten BY NAME in the same
table. Las Brisas renders as a bare "#0014" with its name nowhere on
screen, which made a real device login look absent when it existed.

THIS IS NOT A DESIGN DECISION — it is making two stragglers match the
house idiom. The `#0014 — Las Brisas` form already exists at eight
other sites:
    user-actions.tsx:112, :244, :271
    staff-buttons.tsx:116
    template-form.tsx:995
    training-form.tsx:813
    staff-edit-actions.tsx:201
    create-device-login-button.tsx:103
Verify all eight against the current checkout (report drift), confirm
they agree with each other EXACTLY — including the dash character —
and match the dominant form. If the eight are NOT consistent with
each other, stop and report the variants: then it IS a decision and I
want to make it. Default if I'm asked: match user-actions.tsx, which
holds three of the eight sites and is this page's closest cousin.

When storeNumber is absent, the chip stays name-only — the fix
changes only the number-present branch. Both fields are already
present at both sites; this should be a label-string change with no
data plumbing. If it turns out to need more than that, stop and
report before writing it.

LAYOUT CHECK, before you widen anything: the chips sit in
`flex flex-wrap gap-1` containers with no fixed widths or truncation,
so longer labels should wrap rather than squash — confirm. Note the
asymmetry: the members table caps at 5 chips with a "+N more"
overflow; the pending-invites list renders all chips uncapped, so
that is where longer labels will show their bulk. If you judge the
uncapped list becomes unreadable with the longer form, say so and
propose — do not silently add a cap (that would be a behavior
change), and do not ship a squashed table.

────────────────────────────────────────────────────────────────
AUDIT AND PLAN — what I want back before any edit
1. The two (or more) chip sites' real file:line, drift called out.
2. The exact label expression you'll write at each site, quoted.
3. Evidence the eight precedent sites agree, or the variants if not.
4. The layout verdict, including the uncapped invites list.
5. Anything in this prompt that contradicts the repo or the row —
   say so rather than reconciling it silently.
6. Commit plan. I expect two commits: the page.tsx edit, then the
   follow-up ROADMAP.yaml commit recording its SHA on the row.

DONE CRITERION
Row DEBT-5 leaves the open list on /internal/roadmap. `isResolvedDebt`
counts staging | shipped | verified. Follow-up-commit convention for
the SHA (precedents: 6f0821c, 116d77e, b407de1, a2356d5, 5b1e377).
Short SHAs QUOTED in ROADMAP.yaml — `commits: ["6b36471"]`. CLOSED
preamble above the row's original text, original wording preserved
below the ── ORIGINAL TEXT BELOW, UNCHANGED ── marker, per house
style. The preamble must record that the backfill half remains open
and where it lives (its own future row or DEBT-4's ruling — state
which, per what the rows actually say). Confirm at the end that the
row does not have a landed status without a commits field.

REPORT BACK
1. The six audit items above, then what was actually committed.
2. Every file:line that had drifted, with the real location.
3. `next build` green, chained with each commit as one command.
4. The explicit unpushed-commits line — I run all pushes.
5. What I should verify visually on staging after I push: which
   page, which column, which stores, and what correct looks like.
