# REGION-1 — Phase 1 audit (read-only)

Session: REGION-1, TIER 2, 2026-11-03 (UTC dates below; local is PST, UTC−8,
since DST ended 2026-11-01). Prompt of record: `docs/prompts/REGION-1.md`.
Repo at audit time: `staging`, HEAD `85a5b42`, clean apart from the untracked
prompt. Nothing was changed. No database connection was opened. No env values
were read: every Vercel API response below was filtered to the named fields
before printing.

Commands run (all read-only): `git status`, `git log --oneline -3`,
`npx vercel project inspect froot`, `npx vercel api /v9/projects/<id>` (function
fields only), `npx vercel api /v13/deployments/<id>` (region fields only, two
deployments), `npx vercel blob list-stores`, `npx vercel logs` (runtime and
requests sources, last 24 h), plus `grep`/`sed` over the tree. No prisma
commands.

---

## A. Where the region is set today

| Place | Finding |
|---|---|
| `vercel.json` | No `regions` key. The file holds `crons` only (8 jobs). |
| `next.config.ts` | No region setting (`serverExternalPackages`, `headers()` only). |
| Per-route `export const preferredRegion` | **None in `src/`.** No route sets `runtime = "edge"` either; four HR routes set `runtime = "nodejs"`. |
| Project setting (Vercel API `/v9/projects/prj_y0Z6Mod9ma77rO1Xn98b3CIM0QqS`) | `serverlessFunctionRegion: "iad1"`, `resourceConfig.functionDefaultRegions: ["iad1"]`, `fluid: true`, `defaultResourceConfig.functionDefaultTimeout: 300`, `functionZeroConfigFailover: false`. |
| What deployments actually got | Production `dpl_9Vx2iAdJ4twijH55e7PSC7MWeDjN` (main `3ea8112`, created 2026-11-03 21:53:57 UTC): `regions: ["iad1"]`. Staging `dpl_F6s9jBrZYXiC4FWEHG1t7Cikg7Sw` (staging `0b48da3`, created 21:43:02 UTC): `regions: ["iad1"]`. |

So today the region comes only from the project setting: iad1 for every
deployment.

**Which setting wins, per Vercel's docs** (fetched 2026-11-03):

- `vercel.json` `regions` beats the dashboard. The `regions` section of
  https://vercel.com/docs/project-configuration/vercel-json says: "This value
  overrides the Vercel Function Region in Project Settings." (Caveat: this
  sentence came to me through a fetch tool's summary of the page, not a
  verbatim copy.) A per-function `regions` in `vercel.json` beats the
  project-level one.
