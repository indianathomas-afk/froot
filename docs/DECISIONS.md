# Decision Log

Plain record of who decided what, so "yours vs mine" is never fuzzy. **Gary** =
operator decision; **Claude** = implementation choice made without an explicit
instruction. Newest scoping at top. (Started as the Labor log; now records HR
decisions too.)

## BUG-2 staff-profile linking — 2026-07-22 (Gary approved fix + repair)

Caught by the HR-8 staging pass: an invited staff member's `/hr/acknowledge`
page showed "no staff profile matching your email (tommythomas)".

a. **Root cause.** The Clerk webhook persisted
   `public_user_data.identifier` as `User.email` and keyed the
   `PendingInvite` lookup on it — but on username-enabled accounts the
   identifier is the USERNAME, not an email. Both linking mechanisms
   (`StaffMember.userId` via PendingInvite, and the email fallback) failed
   for the same reason. Blast radius was wider than HR: role + store
   assignments from PendingInvite were dropped for any affected invitee.
b. **Fix.** Shared helper `src/lib/clerk.ts`
   (`getClerkPrimaryEmail` — Backend API resolution; `normalizeEmail` —
   trim + lowercase). Webhook resolves the real primary email on
   `organizationMembership.created` (500 on API failure so Svix retries),
   PendingInvite lookup is case-insensitive, User upserts self-heal the
   email, new `user.updated` handler tracks primary-email changes (endpoint
   subscription verified by Gary). Users-page auto-sync uses the helper;
   invite routes normalize at write time; signed-record route unified onto
   `findStaffMemberForUser`; staff email writes trimmed.
c. **Data repair (staging).** Deleted the single orphaned
   `email = 'tommythomas'` User row (the Clerk account behind it had been
   deleted during dashboard investigation; the ADMIN role on it was a
   manual test edit — both Gary). PendingInvite kept for re-invite
   verification; StaffMember untouched.
d. **Noted, not fixed:** no `organization.deleted` / `user.deleted`
   handlers (5 fossil Organization rows on staging; future
   webhook-hardening session). Clerk org display name "Microsoft" drives
   invite-email branding — rename is backlog. Display-only `identifier`
   reads on the users surfaces left as-is (cosmetic).

## HR-8 compliance rollup — 2026-07-22 (Gary)

a. **Acknowledgment docs: current version only.** Compliant = every required
   checkpoint acknowledged on the CURRENT document version. A completed set of
   acknowledgments whose signed PDF hasn't been generated yet ("pending-record")
   still counts as compliant — generation is mechanical and idempotent. A
   record signed against an older version is its own **"needs re-sign"**
   status: non-compliant, but distinct from "not started".
b. **Agreement forms stay OUT of the compliance % (v1).** Nothing in the data
   says who is *supposed* to hold a given form (no assignment mechanism, no
   signing-cycle definition), so forms can't be a denominator. They surface in
   a separate Agreements panel on `/hr/compliance`, with submissions stuck in
   `PendingSupervisor` surfaced prominently as the actionable gap. The
   follow-up ("required forms" flag + defined signing cycle, additive schema)
   is logged in `ROADMAP.md` as HR-10.
c. **Training: Completed = compliant.** Certification is a separate, stricter
   badge — never required for the %. An assignment past its `dueDate` and not
   Completed is **"Overdue"**, the loudest gap state on every surface.
   **Amended 7-22 (Gary, HR-8 staging pass):** not-yet-due assignments are
   EXCLUDED from the % denominator — an assignment only counts against
   compliance once its dueDate passes (completing early counts immediately).
   The % means "is anyone behind", not "is everything assigned done".
   Implementation lands with HR-13 (as-built code still counts from
   assignment until then).
d. **Only ACTIVE staff count in rollups.** Terminated staff are excluded from
   every percentage and every rollup denominator; their records remain fully
   auditable (the profile Compliance tab renders them behind an exclusion
   banner, signed PDFs stay downloadable).
e. (Claude) Rollup is computed live from existing records — no stored
   snapshots, no new schema, no migration; per-store grouping uses the
   member's primary store (the `/staff` directory convention) so nobody is
   double-counted. Flagged: if reminders or trend history land later, those
   become stored per-environment data (regenerate per Neon branch).

## L-3 promotion to production — 2026-07-21 (Gary)

