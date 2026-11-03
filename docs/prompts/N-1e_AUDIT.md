# N-1e — Phase 1 audit (read-only)

Session: TIER 3, 2026-11-02. Repo gate passed: `/Users/garythomas/Claude_Projects/Froot/froot`,
branch `staging`, clean apart from untracked `docs/prompts/N-1e.md`, HEAD `c33df9d`
(`git log --oneline -3`: `c33df9d`, `a00fa1e`, `12bd2b4`). No files touched before this
one. No database was queried; every finding below is from code at `c33df9d`.

Prior art read: `docs/prompts/N-1c_AUDIT.md` (§ F limits), ROADMAP rows N-1 … N-1e,
`docs/PERMISSIONS_INVENTORY.md` NU-5 … NU-9 / PG-36 … PG-42.

---

## A. N-1c reuse — read route, cache, rate limit, review, apply

**Read route** — `src/app/api/nutrition/ingredients/[id]/label/read/route.ts` (NU-8).
Keyed on an INGREDIENT: it loads `ing.nutrition.labelFileUrl` / `labelFileHash` and
refuses (409) when the ingredient has no document. There is no way to read a file that
is not already some ingredient's label document. The model call itself is cleanly
separable: `readLabelWithModel(bytes, contentType)` in `src/lib/label-read.ts` takes
bytes, not an ingredient, and `readLabelBytes(fileUrl)` in `src/lib/nutrition-files.ts`
takes a store URL. Both are reusable as-is by an inbox read.

**24 h reuse** (`read/route.ts:59-80`): newest `nutrition.label.read` /
`.read.reused` AuditLog row with `entityType "Ingredient"`, **`entityId = this
ingredient`**, `metadata.fileHash = this hash`, within 24 h. The transcribed output lives
in that row's `metadata.output`. Consequence: a read done in the inbox (no ingredient yet)
is **invisible** to the reuse lookup as written — it is keyed on the ingredient id, not
the file hash alone.

**Rate limit** (`read/route.ts:82-95`): counts this org's AuditLog rows with
`entityType "Ingredient"` and `action in ["nutrition.label.read", "nutrition.label.read.failed"]`
in the last hour (30) and day (300). **The `entityType` filter is load-bearing for
N-1e**: an inbox read logged under any other `entityType` would not count, and the
inbox would silently get its own second 30/300 budget. Whatever the inbox logs, the
count must include it. Served by `@@index([organizationId, entityType, createdAt])`;
`entityType in [...]` stays on that index.

**Review component** — `src/app/(app)/inventory/ingredients/label-read-review.tsx`.
Pure presentational: props `review, reportingUnit, hasStored, readAt, reused, busy,
onApply, onReadAgain, onDiscard`; it saves nothing. The review MODEL is
`buildLabelReview(output, ingredient, stored)` in `src/lib/label-review.ts` (client-safe,
pure). The queue card can render `LabelReadReview` unchanged; it needs an ingredient
snapshot (name, brand, reportingUnit, allergens, stored numbers) to build the review,
which is exactly what `GET /api/nutrition/ingredients/[id]` already returns. The
component's `onDiscard` means "throw away this read"; the queue needs **Skip** and
**Discard (file)** as two different actions, so the queue adds its own buttons around
it rather than overloading `onDiscard`. "Read again" maps to `fresh: true`.

**Apply path** — client: `applyRead` in `nutrition-section.tsx:334-370`:
`PUT /api/nutrition/ingredients/[id]` with `appliedFromRead { readId, intent, edited,
nameWarningAcknowledged }` (and `keepVerified: false` when verifying), then
`POST …/verify { verified: true }`. Server: the PUT validates `readId` is an AuditLog
row with **`entityType "Ingredient"`, `entityId = this ingredient`**, action read or
read.reused (`[id]/route.ts:107-122`). So the existing write path accepts only reads
recorded against the ingredient being written.

**How the inbox reuses all of this without a second read or write path** (proposal):

1. *One read path.* Factor the body of the read route into a lib function
   `performLabelRead(ctx, { file, subject })` — limit check, model call, audit row — and
   have both the existing ingredient route and a new inbox read route call it. The rate
   limit counts both subjects (`entityType in ["Ingredient", "NutritionLabelInbox"]`).
   One model call site, one counting rule, one set of audit actions.
