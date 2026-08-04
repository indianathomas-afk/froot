# LABOR-0 — Square labor surface audit (READ-ONLY)

**Written:** 2026-08-02
**Repo:** `indianathomas-afk/froot` — Next.js 16 App Router, React 19,
TypeScript, Tailwind 4, Prisma 7 on Neon, Clerk, Square OAuth, Vercel.
**Session type:** AUDIT. Read, report, stop. No plan approval needed because
there is nothing to approve — this session produces a report and no edits.

---

## Why this session exists

Froot does not ingest Square labor data today (or if it does, this audit is
how we find out). A future phase, **LABOR-1**, will read timecards from Square
so Froot can report real hours and — later, and separately — real labor cost.

Before that phase can be scoped, four facts have to be established from the
codebase rather than from memory:

1. Whether this repo already calls Square's **deprecated Shift endpoints**.
   Square API version `2025-05-21` replaced every `/v2/labor/shifts/...`
   endpoint with a `/v2/labor/timecards/...` equivalent and deprecated all
   Shift data types and webhook events. At retirement, Shift endpoints return
   `410 GONE` **regardless of the `Square-Version` header sent** — pinning an
   old version does not buy time. If this repo touches them, that is a dated
   external break and needs its own roadmap row.
2. What `Square-Version` the Square client actually sends. Timecard endpoints
   require `2025-05-21` or later.
3. Whether **`TIMECARDS_READ`** is already in the OAuth scope set. If it is
   not, adding it later forces every existing merchant connection back through
   a consent screen. That is a merchant-facing rollout step, not a deploy, and
   it is very likely the long pole on the whole labor thread.
4. Whether any labor ingest exists today at all.

---

## Hard constraints

- **READ-ONLY.** No file edits. No new files. No `npm install`. No git
  commands of any kind — not `status`, not `diff`, not `log`. If you believe
  an edit is warranted, log it as text under OUT-OF-SCOPE and stop.
- **Every grep MUST exclude generated and doc files:**

  ```
  -g '!src/generated/**' -g '!docs/**' -g '!node_modules/**' -g '!*.lock'
  ```

  Rationale: `src/generated/roadmap.ts` sits in Tailwind's content scan path,
  and roadmap prose has previously manufactured false grep evidence (DEBT-43
  contaminated two independent measurements this way). Roadmap rows and prompt
  files describing *this very audit* contain the exact search strings below.
  A hit inside `docs/` or `src/generated/` is an artifact of writing about the
  problem, not evidence of the problem.
- **Report zero-hit results explicitly.** "No matches for `SearchShifts`" is a
  finding. Silence is not.
- **Quote the exact command you ran** above each result block, so the
  exclusions are visible in the transcript.
- Do not infer. If a scope list is assembled dynamically and you cannot
  determine the final value statically, say so rather than guessing.

---

## Task 1 — Square client version pin

Find every place a Square client is constructed. Report:

a. The `square` package version in `package.json`.
b. Every `Square-Version` / `squareVersion` / `version:` value passed to a
   Square client constructor or to a raw fetch header.
c. How many distinct construction sites exist — one shared client, or several
   scattered ones. If several, note whether they agree on the version.

## Task 2 — Deprecated Shift surface

Search for each of the following and report `file:line` for every hit:

- `labor/shifts`
- `SearchShifts`, `CreateShift`, `UpdateShift`, `DeleteShift`,
  `RetrieveShift`, `ListShifts`
- `labor.shift.` (webhook event strings: `created` / `updated` / `deleted`)
- The bare identifier `Shift` **where it is a Square type import** — ignore
  unrelated local types with the same name, but say that you did and show what
  you excluded.

## Task 3 — Existing Timecard / labor surface

Same treatment for:

- `labor/timecards`, `SearchTimecards`, `CreateTimecard`, `UpdateTimecard`
- `labor.timecard.`
- `BreakType`, `WorkweekConfig`, `TeamMemberWage`

Then state plainly, in one sentence: does any Square labor ingest exist in
this repo today?

## Task 4 — OAuth scopes requested (most important output)

Find where the Square OAuth authorize URL and its scope list are built.

**Quote the complete scope list verbatim.** Do not summarize it.

Then state explicitly, one line each, whether the following are present:

- `TIMECARDS_READ`
- `TIMECARDS_WRITE`
- `TIMECARDS_SETTINGS_READ`
- `EMPLOYEES_READ`
- `MERCHANT_PROFILE_READ`

If scopes differ between the production Square app and the "Froot Staging"
Square app, or between environments, report both and name which is which.

## Task 5 — Webhook subscription inventory

Report where Square webhook event types are registered and/or handled, and
list every Square event type the app subscribes to today.

---

## Report format

For each task: **command → raw result → one-sentence plain reading.**

Then a REPORT section answering, one line each:

1. Does this repo call any deprecated Shift endpoint or handle any
   `labor.shift.*` event? **YES/NO + count**
2. What `Square-Version` does it send?
3. Is `TIMECARDS_READ` already in the requested scopes? **YES/NO**
4. Does any labor ingest exist today? **YES/NO**

---

## Close

End the session with the standard triage **before** the report body:

**FIX NOW / RULING NOW / COMMENT / ROW** — a row is the last resort.

Log anything noticed but out of scope as text under **OUT-OF-SCOPE**. Do not
fix it inline.
