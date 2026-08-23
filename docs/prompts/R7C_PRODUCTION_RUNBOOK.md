# R7-C — the production promotion runbook

**Written 2026-08-22 during the R7-C build (work commit `05f9a98`). NOTHING IN
HERE HAS BEEN RUN.** It is the sequence, not a record of one.

**The gate is `AFTER == PREDICTED`, not `AFTER == BEFORE`.** The allocation
ruling moves stores on purpose, so an empty BEFORE/AFTER diff is now the wrong
assertion — verified during the build: BEFORE vs PREDICTED reports **25
mismatches**, which is the old gate being dead exactly as intended.

---

## 0 · The one thing that cannot be automated

**Kristie's data must exist on production BEFORE the code lands.** Not after, not
in the same deploy. If the code promotes first, there is a window in which "absent
means zero" is live and Las Brisas and UNR carry nothing — **two real stores lose
a real manager**, which is precisely what Gary's promotion-order ruling exists to
prevent.

**The tables ship empty and the code reads them the moment it is live.** So the
rows go in first, on a deployment that does not yet read them, and are inert until
the code arrives.

---

## 1 · GARY DECIDES: manual entry, or a seeding script

Both are written out. **Neither has been run and no script has been written** —
if Gary picks (b), that script is a separate session's work.

### Option (a) — MANUAL, through the UI · **RECOMMENDED**

**Why this is the recommendation:** it is four records, it exercises the exact
surface an operator will use for every future change, and **the write path
enforces the 100% rule** — a script writing rows directly bypasses
`validateAllocationSet` and can leave a person at 90% that no one notices until
the banner appears. Four records is not enough work to justify carrying that risk.

Prerequisite: the **roster sync must have run on production**, or the card has no
salaried people to list. `/settings/labor` → Positions → roster tab → Sync.

1. Open `/settings/labor` on production as an ADMIN with `labor.costs.view`.
2. In **Salaried people**, for **Kristie Connolly**:
   - Leave the exempt switch **off**.
   - **Weekly cost** — the field pre-fills `1000.00` from Square's `$52,000/yr`;
     confirm it. *This is the seed, and it happens once.*
   - **Weekly hours** — `40`.
   - **Share by store** — `Las Brisas 50`, `UNR 50`. The footer must read
     **Totals 100%**; Save stays disabled until it does.
   - Save.
3. For **Kelton Thomas**, **Karson Thomas** and **Taylin Thomas**: turn the
   exempt switch **on** and Save. The allocation section disappears — an exempt
   person is *outside* the system, not allocated 0%.
   **Karson and Taylin have no `StaffMember` row and must not be imported.** They
   appear on this card regardless, because the key throughout is
   `squareTeamMemberId`.
4. Re-open each of the four and confirm what was stored.

### Option (b) — a seeding script Gary runs

Only worth it if the estate grows past a handful of salaried people.

**It must POST to `/api/labor/salaried` rather than write rows directly** — that
is the whole point, because the endpoint is where the 100% rule, the org scoping
and the exempt/allocation contradiction check live. A script writing Prisma rows
straight into the tables re-creates every failure the endpoint exists to prevent.

It would need: a production session cookie, the four `squareTeamMemberId`s (read
from the Neon console — see §2), and one PUT per person. **Not written.**

---

## 2 · Reading the four Square ids (Neon console, production)

Deployed-environment reads go through the Neon console — no credential to disk
(CLAUDE.md § Environment Variables). Branch `production`, endpoint
`ep-green-smoke-a6xthq4r`:

```sql
SELECT w."squareTeamMemberId",
       COALESCE(s."displayName", s."fullName", '*** NOT IN FROOT ***') AS person,
       w."jobTitle", w."annualRate", w.status
FROM "SquareTeamMemberWage" w
LEFT JOIN "StaffMember" s
       ON s."squareTeamMemberId" = w."squareTeamMemberId"
      AND s."organizationId"     = w."organizationId"
WHERE w."organizationId" = 'cf888f2d-f234-48c7-8097-fd5b44b5b3dd'
  AND (w."payType" = 'SALARY' OR w."annualRate" IS NOT NULL)
ORDER BY w."annualRate" DESC;
```

Expect five rows: Kristie ($52,000), Karson ($51,000), Taylin ($51,000), Kelton
($36,000), and whatever else the mirror holds. **Two of them will show
`*** NOT IN FROOT ***`** — that is the unmapped gap, and it is why the person
record is keyed by the Square id.