2. *One write path.* On Apply the queue does exactly what the dialog does, in order:
   (a) attach the inbox file to the ingredient as its label document (§ B — the
   register logic, server-side copy instead of a browser PUT); (b) call the existing
   ingredient read route without `fresh`, whose reuse lookup is widened to **also match
   an inbox read of the same `fileHash` in the same org** — no model call, it writes the
   normal `nutrition.label.read.reused` row on the ingredient and returns a `readId` the
   PUT already accepts; (c) the existing PUT with `appliedFromRead`; (d) the existing
   verify POST. Steps (c)–(d) are byte-for-byte the dialog's `applyRead`. The PUT and
   verify routes are not changed at all.
3. Hash-keyed reuse across subjects is safe: the transcription is a function of the file
   bytes, not the ingredient. The name check (`nameWarning`) is computed client-side
   from the ingredient at review time, so it still runs against the confirmed ingredient.

**RULING NOW (R1) — the 24 h window vs. a persisted inbox.** N-1c's ruling is "24 h
reuse of a result for the same file". An inbox item read on Monday and applied on
Wednesday would, under step 2(b), be re-sent to the model (paid, counted) — defeating
F1's "paid reads survive". Options: (i) the inbox item's own stored read is reusable
for the life of the inbox item (same hash = same bytes; the 24 h window keeps governing
ingredient-dialog reads); (ii) keep 24 h everywhere and accept re-reads after a day.
Audit leans (i). This amends an N-1c ruling, so it is Gary's.

---

## B. Storage — inbox files and "becomes the label document"

Store: private `froot-nutrition`, token `NUTRITION_BLOB_READ_WRITE_TOKEN`, read only in
`src/lib/nutrition-files.ts`. Label layout today: `nutrition/{orgId}/ingredients/{ingredientId}/{safeName}-{12-byte random}.{ext}`
(`labelKeyPrefix`, `getLabelUploadUrl`). Upload = presigned browser PUT with the type
allow-list and 10 MB cap baked into the signature; register (`label/route.ts` POST)
re-reads the stored bytes for size, type, sha256 and first-bytes sniff, and **pins the
pathname to that ingredient's prefix** (`label/route.ts:85`).

**Inbox layout (proposal):** `nutrition/{orgId}/inbox/{inboxItemId}/{safeName}-{random}.{ext}`
via the same `getLabelUploadUrl` with a different `keyPrefix` — the function already
takes the prefix as a parameter. The inbox register step is the same `readLabelMeta` +
`validateLabelMeta` + `sniffMatches` sequence, pinned to the inbox prefix. HEIC: the
store accepts HEIC (N-1b ruled "HEIC accepted"), but the prompt says the inbox
**refuses** HEIC with the N-1c note — a file that can never be read has no business in a
read queue. That refusal is inbox-only (client pre-check on extension/type, server
re-check on the sniffed type); the dialog keeps accepting HEIC as proof.

**"Becomes the label document" without re-uploading:** `@vercel/blob@^2.5.0` exports
`copy(fromUrlOrPathname, toPathname, options)` (`node_modules/@vercel/blob/dist/index.d.ts:343`)
— a server-side copy inside the store; the bytes never leave Vercel and never pass
through the Function body (so no 4.5 MB limit). Then `del` the inbox blob. Two options:

- **(a) copy → ingredient prefix, then delete the inbox blob.** The ingredient folder
  invariant (`label/route.ts:85`, NU-6 "namespace pin") stays exactly true; the
  register code is unchanged except that it is called with a server-produced URL.
  Hash is carried over (same bytes), re-verified by `readLabelMeta` if wanted.
  If the delete fails, `deleteLabelBlob` is best-effort (logs, never fails) — an
  orphan in the inbox prefix, findable by the leftovers list.
- **(b) point the ingredient record at the inbox blob and widen the pin** to accept
  `nutrition/{org}/inbox/…` too. No copy, but weakens the one namespace invariant NU-6
  documents and couples an ingredient's document to an inbox row's lifecycle (discarding
  the inbox row must then NOT delete the blob).

Audit leans **(a)**. Note `copy` needs `access: "private"` and the token passed
explicitly, as every other call in this file does; confirm the exact option shape
against the installed d.ts at build time (AGENTS.md: this is not the API you know).

