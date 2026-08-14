# F-4 FINAL — Task 1 audit: webhook enablement + dashboard freshness on store switch

**Session date:** 2026-08-13 · **TIER 3** · Audit-only phase, no files edited.
**Prompt of record:** `docs/prompts/F-4_FINAL_webhook_and_freshness.md`

---

## Task 0 — Preconditions (measured, not recalled)

| Check | Command | Result |
|---|---|---|
| Repo root | `git rev-parse --show-toplevel` | `/Users/garythomas/Claude_Projects/Froot/froot` (lowercase — correct) |
| Branch | `git branch --show-current` | `staging` |
| Working tree | `git status` | Clean except one untracked file: `docs/prompts/F-4_FINAL_webhook_and_freshness.md` (this session's own prompt). Not cleaned up, as instructed. |
| HEAD | `git log --oneline -5` | `ce036f9 docs: commit DOC-1 session prompts and working drafts — board rows cite them` |

`staging` reports **up to date with `origin/staging`** — the DOC-1 work named in the
prompt's standing context is already pushed, so this session's commits would land on
top of pushed work rather than on top of an unpushed stack.

---

## 1a. The webhook route's failure mode at HEAD — **FAIL-CLOSED, CONFIRMED AT SOURCE**

Read in full: `src/app/api/webhooks/square/route.ts` (127 lines) and
`src/lib/square-webhook.ts` (27 lines).

### `SQUARE_WEBHOOK_SIGNATURE_KEY` unset → HTTP 500, before the body is read

```
46  export async function POST(req: Request) {
47    const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY
48    if (!signatureKey) {
49      return NextResponse.json({ error: "SQUARE_WEBHOOK_SIGNATURE_KEY is not configured" }, { status: 500 })
50    }
```

Lines 47–50 are the **first two statements** of the handler. `await req.text()` is not
reached until line 57, so with the key unset the request body is never read, never
parsed, and never reaches `processEvent`. There is no branch anywhere in the file that
skips `verifySquareWebhookSignature` — the only paths past line 62 require a valid
signature.

**This is fail-CLOSED in the strongest form. It is a broken feature, not an
unauthenticated write endpoint. There is no exposure window and nothing to remediate
beyond configuration.** The session proceeds to Task 2 as instructed.

### `NEXT_PUBLIC_APP_URL` unset → HTTP 500, also before the body is read

```
51    const appUrl = process.env.NEXT_PUBLIC_APP_URL
52    if (!appUrl) {
53      return NextResponse.json({ error: "NEXT_PUBLIC_APP_URL is not configured" }, { status: 500 })
54    }
```

Same posture, same position — ahead of `req.text()`. Both env guards fail closed.

### Signature is verified against the RAW body, before parsing — yes

```
56    // Signature covers the exact raw body — read text, verify, then parse.
57    const rawBody = await req.text()
58    const notificationUrl = new URL("/api/webhooks/square", appUrl).toString()
59    const valid = verifySquareWebhookSignature(notificationUrl, rawBody, signatureKey, req.headers.get(SQUARE_SIGNATURE_HEADER))
60    if (!valid) {
61      return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 })
62    }
63
64    let event: SquareWebhookEvent
65    try {
66      event = JSON.parse(rawBody) as SquareWebhookEvent
```

`JSON.parse` at :66 runs strictly after the 401 gate at :60–62, and it parses the same
`rawBody` string that was signed — not a re-serialisation. Correct ordering; no
parse-then-verify hazard, no canonicalisation gap.

### Handled event types (`:44`)

```
44  const HANDLED_TYPES = ["order.created", "order.updated", "payment.created", "payment.updated"]
```

Anything else returns `200 {received:true, ignored:"unhandled event type"}` (:71–73).
An event with no resolvable `location_id` likewise ACKs 200 and ignores (:75–80) — a
deliberate choice so Square does not retry something the handler cannot act on.

### Signing scheme (`src/lib/square-webhook.ts`)

- **Algorithm:** HMAC-SHA256, base64-encoded (`:14`).
- **What is signed:** `notificationUrl + rawBody` — string concatenation, the
  notification URL first (`:14`).
- **Header:** `x-square-hmacsha256-signature` (`:11`).
- **Comparison:** `crypto.timingSafeEqual` with an explicit length pre-check (`:26`),
  and a missing header returns `false` rather than throwing (`:23`).
- **URL source:** derived from `NEXT_PUBLIC_APP_URL`, deliberately **not** from the
  inbound request — comment at `:9` names the reason ("proxies rewrite hosts"). This
  is why the byte-for-byte match in 1d is load-bearing.

### Bookkeeping consequence

**The ROADMAP's `open` item on F-4 was already resolved at source on 2026-08-06** —
`docs/ROADMAP.yaml` carries a prepended entry, "RESOLVED 2026-08-06 AT SOURCE — FAILS
CLOSED, CONFIRMED", citing `:47` and `:48-50`, the same lines this audit re-derives.
The prompt's framing ("The roadmap records a *docs claim* … explicitly flagged as
unverified against source") describes the state before that entry was written. This
session's reading is an **independent re-confirmation at a later HEAD**, not a first
verification. Task 4 item 2 therefore has nothing new to mark — see § Task 4 impact.

---

## 1b. The three freshness paths, and which one is actually serving the dashboard

### Path 1 — Square order webhook (near-real-time). **DEAD since 2026-07-10.**

`src/app/api/webhooks/square/route.ts:46` → `processEvent` (`:101`) →
`syncSalesForStore` (`:121`), rewriting the affected store's whole local day.
Burst absorber at `:115-119`: skips if `salesPeriodCache.syncedAt >= eventAt`.

Dead because `SQUARE_WEBHOOK_SIGNATURE_KEY` is absent from every Vercel environment —
**re-measured this session, still absent on 2026-08-13** (see 1d). Every delivery,
if any subscription existed, would 500 at `:49`.

### Path 2 — 15-minute lazy sync on dashboard request. **ALIVE. Three implementations.**

| Route | Constant | Stale branch | Behaviour |
|---|---|---|---|
| `/api/dashboard/summary` | `route.ts:19` `STALE_MS = 15 * 60 * 1000` | `:83-95` | **Deferred** via `after()` |
| `/api/dashboard/sales` | `route.ts:18` | `:192-202` | **Deferred** via `after()` |
| `/api/dashboard/rollup` | `route.ts:18` | `:66-68` | **Inline `await`** |

All three read `salesPeriodCache.syncedAt` for the store's local `today` and compare
against `Date.now()`. All three also carry a distinct **first-load** branch
(`!todayRow`) that syncs **inline** — `summary:79-82`, `sales:189-191`,
`rollup:66` (folded into the same condition).

### Path 3 — nightly reconcile cron (source of truth). **ALIVE.**

`src/app/api/cron/sales-reconcile/route.ts:20`, `RECONCILE_DAYS = 3` (`:18`), re-pulls
`today-2 .. today` per Square-linked store across all orgs (`:39-42`), serially.
Registered in `vercel.json` at 11:00 UTC; `CRON_SECRET` is present in both Preview and
Production (1d), so this path is genuinely running.

### THE CONTRADICTION, SETTLED

> F-4's blocker: "live intraday pacing … has been silently degraded to the nightly
> sales-reconcile backfill since 2026-07-10. The dashboard has been showing day-old
> pacing, not live pacing, CONTINUOUSLY SINCE 2026-07-10."
>
> `docs/FORECASTING.md:121-124`: "the 15-min lazy dashboard sync and the nightly
> reconcile remain the fallback/source of truth".

**`docs/FORECASTING.md` is correct and the F-4 blocker text is WRONG.** The 15-minute
lazy sync is present and functioning at HEAD in all three dashboard routes. The
dashboard has **not** been showing day-old pacing. What it has actually been showing,
since 2026-07-23, is:

- **All-locations rollup** (`/api/dashboard/rollup`): genuinely fresh — the stale
  branch `await`s the Square sync before responding (`:67`). Slow, correct.
- **Single-store dashboard** (`/api/dashboard/summary`, `/api/dashboard/sales`):
  fresh to within 15 minutes **as of the previous request** — because the refresh is
  deferred behind `after()` and the response is composed from the pre-sync rows. See 1c.

**Severity is materially LOWER than the blocker asserts** — 15-minutes-plus-one-request,
not 24 hours — and this correction belongs in the row in both directions, because IG-1
quotes F-4's degradation claim onward.

**What was genuinely lost with the webhook** is sub-minute latency and the "Today so
far" number moving while an operator watches it. That is still a real regression of
F-4's headline feature; it is just not the nightly-backfill regression that was written
down.

---

## 1c. Store-switch staleness — **(A), and it is a second, distinct defect**

### Ruled out by source reading, not by elimination

**(B) — the client does not refetch. FALSE.**
`src/app/(app)/dashboard/dashboard-client.tsx`:
`saveStoreId` (`:145-148`) writes localStorage and dispatches `STORE_EVENT`;
`subscribeStoreKey` (`:128-135`) listens for it; `useSavedStoreId` (`:137-143`) is a
`useSyncExternalStore` over that event. So `storeId` (`:166-169`) changes on switch →
`loadSummary`/`loadComms` `useCallback` deps `[storeId]` (`:186`, `:193`) invalidate →
`useEffect [loadSummary, loadComms]` (`:195-198`) refires → `fetchCard` is called with
the **new** `storeId` in the URL (`:183`). Results are keyed by `storeId` (`:177`,
`:210`) precisely so a previous store's payload can never be rendered under the new
store. `SalesPerformanceCard` does the same with a composite key
(`sales-performance-card.tsx:280-292`, deps `[storeId, range.start, range.end, compare, retryTick]`).
**The refetch demonstrably fires and is correctly keyed.**

**(C) — a Next.js route-segment or fetch cache returns a stale response. FALSE.**
`grep` over `src/app/api/dashboard` and `src/app/(app)/dashboard` returns **zero** hits
for `export const dynamic`, `export const revalidate`, `export const fetchCache`,
`unstable_cache`, or `revalidatePath`. All five dashboard routes read
`new URL(req.url).searchParams` and call `getCurrentUser()` (Clerk `auth()` → headers),
which forces dynamic rendering; no `Cache-Control` is set on any response. The client
call is a plain browser `fetch` with a distinct URL per store
(`card-fetch.ts:7`). **Nothing caches.**

**(A) — TRUE, with the precise mechanism named.**

### THE DEFECT

**`src/app/api/dashboard/summary/route.ts:83-95`** (and the identical
**`src/app/api/dashboard/sales/route.ts:192-202`**):

```
83        } else if (Date.now() - todayRow.syncedAt.getTime() > STALE_MS) {
84          // BUG-1 step 4: stale-but-present refreshes AFTER the response. The
85          // card renders cached numbers immediately instead of hanging on a
86          // slow Square call; the next load sees the refreshed cache. Square
87          // order webhooks + the reconcile cron remain the primary freshness.
88          after(async () => {
89            try {
90              await syncSalesForStore(org, store, today, today)
91            } catch (err) {
92              console.error(`[api/dashboard/summary] background refresh failed store=${storeId}:`, err)
93            }
94          })
95        }
```

The response is assembled at `:103-127` from `salesPeriodCache` / `salesHourlyCache`
rows read **after** the `after()` callback was registered but **before** it executes —
`after()` runs once the response has flushed. So the response body is composed from the
**pre-sync** rows, every time.

Sequence on a store switch:

1. Switch to store B → `GET /api/dashboard/summary?storeId=B`.
2. B's `salesPeriodCache` row exists but `syncedAt` is older than 15 minutes.
3. Route registers the sync in `after()` and **responds with the stale rows**.
4. Response flushes; `after()` runs `syncSalesForStore`; the cache is now current.
5. User presses refresh → second request → `syncedAt` is now recent → stale branch does
   not fire → **the fresh numbers render.**

That is Gary's reported symptom exactly: *stale on switch, correct after a manual
refresh.* The route is not one sync behind — it is **one request** behind.

The comment at `:86` ("the next load sees the refreshed cache") states the behaviour
accurately. It was a deliberate trade under BUG-1, and the trade is only sound while
webhooks keep the cache fresh, which the comment's own next clause assumes.

### Why it is not the same defect as F-4, and why they compound

`git log -L 79,95:src/app/api/dashboard/summary/route.ts` returns two commits:

| Commit | Date | Change |
|---|---|---|
| `1b8160f` | 2026-07-06 | D-1 store dashboard redesign — stale branch was `await syncSalesForStore(...)`, **inline** |
| `2081401` | 2026-07-23 | STAFF-1, carrying "BUG-1 step 4" — moved it behind `after()` |

Verified against `git show 1b8160f:src/app/api/dashboard/summary/route.ts`: the original
was a single `if (!todayRow || stale) { await syncSalesForStore(...) }`. So:

- **2026-07-10 → 2026-07-23:** webhook dead, lazy sync **inline**. Dashboard fresh on
  every load, just slow. The store-switch symptom did **not** exist.
- **2026-07-23 → today (2026-08-13):** webhook dead **and** lazy sync deferred. Every
  single-store dashboard load serves numbers from the previous load.

**These are two independent defects with one shared consequence.** F-4's dead webhook is
a configuration gap dating to 2026-07-10. The deferred refresh is a code regression
introduced by BUG-1's own fix on 2026-07-23. They compound rather than coincide: with a
live webhook the cache would rarely be older than 15 minutes, the deferred branch would
almost never fire, and the store-switch symptom would be close to invisible. **The
fallback that was supposed to cover for the dead webhook is itself only half-firing** —
which is the sentence the prompt asked for if (A) proved true, and it does.

Note the direction of the interaction: **fixing the webhook alone would largely mask
this bug without fixing it.** It would resurface on any store not transacting, on any
webhook outage, and on the first load after any 15-minute quiet period.

### The rollup asymmetry, which is the same code disagreeing with itself

`/api/dashboard/rollup:66-68` never received BUG-1 step 4 — it still `await`s inline.
So today the **all-locations** view is fresh and slow while the **single-store** view is
fast and one request behind. Two surfaces of the same dashboard, seconds apart, can show
different "today" numbers for the same store. That belongs in the BUG row.

---

## 1d. Notification URLs — **both set, both UNREADABLE, and that is the finding**

Measured 2026-08-13 via `npx vercel env ls` (names/scopes only; **no values printed, no
`vercel env pull`**, per CLAUDE.md § Environment Variables).

| Var | Environment | Type | Created |
|---|---|---|---|
| `NEXT_PUBLIC_APP_URL` | Production | **Sensitive** (value `Hidden`) | 48d ago (≈2026-06-26) |
| `NEXT_PUBLIC_APP_URL` | Preview | **Sensitive** (value `Hidden`) | 41d ago (≈2026-07-03) |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | — | **ABSENT FROM EVERY ENVIRONMENT** | — |
| `CRON_SECRET` | Production, Preview | Sensitive | 36d ago |

Local `.env:23` → `NEXT_PUBLIC_APP_URL=http://localhost:3000` (dev only; not a deployed
value). `docs/STAGING_SETUP.md:91` documents the *intended* shape —
`https://<prod-domain>` for production, `https://staging-froot.vercel.app` "(or your
preview URL pattern)" for staging — which is a template, **not a measurement**, and the
parenthetical means it never asserted a concrete staging value.

