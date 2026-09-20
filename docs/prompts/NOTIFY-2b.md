Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/NOTIFY-2b.md and execute it.

# NOTIFY-2b — Branded email template, send log, Resend delivery webhooks

**TIER 2 — contained code change.** No schema, no migration. New lib for
the template, a new webhook route, a read-only section on
`/settings/notifications`. Brief audit (report before building), no stop
gate unless the audit contradicts this prompt.

**Save to:** `/Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/NOTIFY-2b.md`
**Branch:** `staging`. Commit only — never push.
**Today:** 2026-09-20.

Read `/Users/garythomas/Claude_Projects/Froot/froot/CLAUDE.md` first. One
command at a time, no `&&`, never `git add -A`, `npm run build` gates every
commit. Report every `prisma` command verbatim (expect only `prisma
generate` inside the build).

---

## Why this session exists

Every email Froot sends is plain text with no mark, and the only record of
a send is a write-only AuditLog row or the Resend dashboard. NOTIFY-2b does
three things Gary ruled 2026-09-20: one branded look shared by every email;
a "Recent emails" section on `/settings/notifications` so an admin can see
what went out and whether it arrived; and Resend delivery webhooks so
"arrived" is a fact, not a guess.

Rulings already made:
- Every consumer (HR-16 ack email, F-5 pace alert, the admin test route)
  renders through ONE template. No per-consumer HTML.
- The plain-text part is kept as the alternative body. The pace-alert
  text wording stays byte-identical to today (`pace-alerts.ts:137-150`);
  the HTML mirrors it.
- AuditLog is append-only. Delivery events become NEW rows, never updates
  to the `email.sent` row.
- Recipients, thresholds, toggles: untouched (2a).
- Employee-facing emails, ops reports: not this phase.

## Phase 1 — Audit (brief; report, then continue)

1. `src/lib/notify.ts`: confirm `EmailMessage` has no `html` field and
   the Resend body has no `html` key. Report lines.
2. The three consumers: `src/lib/hr-ack-notification.ts` (subject/body
   build, the AuditLog write and its metadata shape incl. `provider`),
   `src/lib/pace-alerts.ts:137-150`, `src/app/api/notify/test/route.ts`.
   Report where each builds its text.
3. Branding assets: what exists under `public/` (a Froot mark? which
   formats?) and what colour tokens the app uses for the orange (find the
   Tailwind config or CSS variable). Report paths and hex values.
4. AuditLog query shape for the log: `@@index([organizationId,
   entityType, createdAt])` exists; confirm Prisma JSON filtering on
   `metadata.resendId` works on this Postgres/Prisma version (`metadata:
   { path: ["resendId"], equals: id }`). Report.
5. Webhook precedent: `src/app/api/webhooks/square/route.ts` (HMAC
   verify, ACK-then-work) and `src/app/api/webhooks/clerk/route.ts`
   (Svix). Resend signs with Svix; report whether the `svix` package is
   already a dependency.
6. `/settings/notifications` page: where a third card goes, and the
   "Recipients:sent" missing space (fix it in Phase 2).

**Forks — report with your lean, then proceed on the lean unless it is
F1; STOP for F1 only if no usable mark exists in `public/`.**

- **F1 — Logo.** Hosted PNG from `NEXT_PUBLIC_APP_URL/...` with alt text
  (my lean if a mark exists) vs a text wordmark on an orange bar (fallback
  if none does, or if the only mark is SVG — many mail clients drop SVG).
- **F2 — Log depth.** Last 50 rows vs last 30 days. Lean: last 50, newest
  first; it's a glance surface, not a report.
- **F3 — Delivery-event correlation.** By `metadata.resendId` JSON filter
  (lean) vs adding a column (not this phase — no schema).

## Phase 2 — Build

**Template.** New `src/lib/email-template.ts` exporting
`renderEmail(input) → { html, text }` where input is
`{ orgName, heading, intro, rows: {label, value}[], cta?: {label, url},
footer }`. Rules:
- Table-based HTML, inline styles only, single column, max-width 600px,
  system font stack. Orange header bar with the mark (F1), org name in
  the header ("USE Froot · on behalf of <orgName>"), rows as a two-column
  table, CTA as a bordered button link, footer line as today's
  "This address does not accept replies."
- `text` is generated from the same input: heading, blank, intro, blank,
  `Label:  value` rows, CTA URL on its own line, footer. Consumers must
  produce text identical to what they send today; for pace alerts that
  means the input is shaped so the generated text equals the current
  lines byte-for-byte — prove it in the fixture (diff against a captured
  pre-change send), or if the template's row format cannot reproduce a
  line exactly, keep the consumer's existing text builder for `text` and
  use the template for `html` only, and say which you did.
- No external CSS, no web fonts, no tracking pixels, no images except the
  mark.

**Sender.** `EmailMessage.html?: string`; Resend body gains `html` when
present. Console sender logs a one-line note that html was present and
its length; it does not print the HTML.