---

## 3 · The sequence, in order

| # | Step | Where |
|---|---|---|
| 1 | **Capture production BEFORE** — every store, not only budgeted ones | production, pre-deploy |
| 2 | **Enter the four records** (§1) | production UI, pre-deploy |
| 3 | **Predict + manifest** | local |
| 4 | **Gary signs the manifest line by line** | — |
| 5 | **Deploy** | — |
| 6 | **Capture production AFTER** | production, post-deploy |
| 7 | **`diff --expect`** | local |

**Steps 1 and 2 both precede the deploy, and their order between themselves does
not matter** — the tables are inert until the code reads them.

### Step 1 — the BEFORE capture

Pick a Monday and use the SAME week for BEFORE and AFTER. Ideally take both on
the **same Pacific day**, which lets `adjustedTotalSchedulableHours` be promoted
into the strict diff (S5-D34); across days it is excluded, because it is a
function of the wall clock and not of any write.

For every production store, fetch:

```
/api/labor/budget?storeId=<id>&weekStart=<Monday>
```

Save the raw responses as one JSON array, then:

```bash
npx tsx scripts/capture-labor-budget.ts normalize <raw.json> --out docs/prompts/r7c_budget_BEFORE_production_<date>.jsonl --branch production --week <Monday> --tip <sha>
```

**Every store, including ones with no forecast** (S5-D26). Filtering to budgeted
stores puts the rest outside the gate and hides a store gaining or losing a budget.

### Step 3 — predict and manifest

```bash
npx tsx scripts/capture-labor-budget.ts predict docs/prompts/r7c_budget_BEFORE_production_<date>.jsonl --out docs/prompts/r7c_budget_PREDICTED_production_<date>.jsonl --branch production --week <Monday> --tip <sha> --declare "Las Brisas=500:20" --declare "UNR=500:20"
```

```bash
npx tsx scripts/capture-labor-budget.ts manifest docs/prompts/r7c_budget_BEFORE_production_<date>.jsonl docs/prompts/r7c_budget_PREDICTED_production_<date>.jsonl
```

**Every store not named in a `--declare` carries nothing.** That is the ruling,
and the manifest shows it per store.

**The manifest prints a canary line.** `blendedHourlyRate` must be the same value
on both sides at every store. If it differs, **stop** — the person record has
leaked into rate math, and no amount of signing makes that safe.

### Step 4 — the signature

Gary reads every moving line and approves it. **This is the gate**, not the diff;
the diff only proves the deploy did what the signed manifest said.

### Steps 5–7 — deploy and verify

Push, satisfy the staging-SHA precondition, promote, then re-capture and:

```bash
npx tsx scripts/capture-labor-budget.ts diff docs/prompts/r7c_budget_PREDICTED_production_<date>.jsonl docs/prompts/r7c_budget_AFTER_production_<date>.jsonl
```

**Empty strict diff = the estate moved exactly as predicted and signed.**

---

## 4 · What an empty diff does and does not establish

**DOES:** every store's budget block landed on the predicted figure;
`blendedHourlyRate` never moved; the seven-or-more forecast-less stores stayed
`budget:null`; no store appeared or disappeared.

**DOES NOT:**

- **Prove the percentages are right.** It proves the arithmetic followed the
  percentages that were entered. If Kristie is really 60/40, the diff is empty
  and the numbers are wrong. **Only Gary's signature covers that**, which is why
  step 4 is a human step and cannot be automated away.
- **Exercise `hasIncompleteAllocation`.** It is deliberately not a strict field —
  a data-entry state, not a labor figure — and a correct 100% set never raises it.
- **Say anything about the GM on-floor window.** Las Brisas and UNR will each
  draw Kristie's band from their own settings on the same days, each capped at
  its own 20 hours. **Hours right, coverage shape wrong.** Filed on the R7-C row;
  this build does not make it worse and does not fix it.
- **Cover staging.** Staging has a forecast at only 5 of 12 stores and forecast
  goals are per-environment data, so a staging pass understates the estate. It is
  a useful rehearsal and is not the gate.

---

## 5 · Rollback

The code is revertable on its own: the two tables keep their rows, nothing reads
them once `getWeeklyDayPlan` is reverted, and the estate returns to the archetype
behaviour. **The rows do not need deleting** — they become inert, exactly as they
were between step 2 and step 5.