### Findings, in order of consequence

**1. `SQUARE_WEBHOOK_SIGNATURE_KEY` is still absent everywhere.** F-4's first blocker is
re-confirmed live on 2026-08-13, 34 days after it was first confirmed on 2026-07-27 and
34 days after the degradation began. Nothing has changed.

**2. Preview's `NEXT_PUBLIC_APP_URL` is SET — so the prompt's failure hypothesis
("unset, or pointing at the production domain") is half-answered: it is not unset.**
Whether it points at the production domain **cannot be determined**, by me or by Gary,
because the var is marked **Sensitive**, and per CLAUDE.md § Provisioning a secret a
Sensitive value can never be revealed again — not in the dashboard, not by the CLI, not
by the API. This is the exact trap that section documents, applied to a value that is
not a secret at all.

**This is a hard blocker on Task 3 step 4 as the prompt writes it.** "With the
notification URL matching Preview's `NEXT_PUBLIC_APP_URL` exactly" is not an executable
instruction while the value is unreadable — and a wrong guess produces a **401**, which
is the silent-failure mode this whole session exists to prevent.

**Two ways out, both for Gary to choose between (see § Console checklist step 4a):**

- **(i) Overwrite it with a known value.** Delete and re-create Preview's
  `NEXT_PUBLIC_APP_URL` as **Non-sensitive**, set to the staging alias
  (`https://froot-git-staging-indianathomas-2483s-projects.vercel.app`), then redeploy
  staging. This is the recommended path: it makes the value readable forever after,
  which every future webhook/OAuth/invite debugging session needs, and it costs one
  redeploy. **A `NEXT_PUBLIC_` variable is inlined into client bundles by definition —
  marking it Sensitive protects nothing and only removes Gary's ability to read it.**