- Next.js `preferredRegion` doesn't apply here. The bundled Next 16 docs
  (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/preferredRegion.md`)
  say that on Vercel, "regions are only supported if `export const runtime =
  'edge'` is set". Froot has no edge routes, so nothing needs removing.
- Preview vs production: the pages I read don't say the two are treated
  differently. `vercel.json` is part of the deployment source, so it applies
  to whatever branch carries it. Staging gets pdx1 on its first deploy with
  the change, and production gets it when the change is promoted.
- Plan limit: https://vercel.com/docs/functions/configuring-functions/region
  allows Pro "5 regions" (a changelog title on the same page says 3). One
  region is inside either number. The account is Pro (CRON-DIAG, 2026-08-09).
- Region code: https://vercel.com/docs/regions lists `pdx1 | us-west-2 |
  Portland, USA`.

## B. Database region

These hosts are recorded in `docs/`. Note that `CLAUDE.md` doesn't actually
list them; the prompt's pointer to it was off.

| Branch | Endpoint host | Region |
|---|---|---|
| dev | `ep-late-water-a6k53nv2-pooler.us-west-2.aws.neon.tech` | us-west-2 |
| staging (`preview/staging`) | `ep-odd-rain-a6gr4xmm.us-west-2.aws.neon.tech` | us-west-2 |
| production | `ep-green-smoke-a6xthq4r.us-west-2.aws.neon.tech` (the Prisma datasource line in `docs/DEPLOY_LOG.md`) | us-west-2 |

All three are in AWS us-west-2, which is the region Vercel's pdx1 maps to.
Which branch is which comes from the prompt and the docs, not from a
connection.

## C. Everything else the functions talk to

**Vercel Blob.** From `npx vercel blob list-stores`:

| Store | Region | Size | Used by |
|---|---|---|---|
| `froot-blob` | **sfo1** | 449.47 MB, 792 files | public uploads (`BLOB_READ_WRITE_TOKEN`: checklist photos, attachments, PO invoices, forecasting import) — env mapping inferred, not read |
| `froot-guide` | **sfo1** | 568.2 KB | help screenshots (`GUIDE_READ_WRITE_TOKEN`) |
| `froot-hr` | iad1 | 1.89 GB, 169 files | HR documents (`HR_BLOB_READ_WRITE_TOKEN`) |
| `froot-nutrition` | iad1 | 1.54 MB | N-1b label documents |
| `froot-blob-staging` | iad1 | 3.49 MB | presumably the Preview public store — inferred |

The audit prompt assumed the stores were all iad1. Two of them, including the
largest public one, are actually in sfo1.

What a cross-region Blob call costs, per https://vercel.com/docs/vercel-blob and
`/usage-and-pricing`:

- **It costs latency only.** Pricing is per store region ("regionalized"),
  and the pages describe no charge for reaching a store from another region.
  Private reads need a token, and nothing restricts them by region. So moving
  functions doesn't change what Blob costs or who can read it.
- **Reads mostly go through the CDN.** "Vercel's CDN cache caches all blobs
  (private and public) for up to 1 month". Private blobs are fetched by the
  function "through the CDN". Store region matters for uploads, for `head()`
  checks (`src/lib/hr-files.ts:179`, `src/lib/nutrition-files.ts:181,199`),
  `copy`/`del`, and cache misses.
- **Moving a store isn't a setting.** "You cannot change the region once the
  store is created." Moving one means migrating its data (REGION-F3).
- **Net effect of pdx1.** Calls to the iad1 stores get one cross-country hop
  longer; these are upload-time and verification calls, not page loads. Calls
  to the sfo1 stores (public uploads, guide) get shorter, since Portland is
  closer to sfo1 than D.C. is. I didn't measure either.

**Other services.** Froot talks to each over HTTPS by hostname and fixes no
region for any of them. I didn't measure where each provider serves from.

- **Square** (`connect.squareup.com`, read-only per the 2026-08-18 ruling):
  not region-bound from Froot's side.
- **Clerk** (backend API calls in `auth()` / `currentUser()`): not
  region-bound. The proxy checks the session in middleware (section D).
- **Resend** (notify mail), **Anthropic** (label read, 45 s call timeout under
  `maxDuration` 60), **Instagram Graph** (cached feed): not region-bound. A
  provider hosted in US East would gain a little latency, but these are
  occasional calls, unlike the database round trips that happen on every
  request.
- **Cron.** Vercel invokes the 8 jobs in `vercel.json` against the production
  deployment, so they run wherever the functions run. They're among the most
  database-heavy code (day-close, calendar-materialize, notify-dispatch,
  sales-reconcile), so they benefit most. Schedules and `CRON_SECRET` are
  unaffected.

## D. Middleware / proxy (`src/proxy.ts`)

`clerkMiddleware`, which protects every route outside `isPublicRoute`. Per
https://vercel.com/docs/functions/configuring-functions/region: "Vercel deploys
Routing Middleware to all regions by default, regardless of your region
settings." The region change doesn't move or alter it, and it makes no
database calls.

## E. Baseline measurement

**What the logs carry.** `vercel logs` runtime records (fields: timestamp,
environment, requestPath, source, region, level, message, …) and CDN request
records (fields: httpStatus, pathType, cacheResult, edgeNetworkRegion, …) have
**no duration field**. Both `region` and `edgeNetworkRegion` read `sfo1` on
these records. That's the edge location the request came in through, not where
the function ran. The deployment API says the function ran in `iad1`.

Don't read a log line's "region" as the function region. This matters for the
Phase 2 test plan.

**Sales-items sync: derived, not measured.** The route logs its
`[sales-items/sync]` summary line just before it returns
(`src/app/api/square/sales-items/sync/route.ts:88`). So the time from the CDN
request's start to that log line approximates the function duration (within a
few hundred ms). `writeMs` is the route's own timing of its database writes.

| Env | Request start (UTC / PST) | Summary log (UTC) | ≈ duration | writeMs | Rows |
|---|---|---|---|---|---|
| production | 22:38:28.471 / 14:38 PST | 22:38:36.649 | **≈ 8.2 s** | 4,624 | items created 123, updated 288, unchanged 860; categories 18/13; modifiers 595 |
| preview (staging) | 21:50:23.852 / 13:50 PST | 21:50:34.316 | **≈ 10.5 s** | 5,340 | items created 673, unchanged 598; modifiers 595 |
| preview (staging) | 21:51:35.162 / 13:51 PST | 21:51:40.996 | **≈ 5.8 s** | 2,544 | all 1,271 unchanged; modifiers 595 |

All three runs were on iad1 deployments (production `dpl_9Vx2…`; preview
`dpl_F6s9…`). The cleanest before/after comparison is the third row, an
unchanged re-run on staging: ≈ 5.8 s total, `writeMs` 2,544. Re-run the same
thing after the change. Also on record: a preview `GET` at 20:09:45 UTC
returned **504** (`dpl_C6JdLr4A…`, before the N-5-SYNC fix deployed).

**Dashboard, `/inventory/ingredients`, `/nutrition/menu`: no numbers.** The
CLI logs have no durations for these and none of them logs its own timing, so
I'm not giving numbers for them. Gary, to read them before the change
(dashboard labels may differ a little from these):

1. Vercel dashboard → project **froot** → **Observability** → **Vercel
   Functions** (or **Logs**).
2. Set the environment (**Preview** for staging, then **Production**) and the
   time range (last 24 h or 7 d).
3. Pick the route: `/dashboard` and the APIs it calls (`/api/dashboard/summary`,
   `/api/dashboard/sales`, `/api/dashboard/rollup`), `/inventory/ingredients`,
   `/nutrition/menu`.
4. Write down **P50 and P75 duration** for each, and the invocation count so
   tiny samples are obvious. In **Logs**, clicking a single request opens its
   details, which show its duration and the function's region. That's also
   where Phase 2 test 1 checks for `pdx1`.
5. To get a fresh sample instead: load each page three times on staging
   (sign in first, skip the first cold load) and read the durations from
   Logs.

Either way, the "before" numbers have to be captured **before** Gary pushes
the change.

## F. Plan (no change made)

Add one key to `vercel.json`, a sibling of `crons`:

```json
{
  "regions": ["pdx1"],
  "crons": [ … unchanged … ]
}
```

- Per section A, `vercel.json` `regions` overrides the project's Function
  Region, so the dashboard setting can stay at iad1. That way git is the
  single source of truth. If Gary wants the dashboard to match too, he can
  change it himself; it's optional.
- No per-route `preferredRegion` to remove (there are none, and they only
  apply to edge routes).
- No `src/`, schema or env change. `npm run build` gates the commit.
- The change takes effect on each environment's next deployment: staging when
  Gary pushes, production when it's promoted. Until promotion, staging runs in
  pdx1 and production in iad1.
- **Rollback:** revert the commit. If that's urgent, setting the project's
  Function Region doesn't work while `vercel.json` has the key, because the
  file wins.

**Forks (chat's leans; Gary rules):**

- **REGION-F1:** pdx1 for all functions, Preview and Production. Lean: yes.
- **REGION-F2:** set it in `vercel.json` (tracked in git). Lean: yes.
- **REGION-F3:** leave the Blob stores where they are. Lean: yes. Recorded:
  the iad1 stores (`froot-hr` 1.89 GB, `froot-nutrition`,
  `froot-blob-staging`) get one cross-country hop on uploads, `head()` and
  cache misses. The sfo1 stores (`froot-blob`, `froot-guide`) get closer. The
  pages read describe no cost difference. A store's region can't be changed,
  only migrated.

**Surprising, for the record:**

1. Log `region` is the edge region (sfo1), not the function region (iad1).
2. Two Blob stores are in sfo1, not iad1.
3. The database hosts aren't in `CLAUDE.md`.

None of these changes the plan.

**Tier.** The change is deployment config only. It writes no rows, changes no
permission or schema, and doesn't change what any page does. It stays TIER 2.
