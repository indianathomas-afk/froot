# BUILD-1 — Separate local builds from production migrations

**Track:** BUILD (tooling / environment)
**Branch:** staging
**Type:** Implementation — config only, no product code
**Related:** DEBT-4
**Created:** 2026-07-26

---

## Why this session exists

SQ-1 confirmed: `ep-green-smoke-a6xthq4r` is the **production** Neon branch, and
the repo's local `.env` `DATABASE_URL` resolves to it.

Two consequences, both live right now:

1. `package.json` build script is
   `prisma generate && prisma migrate deploy && next build`.
   Every local `npm run build` runs **`migrate deploy` against production**. Today
   it was a no-op only because no migration was pending. The next local build
   with a pending migration applies it to production — from a laptop, outside any
   promotion, with no approval step.
2. `npm run dev` reads **and writes** live Keva Juice data. Every local
   development session to date has operated on the production database.

This is the same class of failure as the earlier shared-`DATABASE_URL` incident,
arriving by a different road. It is a prerequisite for any future session that
touches the schema — which includes SEC-2 and HR-14.

---

## Scope — two changes

### Change 1 — Migrations run on Vercel, not locally

Vercel checks for a `vercel-build` script and prefers it over `build`. Use that
to split the two paths:

```
"build":        "prisma generate && next build"
"vercel-build": "prisma generate && prisma migrate deploy && next build"
```

Verify before implementing:

- Confirm Vercel's build command for this project is the default (`npm run
  build`) and not an explicitly overridden command in project settings or
  `vercel.json`. If it is overridden, this approach does not apply — report and
  stop.
- Confirm nothing else in the repo (CI config, scripts, docs) depends on `build`
  running `migrate deploy`.
- Check whether `prebuild` (added by commit `3902d5c`, currently on staging only)
  interacts with `vercel-build`. npm runs `prebuild` before `build`, but the
  behavior with `vercel-build` needs confirming, not assuming. Report what you
  find.

Report the exact `package.json` diff before making it.

### Change 2 — Repoint local development off production

Local `.env` must not point at the production Neon branch.

Present the options and recommend one:

- **(a)** Point local `DATABASE_URL` at the existing staging branch
  (`ep-odd-rain-a6gr4xmm`). Simplest, but local development would then mutate
  the same database used for staging verification — which is how a verification
  run gets corrupted by unrelated local work.
- **(b)** Create a dedicated Neon `dev` branch. Cleaner separation. Requires a
  new branch in the Neon console.

**Do not edit `.env` yourself and do not print any connection string.** Report
which file and which key needs changing, and which Neon branch it should point
at. Gary will make the edit by copying the connection string from the Neon
console directly.

Also report whether `DATABASE_URL_UNPOOLED` needs a matching change, since BUG-3
routes Prisma CLI through the direct endpoint.

---

## Also verify (report only, do not change)

In Vercel → Settings → Environment Variables, report the **environment tags** on
`DATABASE_URL` — Production only, or is Preview also ticked? Do not print the
value. Preview carrying a `DATABASE_URL` is the configuration behind the earlier
migration-landing-early incident and should be recorded either way.

---

## Hard constraints

- **Staging branch only. Do not push.** Gary runs all git commands.
- **NO MIGRATIONS OF ANY KIND.** Not `migrate dev`, not `migrate deploy`, not
  `db push`. This session exists because migrations are dangerous here; running
  one before the fix is in place would be self-defeating.
- **No schema changes.**
- Do not edit `.env` or any file containing credentials.
- Do not print connection strings, passwords, or tokens. Hostnames only.
- **Audit first.** Read `package.json`, `vercel.json`, `prisma.config.ts`, and
  any CI config. Present the plan and wait for explicit approval before editing.
- Out-of-scope findings: write them down. Do not fix them.

---

## Verification

1. `npm run build` locally. Confirm from the output that **no**
   `prisma migrate deploy` step runs and **no** database host is contacted for
   migrations. Build must still pass.
2. After Gary repoints `.env`, confirm the host echoed by any Prisma command is
   the dev/staging branch, not `ep-green-smoke`.
3. Push and deploy to staging. Confirm the Vercel build log **does** show
   `migrate deploy` running — i.e. `vercel-build` took effect and migrations
   still reach deployed environments.

Step 3 is the one that matters. If `vercel-build` is not picked up, migrations
would silently stop being applied on deploy, which is worse than the problem
being fixed. Verify it explicitly in the build log.

---

## Report back

- The `package.json` diff, before and after
- Whether Vercel's build command is default or overridden
- How `prebuild` interacts with `vercel-build`
- Recommended option for the local database (a or b), with reasoning
- Which file/key Gary must edit, and whether `DATABASE_URL_UNPOOLED` also needs it
- `DATABASE_URL` environment tags in Vercel
- Local `npm run build` output confirming no migration step
- Staging build log confirming `migrate deploy` still runs there
- Any out-of-scope findings, as text

---

## Roadmap update

`docs/ROADMAP.yaml`:

- BUILD-1 → `staging` once verification steps 1 and 3 both pass
- DEBT-4 → note that BUILD-1 addresses it; do not close it until BUILD-1 reaches
  production
- Record that schema-touching sessions (SEC-2, HR-14) were gated on this

Additive only. Use the documented status vocabulary.

---

## Done criterion

`next build` passes locally with no migration step. Staging deploy confirms
`migrate deploy` still runs on Vercel. `docs/ROADMAP.yaml` updated. Nothing
committed, nothing pushed.