- **(ii) Recover the value from a system that already mirrors it.** The same env var
  builds the Square OAuth `redirect_uri`
  (`src/app/api/square/auth/route.ts:30`, `callback/route.ts:49`). If Square OAuth
  currently works on staging, then the "Froot Staging" app's registered redirect URI
  **is** `${Preview NEXT_PUBLIC_APP_URL}/api/square/callback` — so its host can be read
  straight off that app's OAuth settings page. Same trick via Clerk's invite
  `redirectUrl` (`src/app/api/users/route.ts:112`). This reads the value without
  changing anything, but it infers rather than proves, so **(i) is still the better
  path and (ii) is the cross-check.**

**3. Preview's `NEXT_PUBLIC_APP_URL` carries no git-branch qualifier** (contrast
`DATABASE_URL`, which shows `Preview (staging)`). One fixed URL therefore serves every
preview deployment on every branch. Webhook verification can only ever succeed for the
one branch whose alias matches it — every other preview branch 401s. Acceptable while
staging is the only preview that matters; worth knowing before anyone opens a second
preview branch and spends an afternoon on it.

**4. Eight non-secret variables are marked Sensitive** — `NEXT_PUBLIC_APP_URL`,
`NEXT_PUBLIC_SQUARE_APP_ID`, `NEXT_PUBLIC_CLERK_*` (four), `SQUARE_ENVIRONMENT`,
`HR_MODULE_AVAILABLE`, `LABOR_MODULE_AVAILABLE`. Every one is either `NEXT_PUBLIC_` (public
by construction) or a boolean/enum flag. Each is now permanently unreadable. Classified
below; not fixed here.

