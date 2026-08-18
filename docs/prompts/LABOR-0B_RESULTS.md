# LABOR-0B — RESULTS

**Run:** 2026-08-18
**Session type:** TIER 2, READ-ONLY SURVEY. Zero code changes, zero schema
changes, zero deploys, no push.
**Prompt:** `docs/prompts/LABOR-0B_completion_survey.md`
**Completes:** `docs/prompts/LABOR-0_shift_surface_grep.md` Tasks 1c and 5, plus
two research riders ruled in scope by Gary 2026-08-18.

This file is the addendum to LABOR-0. The original prompt file was not edited
(LABOR-0B hard rule 5).

---

## TRIAGE (before the report body, per LABOR-0 § Close)

**FIX NOW — 0.** Nothing in this survey is a defect this session may touch, and
this session may touch nothing.

**RULING NOW — 3.**

1. **Froot writes to Square today, and the write is not OAuth machinery.**
   `updateSquareTeamMemberName` (`src/lib/square.ts:227-254`) issues
   `PUT /v2/team-members/{id}`. It is live, reachable, and deliberate — the
   route comment says so in as many words: "here Froot is the source of truth"
   (`src/app/api/staff/[id]/square-writeback/route.ts:8-12`). The standing
   ruling this session was handed reads "Froot never writes to Square —
   app-wide, read-only by design, OAuth machinery excepted (2026-08-18, pending
   Gary's own wording — treat as binding)." A team-member name write-back is
   not OAuth machinery. **Gary's final wording must either carve this route out
   by name or the route is in breach of the ruling.** Not resolved here.
   See Finding 1c-4 for the full call path.

2. **The name write-back cannot be satisfied by Froot's OAuth token, so it can
   only land via the personal access token.** `SCOPES`
   (`src/app/api/square/auth/route.ts:9`) requests `EMPLOYEES_READ` and **not**
   `EMPLOYEES_WRITE`. `updateSquareTeamMemberName` tries
   `org.squareAccessToken` first and falls back to
   `process.env.SQUARE_ACCESS_TOKEN` (`src/lib/square.ts:236`). On the code path
   as written, the OAuth attempt cannot authorize a PUT, so any successful
   write-back is carried by the personal token — a credential whose permissions
   are not expressed in, or constrained by, the merchant's consent grant.
   **FLAGGED, NOT DIAGNOSED — not executed at runtime in this session.** This
   interacts directly with the read-only ruling above and with the consent
   batch in Task 3; it is Gary's call, not this session's.

3. **`REPORTING_READ` may not exist.** Square's own documentation contradicts
   itself. The Reporting API overview states the scope is required; the
   canonical OAuth Permissions Reference and the `OAuthPermission` enum
   reference both omit it entirely (Task 3 § Reporting). A scope string that is
   not an enum member cannot be put into a consent URL. **This is a question
   for Gary / Square support, not a judgment call to make here.**

**COMMENT — 6.**

- A `SQUARE_VERSION` bump moves **6 of 8** version-bearing header sites and
  silently leaves 2 behind (Task 1c, Finding 1c-3). This is the single most
  material finding for the planned bump.
- `docs/ROADMAP.yaml:7099-7100` describes the client as "one constant, seven
  call sites". The measured shape is one constant, 8 version-bearing header
  sites, only 6 of which track the constant. Preserve-and-mark correction, not
  a defect.
- The webhook handler ACKs an unrecognized event type with HTTP 200 and **no
  log line** (`src/app/api/webhooks/square/route.ts:71-73`). A newly-subscribed
  or renamed event type is invisible in logs. Directly relevant to L-2's
  webhook-ingest option (Task 5, Finding 5-3).
- **The Shift retirement date has already passed** — 2026-05-21, 89 days before
  this run. LABOR-0 was written 2026-08-02 to get ahead of a deadline that was
  already behind it. Froot was unaffected, re-verified today at zero hits
  (Task 5 § Re-verification).
- Scheduled-shift **reads** are not gated by a Shifts Plus subscription; only
  certain write/update paths are (Task 3 § Shifts Plus). The RULING NOW trigger
  the prompt specified for this did **not** fire.
- Timecard-adjacent **wage reads are already covered by the held
  `EMPLOYEES_READ`** — the wage half of L-2 needs no new scope (Task 3).

**ROW — 0.** No new roadmap row is warranted. L-2 already exists and already
carries every constraint this survey touched; the recorder commit updates its
blocker text rather than opening anything new.

**OUT-OF-SCOPE (noticed, not fixed, not filed):** the `TIMECARDS_SETTINGS_READ`
row in Square's permissions reference lists `UpdateBreakType` under a READ
scope. Almost certainly a doc error on Square's side. Recorded because it will
confuse whoever writes the consent batch.

---

## Task 0 — Original prompt read in full

`docs/prompts/LABOR-0_shift_surface_grep.md` was read in full before any other
work.

### CONFLICT RECORDED (LABOR-0B Task 0 requires this)

LABOR-0B § Task 1 summarizes Task 1c as:

> a count and listing of the sites in `src/` (excluding `src/generated`) where
> the word "shift" is already spent or where labor-surface code would be
> touched by the L-2 build.

The original file's Task 1c reads:

> c. How many distinct construction sites exist — one shared client, or several
>    scattered ones. If several, note whether they agree on the version.

These are different tasks. Task 1c in the original is about **Square client
construction sites** — it is subtask (c) of Task 1, "Square client version
pin" — and has nothing to do with the word "shift". Per LABOR-0B Task 0, **the
file wins.**

Corroboration that the file is right and the summary is the outlier:
`docs/ROADMAP.yaml:7108` calls the owed item "Task 1c construction-site count",
which matches the original's meaning, and the word-"shift" survey is already
covered by the original's Task 2, which the 2026-08-05 partial completed.

**Task 1 below executes the original's Task 1c.** The LABOR-0B framing is
recorded as a mis-summary and not acted on.

### Constraint reconciliation

LABOR-0 § Hard constraints forbids git commands of any kind. LABOR-0B § Output
and commits mandates two commits. LABOR-0B is this session's governing prompt
and its commit instruction is deliberate and specific, so it governs session
mechanics; LABOR-0's read-only constraint was honoured for all *file* content —
nothing under `src/` was read-modified, and the only files written are this
results file and the ROADMAP blocker text.

### Exclusions applied to every grep

Per LABOR-0 § Hard constraints, every search below ran with:

```
-g '!src/generated/**' -g '!docs/**' -g '!node_modules/**' -g '!*.lock'
```

Rationale is the original's: `docs/` prose and `src/generated/roadmap.ts`
contain the exact search strings and have manufactured false grep evidence
before (DEBT-43). Where a search deliberately *included* `docs/` — Task 5's
"where is the event list referenced in docs" half — that is stated inline.

---

## Task 1 — LABOR-0 Task 1c (Square client construction sites)

Task 1c cannot be read without 1a and 1b, so both are re-measured and reported
first. All three are dated 2026-08-18.

### 1a — the `square` package version in `package.json`

```
grep -n "square" package.json
```

**Result: exit 1, zero matches.**

Plain reading: there is no `square` npm package. Every Square call in this repo
is a raw `fetch`. Confirms the ROADMAP's "raw fetch, no `square` npm package"
(`docs/ROADMAP.yaml:7100`).

### 1b — every `Square-Version` value

```
rg -n "SQUARE_VERSION|Square-Version|squareVersion" \
  -g '!src/generated/**' -g '!docs/**' -g '!node_modules/**' -g '!*.lock' .
```

```
src/lib/square.ts:4:const SQUARE_VERSION = "2024-01-17"
src/lib/square.ts:70:    headers: { "Content-Type": "application/json", "Square-Version": SQUARE_VERSION },
src/lib/square.ts:141:          "Square-Version": SQUARE_VERSION,
src/lib/square.ts:175:        "Square-Version": SQUARE_VERSION,
src/lib/square.ts:212:        "Square-Version": SQUARE_VERSION,
src/lib/square.ts:243:        "Square-Version": SQUARE_VERSION,
src/lib/square.ts:284:      "Square-Version": SQUARE_VERSION,
src/app/api/square/callback/route.ts:43:    headers: { "Content-Type": "application/json", "Square-Version": "2024-01-17" },
src/app/api/square/locations/route.ts:44:    headers: { Authorization: `Bearer ${org.squareAccessToken}`, "Square-Version": "2024-01-17" },
```

Verbatim, as LABOR-0B § Task 4 requires:

> `src/lib/square.ts:4` → `const SQUARE_VERSION = "2024-01-17"`

Plain reading: **8 version-bearing header sites, all currently reading
`2024-01-17`, but only 6 of them get there through the constant.** Two hardcode
the string literal and never import `SQUARE_VERSION`.

### 1c — how many distinct construction sites, and do they agree?

**Answer: not one shared client. Three tiers, 11 Square-bound request sites,
8 of which carry a version header.**

Full enumeration, from:

```
rg -n "/v2/|/oauth2/" -g '!src/generated/**' -g '!docs/**' -g '!node_modules/**' -g '!*.lock' src/
rg -n "client\.baseUrl|client\.headers|baseUrl\}" -g '!src/generated/**' -g '!docs/**' -g '!node_modules/**' -g '!*.lock' .
rg -n "getSquareClient|updateSquareTeamMemberName|fetchSquareTeamMembers|fetchSquareTeamMember\b|fetchSquareLocation|squareBaseUrl" -g '!src/generated/**' -g '!docs/**' -g '!node_modules/**' -g '!*.lock' .
```

**Tier 1 — the one shared factory.** `getSquareClient` (`src/lib/square.ts:275-288`)
returns `{ baseUrl, headers, org }` and is the only thing in the repo that
resembles a client. It is constructed at 4 sites and consumed at 4 fetch sites:

| # | Construct | Fetch | Endpoint | Version source |
|---|---|---|---|---|
| 1 | `src/lib/sales-sync.ts:262` | `src/lib/sales-sync.ts:291` | `POST /v2/orders/search` | constant |
| 2 | `src/app/api/forecasting/day-report/route.ts:67` | `:76` | `POST /v2/orders/search` | constant |
| 3 | `src/app/api/square/catalog/sync/route.ts:53` | `:64` | `GET /v2/catalog/list` | constant |
| 4 | `src/app/api/square/sales-items/sync/route.ts:49` | `:60` | `GET /v2/catalog/list` | constant |

`getSquareClient` is also the **only** path that calls `refreshTokenIfNeeded`
(`src/lib/square.ts:278`). Everything in Tiers 2 and 3 skips token refresh.

**Tier 2 — five ad-hoc header literals inside `src/lib/square.ts`.** These do
not use `getSquareClient`; each assembles its own headers object, but each
reads the `SQUARE_VERSION` constant, so they agree by construction:

| # | Line | Endpoint | Function |
|---|---|---|---|
| 5 | `src/lib/square.ts:68-70` | `POST /oauth2/token` | `refreshTokenIfNeeded` |
| 6 | `src/lib/square.ts:137-143` | `POST /v2/team-members/search` | `fetchSquareTeamMembers` |
| 7 | `src/lib/square.ts:172-176` | `GET /v2/team-members/{id}` | `fetchSquareTeamMember` |
| 8 | `src/lib/square.ts:209-213` | `GET /v2/locations/{id}` | `fetchSquareLocation` |
| 9 | `src/lib/square.ts:239-245` | **`PUT /v2/team-members/{id}`** | `updateSquareTeamMemberName` |

**Tier 3 — two ad-hoc header literals OUTSIDE `src/lib/square.ts` that hardcode
the version string.** These import only `squareBaseUrl`, never the constant:

| # | Line | Endpoint | Version source |
|---|---|---|---|
| 10 | `src/app/api/square/callback/route.ts:41-43` | `POST /oauth2/token` | **hardcoded `"2024-01-17"`** |
| 11 | `src/app/api/square/locations/route.ts:43-44` | `GET /v2/locations` | **hardcoded `"2024-01-17"`** |

**Not a version-bearing site:** `src/app/api/square/auth/route.ts:32` builds the
`/oauth2/authorize` redirect URL. It sends no `Square-Version` header, which is
correct — the authorize redirect is a browser navigation, not an API call.

### Findings

**1c-1 — There is no single shared client.** One factory covering 4 of 11 sites;
7 sites assemble their own headers. Answering the original's question directly:
**several scattered ones.**

**1c-2 — They agree on the version today.** All 8 version-bearing sites send
`2024-01-17` as of this run. The original's follow-up ("note whether they
agree") is satisfied: **yes, currently.**

**1c-3 — They agree by coincidence, not by construction, and a bump breaks that.**
This is the finding that matters. Editing `src/lib/square.ts:4` moves sites
1-9 and leaves sites 10 and 11 pinned at `2024-01-17`. The repo would then be
sending **two different API versions to Square simultaneously**, including two
different versions of `POST /oauth2/token` — site 5 (constant, bumped) and site
10 (hardcoded, stale) hit the *same endpoint* on the *same OAuth flow*.

This is a direct, unflagged hazard for the Task 4 version bump, and it is not
recorded anywhere in `docs/ROADMAP.yaml` today. **Surfaced, not fixed** — hard
rules 2 and 4 forbid this session touching either file.

**1c-4 — One of the 11 sites is a WRITE.** Site 9,
`PUT /v2/team-members/{id}` in `updateSquareTeamMemberName`. Live call path:

```
POST /api/staff/[id]/square-writeback
  → src/app/api/staff/[id]/square-writeback/route.ts:46
  → updateSquareTeamMemberName  (src/lib/square.ts:227)
  → PUT {baseUrl}/v2/team-members/{id}  (src/lib/square.ts:239)
```

Escalated to **RULING NOW 1 and 2**. Sites 1-8, 10 and 11 are reads or OAuth
token machinery; site 9 is the sole exception, and it is not OAuth machinery.

**1c-5 — Tiers 2 and 3 bypass token refresh.** Only `getSquareClient` calls
`refreshTokenIfNeeded`. Seven Square-bound sites use whatever token is on the
`Organization` row. Noted for completeness — outside this survey's scope, not
filed.

### APIs Froot calls today (the Task 4 filter set, measured not assumed)

OAuth (`/oauth2/authorize`, `/oauth2/token`), Orders (`search`), Catalog
(`list`), Locations (`list`, `get`), Team (`team-members/search`,
`team-members/{id}` GET and PUT). **Froot calls no `/v2/merchants` endpoint** —
`MERCHANT_PROFILE_READ` is held because it is the scope governing Locations
reads, not because a Merchants endpoint is called. Labor: none.

---

## Task 2 — LABOR-0 Task 5 (webhook inventory)

### Code side — every event type the handler processes

```
src/app/api/webhooks/square/route.ts:44
const HANDLED_TYPES = ["order.created", "order.updated", "payment.created", "payment.updated"]
```

| Event type | Handled at | Entity key read | Beta? |
|---|---|---|---|
| `order.created` | `route.ts:44`, dispatched `:71` | `obj.order_created` (`:76`) | **yes** |
| `order.updated` | `route.ts:44`, dispatched `:71` | `obj.order_updated` (`:76`) | **yes** |
| `payment.created` | `route.ts:44`, dispatched `:71` | `obj.payment` (`:76`) | no |
| `payment.updated` | `route.ts:44`, dispatched `:71` | `obj.payment` (`:76`) | no |

**Four event types. No others.** Beta status per `docs/ROADMAP.yaml:2772-2777`.

The handler is the only Square webhook surface: `find src/app/api/webhooks -type f`
returns exactly `clerk/route.ts` and `square/route.ts`.

Full processing path, for the record:

| Stage | Line | Behaviour |
|---|---|---|
| Env guard | `:47-54` | 500 if `SQUARE_WEBHOOK_SIGNATURE_KEY` or `NEXT_PUBLIC_APP_URL` unset |
| Signature | `:57-62` | HMAC-SHA256 over notification URL + raw body; 401 on mismatch |
| Parse | `:64-69` | 400 on invalid JSON |
| **Type filter** | **`:71-73`** | **200 + `{received, ignored}` on unrecognized type** |
| Location filter | `:76-80` | 200 + `{received, ignored}` when no `location_id` |
| ACK-then-process | `:89-94` | `after()`, falling back to inline when outside a request scope |
| Resync | `:101-126` | re-pulls the store's whole local day; never throws |

Signature verification lives in `src/lib/square-webhook.ts:11-27`
(`x-square-hmacsha256-signature`, timing-safe compare).

### Every place the event list or API version is referenced

```
rg -n "order\.created|order\.updated|payment\.created|payment\.updated|labor\.shift|labor\.timecard|webhooks/square|2024-01-18" \
  -g '!node_modules/**' -g '!*.lock' -g '!src/generated/**' .
```

`docs/` deliberately included here — the prompt asks for doc references.

**Code (3):**

| Location | What |
|---|---|
| `src/app/api/webhooks/square/route.ts:44` | the authoritative list |
| `src/app/api/webhooks/square/route.ts:58` | notification URL derived from `NEXT_PUBLIC_APP_URL` |
| `scripts/verify-f4-rollup-webhook.ts:169,174` | fixture; posts a synthetic `order.updated` |

**Docs (5 primary):**

| Location | What |
|---|---|
| `docs/FORECASTING.md:115-133` | setup procedure; all four events; the signature-key step |
| `docs/ROADMAP.yaml:2732-2734` | **the dashboard reading** — URL, API version, four events |
| `docs/ROADMAP.yaml:2758-2771` | the version-discrepancy record (see below) |
| `docs/ROADMAP_ARCHIVE.md:21` | F-4 shipped row, deploy note |
| `CLAUDE.md:827` | pointer line |

**API version referenced in code: nowhere.** No file under `src/` mentions
`2024-01-18` or otherwise version-guards the webhook payload shape. The
subscription's API version exists only in the Square dashboard and in the
ROADMAP record of it. Consequence: if a subscription version change alters
payload shape, nothing in the repo detects it — the handler would fall through
`:76` to `locationId === undefined` and return the `:79` ignore, silently.

### Finding 5-3 — unrecognized event types are swallowed without a log

```
src/app/api/webhooks/square/route.ts:71-73
  if (!event.type || !HANDLED_TYPES.includes(event.type)) {
    return NextResponse.json({ received: true, ignored: "unhandled event type" })
  }
```

HTTP 200, no `console.*` call. The `ignored` string goes back to Square, which
discards it, and is never written to a Vercel log. Square's delivery log will
show 200 and nothing will look wrong.

Why this matters beyond tidiness: **L-2's leading ingest option is
webhook-driven** (`docs/ROADMAP.yaml:7148-7151`). If `labor.timecard.created` /
`labor.timecard.updated` are added to the subscription before the handler
learns them, every one is 200-ACKed and dropped with no trace, and Square will
not retry a 200. The same silence applies today to any renamed or newly-beta
event. **Recorded as COMMENT; the fix belongs to whoever builds the ingest.**

### Finding 5-4 — the version discrepancy is already ruled, do not "fix" it

`docs/ROADMAP.yaml:2758-2771` records that the subscription is `2024-01-18`
while `SQUARE_VERSION` is `2024-01-17`, and rules them **not the same knob**:
the subscription version governs event shape Square *sends*; the constant is
the header on calls Froot *sends*. Different directions, independently
versioned. Carried forward here so the Task 4 bump does not drag the
subscription version with it by reflex.

### Dashboard side

The prompt directed this half to be recorded as **OWED — GARY**. It is
partially discharged already by a dated first-party record, so both states are
given.

**PRODUCTION — the three prior claims are CONFIRMED, not assumed.** Source:
`docs/ROADMAP.yaml:2730-2734`, an entry written by Gary from his own dashboard
session on **2026-08-13**:

> webhook subscription registered, notification URL
> `https://www.usefroot.com/api/webhooks/square`, API version `2024-01-18`,
> events `order.created`, `order.updated`, `payment.created`, `payment.updated`
> — the exact four the handler switches on (route.ts:44).

| Prior claim | Status | Source |
|---|---|---|
| subscription version `2024-01-18` | **CONFIRMED** | ROADMAP.yaml:2732, dated 2026-08-13 |
| four event types | **CONFIRMED**, and they match `route.ts:44` exactly | ROADMAP.yaml:2733-2734 |
| endpoint `https://www.usefroot.com/api/webhooks/square` | **CONFIRMED** | ROADMAP.yaml:2732 |

Production Square app: `sq0idp-UdjqLfkxl0hlbw7b30IiLA` ("Froot").

**STAGING — recorded answer is that no subscription exists.**
`docs/ROADMAP.yaml:2717-2722` states Preview/staging has no subscription on the
staging Square app (`sq0idp-YPgmfGap_oYDRTyYIFG3zw`, "Froot Staging") and that
the staging half "still hits the identical 401". Two separate Square
applications against the same real merchant account, deliberately
(`docs/ROADMAP.yaml:2708-2716`).

**OWED — GARY.** The above is a 2026-08-13 documentary record, not a reading
taken today, and the prompt asked for CONFIRMED-not-assumed. A live re-read
costs a minute and makes the record current as of the consent batch.

Dashboard path, production:
`https://developer.squareup.com/apps` → **Froot**
(`sq0idp-UdjqLfkxl0hlbw7b30IiLA`) → **Webhooks** → **Subscriptions** → open the
subscription.

Dashboard path, staging: same, but app **Froot Staging**
(`sq0idp-YPgmfGap_oYDRTyYIFG3zw`).

Blanks for Gary to fill — **do not guess these:**

| Field | Production (observed ____ ) | Staging (observed ____ ) |
|---|---|---|
| Subscription exists? | | |
| Notification URL | | |
| API version | | |
| Event types (list all) | | |
| Enabled / disabled | | |

### Re-verification — the deprecated Shift surface, re-dated

Not asked for by LABOR-0B, but Task 4's research established that the Shift
retirement date (**2026-05-21**) has already passed, which makes the
2026-08-05 partial's zero-hit answer worth re-dating rather than inheriting.

```
rg -n "labor/shifts|SearchShifts|CreateShift|UpdateShift|DeleteShift|RetrieveShift|ListShifts|labor\.shift\.|labor/timecards|SearchTimecards|CreateTimecard|UpdateTimecard|labor\.timecard\.|BreakType|WorkweekConfig|TeamMemberWage" \
  -g '!src/generated/**' -g '!docs/**' -g '!node_modules/**' -g '!*.lock' src/ scripts/ prisma/
```

**Result: exit 1, zero matches.**

Plain reading: as of 2026-08-18, this repo calls no deprecated Shift endpoint,
handles no `labor.shift.*` event, and contains no Timecard, BreakType,
WorkweekConfig or TeamMemberWage surface. **No Square labor ingest exists
today.** The 410-GONE retirement passed 89 days ago and Froot was untouched by
it, precisely because the surface was already clean.

### LABOR-0 § Report format — the four questions

1. Deprecated Shift endpoint or `labor.shift.*` event? — **NO. Count: 0.**
   (re-verified 2026-08-18)
2. What `Square-Version` does it send? — **`2024-01-17`**, from 8 header sites,
   6 via `src/lib/square.ts:4` and 2 hardcoded.
3. Is `TIMECARDS_READ` in the requested scopes? — **NO.**
4. Does any labor ingest exist today? — **NO.**

---

## Task 3 — Exact OAuth scope strings

### Held today, verbatim

`src/app/api/square/auth/route.ts:9`, quoted as required:

> `const SCOPES = "MERCHANT_PROFILE_READ ITEMS_READ ORDERS_READ EMPLOYEES_READ"`

Confirms the ROADMAP blocker text at `docs/ROADMAP.yaml:7170-7173` exactly. One
scope list, no environment branching — the same four strings go to both the
production and the staging Square app.

### The table

Sources: [OAuth Permissions Reference](https://developer.squareup.com/docs/oauth-api/square-permissions),
[`OAuthPermission` enum](https://developer.squareup.com/reference/square/enums/OAuthPermission),
[Labor API Scheduling](https://developer.squareup.com/docs/labor-api/scheduling).
All strings copied, not paraphrased.

| Need | Exact scope string | What it unlocks (endpoints) | Covered by an already-held scope? |
|---|---|---|---|
| Timecard reads (hours, breaks, declared cash tips) | `TIMECARDS_READ` | `RetrieveTimecard`, `SearchTimecards` | **NO — must be added** |
| Break types + workweek config reads | `TIMECARDS_SETTINGS_READ` | `GetBreakType`, `ListBreakTypes`, `ListWorkweekConfigs` | **NO — must be added** |
| Scheduled-shift READS (never writes) | `TIMECARDS_READ` | `RetrieveScheduledShift`, `SearchScheduledShifts` | **NO — but same string as row 1, so no extra scope** |
| Team wage / job / pay-rate reads | `EMPLOYEES_READ` | `GetTeamMemberWage`, `ListTeamMemberWages`; Team API retrieve team members, wage settings, jobs | **YES — already held. No addition needed.** |
| Reporting API beta | *disputed — see below* | *n/a* | **unresolvable this session** |

**Net: the consent batch needs exactly two new strings —
`TIMECARDS_READ` and `TIMECARDS_SETTINGS_READ`.**

Two results worth stating plainly because they shrink the long pole:

- **Scheduled-shift reads cost nothing extra.** Square documents them under the
  same `TIMECARDS_READ` string as timecards: "Applications using OAuth to
  authorize API requests require the `TIMECARDS_WRITE` or `TIMECARDS_READ`
  permission to call scheduling endpoints." Read-only access to the Keva
  September scheduling move needs no third scope.
- **The wage half needs no new scope at all.** `EMPLOYEES_READ` — already in
  production, already consented by every connected merchant — covers
  `GetTeamMemberWage` and `ListTeamMemberWages`. The DEBT-10 / `labor.costs.view`
  gating question is unchanged, but it is a Froot-side permission question, not
  a Square consent question.

### No WRITE scope is required for any read capability

The prompt's first RULING NOW trigger — "any needed read capability turns out
to require a scope whose name contains WRITE" — **did not fire.** Every read in
the table is served by a `_READ` string.

### Shifts Plus — the second trigger, also did not fire

Square, [Labor API Scheduling](https://developer.squareup.com/docs/labor-api/scheduling), verbatim:

> "Some scheduling features require that the seller has an active Shifts Plus
> subscription. For example, shifts that are scheduled more than 10 days in
> advance using the Labor API are visible in the Square Dashboard to sellers
> without a subscription but these shifts cannot be updated."

Reads are visible to non-subscribers; the restriction lands on *updating*.
`RetrieveScheduledShift` / `SearchScheduledShifts` are not documented as
subscription-gated. **The trigger's condition — "requires a merchant-side
subscription to return data" — is not met for reads.**

Recorded as COMMENT rather than dropped, because it *does* bite L-4's schedule-
push half. That half is already prohibited, so this is confirmation, not news.

### `Square-Version` independence — INCONCLUSIVE AT SOURCE

The prompt asked to confirm or refute the planning lean (that scope grants are
independent of the `Square-Version` header) **at source**. Neither happened.

- The [OAuth Permissions Reference](https://developer.squareup.com/docs/oauth-api/square-permissions)
  contains no statement tying permissions to, or freeing them from, the version
  header.
- The [API versioning overview](https://developer.squareup.com/docs/build-basics/versioning-overview)
  states only what the header controls: "The default API version is pinned to
  the application and used for all API requests unless overridden in the
  `Square-Version` header." It says nothing about OAuth scopes.

**Finding: Square does not document the relationship in either direction.** The
lean is not refuted, but it is *not confirmed at source either*, and this
session will not assert it. What *is* documented and load-bearing is separate
and stronger: scheduled-shift and timecard endpoints require **Square API
version 2025-05-21 or later** regardless of scope, so the version bump and the
scope grant are both necessary independent of how they interact. That matches
the ROADMAP's existing "the two move together" framing
(`docs/ROADMAP.yaml:7174-7175`).

**Question for Gary:** accept "undocumented, treat both as required" as the
working answer, or ask Square support for a definitive statement before the
consent batch?

### Is `EMPLOYEES_READ` deprecated in favour of a Team-scoped permission?

**No — and the distinction matters.**

- The **scope** `EMPLOYEES_READ` is current. It appears in the live
  `OAuthPermission` enum with no deprecation marker, and the permissions
  reference lists it as the scope governing **Team API** reads: "EMPLOYEES_READ
  — Retrieve team members, wage settings, jobs."
- The **Employees API** is deprecated: "The Employees API is deprecated and
  replaced by the Team API."

So the API named "Employees" is dead while the scope named `EMPLOYEES_READ` is
the live scope for its replacement. There is no `TEAM_READ` and no migration
guidance to one, because there is nothing to migrate. **Froot needs no scope
change here**, and `src/lib/square.ts`'s Team API calls (sites 6, 7, 9) are on
the correct, non-deprecated API already.

Recorded because the name invites exactly the wrong inference during a consent
batch.

### Beta / deprecated / renamed scopes on the list

Checked against the `OAuthPermission` enum reference:

| Scope | Status |
|---|---|
| `TIMECARDS_READ` | current, not beta, not deprecated |
| `TIMECARDS_SETTINGS_READ` | current, not beta, not deprecated |
| `EMPLOYEES_READ` | current (see above) |
| `MERCHANT_PROFILE_READ`, `ITEMS_READ`, `ORDERS_READ` | current |

Beta markers on that page attach to `VENDOR_READ`, `VENDOR_WRITE`,
`PAYOUTS_READ`, `DEVICES_READ` — **none of which Froot holds or needs.**

**The Shift→Timecard rename (2025-05-21) renamed no scope.** `TIMECARDS_READ`
and `TIMECARDS_WRITE` predate it and now cover Timecards, ScheduledShifts *and*
the deprecated Shifts. Nothing in the scope list changed names; only endpoints,
data types and webhook event names did.

### Reporting API — a genuine contradiction in Square's own docs

The prompt expected `REPORTING_READ` and asked for confirmation. What the
sources actually say:

| Source | Says |
|---|---|
| [Reporting API Overview](https://developer.squareup.com/docs/reporting-api/overview) | `REPORTING_READ` is the required scope for OAuth apps |
| [OAuth Permissions Reference](https://developer.squareup.com/docs/oauth-api/square-permissions) | **no Reporting permission listed at all** (46 scopes; `REPORTING_READ` absent) |
| [`OAuthPermission` enum](https://developer.squareup.com/reference/square/enums/OAuthPermission) | **`REPORTING_READ` is not an enum member** (47 values; absent) |

Two canonical scope inventories omit a string a third page says is mandatory.
Escalated to **RULING NOW 3**. A consent URL is built from enum members; a
string absent from the enum will not authorize, and may hard-fail the whole
authorize request rather than just that one scope — which would break the
consent batch for *all* merchants, not just the Reporting feature.

**Not resolved here, per hard rule 8 and the prompt's closing instruction.**
Question for Gary: is the Reporting API in L-2's scope at all? If not, drop the
row and the contradiction is moot. If yes, it needs a Square support ticket
before the batch, not a guess.

### Consent-batch consequence

Adding `TIMECARDS_READ` and `TIMECARDS_SETTINGS_READ` forces every connected
merchant back through consent — unchanged from
`docs/ROADMAP.yaml:7182-7188`. What this survey changes is only the *size* of
the batch: **two strings, not the three or four previously assumed**, because
the wage capability is already granted and scheduled-shift reads share
`TIMECARDS_READ`. `TIMECARDS_WRITE` remains out (L-4's push half is
prohibited), which also keeps the batch clear of the Shifts Plus dependency.

---

## Task 4 — `SQUARE_VERSION` changelog delta

### Current pin, verbatim

`src/lib/square.ts:4`:

> `const SQUARE_VERSION = "2024-01-17"`

Proposed target (Gary's accepted lean, 2026-08-18): **`2026-01-22`**.

### Filter set

Only APIs Froot actually calls, as measured in Task 1c: Orders, Catalog,
Locations, Team/Employees, Merchants, OAuth, Webhooks. Everything else in each
release is ignored by instruction.

### The delta table

All eleven dates fetched from
`https://developer.squareup.com/docs/changelog/connect-logs/<date>`.

| Date | API | Change | Breaking? | Froot call site touched |
|---|---|---|---|---|
| 2024-02-22 | Catalog | Text-based modifiers (Beta): `modifier_type`, `max_length`, `text_required`, `internal_name` on `CatalogModifierList`; `ordinal` on `CatalogModifierListInfo` | no | `catalog/sync/route.ts:64`, `sales-items/sync/route.ts:60` — additive, unread |
| 2024-02-22 | Webhooks | `CreateWebhookSubscription` / `UpdateWebhookSubscription` now 400 on read-only fields in the body | **yes** | **none** — Froot never calls the Webhooks *management* API; subscriptions are created by hand in the dashboard |
| 2024-04-17 | Catalog | `CatalogModifierList` / `CatalogCategory` support custom attributes | no | `catalog/sync/route.ts:64`, `sales-items/sync/route.ts:60` — additive, unread |
| 2024-04-17 | OAuth | **`RenewToken` endpoint retired** | **yes** | **none** — Froot refreshes via `POST /oauth2/token` with `grant_type: "refresh_token"` (`src/lib/square.ts:68-76`), not `RenewToken` |
| 2024-05-15 | Catalog | `is_taxable` added to `CatalogItem` | no | `catalog/sync/route.ts:64`, `sales-items/sync/route.ts:60` — additive, unread |
| 2024-08-21 | Catalog | `include_category_path_to_root` param on 3 endpoints; `CatalogEcomSeoData`, `CategoryPathToRootNode`; `CatalogCategory` gains `category_type`/`parent_category`/`is_top_level`/`channels`/`ecom_seo_data`/`path_to_root`; `CatalogItem` gains `categories`/`channels`/`ecom_seo_data`/`reporting_category`; `CatalogObject` gains `availability_period_data` | no | `catalog/sync/route.ts:64`, `sales-items/sync/route.ts:60` — all additive |
| 2024-08-21 | Locations | Two new Merchant Category Codes for AU (5812, 5813) | no | `locations/route.ts:43`, `square.ts:209` — AU-only, no effect |
| 2024-09-19 | Orders | `order.line_items[].quantity_unit` now present for versions **prior to** 2024-09-19 on fractional-quantity lines not tied to fractional-unit variations | no | `sales-sync.ts:291`, `day-report/route.ts:76` — **verified no impact**, Froot reads `line.quantity` (`sales-sync.ts:373`) and never `quantity_unit` |
| 2024-12-18 | Team | `Job` object + `CreateJob`/`UpdateJob`/`ListJobs`/`RetrieveJob` (Beta); `wage_setting` added to `TeamMember` (Beta); `job_id` replaces `job_title` as identifier on `JobAssignment` (Beta) | no | `square.ts:137`, `:172`, `:239` — additive; **see note below, this is an opportunity** |
| 2025-01-23 | Webhooks | Retry schedule → max 19 attempts over 48 hours | no | `webhooks/square/route.ts:46` — delivery behaviour only |
| 2025-04-16 | Catalog | `is_alcoholic` on `CatalogItem` | no | `catalog/sync/route.ts:64`, `sales-items/sync/route.ts:60` — additive, unread |
| 2025-04-16 | Locations | Additional validation on `Location` address fields — emojis, control characters, special symbols disallowed | **yes (write-side)** | **none** — Froot only *reads* locations (`locations/route.ts:43`, `square.ts:209`); validation applies to writes |
| 2025-04-16 | Webhooks | Retry schedule → max 11 attempts over 24 hours (supersedes 2025-01-23) | no | `webhooks/square/route.ts:46` — delivery behaviour only |
| 2025-05-21 | Catalog | Modifier min/max controls; `hidden_online`/`on_by_default` on `CatalogModifier`; `allow_quantities`/`min_selected_modifiers`/`max_selected_modifiers`/`hidden_from_customer` on `CatalogModifierList`, **deprecating `selection_type` and `max_quantity`**; `CatalogItemModifierListInfo` gains `allow_quantities`/`is_conversational`/`hidden_from_customer_override`, deprecating `hidden_from_customer`; `CatalogModifierOverride` gains `*_override` fields, deprecating `hidden_online`/`on_by_default` | no (deprecations, not removals) | `catalog/sync/route.ts:64`, `sales-items/sync/route.ts:60` — **none of the deprecated fields are read by Froot** |
| 2025-05-21 | Labor | Shift→Timecard: `/v2/labor/shifts/…` → `/v2/labor/timecards/…`; `Shift`→`Timecard`; `labor.shift.*`→`labor.timecard.*`; new ScheduledShift endpoints (Beta); **all Shift endpoints, types and webhook events deprecated** | **yes (deprecation)** | **none** — zero labor surface, re-verified 2026-08-18. **Retirement 2026-05-21 has already passed.** |
| 2025-06-18 | Webhooks | All webhook payloads now have associated objects in each Square SDK | no | **none** — Froot uses no Square SDK (Task 1a: no `square` package) |
| 2026-01-22 | Orders | `blocked_service_charges` on `OrderLineItem`; `auto_applied` on `OrderLineItemAppliedTax`; `type` on `OrderReturnServiceCharge`; new `OrderCardSurchargeTreatmentType` enum | no | `sales-sync.ts:291`, `day-report/route.ts:76` — all additive |
| 2026-01-22 | Catalog | KDS support: `kitchen_name`, `buyer_facing` on `CatalogItem`; `kitchen_name` on `CatalogItemVariation` and `CatalogModifier`; new `CatalogModifierToggleOverrideType` enum | no | `catalog/sync/route.ts:64`, `sales-items/sync/route.ts:60` — additive |
| 2026-01-22 | OAuth | New `use_jwt` parameter for JWT authentication | no | `square/auth/route.ts:32`, `callback/route.ts:41`, `square.ts:68` — opt-in parameter, not a default change |

### Dates with no changes to Froot-called APIs

Recorded explicitly, as the prompt requires — an empty row set is a finding:

- **2024-05-15** — Catalog only (`is_taxable`). **No changes to Orders,
  Locations, Team, Employees, Merchants, OAuth or Webhooks.**
- **2025-06-18** — Webhooks SDK-object change only, and Froot uses no SDK. **No
  changes to Orders, Catalog, Locations, Team, Employees, Merchants or OAuth.**

Every other date in the list carried at least one row above.

### Reading the delta

**Nothing in the 2024-01-17 → 2026-01-22 window breaks a Froot call site.**

Four changes are marked breaking. All four miss Froot:

1. **Webhooks management 400 (2024-02-22)** — Froot creates no subscriptions
   via API; the two subscriptions were made by hand in the dashboard
   (`docs/FORECASTING.md:130-133`, `docs/ROADMAP.yaml:2730`).
2. **`RenewToken` retired (2024-04-17)** — Froot uses the `refresh_token` grant
   (`src/lib/square.ts:68-76`), which is the endpoint `RenewToken` was retired
   *in favour of*.
3. **Location address validation (2025-04-16)** — write-side; Froot's two
   Locations call sites are both reads.
4. **Shift deprecation (2025-05-21)** — zero surface, re-verified today.

Every remaining change is an additive field or enum. Froot parses Square
responses through narrow hand-written types (`SquareTeamMember` at
`src/lib/square.ts:108-118`, `SquareLocationRecord` at `:188-196`, `SquareOrder`
in `sales-sync.ts`) and reads named fields off them, so additive response
fields are inert by construction.

**Assessment: `2024-01-17` → `2026-01-22` is a low-risk bump on the evidence
surveyed, and it clears the 2025-05-21 Labor floor with eight months to
spare.** That is a survey finding, not a recommendation to act — acting on any
finding here is explicitly Gary's, per the prompt's closing section.

### The one real hazard, and it is not in the changelog

Finding **1c-3**. Editing `src/lib/square.ts:4` alone moves 6 of the 8
version-bearing header sites. `src/app/api/square/callback/route.ts:43` and
`src/app/api/square/locations/route.ts:44` hardcode `"2024-01-17"` and would
stay behind, leaving `POST /oauth2/token` called at two different API versions
from two different files within the same OAuth flow.

**Whoever executes the bump must change three lines, not one.** No changelog
entry surfaces this; only the grep does. Recorded here because it is the
highest-value thing this session found about the bump, and because hard rules 2
and 4 correctly prevent this session from touching it.

### Items marked "unclear" — questions for Gary, not judgment calls

1. **`REPORTING_READ`** (RULING NOW 3) — a documented-mandatory scope that two
   canonical inventories do not list.
2. **Scope ↔ `Square-Version` coupling** — undocumented in both directions;
   this session declines to assert the lean.
3. **Beta-tagged additions** (`order.created` / `order.updated` webhook events
   already in production; the 2024-12-18 Team `wage_setting`; 2025-05-21
   ScheduledShift endpoints) — beta surfaces can change shape or be withdrawn.
   Whether L-2 may depend on a beta surface is a posture question that has never
   been ruled.

### Opportunity noticed, not acted on

**2024-12-18 put `wage_setting` directly on the `TeamMember` object (Beta).**
Combined with the Task 3 result that `EMPLOYEES_READ` already covers wage
reads, the wage half of L-2 may be reachable through the Team API endpoints
Froot *already calls* (`src/lib/square.ts:137`, `:172`) — under a scope every
merchant has already consented to, and with no Labor API call at all.

If that holds, the wage capability is decoupled from the consent batch
entirely. **Unverified — it depends on the version bump landing past
2024-12-18, on the field surviving beta, and on DEBT-10 / `labor.costs.view`
gating, none of which this session may test.** Flagged for L-2 kickoff.

---

## Stop reasons

No task stopped. All four ran to completion.

Partial-completion notes, recorded rather than smoothed over:

- **Task 2, dashboard half** — discharged from a dated first-party in-repo
  record (2026-08-13) rather than a live dashboard read, which this session
  cannot perform. Blanks left labelled and **OWED — GARY** above. No dashboard
  value was guessed.
- **Task 3, `Square-Version` independence** — could not be confirmed *or*
  refuted at source; Square documents neither direction. Recorded as
  INCONCLUSIVE rather than resolved by inference, per hard rule 8.
- **Task 3, Reporting row** — left unresolved by design; Square's own sources
  contradict each other and hard rule 8 forbids improvising an interpretation.

---

## Compliance

| Hard rule | Status |
|---|---|
| 1. Do not modify `src/app/api/square/auth/route.ts` | not modified — read only |
| 2. Do not modify `src/lib/square.ts` | not modified — read only |
| 3. Do not add/remove/rename any OAuth scope | none touched |
| 4. Do not change `SQUARE_VERSION` | not changed |
| 5. Do not edit `LABOR-0_shift_surface_grep.md` | not edited; this file is the addendum |
| 6. No `&&` chains, one command per paste | observed throughout |
| 7. Do not query any database | none queried |
| 8. Stop-and-record on blocked tasks | applied to the three partials above |

`npm run build` not run — no source file changed, and the prompt does not
require it. Nothing pushed.