**Replace (F5).** Today the register route replaces an existing document **without
asking** (it asks only "Still verified?" on a VERIFIED record) and deletes the old blob
after the transaction (`label/route.ts:111-138`). N-1e's "Replace current label?"
confirm is new behaviour. Proposal: a `CONFIRM_REPLACE` 409 code on the shared attach
step, answered with `replaceLabel: true`. **Open question folded into F5:** does the
confirm also apply to the ingredient dialog's own upload (behaviour change to N-1b), or
only to the queue? Audit leans queue + link only; the dialog's upload is a deliberate
one-ingredient act with the existing document visible beside the button.

---

## C. Matching — what exists and the smallest trustworthy suggestion

Existing:

- **BEV-1 F5 / nutrition CSV import** — `normName(s)` (`src/lib/bevspot/plan-import.ts:104`):
  collapse whitespace, trim, lower-case. `planNutritionImport` keys every ingredient on
  `normName(name)` and, when it has a brand, `normName(brand + " " + name)`; a row is
  UNMATCHED / AMBIGUOUS / matched. **Exact after folding** — no fuzziness at all.
- **N-1c name check** — `nameWarning(label, ingredient)` (`src/lib/label-review.ts:355`):
  `words()` tokeniser (lower-case, stop words, joins "sugar free" → "sugarfree" etc.),
  a **variant-word conflict** test ("Unsweetened" vs "Original" → warning), and a
  **coverage** test (more than half of the ingredient's significant words must occur in
  the squashed label text; size tokens like "32oz" ignored). This is a *verdict*
  ("does this plausibly match?"), not a ranking.

Smallest trustworthy suggestion (proposal, all pure, in `src/lib/label-review.ts` or a
new `src/lib/label-match.ts`):

1. **From the filename** (before reading): strip extension, split on `_ - .` and
   camelCase, drop noise tokens (`label`, `nutrition`, `facts`, `spec`, `sheet`, `img`,
   digits-only, dates). Score every non-PREPARED, non-exempt, non-deleted ingredient by
   the same coverage measure `nameWarning` uses (share of the ingredient's significant
   words present), with brand words as a bonus.
2. **From the label** (after reading): the same scorer on `brand + productName`, and
   the candidate must pass `nameWarning(...) === null` — a variant conflict disqualifies
   ("Unsweetened" never suggests "Original").
3. **Suggest only when unambiguous**: top score ≥ threshold AND a clear margin over
   the runner-up; otherwise show "No confident match — pick one" with the top 3 as
   options. Ties never pick.
4. **Never assign** (F2): the suggestion pre-selects nothing that counts — the row
   holds `suggestedIngredientId` and `ingredientId` separately, and Apply is enabled
   only once `ingredientId` is set by an ADMIN action. The label-based suggestion may
   *replace* a filename-based suggestion, never a confirmed ingredient; if the label
   disagrees with a confirmed ingredient, the review's existing name-check warning and
   "This is the product we use" tickbox fire as they do in the dialog.

Expect filename suggestions to be weak (`IMG_4021.jpg`), so the label suggestion is the
one that matters; the scorer is the same function either way.

---

## D. URL fetching today

**No server code fetches an arbitrary, user-supplied URL.** Every server `fetch` in
`src/lib` and `src/app/api` goes to a fixed host (Square base URL, `api.anthropic.com`,
`graph.instagram.com` / `api.instagram.com`, Resend) or to a URL minted by our own Blob
store (`hr-files.ts:231`, `guide-files.ts:131`, `nutrition-files.ts:170/188`,
`my/signed-records`). `sourceUrl` today is stored and rendered as a link, never fetched
(`parseSourceUrl`, `nutrition-proof.ts:100`, accepts http and https). So N-1e introduces
the **first SSRF surface** in the codebase, and there is no house guard to reuse.

Facilities available (Node `v24.17.0` locally; Vercel Node runtime):

- `node:dns/promises` `lookup(host, { all: true, verbatim: true })` → every A/AAAA.
- `node:net` `isIP()` and **`BlockList`** (`addSubnet` / `addAddress`, `check(addr, "ipv4"|"ipv6")`)
  — verified locally: `10.1.2.3` → blocked, `fd00::1` → blocked, `8.8.8.8` → allowed.
  IPv4-mapped IPv6 (`::ffff:10.0.0.1`) must be unwrapped before the check.