---

## 1e. Fixture coverage — what `verify-f4-rollup-webhook.ts` does and does not reach

Imports (`:21-27`): `prisma`, `reports`, `pacing`, `month-goal`, `square-webhook`, and
`POST as squareWebhookPost` from the webhook route. **That is the entire surface it can
touch.**

### What it covers (14 checks)

- Goal resolution per store — plan vs manual (`:138-141`).
- Rollup arithmetic (`:150-162`) — computed through `computeRollup` in `src/lib/pacing.ts`,
  **not** through `/api/dashboard/rollup`.
- Webhook handler, four cases (`:194-206`): signed payload → 200; wrong-key signature →
  401; missing header → 401; unknown `location_id` → 200-and-ignore.

### What it does NOT cover

1. **The unset-key 500 path — and it structurally cannot, as written.** Line 165 does
   `process.env.SQUARE_WEBHOOK_SIGNATURE_KEY = signatureKey` before the first call, so
   the exact branch that has defined production behaviour for the last month is never
   executed. **The fixture would stay green if `:48-50` were deleted tomorrow.** For a
   route whose entire security posture is that guard, that is worth one added check.
2. **Every dashboard route.** It never imports `/api/dashboard/summary`, `/sales`, or
   `/rollup`. Zero coverage of the 15-minute lazy sync, the `after()` deferral, or the
   `!todayRow` first-load branch.
