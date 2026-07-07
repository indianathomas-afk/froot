# Froot Staging Environment Setup

Goal: a `staging` branch that deploys to a real URL, backed by an isolated database branch, test auth, and sandbox payments — so nothing you test can touch production data or real users.

## 1. Create the staging branch

```bash
git checkout main
git pull
git checkout -b staging
git push -u origin staging
```

Leave `main` as the Production branch in Vercel (Project Settings → Git → Production Branch). `staging` will deploy automatically as a Preview deployment whenever you push to it.

Optional but recommended: in GitHub, add a branch protection rule on `main` requiring a PR (no direct pushes), so `staging` → PR → `main` becomes the actual workflow.

## 2. Install the Neon-Vercel integration

This is the key piece: Neon can auto-create an instant, isolated branch of your production Postgres database for every non-production Vercel deployment, and wire `DATABASE_URL` for you automatically. A bad migration or a destructive script run on `staging` only touches that branch.

Steps (Claude will drive this if you asked for the guided install):
1. Vercel Dashboard → your `froot` project → Integrations (or Storage) tab.
2. Add the **Neon** integration, connect your existing Neon account/project.
3. When configuring, set it to create a new branch per **Preview** deployment (not Production) using your current prod database as the parent branch.
4. Confirm it injects `DATABASE_URL` into the Preview environment automatically — remove any manually-set `DATABASE_URL` under Preview scope so there's no conflict.
5. Production's `DATABASE_URL` (Production scope) stays exactly as it is today, untouched.

After this, every `staging` push gets its own throwaway Postgres branch seeded from a copy of prod data structure — test migrations here first with `prisma migrate deploy` before merging to `main`.

## 3. Clerk — use the Development instance

Clerk splits keys into a Development instance (test mode, `pk_test_...` / `sk_test_...`) and Production (`pk_live_...` / `sk_live_...`). Your `.env` currently has production keys.

1. Clerk Dashboard → your app → confirm a Development instance exists (Clerk creates one by default alongside Production).
2. Grab its publishable key, secret key, and webhook signing secret (create a webhook endpoint pointed at your staging URL if you use Clerk webhooks, e.g. `CLERK_WEBHOOK_SECRET`).
3. Set these under **Preview** scope in Vercel env vars (see table below) — do not touch the Production-scoped values.

Staging sign-ups then land in Clerk's test instance, fully separate from real users.

## 4. Square — use sandbox mode

You already have `SQUARE_ENVIRONMENT` as an env var, and Square provides sandbox app credentials.

1. Square Developer Dashboard → your app → Sandbox tab → grab sandbox `Application ID`, `Application Secret`, `Access Token`.
2. Set `SQUARE_ENVIRONMENT=sandbox` plus the sandbox credentials under Preview scope.

No real charges can happen from staging even by accident.

## 5. Vercel environment variables — Preview scope checklist

In Vercel: Project Settings → Environment Variables → when adding/editing each var, uncheck "Production" and check only "Preview" (or add a second value scoped to Preview if Production already has one).

| Variable | Production value | Preview (staging) value |
|---|---|---|
| `DATABASE_URL` | prod Neon connection string | auto-injected by Neon integration |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `pk_live_...` | `pk_test_...` (Clerk Dev instance) |
| `CLERK_SECRET_KEY` | `sk_live_...` | `sk_test_...` |
| `CLERK_WEBHOOK_SECRET` | prod webhook signing secret | staging webhook signing secret |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` / `SIGN_UP_URL` / `AFTER_SIGN_IN_URL` / `AFTER_SIGN_UP_URL` | same paths, fine to leave identical | same (relative paths, no change needed) |
| `SQUARE_APPLICATION_ID` | live app ID | sandbox app ID |
| `SQUARE_APPLICATION_SECRET` | live secret | sandbox secret |
| `SQUARE_ACCESS_TOKEN` | live token | sandbox token |
| `SQUARE_ENVIRONMENT` | `production` | `sandbox` |
| `NEXT_PUBLIC_SQUARE_APP_ID` | live app ID | sandbox app ID |
| `NEXT_PUBLIC_APP_URL` | `https://<prod-domain>` | `https://staging-froot.vercel.app` (or your preview URL pattern) |
| `BLOB_READ_WRITE_TOKEN` | prod Blob store token | separate staging Blob store token (see below) |

## 6. Vercel Blob — separate store

Create a second Blob store (Vercel Dashboard → Storage → Blob → Create) named something like `froot-staging`, and use its read/write token as `BLOB_READ_WRITE_TOKEN` under Preview scope. This keeps uploaded files (photos, CSVs, etc.) from a staging test from landing in your production storage bucket.

## 7. Day-to-day workflow going forward

1. Branch off `staging` (or a feature branch merged into `staging` first) for anything you're not 100% sure about.
2. Push → Vercel gives you a Preview URL backed by the Neon branch, Clerk Dev instance, and Square sandbox.
3. Test the change end-to-end on that URL.
4. Run `prisma migrate deploy` against the staging branch DB first if the change includes a migration; confirm it applies cleanly.
5. Merge `staging` → `main` via PR. Production deploy runs against real `DATABASE_URL`, live Clerk, live Square — only after staging has proven it out.

## 8. Verification checklist

- [ ] `staging` branch exists and auto-deploys to a distinct Preview URL
- [ ] Neon integration installed; Preview deployments get their own DB branch (confirm by checking Neon dashboard → Branches after a staging deploy)
- [ ] Preview env vars use Clerk Dev keys (sign up on staging URL, confirm the user appears in Clerk's Development instance, not Production)
- [ ] Preview env vars use Square sandbox keys (confirm a test "charge" on staging hits Square's sandbox, not live, dashboard)
- [ ] Preview `BLOB_READ_WRITE_TOKEN` points to the separate staging Blob store
- [ ] `main` branch protected, requires PR to merge
- [ ] A test migration run on `staging` does not appear in the production Neon branch

## Housekeeping note

Your `froot` repo's git remote currently has a GitHub personal access token embedded in plaintext in the remote URL (`git remote -v`). Worth rotating that token and switching to SSH or a credential manager so it isn't sitting in `.git/config`.