- **The DNS-rebinding trap:** resolve-then-`fetch(url)` checks one resolution and
  connects on another. The check must happen **at connect time**. Two ways:
  (i) `node:https.request` with a custom `lookup` option that resolves, rejects any
  blocked address, and hands the connector only the vetted address — no new
  dependency, TLS SNI/cert still validated against the hostname;
  (ii) `undici` `Agent({ connect: { lookup } })` as a `dispatcher` — `undici@6.27.0`
  is present only as a **transitive** dependency (`package-lock.json:4867`), not in
  `package.json`; using it means adding a direct dependency. Audit leans (i).
- Redirects: `redirect: "manual"` / handle `Location` ourselves, max 3, every hop
  re-validated (scheme, port, host, resolved IP) — the custom lookup does that per hop
  for free.
- Body cap: count bytes on the stream and abort at `LABEL_MAX_BYTES` (10 MB) regardless
  of `Content-Length` (which may lie or be absent). Reject early if `Content-Length`
  > cap.
- Timeout: `AbortSignal.timeout(...)` over the whole fetch including redirects.
  Proposal 15 s (route `maxDuration = 60`, matching the read route's house value — 27
  routes set `maxDuration`).
- Type: accept only when BOTH the response `Content-Type` (params stripped) is
  PDF/PNG/JPEG/WEBP AND `sniffLabelType(first bytes)` agrees (`sniffMatches`). `text/html`
  (or sniffed `<` / `<!doctype`) → the prompt's refusal text. HEIC by link → refused
  with the N-1c note.
- No cookies/credentials: a server fetch has none to send; set no `Authorization`,
  no `Cookie`, a plain `User-Agent`, and never forward request headers.
- Ports: allow only 443 (an `https:` URL on a non-default port is refused) — narrows
  the surface to "the public web" and blocks port-scanning use.
- **Body size on Vercel:** the fetched bytes are held in the Function's memory (≤10 MB,
  fine), then written to the private store with server-side `put(pathname, bytes, {
  access: "private", token })` — the 4.5 MB limit is on the Function's *request/response*
  bodies, not on what it fetches or puts. The response to the browser is just the
  inbox row / ingredient JSON.

Blocked ranges for the guard (fixture list in the prompt, plus): IPv4 `0.0.0.0/8`,
`10/8`, `100.64/10` (CGNAT), `127/8`, `169.254/16` (incl. `169.254.169.254` metadata),
`172.16/12`, `192.0.0/24`, `192.0.2/24`, `192.168/16`, `198.18/15`, `198.51.100/24`,
`203.0.113/24`, `224/4`, `240/4`, `255.255.255.255`; IPv6 `::/128`, `::1/128`,
`::ffff:0:0/96` (unwrap then re-check v4), `64:ff9b::/96`, `fc00::/7`, `fe80::/10`,
`ff00::/8`, `2001:db8::/32`. Also refuse IP-literal hosts that are blocked, userinfo in
the URL (`https://user:pass@…`), and hostnames `localhost` / `*.localhost` /
`*.internal` before resolving.

---

## E. Schema — persisted inbox vs client-only

Client-only state loses everything on refresh: the uploaded blobs would be orphaned (no
row points at them), the confirmed matches are gone, and the paid reads survive only as
AuditLog rows that nothing can map back to a file in the UI. Twenty paid reads and the
ADMIN's twenty match confirmations disappearing on a closed tab is the failure F1
exists to prevent. Audit agrees with the lean: **a small table**.

Smallest shape (additive, one model, no enum needed — status as a checked string is the
lighter option, but the codebase uses Prisma enums for status columns, e.g.
`NutritionStatus`; build follows house style):

```prisma
model NutritionLabelInboxItem {
  id                    String    @id @default(cuid())
  organizationId        String
  status                NutritionInboxStatus @default(UPLOADED) // UPLOADED, READ, FAILED, APPLIED, DISCARDED
  fileUrl               String?   // null once discarded/applied (blob deleted or moved)
  filePathname          String?
  fileName              String
  contentType           String
  sizeBytes             Int
  fileHash              String
  sourceUrl             String?   // set when fetched from a link
  suggestedIngredientId String?   // never trusted for writes
  ingredientId          String?   // set only by an ADMIN confirm
  readAuditId           String?   // the AuditLog row holding the transcription (single source)
  readError             String?   // last failure, per row
  uploadedByUserId      String?
  appliedAt             DateTime?
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt
  organization Organization @relation(fields: [organizationId], references: [id])
  @@index([organizationId, status, createdAt])
}
```