3. **The store-switch path — and it cannot cover it at all.** Two independent reasons:
   - The dashboard routes call `getCurrentUser()` → Clerk `auth()`, which requires a
     real request scope with a session. The webhook route is callable from a script
     precisely *because* it authenticates by signature instead of by session; the
     dashboard routes are not.
   - Store switching is **client-side state** (`localStorage` + a `window` event,
     `dashboard-client.tsx:145-148`). A Node fixture has no DOM, no `localStorage`, and
     no React reconciler.

   Covering it needs either a browser-driven pass or a React test harness — **neither
   exists in this repo today, and standing one up is not in this session's scope.**
   The fix must therefore be verified by (a) source reading, (b) `next build` green,
   (c) Gary's manual store-switch check on staging. Say so plainly rather than implying
   fixture coverage that does not exist.

### The row this second defect goes under

`grep "id: BUG-" docs/ROADMAP.yaml` → BUG-1 (`:7225`), BUG-2 (`:7236`), BUG-3 (`:7243`),
BUG-4 (`:7278`), BUG-5 (`:7304`). Highest is **BUG-5**; the next integer is **BUG-6**.

**Proposed: `BUG-6 — Dashboard store switch serves the previous request's sales; the
15-minute lazy refresh lands after the response.`**

**Why it is not folded into F-4's row.** Four reasons, and the first is decisive:

