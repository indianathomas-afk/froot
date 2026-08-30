# ENG-1 — DEPLOY_LOG entry, pasteable

Run these at PROMOTION time (staging -> main), not at the staging push.
CLAUDE.md § DEPLOY_LOG: entries are never hand-edited and never pasted into
an editor. Short heredoc chunks, a `wc -l` check after each, then one splice
with head/tail, then a `grep -c` that proves no prior entry was clobbered.

The three tokens `__SHORTSHA__`, `__DATE__` and `__FULLSHA__` each occur
EXACTLY ONCE, on the heading and the Merge SHA line. They are deliberately
not the bare word SHA: the literal label `**Merge SHA:**` survives into the
shipped entry, and a substitution on `SHA` would rewrite it too.

## 0 — stamp (run from Froot/froot, on main, after the merge)

```bash
SHORT=$(git rev-parse --short HEAD); FULL=$(git rev-parse HEAD); TODAY=$(date +%F); echo "$SHORT $FULL $TODAY"
```

## 1 — entry chunk 1 of 3

```bash
cat > /tmp/eng1-entry.md <<'ENTRY'
## __SHORTSHA__ — __DATE__ — ENG-1: engagement tracking

**Merge SHA:** `__FULLSHA__`
**Written before the merge existed**, per the ritual — the heading's two tokens
and the Merge SHA line's one are stamped by the commands below, never hand-typed.

**READ THIS FIRST IF YOU ARE ROLLING BACK.** This promotion carries an ADDITIVE
MIGRATION and a NEW CAPABILITY. The migration
(`20260830120000_eng1_engagement_tracking`) is two nullable `ADD COLUMN`s on
`User` plus one new table `UsageDaily`. Reverting the code leaves all three
unread and harmless — do NOT drop them (WORKFLOW.md § Rolling a promotion back).
Nothing existing reads or writes them.

**Blast radius is small and one-directional.** No existing query changed, no
existing route changed behaviour, no permission baseline moved. The new
capability `engagement.view` is ADMIN_ONLY, is not grantable and is not
deniable, so no role gains or loses anything on promotion day. The one edit to a
shipped surface is a link added to `/staff`'s header and an icon added to each
ENTRY
wc -l /tmp/eng1-entry.md
```

Expect `18`.

## 2 — entry chunk 2 of 3

```bash
cat >> /tmp/eng1-entry.md <<'ENTRY'
`/stores` row, both behind `can(actor, "engagement.view")` — invisible to
everyone but an admin.

**What is new.** `POST /api/usage` (a beacon written by every authenticated
page view), `GET /api/staff/engagement` (ADMIN-only read), `/staff/engagement`
(the page), `GET /api/cron/engagement-prune` (retention), and a client beacon
mounted in both the `(app)` and `(my)` shells.

**The one thing to watch on the first day.** `POST /api/usage` fires on every
client-side route change for every authenticated user, so it is the highest-QPS
write this app has. It is one indexed upsert against
`@@unique([userId, path, date])` plus, at most once per user per 15 minutes, one
`User` update. If Neon connection pressure shows up after this promotion, that
is the first place to look — and the safe mitigation is to stop mounting
`<UsageBeacon />` in `src/app/(app)/layout.tsx` and `src/app/(my)/layout.tsx`,
which disables collection without touching the schema or any read path.
ENTRY
wc -l /tmp/eng1-entry.md
```

Expect `34`.

## 3 — entry chunk 3 of 3

```bash
cat >> /tmp/eng1-entry.md <<'ENTRY'

**A new cron.** `/api/cron/engagement-prune` at `0 12 * * *`, deleting
`UsageDaily` rows older than 180 days. Vercel crons fire on Production only, so
this promotion is its first live run. `CRON_SECRET` is unchanged and already
held.

**Verified before the push, on the dev branch** (`ep-late-water-a6k53nv2`):
prune end-to-end (401 without the secret, deleted exactly a seeded 200-day-old
row and kept today's), the rollup incrementing rather than duplicating, path
normalization collapsing two staff ids onto one row, the 15-minute throttle
writing once, and 28 fixture checks. NOT verified on staging by that session —
Claude does not push.

**Still open after this promotion.** The per-role 403 capture by request, and
the geo headers, which cannot appear under `next dev` and are only observable on
a Vercel-served request. Expect `lastSeenLocation` to stay null for every row
until the first real Vercel traffic.
ENTRY
wc -l /tmp/eng1-entry.md
```

Expect `51`.

## 4 — stamp the three tokens, then re-check

```bash
sed -i '' -e "s/__SHORTSHA__/$SHORT/" -e "s/__FULLSHA__/$FULL/" -e "s/__DATE__/$TODAY/" /tmp/eng1-entry.md
grep -c '__' /tmp/eng1-entry.md
```

Expect `0` — every placeholder substituted. A non-zero count means `$SHORT`,
`$FULL` or `$TODAY` was empty; re-run step 0 in the SAME shell and repeat.

## 5 — splice (preamble is lines 1-4; entries start at line 5)

```bash
head -4 docs/DEPLOY_LOG.md > /tmp/eng1-new.md && cat /tmp/eng1-entry.md >> /tmp/eng1-new.md && echo "" >> /tmp/eng1-new.md && tail -n +5 docs/DEPLOY_LOG.md >> /tmp/eng1-new.md && mv /tmp/eng1-new.md docs/DEPLOY_LOG.md
```

## 6 — prove nothing was clobbered

```bash
grep -c '^## ' docs/DEPLOY_LOG.md
```

Expect `40` — 39 before this entry, plus this one. **A count of 1 means the
splice ate the file: restore with `git checkout docs/DEPLOY_LOG.md` and start
again.** Then `head -8 docs/DEPLOY_LOG.md` to eyeball the stamped heading.

