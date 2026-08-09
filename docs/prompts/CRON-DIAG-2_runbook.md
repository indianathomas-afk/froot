# CRON-DIAG-2 — runbook for reading the instrumented 401

**Session:** 2026-08-09, continuation of CRON-DIAG
(`docs/prompts/CRON-DIAG_findings.md`). **Temp commit `df96e9b`** — committed,
**NOT pushed**.

This file exists because the log gets read *after* a deploy, possibly in a
different sitting from the one that wrote the instrumentation. The
interpretation table below is written **before** the evidence arrives, so that
reading the log is a lookup rather than a fresh argument.

---

## What was added

One helper and one call site in
`src/app/api/cron/checklist-day-close/route.ts`, all three touch points marked
`// TEMP CRON-DIAG-2 — REVERT` (import, helper, call site — greppable).

It fires **on the 401 rejection path only**. A successful cron run logs nothing
new, so the instrumentation cannot leak through normal hourly invocations.

It logs shapes, never values:

```
[TEMP CRON-DIAG-2] scheme="Bearer" headerLen=71 · env: len=64 ws=false h4=ffe0 h4trim=ffe0 · token: len=64 ws=false h4=a0fa h4trim=a0fa
```

| Field | Meaning |
|---|---|
| `scheme` | the word before the first space in the header — `Bearer`, `bearer`, `Basic` |
| `headerLen` | full length of the `Authorization` header value |
| `env:` | `process.env.CRON_SECRET` as the server holds it |
| `token:` | what arrived, after the scheme and its single space are stripped |
| `len` | character count |
| `ws` | true if leading/trailing whitespace is present (`s.trim().length !== s.length`) |
| `h4` | first 4 hex chars of SHA-256 of the raw string |
| `h4trim` | first 4 hex chars of SHA-256 of the trimmed string |

Four hex chars is 16 bits — enough to decide whether two 64-char secrets are the
same content, far too little to attack. **No secret value is logged, in whole or
in part.**

If no header arrives at all the line is shorter and says so:

```
[TEMP CRON-DIAG-2] no authorization header · env: len=64 ws=false h4=ffe0 h4trim=ffe0
```

Verified locally against six synthetic cases (different values / identical
values / env with trailing newline / lowercase scheme / no header / truncated
env) — every case produces a distinguishable line.

---

## Run order (Gary)

**a. Push.** Claude never pushes.

```bash
git push origin staging
```

**b. Wait for Ready, then confirm the deploy is the instrumented code.** This is
CLAUDE.md's staging precondition, and it is not optional — a log read against
the wrong build is worse than no log read.

```bash
npx vercel inspect https://froot-git-staging-indianathomas-2483s-projects.vercel.app
```

The alias must resolve to a deployment created *after* the push. Then confirm it
is this exact commit:

```bash
npx vercel ls --meta githubCommitSha=$(git rev-parse HEAD)
```

That must return the same deployment the alias points at. (Full 40-char SHA —
the short form returns "No deployments found", indistinguishable from a genuine
mismatch.)

**c. Start the log stream FIRST, then fire the curl.** `vercel logs` tails live
output; if the curl goes first the line may already be gone. Two terminals:

```bash
npx vercel logs https://froot-git-staging-indianathomas-2483s-projects.vercel.app
```

then, in the other:

```bash
curl -sS -i -H "Authorization: Bearer $S" https://froot-git-staging-indianathomas-2483s-projects.vercel.app/api/cron/checklist-day-close
```

Fire it **once**. One rejection is one log line; repeated curls just make the
line harder to find.

**d. Where to look if the stream missed it.** Vercel dashboard → Project `froot`
→ **Deployments** → the new `staging` deployment → **Runtime Logs** tab (not
Build Logs — this is emitted at request time, not at build time). Filter on
`CRON-DIAG-2`. The line is a `warn`-level entry on the
`/api/cron/checklist-day-close` function.

**e. Paste the line back.** The whole line. The relationship *between* the
fields is what identifies the fault; any single number on its own is ambiguous.

---

## Interpretation table — written before the evidence

Read the line against these in order. The first row that matches is the answer.

| Observation | Diagnosis | Next action |
|---|---|---|
| `env len=64 ws=false`, `token len=64 ws=false`, **`h4` differs** | **Two different 64-char values.** The server holds a secret that is not the one being sent. The dashboard save did not take, or a different value was saved than the one in `$S`. | Re-save the Preview `CRON_SECRET` from the same clipboard source as `$S`, redeploy staging, re-test. Confirm the env `updatedAt` moves. |
| `env len=64 ws=false`, `token len=64 ws=false`, **`h4` identical** | Contents match and the compare still failed — the difference is in the header assembly, not the secret. Look at `scheme` and `headerLen`: `headerLen` should be exactly `len(scheme) + 1 + 64`. | If `headerLen` is larger, there is an extra space or character between scheme and token. If `scheme` is not exactly `Bearer`, see the scheme row below. |
| **`scheme` is not `Bearer`** (e.g. `bearer`, `BEARER`) | Case mismatch. The comparison is exact string equality against `` `Bearer ${secret}` ``, so `bearer` fails while looking correct. | Client-side fix: send `Bearer`. Then the S4 hardening comment about a tolerant, trimmed, constant-time compare becomes worth doing. |
| **`env ws=true`** | Trailing/leading character **server-side** — the stored Vercel value carries a newline or space. Check `env h4trim` against `token h4`: if those match, the content is right and whitespace is the entire fault. | Re-paste the value in the Vercel dashboard without the trailing character, redeploy, re-test. |
| **`token ws=true`, `env ws=false`** | The stray character is **client-side after all**, in `$S` or in how the header is built — despite the earlier client-side tests. | Rebuild `$S` (`printf %s`, not `echo`), re-fire. |
| **`env len` is not 64** | The stored value is malformed. `len=0` cannot occur (that path returns 500, not 401). `len=65` with `ws=true` is the trailing-newline case above. `len=65` with `ws=false` is an extra visible character — a paste that caught a neighbouring keystroke. `len=32` or another truncation is a partial paste; Vercel's Sensitive fields hide the value, so a short paste is invisible in the UI. `len` much larger than 64 suggests the whole `Authorization: Bearer …` string was pasted into the value field. | Re-save the correct 64-char value, redeploy, re-test. |
| **`token len` is not 64** | The value is being mangled between `$S` and the wire — shell expansion, a quoting problem, or a truncated variable. | Check `$S` with `printf '%s' "$S" \| wc -c` in the same shell, then re-fire. |
| **`no authorization header`** line | The header never reached the function. Not a secret problem at all. | Check the curl syntax and any proxy/redirect in front of it — a redirect will strip `Authorization`. |
| **No `CRON-DIAG-2` line at all, still 401** | The 401 is not coming from this code. Either the deployment is not the instrumented commit (go back to step b), or something in front of the function is answering. | Re-run the SHA check. If it matches, capture the full response headers (`curl -i`) and look at `server` / `x-vercel-*`. |

---

## Revert — pre-written, and not optional

**The temp commit is reverted, cleanly, in the same sitting as the fix commit —
whatever the fix turns out to be.** The instrumentation must not survive to
production.

```bash
git revert --no-edit df96e9b
```

That produces a clean inverse commit; no hand-editing, no risk of leaving one of
the three marked touch points behind. Do it *in the same sitting* rather than
"before the next promotion": a revert deferred to promotion time is a revert
that gets discovered in a diff review, or not at all.

Belt and braces before any merge to `main`:

```bash
git grep -n "CRON-DIAG-2"
```

Must return nothing outside `docs/prompts/`.
