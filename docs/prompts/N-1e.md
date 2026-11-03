# N-1e — Batch label reading + reading from a link — TIER 3

TIER 3: likely schema (a label inbox), a new server-side URL fetcher (SSRF
risk), new routes. Plan-first with hard stops. One phase, no riders.
Two-commit pattern (work, then docs citing the work SHA). `npm run build` gates
commits; lint does not (DEBT-33). Never push. Claude never connects to staging
or production databases.

Saved as `/Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/N-1e.md`.

## Why

N-1 → N-3 are live (production `a00fa1e`; staging `c33df9d` adds only the N-3
stamp). Keva org `cf888f2d-f234-48c7-8097-fd5b44b5b3dd` has ~177 food
ingredients with Estimated nutrition and only a couple Verified. The public
menu (N-3) shows numbers only for fully Verified sizes, so **verification is
now the bottleneck**. Today it is one ingredient at a time: open the dialog →
upload label → Read label → review → Apply & mark verified (~1 minute each,
~2 hours for the food list). N-1e makes it a batch job.

**Standing rule for this series:** nothing is promoted to production until Gary
confirms it on staging.

## What N-1e delivers

1. **Label inbox** — new ADMIN page (e.g. `/nutrition/labels`):
   - drop **many files at once** (PDF, PNG, JPG/JPEG, WEBP; HEIC refused with
     the N-1c "share as JPEG" note; same 10 MB and first-bytes checks as N-1b);
   - each file lands in the inbox as a row: filename, size, status;
   - **ingredient match per file** — Froot suggests an ingredient from the
     filename and, after reading, from the product name on the label (fuzzy,
     brand-aware); the ADMIN confirms or picks another. **Never assigned
     silently.** A file can be discarded.
2. **Batch read** — "Read all" (or selected) runs N-1c's Read label on each
   inbox file **one at a time**, within N-1c's limits (30/hour, 300/day per
   org, 24 h reuse for the same file), with visible progress, and stops
   cleanly at a limit with "N left — continue after …". Failures are per row,
   never all-or-nothing.
3. **Review queue** — step through read files one card at a time: the N-1c
   side-by-side review (label vs stored, flags, name check, "This is the
   product we use"), then **Apply & mark verified / Apply only / Skip /
   Discard**, then the next card. Apply goes through the existing N-1c/N-1b
   write path (no second write path); on apply the file becomes the
   ingredient's **label document** (replacing an existing one only after an
   explicit "Replace current label?" confirm).
4. **Read from a link** — in the ingredient dialog's Proof box and in the
   inbox ("Add from link"): paste a URL to a **PDF or image file**; the server
   fetches it, and it then behaves exactly like an upload (stored as the label
   document / inbox file, `sourceUrl` set). Product **web pages (HTML) are
   refused** with "Open the page, save the label image, and upload it."
   Fetch safety is mandatory (see N1E-F4).
5. **Leftovers:** discarded inbox files are deleted from storage; abandoned
   ones (never applied/discarded) are listed with their age and a "Discard
   all older than 7 days" action. (A scheduled purge is out of scope — file a
   ROW if the audit thinks it's needed.)

Out of scope: HEIC conversion, reading HTML product pages, N-4/N-5/N-6.

## Phase 0 — repo gate (one command at a time)

`pwd` must end in `Froot/froot` (capital-F: STOP and tell Gary). `git status`:
on `staging`, clean apart from untracked prompts. HEAD `c33df9d`.
`git log --oneline -3`.

## Phase 1 — audit (read-only), then STOP

Write `/Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/N-1e_AUDIT.md`.

A. **N-1c reuse:** the read route, result cache (24 h reuse), rate-limit
   counting, the review component, and the apply path — how the inbox and
   queue reuse them without a second read or write path.
B. **Storage:** how an inbox file is stored before it belongs to an ingredient
   (private `froot-nutrition` store, path layout), and how "becomes the label
   document" moves or re-registers it without re-uploading.
C. **Matching:** what fuzzy matching already exists (BEV-1 F5 brand + name
   folding, N-1c name check) and the smallest suggestion method that's
   trustworthy.
D. **URL fetching today:** does any server code fetch arbitrary URLs? What
   Node/Next facilities exist for DNS resolution and IP checks; body size and
   timeout limits on Vercel functions.
E. **Schema:** smallest shape for a persisted inbox (so closing the tab doesn't
   lose 20 paid reads), or the case for client-only state.
F. **Permissions & audit:** ADMIN (`nutrition.manage`) for everything here;
   audit-log entries for inbox upload, fetch-from-link, assign, apply, discard.

**Forks — chat's leans; Gary rules at the STOP:**

- **N1E-F1 Persisted inbox:** lean — yes, a small table, so progress and paid
  reads survive a refresh or a closed tab.
- **N1E-F2 Matching:** lean — suggest, never assign; the ADMIN confirms every
  file's ingredient before Apply is enabled.
- **N1E-F3 Batch reads:** lean — sequential, inside N-1c's 30/hour and
  300/day limits, stop and resume at a limit; no limit increase.
- **N1E-F4 Link fetching safety:** lean — https only; resolve DNS and refuse
  private, loopback, link-local, metadata and other non-public addresses
  (re-checked after every redirect, max 3 redirects); 10 MB cap enforced
  while streaming; short timeout; accept only PDF/PNG/JPEG/WEBP by both
  Content-Type and first bytes; never send cookies or credentials; HTML
  refused.
- **N1E-F5 Replacing an existing label:** lean — only after an explicit
  confirm; the old file is deleted from storage after the replace succeeds.

**STOP.** Report the audit path, a one-screen summary, forks with leans,
anything RULING NOW. No code before Gary rules.

## Phase 2 — schema (only if ruled), then STOP

If F1 is ruled yes: migration per `docs/MIGRATIONS.md`; baseline `migrate diff`
against dev first. **STOP after the migration file exists.** Gary applies it to
dev and says go. If no schema is needed, say so and go straight to Phase 3.

## Phase 3 — build (after Gary's go)

Deliverables 1–5 as ruled.

- **Fixture** `scripts/verify-n1e.ts` (pure where possible): suggestion never
  auto-assigns; Apply disabled until an ingredient is confirmed; batch stops at
  the rate limit and resumes; 24 h reuse respected; the URL guard refuses
  `http://`, `localhost`, `127.0.0.1`, `10.x`, `172.16–31.x`, `192.168.x`,
  `169.254.169.254`, IPv6 loopback/link-local/unique-local, a redirect from a
  public host to a private one, HTML content, an oversize body, and a
  mismatched first-bytes type; replace requires confirm; discard deletes the
  file.
- Re-run N-1 … N-3 and BEV-1 fixtures; all must pass.
- Routes/pages into `docs/PERMISSIONS_INVENTORY.md`.
- `npm run build` before each commit; stage only touched files.

## Docs commit

ROADMAP: N-1e `in_progress` with the work SHA. DECISIONS: Gary's N1E rulings
in his words, DRAFT. MIGRATIONS entry if a migration exists. Commit this prompt
and the audit.

## Report and stop

Work SHA, docs SHA, migration name (if any), files touched, prisma commands
(verbatim), fixture results, and a staging test plan: drop 3–5 labels at once
(including one whose name doesn't match), confirm matches, Read all, step
through the queue applying two and skipping one; add a label from a direct
PDF link; try an HTML product page link (refused) and `http://localhost`
(refused); close the tab mid-batch and confirm progress is kept. Do not push.
