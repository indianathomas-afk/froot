# TrainingModule display order — audit ADDENDUM

**Date:** 2026-08-24 · **Corrects:** `docs/prompts/2026-08-24_HR-TrainingModule_Order_AUDIT.md`
**Author:** Claude, self-review at Gary's request, before any source file was touched.

The audit is a claim wholesale and is **NOT edited**. Every correction to it lives here.
Where the two documents disagree, **this one wins**.

Five corrections (§§1–5), one new blocking constraint found while clearing the gates (§6),
and Ruling 2 restated on the argument that survived (§7).

---

## 1 · CORRECTION — `/my/training` was pulled into scope on authority it does not have

**The audit claimed** (§1, #7, and again in §6): *"§6 acceptance check 3 — `tommy@keva.com`:
staff-facing training surface shows the same order — cannot pass without editing this file. So
it is in scope by the order's own gate."*

**That is wrong.** The audit never verified `tommy@keva.com`'s role and reasoned from an
assumption. The role is recorded in three places in this repo:

```
$ grep -rn "tommy" docs/ | grep -i "role\|store\|manager"
docs/ROADMAP.yaml:5041:      (tommy@keva.com, STORE/MANAGER) to be confirmed blind to a document
docs/ROADMAP.yaml:5224:      (tommy@keva.com, STORE/MANAGER) and visible to karson@keva.com (ADMIN);
docs/DEPLOY_LOG.md:295:(`tommy@keva.com`, STORE/MANAGER) to be confirmed blind to a document granted to
```

STORE and MANAGER are precisely the roles `requireHrTrainingReadAccess` admits
(`src/app/api/hr/training/access.ts:88`):

```ts
const role = viewer.dbUser?.role
if (role !== "ADMIN" && role !== "MANAGER" && role !== "STORE") {
```

So §6 check 3 exercises the **read-only library route** — `api/hr/training/library/route.ts:62`,
surface #3, already named in the order's own §1 table. **It passes without `/my/training`
being touched at all.**

**A second consequence the audit missed.** `/my/training` is gated by `getActiveStaffSelf()`
(`(my)/my/training/page.tsx:14`), which resolves a **StaffMember**, not a role. None of the
named staging principals is a staff member, so **no test account in this repo can verify a fix
to that page.** Shipping the edit inside this row would have shipped an unverifiable change
and then reported six-of-six green on a staging pass that never touched it.

**Disposition (Gary, 2026-08-24):** `/my/training` is **its own row**, not this session. Filed
as `HR-31` — see §8. The defect is real and the fix is one line; it is the *verification* that
is blocked, and that blockage is now written on the row instead of being discovered later.

**What stands unchanged:** the defect itself. `(my)/my/training/page.tsx:34` really does sort
`orderBy: { createdAt: "desc" }` on the **assignment**, so a trainee's list is ordered by when
someone clicked Assign, newest first. The §0 sweep really cannot find it — it greps
`trainingModule.findMany`, and that page queries `trainingAssignment` and reaches the module
through an `include`. Only the *authority for fixing it here* was manufactured.

---

## 2 · CORRECTION — the audit's §5 contradicts its own §3.3, and §3.3 was right

**The audit claimed** (§5, Ruling 2): *"the archived tab's order shifts as a side effect of a
drag in the active tab, which no one asked for."*

**That does not happen.** Worked example. An org holds five modules, backfilled dense by
`createdAt`, with B and D archived:

```
backfill:      A=0   B=1(arch)   C=2   D=3(arch)   E=4
Active tab renders  A(0), C(2), E(4)
Archived tab renders  B(1), D(3)

admin drags active to  E, A, C  →  endpoint writes  E=0, A=1, C=2
after:         A=1   B=1(arch)   C=2   D=3(arch)   E=0
Active tab renders  E(0), A(1), C(2)      ← the drag, persisted
Archived tab renders  B(1), D(3)          ← IDENTICAL. Nothing moved.
```

Archived rows keep their indices, and the tabs are mutually exclusive
(`training-client.tsx:107,127,341`), so archived rows are never ranked against live ones on
screen. Their relative order among themselves is untouched. The audit's own §3.3 says exactly
this and is correct; §5 then argued the opposite to motivate the ruling. The collision damage
was invented.

**The only place stale and fresh indices genuinely mix** is `export?includeArchived=true`
(`export/route.ts:37`), where the `createdAt` tie-break keeps the result deterministic but no
longer meaningful for archived rows. §3.3 already said so, and that remains accurate.

**Ruling 2 still stands** — but only on the argument that survives. Restated in §7.

---

## 3 · CORRECTION — the `rectSortingStrategy` conflict was overstated

**The audit claimed** (§3.4, and again in §6): that a drag handle in the 3-column card grid
would need `rectSortingStrategy`, *"i.e. a second dnd approach, which §5 of the order forbids
('no second approach')."*

**The order forbids no such thing.** `rectSortingStrategy` is an export of
**`@dnd-kit/sortable`** — the same package already imported at `training-form.tsx:16`, already
a dependency. §5's constraints are "no new dependency" (satisfied) and "same sensors,
contexts, handle icon" (also satisfied — sensors and contexts are identical; only the
`strategy` prop on `<SortableContext>` differs). Card-grid drag is **one import and one prop**,
not a prohibited second approach.

