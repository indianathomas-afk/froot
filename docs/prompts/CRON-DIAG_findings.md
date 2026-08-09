# CRON-DIAG — why the staging day-close cron 401s a verified secret

**Session:** 2026-08-09, read-only diagnostic. No edits, no commits, no deploys.
**Repo:** `~/Claude_Projects/Froot/froot` · branch `staging` · HEAD `411557a` (= `origin/staging`, nothing unpushed)
**Route under test:** `GET /api/cron/checklist-day-close` (shipped CHK-3 / S3, `d089a7c`)

---

## Answer in one line

**The deployment the staging alias serves was built at 13:40:16 PDT today. The
Preview `CRON_SECRET` was last edited at 15:13:04 PDT today — 1 h 33 m LATER.**
A Vercel deployment carries the env values that existed when it was built, so
that deployment is still holding the **previous** (2026-07-08) Preview
`CRON_SECRET`. Gary is sending the new value. Two different 64-hex strings are
being compared, so the comparison fails and the route returns its 401.

Staging has never been redeployed since the Preview secret changed. The three
failed `main` redeploys are not unrelated noise — they are, at least in part,
where the intended post-overwrite redeploy went.

---

## The evidence, in the order it forces the conclusion

### 1. The 401 proves the secret EXISTS in the running deployment

`src/app/api/cron/checklist-day-close/route.ts:86-93`:

```ts
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 })
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
```

The route distinguishes **missing configuration (500)** from **wrong credential
(401)**. Gary observed `{"error":"Unauthorized"}` / HTTP 401, not the 500 — so
`process.env.CRON_SECRET` was truthy in that Lambda. This single fact eliminates
the whole "the variable isn't attaching to staging" family of hypotheses
(scoping gap, missing var, Sensitive-var-not-injected) before any Vercel lookup
is needed. The secret is there; it is the **wrong value**.

It also confirms the request reached our code and not a platform gate: Vercel
Deployment Protection returns an HTML challenge, and an unmatched App Router
path returns a 404 HTML page. A JSON body in our exact shape is our handler.

### 2. The header shape is correct, and identical to the working crons

All three cron routes use byte-identical auth:

| Route | Line | Check |
|---|---|---|
| `src/app/api/cron/checklist-day-close/route.ts` | 87–93 | `req.headers.get("authorization") !== \`Bearer ${secret}\`` |
| `src/app/api/cron/pace-alerts/route.ts` | 16–22 | identical |
| `src/app/api/cron/sales-reconcile/route.ts` | 21–27 | identical |

The day-close route's own header comment says it: *"Shaped on
api/cron/pace-alerts/route.ts — same auth, same maxDuration, same per-store
try/catch, same summary log."* There is **no expectation mismatch between the
new cron and the working ones.**

Properties of that check, stated explicitly so they are not re-litigated:

- `Headers.get()` is case-insensitive, so `Authorization:` matches the
  lowercase lookup. Not the problem.
- The `Bearer ` prefix, one space, is required. Vercel's own cron invoker sends
  exactly `Authorization: Bearer $CRON_SECRET`, so a manual curl of that shape
  is the right shape. Not the problem.
- **There is no `.trim()` on either side.** Exact string equality. A trailing
  newline or space on the stored Vercel value would fail this comparison
  invisibly. This is *not* the root cause here (the timing below is), but it is
  the failure mode that would survive the redeploy if the pasted value carried
  whitespace — see the verification step in the proposal.

`src/proxy.ts:10` lists `"/api/cron(.*)"` as public, so Clerk is not involved:
the route authenticates itself and nothing else stands in front of it.

### 3. Where the env var actually lives (metadata only — no values read)

`npx vercel env ls` (`vercel env pull` is banned; not used):

```
 name           value    type         environments (git branch)   created
 CRON_SECRET    Hidden   Sensitive    Production                  32d ago
 CRON_SECRET    Hidden   Sensitive    Preview                     32d ago
```

Two rows, exactly as the dashboard shows. Note the `environments (git branch)`
column: `DATABASE_URL` and `DATABASE_URL_UNPOOLED` read **`Preview (staging)`**
— branch-scoped — while `CRON_SECRET` Preview reads a bare **`Preview`**.

Confirmed against the project API (`GET /v9/projects/.../env`, values filtered
out with `jq` and never printed):

```json
{"key":"CRON_SECRET","target":["production"],"gitBranch":null,"type":"sensitive",
 "createdAt":1783547531076,"updatedAt":1786307588053,"id":"m8xjKpE5uPiM7XsG"}
{"key":"CRON_SECRET","target":["preview"],"gitBranch":null,"type":"sensitive",
 "createdAt":1783547499453,"updatedAt":1786313584225,"id":"2rGeMG4ODgETVeBI"}
```

