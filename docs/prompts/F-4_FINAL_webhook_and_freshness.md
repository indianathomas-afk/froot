# F-4 FINAL — live pacing: webhook enablement + dashboard freshness on store switch

**TIER 3 — Structural.** Full ceremony: audit → plan → Gary's approval → build →
two-commit SHA pattern. Do not start building until Gary has approved the plan
produced by Task 1.

---

## Universal floor (applies regardless of anything below)

- **Directory trap.** The git root is the **lowercase** `~/Claude_Projects/Froot/froot`.
  The capitalized parent `Froot/` is **not** the repo and has no `.git`. Confirm with
  `git rev-parse --show-toplevel` before anything else. The `froot` shell alias goes there.
- **No `&&` chains.** One command at a time. Read the result before the next.
- **Gary runs all pushes.** You commit to `staging` only. You never push, never merge, never touch `main`.
- **No schema changes.** Additive-only is the standing rule and this session needs
  no migration at all. If you believe one is required, STOP and surface it.
- **Staging SHA precondition.** Before any browser verification, confirm the deployed
  Vercel commit SHA matches local `staging` HEAD. Report both.
- **Evidence rules are absolute.** Any database result must carry the branch name in the
  same output. Any browser observation must name the org ID and Clerk instance captured
  before testing. Re-measure; never cite from memory or from project knowledge.
- **Out-of-scope findings** get classified FIX NOW / RULING NOW / COMMENT / ROW before
  the session report. Never fixed inline.
- **Claude Code never resolves ambiguity by picking the reasonable option.** Surface and stop.

**Standing context you must account for:** `staging` currently carries un-promoted DOC-1
work with open carried items. Your commits land on top of that. Do not rebase, do not
squash, do not touch anything DOC-1 owns.

---

## Why this session exists

F-4 ("Dashboard live pacing") is `shipped` but its headline feature has been silently
degraded since **2026-07-10**. `SQUARE_WEBHOOK_SIGNATURE_KEY` is absent from every Vercel
environment, and no webhook subscription is known to be registered in either Square app
(production, and the separate "Froot Staging" app — different apps, different keys).

Gary has separately observed a second symptom on the dashboard: **switching stores in the
store picker shows stale sales; a manual page refresh is required before current sales
appear.** These may be the same defect wearing two hats. This session settles both.

The screenshot that prompted this was taken on the **staging** preview
(`froot-git-staging-indianathomas-2483s-projects.vercel.app`), not production. Treat
staging and production as two independently-configured environments throughout.

---

## Task 0 — Preconditions

1. `git rev-parse --show-toplevel` — confirm the lowercase `froot` path.
2. `git branch --show-current` — confirm `staging`.
3. `git status` — report anything uncommitted. Do not clean it up; report it.
4. `git log --oneline -5` — record HEAD.

Report all four before proceeding.

---

## Task 1 — AUDIT ONLY. No edits. This task ends in a written plan.

### 1a. Verify the webhook route's failure mode at HEAD

Read `src/app/api/webhooks/square/route.ts` in full and report, quoting line numbers:

- What happens when `SQUARE_WEBHOOK_SIGNATURE_KEY` is unset.
- What happens when `NEXT_PUBLIC_APP_URL` is unset.
- Whether the signature is verified against the **raw** body before parsing.
- Which event types are handled.

**This settles F-4's open question.** The roadmap records a *docs claim* from
`docs/FORECASTING.md:135` that an unset key produces a 500 (fail-CLOSED), explicitly
flagged as unverified against source. Confirm or refute it at source. If the route ever
**skips** verification when the key is unset, that is fail-OPEN — an unauthenticated
write endpoint into the sales caches, exposed since 2026-07-10 — which is a materially
more urgent finding than degraded pacing. **If you find fail-open, STOP the session and
report immediately.** Do not proceed to Task 2.

Also read `src/lib/square-webhook.ts` and confirm the signing scheme (algorithm, what is
signed, which header carries it).

### 1b. Map every path that can freshen dashboard sales

There are believed to be three. Name them precisely, with file paths and line numbers,
and state for each what triggers it and what it writes:

1. The Square webhook (`/api/webhooks/square`) — near-real-time.
2. A **15-minute lazy sync** on dashboard request — the documented fallback for missed or
   misconfigured webhooks. Find it. `src/lib/sales-sync.ts` and the dashboard API routes
   (`/api/dashboard/summary`, `/api/dashboard/sales`) are the places to start.
3. The nightly reconcile cron (`/api/cron/sales-reconcile`, 11:00 UTC) — source of truth.

**Then answer the question the roadmap gets wrong or right:** F-4's blocker text asserts
pacing has degraded to *the nightly backfill*, while `docs/FORECASTING.md` asserts the
15-minute lazy sync remains as fallback. These cannot both be true. Determine which is
actually the case at HEAD and report it. The answer changes how severe the last month has
been and belongs in the ROADMAP row either way.

### 1c. Diagnose the store-switch staleness

The reported behaviour: changing the store in the dashboard store picker renders stale
sales figures; a full browser refresh is required to see current numbers.

Read the dashboard client and its data-fetch path. Determine which of these is true —
do not guess between them, prove it:

- **(A)** The store switch refetches, but the lazy 15-minute sync is gated on something a
  client-side navigation doesn't satisfy (a server component render, a cache header,
  `revalidate`, a cookie set only on document load), so the refetch returns cached rows
  that were never freshened.
- **(B)** The store switch does not refetch at all — the client holds the previously
  selected store's payload, or a `useEffect` dependency array omits the store ID.
- **(C)** The refetch happens but hits a route segment cached by Next.js / `fetch` cache,
  so a fresh request returns a stale response.
- **(D)** Something else. Describe it.