**Disposition (Gary, 2026-08-24): table-only drag; leave `rectSortingStrategy` alone.** The
recommendation is unchanged, but it now rests on the grounds that actually support it —
grid drag is fussier to use and HR-21's parity rule is about the *rendered result*, which
table-only preserves — and not on a prohibition that was never in the order.

**Recorded so it is not rediscovered as a bug:** the card grid (`training-client.tsx:707`)
**reads** the new order and renders it correctly. It simply offers no handle. The view toggle
is the route to reordering.

---

## 4 · FINDING THE AUDIT RAN AND FAILED TO REPORT — no roadmap row exists for this work

The audit ran the search, received `*** NO MATCH ***`, and never surfaced it.

```
$ grep -n -i "training" docs/ROADMAP.yaml | grep -i "order\|sort\|drag\|sequence"
*** NO ROW EXISTS FOR THIS WORK ***
```

This matters because the order's §7 reads *"`docs/ROADMAP.yaml`, preserve-and-mark: this
work's row → `staging`"*, which presumes a row already exists to be flipped. **There is none.**

**Disposition (Gary, 2026-08-24):** §7 **creates** this work's row rather than flipping one.
Filed as `HR-29`; the enforcement row is `HR-30` and `/my/training` is `HR-31`. Next free id
was `HR-28` (`grep -oE "id: HR-[0-9]+" docs/ROADMAP.yaml | sort -u -t- -k2 -n | tail -1`);
the highest `DEBT` is `DEBT-84`. Row text is in §8.

---

## 5 · METHOD DEFECT — a sweep asserted complete that had not been run

The audit stated *"No client-side module sort exists to delete"* and named
`training-client.tsx:362` as the only `.sort()` in the training UI. The sweep behind that
sentence had **silently dropped `src/components/`**: the first attempt failed on a shell glob
(`--include=*.tsx` unquoted under zsh → `no matches found`), and the retry narrowed to
`src/app/(app)/hr/training/` and `src/app/(app)/staff/` without saying so. The conclusion was
asserted at a confidence the evidence did not carry.

Gary asked for the actual output rather than a sentence claiming it is clean. Verbatim, run
on `staging` at `04a4bf4`:

```
########## VERBATIM: client-side sort sweep over src/components/ ##########
$ grep -rn '\.sort(' src/components/
*** NO MATCH ***

$ grep -rn 'trainingModule' src/components/
*** NO MATCH ***

$ grep -rn 'localeCompare' src/components/
*** NO MATCH ***

$ ls src/components/
build-info.tsx
hr
instagram-icon.tsx
labor
layout
ui
########## END ##########
```

**The conclusion holds** — there is no client-side module sort anywhere in `src/components/`,
no reference to `trainingModule`, and the assign dialog does not live there. The audit reached
a true statement by an incomplete method. The claim is now earned.

The single `.sort()` in the training UI remains `training-client.tsx:362`, over **category chip
names**, and it stays.

---

## 6 · NEW BLOCKING CONSTRAINT — the `ep-` host proof of the backfill is NOT Claude's to run

Found while clearing the gates, after the audit was written. It changes the order's §3 and
Gary's item 7, so it is recorded here rather than discovered mid-phase.

`CLAUDE.md` § Environment Variables, lines 975–995:

> **Never run `vercel env pull` in this repo. No exceptions — not staging, not preview, not
> production. Database reads for every deployed environment go through the Neon console.**
>
> No deployed-environment credential is written to disk — not to the working tree, not to a
> scratchpad, not to a file you intend to delete afterwards. If a task needs data from a
> deployed environment, either derive it from the code paths or **ask Gary to run the query in
> the Neon console and paste the result.** Read-only access is not an exception […]
>
> The ban is total by ruling (Gary, 2026-07-28), after a first draft of this section carved out
> staging. Staging's `DATABASE_URL` is genuinely not Sensitive and does pull, which is exactly
> why the carve-out was tempting and exactly why it is not allowed.