Notes: the transcription stays in AuditLog (where N-1c's reuse already reads it) and the
row points at it, so there is one copy. `ingredientId` is deliberately **not** a
foreign key with cascade — an ingredient soft-deleted (`deletedAt`) mid-queue must be
detected at Apply (`findOrgIngredient` filters `deletedAt: null`), not silently null the
column. A relation with `onDelete: SetNull` is the alternative; either is fine, the
Apply-time check is what matters. Additive only: a new table, a new enum, one back-relation
on `Organization`. No column changes to `IngredientNutrition` (`sourceUrl` already exists
for "Read from a link" in the dialog).

"In progress" is not a stored status: reads are sequential and driven by the open page
(F3), so a closed tab mid-batch leaves the current item `UPLOADED` (or `READ` if the
call completed — the server writes the row in the same request). Nothing is ever stuck
"reading".

---

## F. Permissions & audit

Every route and the page: `requireNutrition("nutrition.manage")` (ADMIN only — both
modules on, then the capability), org-scoped by `ctx.org.id` on every query; the inbox
item id never resolves across orgs (`findFirst({ id, organizationId })`). The page:
`(app)/nutrition/labels/page.tsx`, `nutrition.manage`, other viewers redirect to
`/nutrition/menu` and the upgrade card when a module is off — the PG-37/PG-40/PG-42 shape.
Sidebar: one more `capability: "nutrition.manage"` entry beside Import Nutrition
(`sidebar.tsx:249`). Uses `getCurrentUser()` via `requireNutrition` — never a bare
`clerkUserId` lookup (CLAUDE.md § Page Conventions).

Audit rows (via the existing `nutritionAudit` helper, extended for a second subject):

| Event | action | entityType / entityId |
|---|---|---|
| inbox upload registered | `nutrition.inbox.uploaded` | `NutritionLabelInbox` / item |
| fetched from a link (success) | `nutrition.inbox.fetched` (+ `sourceUrl`, final URL, hops) | item |
| link fetch refused/failed | `nutrition.inbox.fetch.failed` (+ reason code, host only) | item-less: `entityId null` |
| ingredient confirmed / changed | `nutrition.inbox.assigned` (+ from → to, suggested?) | item |
| inbox read / failed / reused | `nutrition.label.read` / `.read.failed` / `.read.reused` — SAME actions, so the limit counts them | item |
| attached to ingredient | existing `nutrition.label.uploaded` / `.replaced` (+ `inboxItemId`) | `Ingredient` |
| apply | existing `nutrition.label.applied` (unchanged) | `Ingredient` |
| discard (single / bulk ≥7 days) | `nutrition.inbox.discarded` (+ `bulk: true`, age) | item |
| dialog "Read from a link" | `nutrition.label.uploaded`/`.replaced` with `sourceUrl` + `via: "link"` | `Ingredient` |

`nutritionAudit` today hard-codes `entityType: "Ingredient"`; it gains an
`entityType` parameter (default "Ingredient") rather than a second helper.

New routes for `docs/PERMISSIONS_INVENTORY.md` (NU-12 …), all ADMIN:
`nutrition/labels` GET (list + leftovers) · `nutrition/labels/upload-url` POST ·
`nutrition/labels` POST (register) · `nutrition/labels/from-link` POST ·
`nutrition/labels/[id]` PATCH (assign) + DELETE (discard) ·
`nutrition/labels/[id]/read` POST · `nutrition/labels/[id]/attach` POST ·
`nutrition/labels/discard-old` POST · `nutrition/ingredients/[id]/label/from-link` POST
(the dialog). Plus PG-43 `(app)/nutrition/labels/page.tsx`.

---

## Other findings

- **Leftovers / abandoned age.** Age is `now − createdAt`; `createdAt` is UTC
  `TIMESTAMP(3)` (CLAUDE.md § Database Evidence: no `Timestamptz` in the schema). The
  "older than 7 days" filter is computed server-side in UTC, so no client-zone math.
  Display age as "N days".
- **A scheduled purge** is out of scope. Audit does **not** think a ROW is needed yet:
  abandoned items are visible on the page with ages and a one-click bulk discard, the
  store is private, and the volume is one org's label set. Revisit if a second org
  adopts nutrition.
- **Batch throughput vs F3.** 177 food ingredients at 30 reads/hour is ~6 hours of
  wall clock at the limit; the 300/day cap is not the binding one. That is the ruled
  limit working, not a bug — but it means "Read all" on the full list *will* stop at 30
  and say "N left — continue after HH:MM". The inbox's 24 h/lifetime reuse (R1) and the
  per-row persistence are what make that tolerable. Flagged so the staging test plan
  expectation is right: a 3–5 file test will not hit the limit.
- **Concurrency.** Sequential-by-the-client is not a lock: two tabs could both run
  "Read all". The limit still holds (counted server-side from AuditLog), and the inbox
  read route should refuse an item whose status is already `READ` unless `fresh`, so a
  second tab mostly no-ops. Not worth a lock.
- **`NU-7` inventory text is stale** ("requires a label document or a source link — F2")
  — N1D-F2 made the link reference-only. Pointer-vs-claim: PERMISSIONS_INVENTORY is a
  living doc, so the docs commit can correct it. Noted, not in scope unless Gary says.
- **NU-8 / NU-6 inventory text** says "refused with no record (F6)" — also superseded by
  N1D-F1. Same treatment.

---

## Forks — chat's leans; audit position

- **N1E-F1 Persisted inbox** — lean yes, small table. **Audit agrees** (§ E).
- **N1E-F2 Matching** — lean suggest, never assign; Apply disabled until confirmed.
  **Audit agrees**, with the § C scorer (reuse `words()` + coverage + variant
  conflict; suggest only with a clear margin).
- **N1E-F3 Batch reads** — lean sequential, inside 30/h · 300/day, stop/resume, no
  increase. **Audit agrees**; requires the shared-count change in § A (inbox reads
  counted in the same pool) — otherwise the inbox doubles the budget.
- **N1E-F4 Link fetching safety** — lean as written. **Audit agrees** and adds:
  connect-time IP check (custom `lookup` on `node:https`, no new dependency) to defeat
  DNS rebinding; port 443 only; no userinfo; IPv4-mapped IPv6 unwrapped; the full
  range list in § D.
- **N1E-F5 Replacing an existing label** — lean confirm, delete old after success.
  **Audit agrees** for the queue and link paths; asks whether the dialog's own upload
  gets the confirm too (§ B; lean: no).

## RULING NOW

- **R1 — reuse window for inbox reads** (§ A): lifetime-of-the-inbox-item reuse by
  file hash (lean) vs. N-1c's 24 h everywhere. Amends an N-1c ruling.
- **R2 — storage move** (§ B): copy into the ingredient folder then delete the inbox
  blob (lean), vs. widening the namespace pin.
- **R3 — fetcher implementation** (§ D): `node:https` + custom `lookup` (lean, no new
  dependency) vs. adding `undici` as a direct dependency.
- **R4 — "Replace current label?" in the ingredient dialog's upload** (§ B): lean no
  (queue and link only).

## Files Phase 2/3 expect to touch

Schema: `prisma/schema.prisma` (+ `prisma/migrations/<ts>_n1e_label_inbox/`).
Lib: `src/lib/label-read.ts` or new `src/lib/label-read-run.ts` (shared read),
new `src/lib/label-match.ts`, new `src/lib/safe-fetch.ts`, `src/lib/nutrition-files.ts`
(inbox prefix, copy/put helpers), `src/lib/nutrition-record.ts` (audit actions,
entityType param). Routes: existing `nutrition/ingredients/[id]/label/read/route.ts`
(delegate to shared read, widened reuse), `…/label/route.ts` (CONFIRM_REPLACE on the
attach path, shared attach helper), new `…/label/from-link/route.ts`, new
`src/app/api/nutrition/labels/**`. UI: new `src/app/(app)/nutrition/labels/`
(page + client + queue card), `nutrition-section.tsx` (Proof box "Add from link"),
`src/components/layout/sidebar.tsx`. Fixture: `scripts/verify-n1e.ts`. Docs:
`docs/PERMISSIONS_INVENTORY.md`, `docs/ROADMAP.yaml`, `docs/DECISIONS.md`,
`docs/MIGRATIONS.md`. The PUT and verify routes are **not** expected to change.