1. **Different origin dates and different causes.** F-4's is a *configuration* gap from
   2026-07-10 (an env var and two Square subscriptions that were never created). BUG-6
   is a *code regression* from 2026-07-23, introduced by `2081401` — BUG-1 step 4. They
   are not one defect wearing two hats; they are two defects with one visible symptom.
2. **They close on different evidence.** F-4 closes on Gary's console work plus a live
   transaction moving "Today so far" (Task 3 step 6). BUG-6 closes on a code change plus
   a store switch showing current numbers — provable on staging **without** any Square
   webhook existing.
3. **Folding it in would let the wrong fix claim the win.** Setting the signature key
   would largely mask BUG-6 without repairing it (see 1c). One row covering both would
   be marked resolved by the masking fix.
4. **BUG-6 is a regression of BUG-1's fix**, so it belongs in the `BUG-` sequence beside
   the row that caused it — where the next reader of BUG-1 will find it. F-4 is a
   forecasting-track feature row.

Cross-reference both ways: F-4 gains a pointer to BUG-6 as the second half of the
observed symptom; BUG-6 gains a pointer to F-4 as the reason the defect stayed invisible
for three weeks, plus a pointer to BUG-1 as the change that introduced it.

---

## Out-of-scope findings — classified, not fixed

| # | Finding | Class |
|---|---|---|
| 1 | Preview + Production `NEXT_PUBLIC_APP_URL` are marked **Sensitive**, so a non-secret, `NEXT_PUBLIC_`-by-definition value is permanently unreadable — and it is the exact value the webhook fix must match byte-for-byte. | **RULING NOW** — blocks Task 3 step 4; Gary must choose path (i) or (ii) in 1d before the staging half can be executed. |
| 2 | Seven further non-secret vars marked Sensitive (`NEXT_PUBLIC_SQUARE_APP_ID`, four `NEXT_PUBLIC_CLERK_*`, `SQUARE_ENVIRONMENT`, plus `HR_MODULE_AVAILABLE` / `LABOR_MODULE_AVAILABLE` booleans). Same permanent-unreadability cost, no confidentiality benefit. | **ROW** — a small Vercel-hygiene sweep; would ride along with #1's re-creation. |
| 3 | `verify-f4-rollup-webhook.ts:165` sets `SQUARE_WEBHOOK_SIGNATURE_KEY` itself, so the fixture can never regress-detect deletion of the `:48-50` fail-closed guard. | **COMMENT** — one added check (call the handler with the var deleted, assert 500). Cheap, but it is a fixture change and Task 2 forbids widening scope. |
| 4 | `/api/dashboard/rollup:66-68` never received BUG-1 step 4 and still syncs inline, so the all-locations view and the single-store view can disagree about the same store's "today" seconds apart. | **ROW** — fold into BUG-6's text as the second surface; deciding which posture is canonical is part of that row, not this fix. |
| 5 | Preview's `NEXT_PUBLIC_APP_URL` has no git-branch qualifier, so one URL serves every preview branch and any second preview branch will 401 on webhooks. | **COMMENT** — note it in the checklist; harmless while staging is the only live preview. |
| 6 | F-4's blocker text asserting degradation "to the nightly sales-reconcile backfill" is factually wrong (1b), and IG-1's blocker quotes F-4's degradation claim onward. | **FIX NOW** — a dated prepended correction on F-4 is already Task 4's job; the IG-1 pointer should be checked in the same pass. |

