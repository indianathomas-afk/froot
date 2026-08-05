# Froot — Pending Rulings Sheet
# Prepared 2026-08-05. One sitting, ~1 hour. Decisions only — no session
# needed to answer these; sessions come after, only where a ruling creates
# work. Answer inline, then we turn the answers into row updates / session
# prompts as needed.
#
# Format per item: what it is → the options → my recommendation → what
# happens after you rule.

────────────────────────────────────────────────────────────────────
## PART 1 — The new rows from the DEBT-50 / PERM-5 arc

### R1. DEBT-55 — the remaining 20 org-blind lookup sites
**What:** 20 pages (18 inventory + /hr, /items) still look up the user by
Clerk id without checking the org — the same gap F1 closed centrally.
UI-only today (every gate behind them refuses independently), but it is
why a cross-org session still sees an overpromising sidebar, and it is a
HARD PREREQUISITE for the org-switcher half of DEBT-50.
**Options:** (a) schedule the sweep soon — it's mechanical, one session,
mostly one module; (b) leave open until something needs it (the switcher,
or a new page copying the pattern); (c) fold it into the next inventory-
touching session as a rider.
**Recommendation:** (b), with one addition — a comment in CLAUDE.md or at
the pattern's most-copied site saying "new pages must use the org-guarded
lookup," so the surface stops growing. It's latent, the center is fixed,
and no phase currently needs it.
**After ruling:** (a) → I draft the sweep session prompt. (b) → one-line
comment placement decision, row stays open. (c) → noted in the row.

**RULING: ______**

### R2. DEBT-56 — the org-move stale-row defect
**What:** when a member is removed from an org, their DB row keeps
pointing at the old org forever; no writer can fix it. Post-F1, such a
person degrades to STAFF with no in-app repair (before F1 they silently
kept their old role — worse). Needs a direction, not a patch:
**Options:** (a) webhook moves the row on membership.created when the
identity has exactly one membership; (b) webhook deletes the row on
membership.deleted — cleaner, but drops defaultStoreId and every FK
hanging off User (needs enumeration first); (c) leave as-is — the
console.warn makes any occurrence one log grep, and org moves are rare
in a one-org world.
**Recommendation:** (c) for now, revisit when multi-org work starts —
at which point (a) vs (b) becomes a design input to that phase rather
than a standalone fix. Write that into the row.
**After ruling:** (a)/(b) → audit-first session prompt. (c) → row note.

**RULING: ______**

### R3. DEBT-57 — the fossil cleanup (the only LIVE item on this sheet)
**What:** production DB rows pointing at deleted Clerk objects: the
kevajuice14 ghost STAFF row INSIDE the live org (rosters disagree with
Clerk today: 6 rows vs 5 members), the gary@ dev-org row, and the four
rows orphaned by Monday's cleanup (blankettegirl + My Organization +
Keva Smoothie Company + gary@keva.com's row under it), plus the
"Microsoft" dev org row.
**Options:** (a) approve the cleanup session — verification SQL, then
hand-authored DELETEs presented for approval, you run them in the Neon
console; (b) leave documented.
**Recommendation:** (a), this week. It's the one item with live cost
(wrong member counts on production), it's small, and the evidence is
already gathered.
**After ruling:** (a) → I draft the DEBT-57 session prompt (read-only
verify → approved DELETEs → re-verify, branch ids throughout).

**RULING: ______**

────────────────────────────────────────────────────────────────────
## PART 2 — Registry and record questions

### R4. square.manage baseline — ALL in registry vs ADMIN enforced
**What:** the registry grants square.manage to ALL roles; every Square
route actually enforces ADMIN. One of them is wrong. The C session
reported it and deliberately left the routes unmigrated.
**Options:** (a) registry is wrong → change square.manage to ADMIN_ONLY
(matches reality; Square connect/disconnect/sync are org-level
destructive actions — SEC-1 already treats disconnect as ADMIN); (b)
enforcement is wrong → widen access (no case for this).
**Recommendation:** (a), emphatically. Then the Square routes become
migratable in a future sweep with zero baseline change.
**After ruling:** registry edit rides the next docs/code session.

**RULING: ______**

### R5. CLAUDE.md § Browser Evidence — the misattributed org id
**What:** the incident report that motivates the "name your org id" rule
says org_3FhYUR... was a DEV org with 9 stores / 6 staff. We proved that
id is PRODUCTION's. Two readings: (i) the incident was on dev and the
report just pasted the wrong id (label fix); (ii) the session was on
PRODUCTION while believing it was dev — a bigger historical finding.
**Options:** (a) ten-minute read-only look at the DEBT-9 Phase 3 records
first: what did that session DO on that org (observe or write?), and do
the counts (9 stores / 6 staff) match production-at-that-date or dev?
Then fix the passage accordingly; (b) just correct the id and move on.
**Recommendation:** (a). If the counts match dev, it's reading (i) and a
one-line fix. If they match production, reading (ii) — and whatever that
session did needs a trace. Discriminating evidence exists; use it.
**After ruling:** (a) → I write the short look-see prompt (read-only).

**RULING: ______**

────────────────────────────────────────────────────────────────────
## PART 3 — The six pre-existing pending rulings (DEBT-36/38/41/42/45/48)

NOTE: these six predate my full visibility — the rows live in
ROADMAP.yaml and I don't have their current text in front of me. Rather
than guess their content, this sheet handles them one of two ways —
pick per item or wholesale:

### R6. Disposition of DEBT-36 / 38 / 41 / 42 / 45 / 48
**Options:** (a) paste the six row texts into chat and I extend this
sheet with per-item options + recommendations (15 min of my work, then
they join your same sitting); (b) you rule directly from the rows
without my input — they're marked "decisions, not work" and you've had
them in view longer than I have; (c) explicitly defer the six another
cycle with a dated note so they stop being silently pending.
**Recommendation:** (a) — the whole point of this sheet is one sitting,
and six unexamined items leave the sitting half-done. Paste them and
I'll turn the additions around fast.

**RULING: ______**

────────────────────────────────────────────────────────────────────
## PART 4 — Housekeeping (near-zero effort, just say yes)

### R7. The untracked promotion runbook
Already pre-approved into the Labor planning session's scope. If that
session doesn't run this week, it's one command any docs commit can
carry. **Nothing to rule unless you want it out of the repo instead.**

**RULING (only if objecting): ______**

### R8. Staging /users — the leftover pending invite
The gary@kevajuice.com invite from the F4 test still shows Pending on
staging /users (it was consumed/errored, but the row lingers). Trash
icon, ten seconds, next time you're on staging. Listed so it stops
being remembered instead of done.

**RULING: (just do it — no ruling needed) ______**

────────────────────────────────────────────────────────────────────
## What happens after the sitting

Rulings that create work map to, at most, three small artifacts from me:
- DEBT-57 cleanup session prompt (if R3 = a)
- The Browser Evidence look-see prompt (if R5 = a)
- Sheet extension for the six older items (if R6 = a)
Everything else is row notes and comments that ride the next docs
session — including the Labor planning session already queued, which can
carry most of them.

Then the desk is clear, and the only conversation left is the good one:
Labor v-next vs UM-2 — building for the stores vs finishing the admin
cockpit.
────────────────────────────────────────────────────────────────────