Local `.env` holds exactly one database, and it is the **dev** branch:

```
$ grep -m1 "^DATABASE_URL=" .env | sed -E 's#.*@([^/]*)/.*#\1#'
ep-late-water-a6k53nv2-pooler.us-west-2.aws.neon.tech
```

**Therefore Claude cannot apply the migration to `br-square-feather` (`ep-odd-rain`) and
cannot run the proof query against it.** The one recorded staging-probe exception
(`DECISIONS.md`, 2026-08-20) covers that one probe only and does not extend here.

**How the backfill actually reaches staging.** It ships inside the migration file, and
`prisma migrate deploy` runs it during the Vercel build **when Gary pushes**
(`docs/MIGRATIONS.md` § 145). Nothing about that is manual and nothing about it is Claude's.

**What is delivered instead, and it is not a downgrade in rigour:**
1. The migration is applied to the **dev** branch locally and proved there, with the `ep-` host
   in the output — a real execution of the exact SQL that will run on staging, on the one
   database Claude is permitted to touch, labelled `dev` and never as staging.
2. A paste-ready proof query for Gary to run **in the Neon console against
   `br-square-feather`** after the deploy. Its output names the `ep-` host.
3. The staging pass (order §6) resumes on Gary's paste.

**No figure will be reported as a staging figure without that paste.** The audit's §3.2 wording
— *"Applied to `br-square-feather` (`ep-odd-rain`) only, proved with a query whose output
names the `ep-` host"* — is superseded by this paragraph.

---

## 7 · RULING 2, restated on the surviving argument only

Per Gary's item 6.

The audit's §3.3 endpoint rejects ids that are not in scope (`found.length !== ids.length` →
400) but has nothing that checks the client sent the **whole** scope, and `/hr/training`
never shows the whole scope: the visible list is filtered twice, by category chip
(`training-client.tsx:342`) and by tab (`:341`, Active/Inactive/Archived at `:107,127`). The
order's §5 disables the handle while a **chip** filter is active but says nothing about tabs,
and a tab is always applied — so there is no view in the product from which a user could drag
the complete set of org modules. That is not a hazard, it is an underspecified contract: the
endpoint must state what set it writes dense positions over. **It states it as: the full ACTIVE
list.** Scope is `{ organizationId, isActive: true, isArchived: false }`; the client sends every
active id in its new order; the handle is enabled only on the Active tab with no chip filter;
inactive and archived rows keep their backfilled index and settle by the `createdAt` tie-break
within their own tabs, which as §2 above shows is visually inert.

**This needs no further ruling from Gary and the session does not stop here.** It resolves to
exactly the sentence his item 6 named as the proceed condition — *"the endpoint accepts the
full active list explicitly"* — and it is an endpoint contract, not a product decision.

**One consequence, accepted and recorded rather than mechanised:** un-archiving a module
drops it wherever its stale index falls in the live list rather than at the end. One drag fixes
it. Noted on `HR-29`.

---

## 8 · The three rows, as filed

Row text is reproduced in the session report. `HR-29` is this work and is created, not
flipped (§4). `HR-30` is training-sequence enforcement — filed, deliberately not built, per
the order's §1 "Not this row". `HR-31` is `/my/training`, split out per §1 above and blocked on
a STAFF-role test account.

---

## 9 · Corrections summary

| # | Audit said | Correct position |
|---|---|---|
| 1 | `/my/training` is in scope, forced by §6 check 3 | `tommy@keva.com` is STORE/MANAGER; check 3 runs through the library route. Out of scope → row `HR-31`, blocked on a STAFF test account |
| 2 | A drag in the Active tab shifts the archived tab | It does not. Archived indices are untouched and tabs are exclusive. Ruling 2 survives on the scope-contract argument alone (§7) |
| 3 | Card-grid drag needs a "forbidden second approach" | Same package, one import, one prop. Not forbidden. Table-only stands on UX and parity-of-result grounds |
| 4 | *(silent)* | No roadmap row exists for this work; §7 creates `HR-29` rather than flipping one |
| 5 | "No client-side module sort exists to delete" | True, but the sweep skipped `src/components/`. Now run; output verbatim in §5 |
| 6 | *(unknown at the time)* | Claude cannot touch the staging DB. Backfill proof on `dev` + a Neon-console query for Gary (§6) |

**RULING = GLOBAL** (Gary, 2026-08-24, `docs/DECISIONS.md`) carries through every phase.