`gitBranch: null` on the Preview row → **it attaches to every preview branch,
staging included. There is no branch-scoping gap.** Both rows created
2026-07-08 (the F-1 ship date, as F-1's notes record). Both edited today.

### 4. The timeline — this is the finding

| Time (PDT, 2026-08-09) | Event | Source |
|---|---|---|
| 12:55:57 | `d089a7c` CHK-3 lifecycle engine committed | `git log` |
| 13:01:04 | `411557a` (branch tip) committed | `git log` |
| **13:33:08** | **Production `CRON_SECRET` overwritten** | env `updatedAt` 1786307588053 |
| 13:34:50 | `main` preview redeploy `dpl_47KCcS…` → **Error** | `vercel inspect` |
| **13:40:16** | **staging redeploy `dpl_BkJ1gF…` → Ready; alias moves here** | `vercel inspect` |
| 13:44:51 | `main` preview redeploy `dpl_6dSvM8…` → **Error** | `vercel inspect` |
| **15:13:04** | **Preview `CRON_SECRET` overwritten** | env `updatedAt` 1786313584225 |
| 15:13:14 | `main` preview redeploy `dpl_6mgCpz…` → **Error** (10 s after the edit) | `vercel inspect` |

The alias, verified rather than assumed:

```
npx vercel inspect https://froot-git-staging-indianathomas-2483s-projects.vercel.app
  → dpl_BkJ1gFhBRFxCgVQG8NqQhu7W9gHd  (froot-jjip8xtqh…)
    target preview · status Ready · created Sun Aug 09 2026 13:40:16 PDT
    alias froot-git-staging-indianathomas-2483s-projects.vercel.app
```

And it does serve the code under test — `npx vercel ls --meta
githubCommitSha=411557a84216cbadaf5a2b5307399cd6b5a32df3` returns
`froot-jjip8xtqh` and `froot-d8z4pymo6`, i.e. the alias holder is a redeploy of
branch tip `411557a`. **The code is current; only the secret is stale.** (Which
is why the route answered at all instead of 404ing.)

`13:40:16 < 15:13:04`. Vercel resolves environment variables into a deployment
when that deployment is built; editing a variable afterwards does not reach back
into deployments that already exist. The staging deployment therefore still
serves the July-8 Preview value.

Note what the 13:33 Production edit did to the appearance of things. Gary
overwrote **Production** first, then redeployed staging seven minutes later —
so at 13:40 there genuinely *was* a fresh redeploy after *an* overwrite. It just
wasn't after the overwrite that matters to a Preview deployment. The Preview row
was not touched until 15:13, and nothing has been built on the staging branch
since.

### 5. What the failed `main` deployments are (checked only far enough to rule them in or out)

All three carry `ref: main`, `sha: 7ab7106`, and fail identically:

```
errorCode  BUILD_UTILS_SPAWN_1
errorMessage  Command "npm run vercel-build" exited with 1
errorStep  buildStep
```

They are **build failures, not cron-registration failures** — which matters,
because it rules out the hypothesis that `vercel.json`'s new hourly entry is
rejecting deployments. They are also not harmless mis-click noise: `main` is red
at `7ab7106`, three attempts today, the most recent 10 seconds after the Preview
secret edit. Filed below; not investigated further, per scope.

### 6. `vercel.json` — and a stale claim corrected

```json
{ "crons": [
  { "path": "/api/cron/sales-reconcile",        "schedule": "0 11 * * *" },
  { "path": "/api/cron/pace-alerts",            "schedule": "0 15 * * *" },
  { "path": "/api/cron/checklist-day-close",    "schedule": "0 * * * *"  }
] }
```

The new entry differs from the two working ones in exactly one way: it is
**sub-daily** (`0 * * * *`, hourly), by design — the route's header comment
explains why ("a daily UTC cron fires at one instant for stores across several
timezones").

`docs/ROADMAP.yaml` (F-1 notes, from SQ-1 on 2026-07-26) records that *"the
account is on Hobby, and Hobby caps crons at ONCE PER DAY … any future sub-daily
expression will FAIL DEPLOYMENT, not fail quietly."* On that basis the hourly
schedule would be a deployment-killer.

**That claim is now false.** `GET /v2/teams/team_263mbnLkV4Te2Ca9ssqrV0gl`
returns `billing.plan: "pro"`. On Pro, cron frequency is not capped at daily, so
`0 * * * *` is legal — and the empirical confirmation is right here: the staging
deployment carrying this `vercel.json` built successfully at 13:40, and the three
`main` failures fail in `buildStep` on `npm run vercel-build`, not on cron
validation. **No cron-schedule problem exists.** The ROADMAP line is a dated
claim that has been overtaken by a plan upgrade; flagged below rather than
edited, per the pointers-vs-claims rule and this session's read-only scope.

Nothing else about the new cron differs: same `maxDuration = 300`, same
`GET`-only handler, same public-route entry in `src/proxy.ts` (`/api/cron(.*)`
covers it with no per-path change needed).

---

## Proposal — the minimal fix (NOT APPLIED)

**No code change fixes this.** The expectation, the header shape, the scoping
and the route are all correct. One action:

1. **Redeploy the staging branch**, so a new deployment picks up the Preview
   `CRON_SECRET` as edited at 15:13:04. Vercel dashboard → Deployments →
   `froot-jjip8xtqh` (branch `staging`) → Redeploy. Confirm the branch reads
   **staging** before clicking — three of today's four redeploys went to `main`.

2. **Verify by the timestamp, not by the click.** After it goes Ready:

```bash
npx vercel inspect https://froot-git-staging-indianathomas-2483s-projects.vercel.app
```

   The `created` time must be later than **15:13:04 PDT 2026-08-09**. If it is,
   the deployment holds the new secret; if it is not, the redeploy landed
   somewhere else again.

3. **Then re-run the curl.** Expected: `200` with the day-close summary JSON.

If it still 401s after a deployment built past 15:13:04, the remaining candidate
is **whitespace in the stored Vercel value** — the comparison is exact and
neither side is trimmed, so a value pasted with a trailing newline fails while
looking correct in every UI. Diagnose it without printing anything: send the
value with a trailing newline appended and see whether *that* returns 200. A
200 identifies the defect precisely, and the fix is to re-paste the value in the
dashboard.

Do **not** re-issue a new secret as a first move. The secret is not the problem
and rotating it would put the Production row out of step for no reason.

---

## Triage

**FIX NOW — 1** (Gary's action; this session cannot deploy)
- Redeploy branch `staging` so the deployment picks up the 15:13:04 Preview
  `CRON_SECRET`, then verify the deployment's `created` time postdates it.
  Root cause; nothing else is required.

**RULING NOW — 1**
- `docs/ROADMAP.yaml` F-1 notes assert the account is on **Hobby** with a
  daily cron cap and deployment-failing sub-daily expressions. The team is on
  **Pro** (`billing.plan: "pro"`, verified today). The hourly day-close cron is
  legal and is already deploying. Ruling wanted: does that superseded claim get
  a dated correction appended, and does the Hobby-derived caution elsewhere
  (`docs/prompts/verification-smoke-pass.md`, `CHK-1_PLAN.md`) get re-read
  against Pro limits? Not edited here — read-only session.

**COMMENT — 2** (for S4 hardening; both apply to all three cron routes)
- **A rejected cron request logs nothing.** The 401 path returns immediately
  with no `console.warn`, so a failing cron leaves no trace in Vercel logs and
  the only signal is the caller's own response. One line — logging *that* a
  rejection happened, never the value, and whether the header was absent versus
  present-and-wrong — would have reduced today's diagnosis to a log read. The
  *response* should stay identical in both cases; the *log* should not be.
- **The comparison is `!==`, not constant-time.** `crypto.timingSafeEqual` on
  equal-length buffers is the hardened form. Low value over a network path with
  a 64-hex secret, but it is the kind of thing S4 exists to sweep. While in
  there: `.trim()` both sides, which removes the entire whitespace-in-the-stored
  value class permanently.
- (Answering the prompt's question directly: the route **does** distinguish
  missing-configuration from wrong-credential — 500 vs 401 — and that
  distinction is what solved this. It does **not** distinguish a missing
  `Authorization` header from a wrong one; both are 401 with an identical body,
  which is correct and should stay that way.)

**ROW — 1**
- `main` is red at `7ab7106`: three failed deployments today (13:34:50,
  13:44:51, 15:13:14), all `BUILD_UTILS_SPAWN_1` — `npm run vercel-build`
  exited 1 in `buildStep`. Production is still serving an earlier Ready
  deployment, so nothing is down, but the next promotion to production is
  blocked until this is understood. Explicitly out of scope for CRON-DIAG and
  investigated only far enough to confirm it is not cron-schedule validation.
  Build log: `npx vercel inspect --logs https://froot-4608w2c0v-indianathomas-2483s-projects.vercel.app`.
  (`vercel-build` runs `prisma migrate deploy` — see the known intermittent
  Neon advisory-lock P1002 failure mode before assuming a code break.)

---

## Method notes

- Read-only throughout. No file in the repo was modified except this findings
  document. No commits, no pushes, no deployments, no `vercel env pull`.
- No secret value was read or printed. The project env API was queried once for
  metadata; the response was filtered through `jq` to `key`/`target`/
  `gitBranch`/`type`/`createdAt`/`updatedAt`/`id` before anything was displayed,
  and nothing was written to disk.
- Every timestamp above is Vercel's own (`updatedAt` on the env row,
  `created` on the deployment) or `git log`'s, converted to PDT.