a. **Coverage stays sales-inferred for v1.** Populating `StoreHours` (real
   open/close hours) is deferred as a future *additive* upgrade — Square always
   provides selling hours, so there is no empty-data failure mode. Not a blocker
   for promotion.
b. **L-3 promoted to production** on 2026-07-21 (merge commit `9743899`). First
   `staging → main` promotion in a while.
c. **Prod forecast plan was STALE — and it was NOT caused by the promotion.**
   dev / staging / production are separate Neon branches, and forecast goals are
   *stored* data (`GoalPlan` / `dailyGoals`), not recomputed from code. A plan
   regenerated on staging (Jul 20, +3%) was **never** regenerated on prod, so
   prod carried the old ~$802k plan (spiky per-day goals) while staging showed
   the smoothed ~$753k plan. Fixed by running **Refresh from Square + regenerate
   +3%** on prod. **LESSON:** forecast/plan data is per-environment stored data —
   promoting *code* never migrates it; each Neon branch must be regenerated
   independently. (Code was confirmed identical: `goal-engine.ts` unchanged since
   F-1; the only forecasting file in the promoted diff was a new labor helper.)
d. **STRUCTURAL — keep `main` close to staging.** `main` had drifted **53
   commits behind** staging, so "promote L-3" became "promote the whole backlog"
   (L-3 + all of HR-0…HR-7.6 + the Labor foundation, 11 migrations). Going
   forward, promote more often so each `staging → main` diff stays small and
   readable.

## Phase 3 — BUILT 7-20 (Gary decisions)

1. **Budget is the hard cap.** Conservative budget caps total scheduled hours;
   coverage never exceeds it. The floor-to-tier rounding ($15k→$14k, $14.5k→$14k)
   is the buffer. Small stores have physical limits — never schedule blindly to %.
2. **Demand-shaped headcount; drop fixed daypart minimums.** ✅ CONFIRMED. Heads
   follow the sales shape (1 at 2p, 3 at 3p), capped by budget, floored at **1
   opener + 1 closer**. Daypart headcount minimums are removed.
3. **Only the GM is salaried; GM counts on the floor.** ✅ Re-seed positions to
   **one salaried General Manager + everyone else hourly** (ASM/Lead/Supervisor/
   Team). The GM is a body on the floor and the supervisor. **On-floor rule =
   option (b): GM covers open→mid by default** (GMs typically work days/mids;
   Square integration will refine this automatically later).
4. **Future / 4-week forward scheduling.** ✅ Coverage must render future days and
   next weeks (4-week horizon) for writing schedules. Future-day demand shape =
   **average of the same weekday over the last 4 weeks** (fall back to last-year
   same-weekday, à la Forecasting, when recent data is thin).
5. **Per-store settings, rolling to the org.** ✅ Each store's budget maps to its
   own performance/budget; per-store `LaborSettings` override the org default;
   locations roll up to the org total.

## Locked decisions (already built)

- Money = dollars, `Decimal(10,2)`, integer-cents internally. (Gary/Claude)
- Rounding: sales floor-to-tier (no full-step-down); hours floor to 0.5. (Gary)
- Total sales only — delivery split removed; `denominator` /
  `projectedDelivery` deprecated. (**Gary** — 7-20 answer to the 3 questions.)
- Auto-forecast from Forecasting `DailyGoal` (TREND default, MANUAL override). (Gary)
- Adjustment scales hourly hours only; salaried fixed. (Gary)
- Salaried hours are a weekly constant, never split per day (option B). (Gary)
- Two-gate feature flag; RBAC read=any / write=ADMIN+MANAGER. (Claude, unchallenged)

## Claude implementation choices (autonomous — for the record)

- Daypart defaults 2/3/2, all requiring a supervisor. (superseded by open #2)
- Weather-adjustment control on the Coverage card; weekly hero shows adjusted
  total by splitting → adjusting → re-summing (the "adjusted from N" label also
  fires on pure rounding drift — **known wart to fix**).
- Day-split weights auto-derived from trailing 8 weeks of sales.
- Coverage today/past only. (superseded by open #4)
- Day-split editor on `/settings/labor` with a per-store dropdown.
- StoreHours window mapping (0=Sun, floor/ceil times, demand-inference fallback).
- "Revert to auto" delete for the manual override; cross-card refresh event.

## Process

- **Verify-gate:** no new phase starts until the prior one passes a staging pass.
- Heads-up on non-trivial autonomous calls before building; veto window.
- Smaller commits per sub-feature.