Name the exact file and line where the defect lives. If A is true, this is the *same*
defect as F-4 wearing a second hat — the fallback that was supposed to cover for the dead
webhook is itself only half-firing — and that should be stated plainly in the report.

### 1d. Establish the correct notification URLs

The handler derives the signed URL from `NEXT_PUBLIC_APP_URL` and Square's signature must
match it **byte-for-byte**. Report the value of `NEXT_PUBLIC_APP_URL` in each Vercel
environment as far as you can determine it from the repo and from `vercel env ls` if that
is available to you without exposing secret values.

**Flag explicitly if Preview's `NEXT_PUBLIC_APP_URL` is unset or points at the production
domain.** If it does, every staging webhook will 401 no matter how correctly the
subscription is registered, and the staging half of this fix will silently fail exactly
the way production has been failing.

### 1e. Deliverable for Task 1

Write a plan covering:

- The confirmed failure mode (1a).
- The three freshness paths and which is actually serving the dashboard today (1b).
- The root cause of store-switch staleness, with file and line (1c).
- The proposed code change, kept as small as the diagnosis allows.
- What the fixture `scripts/verify-f4-rollup-webhook.ts` already covers and what it
  does not — specifically whether it can cover the store-switch path at all.
- The row this second defect should be filed under. Grep `docs/ROADMAP.yaml` for the
  highest existing `BUG-n` and propose the next integer; state which you chose and why
  it is not being folded silently into F-4's row.

**STOP HERE. Present the plan to Gary. Do not build until he approves it.**

---

## Task 2 — Build (only after approval)

Scope is whatever the approved plan says. Expected shape:

1. The store-switch freshness fix, at the file and line identified in 1c.
2. Nothing else. Do not "improve" the webhook route, do not refactor `sales-sync.ts`,
   do not touch the reconcile cron.

Constraints:

- No schema changes, no migrations.
- Do not add, rename, or read new environment variables in code. The env vars in this
  fix are set by Gary in the Vercel console; the code already reads the ones it needs.
- Do not weaken signature verification for any reason, including local testing convenience.

Run `npx tsx scripts/verify-f4-rollup-webhook.ts` and report the full output. If it fails,
report and stop rather than adjusting the fixture to pass.

Run `next build` locally and report green before committing.

---

## Task 3 — Produce Gary's console checklist

**You cannot do any of this yourself and must not attempt it.** Write it into the session
report as a numbered, copy-pasteable checklist Gary executes by hand. It must cover, per
environment, and it must be explicit that doing one half without the other yields exactly
the silence of doing neither:

**Production (the production Square app):**
1. Square Developer Dashboard → the production app → Webhooks → Subscriptions → Add
   subscription. Notification URL = `<production NEXT_PUBLIC_APP_URL>/api/webhooks/square`,
   exact. Event types: `order.created`, `order.updated`, `payment.created`, `payment.updated`.
2. Copy that subscription's **Signature key** into `SQUARE_WEBHOOK_SIGNATURE_KEY`, scoped
   **Production**, in Vercel. Mark Sensitive.
3. Redeploy production so the new var is present in the running lambda.

**Staging (the separate "Froot Staging" Square app — different app, different key):**
4. Same three steps against the staging app, with the notification URL matching Preview's
   `NEXT_PUBLIC_APP_URL` exactly. If 1d found that value unset or wrong, **fixing it comes
   first** and must be step 4a.

**Verification, per environment, and this is the part that proves it rather than assumes it:**
5. Square Developer Dashboard's subscription page has a **Send test event** control. Use it,
   then read Vercel runtime logs for that environment and confirm a **200**, not a 500 or 401.
   A 500 means the env var did not reach the lambda. A 401 means the notification URL does
   not match `NEXT_PUBLIC_APP_URL` byte-for-byte.
6. Ring a real transaction on one Keva store and confirm the dashboard's "Today so far"
   moves **without a manual page refresh**, within the webhook's latency rather than the
   15-minute or nightly window.

Note in the checklist that step 6 is the only step that actually closes F-4's blocker.
Steps 1–5 are configuration; step 6 is evidence.

---

## Task 4 — Roadmap bookkeeping

Per house convention: **append-only, preserve-and-mark, prepend corrections with dates.**
Never edit an existing entry's text to mark it resolved.

1. **F-4's blocker entries.** Do not close them — you cannot, since closure depends on
   Gary's console work and step 6. Prepend a dated entry recording: the confirmed
   fail-closed (or fail-open) finding from 1a with its line numbers, the resolution of the
   nightly-vs-15-minute contradiction from 1b, and a pointer to this session's report.
2. **F-4's `open` entry** about fail-open vs fail-closed. This session either resolves it
   at source or escalates it. Mark it with the `resolved` flag **only** if 1a proved
   fail-closed by source reading. Never write `resolved: false`.
3. **The new BUG row** for store-switch staleness, using the ID proposed in 1e and approved
   by Gary. Cross-reference F-4 in both directions.
4. If 1c proved the two defects share a root cause, say so in both rows in the same words.

**Two-commit pattern.** Work commit first. Then a follow-up commit recording that SHA in
the ROADMAP row. Never commit-then-amend.

---

## Session report

Close with:

- Preconditions from Task 0 (toplevel path, branch, HEAD SHA).
- The 1a finding, quoted with line numbers.
- The 1b answer to the nightly-vs-15-minute contradiction.
- The 1c root cause, file and line, and whether it is the same defect as F-4.
- Both commit SHAs.
- Gary's console checklist from Task 3, verbatim and ready to work through.
- Out-of-scope findings classified FIX NOW / RULING NOW / COMMENT / ROW.
- Anything you were told to surface and stop on.

**Do not say "ready to push."** Gary decides that, and `staging` has DOC-1 work on it that
this session did not verify.