---

## Proposed change (Task 2 scope, pending approval)

**Shape: make the client fetch again once the deferred sync has landed. Do not revert
`after()`.**

Reverting `:83-95` to an inline `await` would restore freshness in one line and
**reintroduce BUG-1 verbatim** — that row shipped 2026-07-23 specifically because an
inline Square call inside the request made the summary card hang against
`card-fetch.ts`'s 12-second timeout and skeleton forever. Trading a stale card for a
dead card is not a fix.

Four files, no schema, no migration, no new env var, no new route — matching Task 2's
constraints:

1. **`src/app/api/dashboard/summary/route.ts`** — in the stale branch (`:83-95`) set a
   local `salesRefreshing = true`; add `salesRefreshing` to the response object
   (`:160-176`). No behaviour change to the sync itself.
2. **`src/app/api/dashboard/sales/route.ts`** — same, `:192-202` → response `:220-229`.
3. **`src/app/(app)/dashboard/dashboard-client.tsx`** — in `loadSummary` (`:181-186`),
   when the payload carries `salesRefreshing`, schedule **exactly one** delayed refetch
   for that `storeId`. Guard with a ref keyed by `storeId` so it can fire at most once
   per store per mount; the second response cannot re-arm it, because by then
   `syncedAt` is recent and `salesRefreshing` is `false`. Bounded by construction — no
   polling loop.
4. **`src/app/(app)/dashboard/sales-performance-card.tsx`** — the same single-shot
   re-arm on its `requestKey` (`:280`).

Optionally (Gary's call, one extra line): surface the in-flight state in the card as a
quiet "updating…" affordance rather than refreshing numbers silently under the operator.
Left out of the default scope — it is a design decision, not a correctness one.

**Explicitly NOT in scope**, per Task 2: the webhook route, `sales-sync.ts`, the
reconcile cron, and `/api/dashboard/rollup`'s inline branch (finding #4 — recorded on
BUG-6, deliberately not touched).

**Verification available:** `npx tsx scripts/verify-f4-rollup-webhook.ts` (must stay
green — it does not cover this path, so green is a no-regression signal, not proof),
`next build` green, and a manual store-switch check on staging by Gary after the
staging-SHA precondition is satisfied. **Stated plainly: there is no automated coverage
of the fixed path, and this session does not create any.**