**Consumers.** All three pass `html` from the template. HR-16's CTA is
the record download URL; pace alert's CTA is the dashboard URL; the test
route's CTA is `/settings/notifications`. Subjects unchanged.

**Send log.** Third card on `/settings/notifications`, "Recent emails":
newest-first list per F2, from AuditLog where `entityType =
"Notification"` for the org. Columns: when (org-local), kind (`hr.ack` →
"Signed acknowledgment", `pace.alert` → "Behind-pace alert", `test` →
"Test"), recipients (comma list, truncated after 3 with "+N"), status,
provider. Status is derived per `resendId`: the latest of
`delivered` / `bounced` / `complained` / `delayed` if a delivery-event row
exists for that id, else `sent` (provider resend) or `logged only`
(provider console), else `failed` with the error on hover/expand. Empty
state: "No emails sent yet." ADMIN only via the page gate; read-only, no
route needed if the page can query server-side — say which.

**Webhook.** New `src/app/api/webhooks/resend/route.ts`:
- Verify the Svix signature with `RESEND_WEBHOOK_SECRET` (fail closed: no
  secret → 500 with a log line; bad signature → 401). Use the Clerk
  route's pattern.
- Accept `email.delivered`, `email.bounced`, `email.complained`,
  `email.delivery_delayed`; ignore others with 200.
- Find the org by the `email.sent`/`email.failed` AuditLog row whose
  `metadata.resendId` matches `data.email_id` (F3). No match → 200 and a
  log line (an email Froot didn't send, or an old one); never 4xx on a
  miss, Svix would retry forever.
- Write a NEW AuditLog row: `entityType "Notification"`, `action` =
  `email.delivered|bounced|complained|delayed`, `metadata { resendId,
  kind (copied from the sent row), recipients (from the event), reason
  (bounce/complaint text if present), at (event timestamp) }`.
- Idempotent: if a row with the same `resendId` + action already exists,
  200 and skip. Svix retries.
- ACK fast: verify, find, write, return. No email, no Square calls.

**Docs.** CLAUDE.md required-env block: `RESEND_WEBHOOK_SECRET`
(Preview and Production, separate values, one per Resend endpoint).
`docs/FORECASTING.md` pace-alert section: HTML now sent alongside text.

**Fixture.** `scripts/verify-f5-polish.ts`: the pace-alert capture now
asserts `text` is byte-identical to the pre-2b wording (embed the
expected lines) and that `html` is non-empty and contains the store
name. Add a small `scripts/verify-notify-template.ts`: renders all three
consumers' inputs and asserts each `html` contains the org name, the CTA
URL, and no `<script`, `<link`, or `http://` (mixed content); writes the
three HTML files to `/tmp` so Gary can open them in a browser.

## Phase 3 — Commit (two-commit pattern)

Commit 1: template lib, notify.ts, three consumers, page card, webhook
route, fixtures, the "Recipients:" space fix.
`feat(NOTIFY-2b): branded email template for all consumers; Recent emails log; Resend delivery webhook`

Commit 2 (cites 1):
- `docs/ROADMAP.yaml`: NOTIFY-2b → `in_progress`, commits, F1–F3 in
  notes; `open:` entry "webhook proven on staging (needs endpoint +
  secret)". NOTIFY-1's "delivery webhooks — ROW" note → resolved rider.
- `docs/DECISIONS.md`: NOTIFY-2b heading — template rules, append-only
  delivery rows, plain-text-preserved ruling.
- `docs/prompts/NOTIFY-2b.md`.
`docs(NOTIFY-2b): row, rulings, NOTIFY-1 webhook note resolved (work <SHA>)`

## Staging verification — Gary's side

Before pushing, nothing. After pushing:
1. **Resend → Webhooks → Add endpoint**:
   `https://froot-git-staging-indianathomas-2483s-projects.vercel.app/api/webhooks/resend`
   Events: delivered, bounced, complained, delivery_delayed. Copy the
   signing secret.
2. **Vercel → Environment Variables, Preview only**:
   `RESEND_WEBHOOK_SECRET` = that secret. Then an empty commit + push so
   the build picks it up (Redeploy button does not).
3. Signed in as admin on staging, `POST /api/notify/test` from the
   browser console. Open the email: it should be branded. Within a
   minute `/settings/notifications` → Recent emails shows the test row
   with status **delivered**, provider resend.
4. Set your address as HR recipient, sign a document as Tommy, confirm
   the branded `Signed:` email and a second delivered row. Clear the
   recipient after.
5. Open the three `/tmp` HTML files the template fixture wrote, or the
   real emails on a phone — that's the branding review.

## Report

1. Audit findings 1–6 with file:line; F1–F3 as taken.
2. Whether pace-alert `text` is template-generated or builder-preserved,
   with the byte-identical proof.
3. Both SHAs; fixture counts; `npm run build`.
4. Prisma commands run.

## Out of scope

- Per-consumer designs, marketing-style layouts, images beyond the mark.
- Any change to recipients, thresholds, toggles, or the cron.
- Employee notifications, ops reports.
- Production webhook endpoint (set up at promotion time).
