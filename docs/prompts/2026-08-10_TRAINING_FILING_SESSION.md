# SESSION PROMPT — TRAINING PHASE FILING (docs-only)

**Date commissioned:** 2026-08-10
**Session type:** DOCS-ONLY. One logical unit: file the training phase rows and ratified rulings onto `docs/ROADMAP.yaml`, plus the DEPLOY_LOG standing-note extension. No code edits, no schema changes, no migrations, no database queries.
**Executor:** Claude Code. **Rulings authority:** Gary — and note: every ruling in this prompt is ALREADY RULED and ratified. This session transcribes; it does not re-open, re-litigate, or improve any ruling. If transcription surfaces a genuine conflict with the board at HEAD, that is a STOP, not a judgment call.
**Git:** One docs commit. `npm run build` gates it per CLAUDE.md (docs-only commits gate on build alone). Commit, never push — Gary runs all pushes.

---

## GROUND RULES

- Source of truth is the repo at HEAD. Read `docs/ROADMAP.yaml` in full before writing anything; match its existing row schema, id conventions, and preserve-and-mark style exactly. Nothing is ever deleted; additions only.
- Read `CLAUDE.md` and `docs/prompts/2026-08-10_TRAINING_AUDIT.md` (the audit artifact, committed in 35a25c6) before drafting. The audit artifact is the evidence record these rows cite — reference it by path, do not restate its findings into the rows beyond what the row schema needs.
- Expected repo state at session start: branch staging, HEAD 35a25c6 (or a descendant if Gary has pushed/merged — verify and report). If HEAD does not contain the audit artifact, STOP and report.
- HARD STOP: draft the full set of row texts and the rulings transcription in-session, present them to Gary, and WAIT for explicit approval before writing to any file. One presentation, one approval, one commit.

## PROVENANCE LINE (include with the rulings filing)

All rulings below were made in the Claude.ai planning session of 2026-08-10 following the training audit (docs/prompts/2026-08-10_TRAINING_AUDIT.md). R-a, R-b, R-d, R-e, R-f: ruled by Gary on the audit's evidence packets. R-c page access and the HR-13 scheduling call: recommended with reasoning by the audit session, explicitly ratified by Gary 2026-08-10 ("ratified"). Record this attribution as stated — the distinction between ruled-directly and ratified is deliberate.

## WHAT TO FILE

### 1. Three new phase rows (HR- sequence continues; no TRN- series — ruled R-a)

**HR-20 (size M) — TrainingCategory entity + additive migration.**
Fourth instance of the per-org category pattern (IngredientCategory / LossReason / TemplateType). Scope: TrainingCategory entity; nullable FK on TrainingModule; migration seeding categories from distinct `subject` values (backfill sized by Gary's §8.1 Neon results, which the HR-20 session opens with); starter seed for zero-category orgs (DEBT-59 style: visible, renameable, never silently stamped — note: category is OPTIONAL per R-a, so the starter seed is convenience, not load-bearing, and the empty state must render sanely); module form select; CSV by-name resolution; `subject` kept as mirror per the TPL-1a additive shape — retirement is its own later step, not this row.
Conditional element: unique constraint on TrainingAssignment (module × staff) lands in this row's migration ONLY if §8.2 returns zero duplicate pairs on all three branches (dev br-broad-wave, staging br-square-feather, production br-sparkling-block); any nonzero result returns to Gary with the rows before the constraint ships (ruled R-b).
Rider (shared with HR-21): close the storeIds org-validation gap in module POST/PATCH (PERM-7's class, found unreached by PERM-7 — audit §9). No separate debt row; the rider is named here so it cannot silently drop.

**HR-21 (size M) — Category management UI + badges + chips + card/list toggle.**
Scope: Manage Categories dialog living with the list it categorises (the Manage Types precedent); colour badges via badge-preset KEYS only (`src/lib/badge-presets.ts` — never class strings from the DB, Tailwind 4 constraint); filter chips; card view / list view toggle on /hr/training. One data source feeds both views — the list view never fetches its own data; a module must not differ in category, status, or action set between views; everything this phase adds appears in BOTH views. Toggle persistence: localStorage, single key `froot.hr.training.view` (ruled R-f) — UX-2's shared-device caveat stated on this row, with the mitigating fact recorded beside it: Gary confirmed 2026-08-10 that MANAGER logins at Keva are personal machines and shared iPads run STORE, which cannot reach this page.
Page access: /hr/training stays ADMIN-only (ruled R-c, ratified) — HR-6 shipped it that way deliberately, training content is confidential, and the org-wide-push persona is ADMIN. Reversible later as its own small named row on demonstrated manager need; HR-21 ships no role-conditional UI.
Carries the storeIds rider jointly with HR-20 (whichever session touches the write path closes it; the other verifies).

**HR-22 (size M) — Bulk assign + due date carry-through.**
Scope: Bulk Assign entry point on /hr/training modules (both views); recipient picker — individuals, entire store, or everything in the assigner's scope; optional due date applied to every created assignment, NO invented default (DEBT-59). Server-side enforcement on the bulk route (ruled R-d): every submitted staff/store id validated against org ownership AND caller scope (getUserStoreScope — PERM-6's lesson on day one); ACTIVE staff only, always; corporate staff excluded from entire-store expansion (individually selectable; included in ADMIN's everything-in-scope), because Square sync expands isCorporate staff to every store; module-active and applicability-vs-store enforced server-side, not UI-only. Duplicates: skip-and-report (ruled R-b). Response reports its own blast radius — assigned / already-assigned / each exclusion as a named count — and sums exactly to its input (CHK-3's counter lesson).
Permissions (ruled R-e): STORE 403'd; ADMIN + store-scoped MANAGER at the API per the existing shared guards in `api/hr/training/access.ts` — inline pattern, zero registry edits, PERM-5C's boundary comment untouched; HR-19 migrates this seam later. (Page gating per R-c means the button is ADMIN-reachable in practice; the API guard is the enforcement layer.)
Disclosure guardrail (ratified with the HR-13 call): HR-22's confirm dialog states the immediate compliance effect plainly — "this adds N required items to compliance now" — so the pre-HR-13 dip is never a surprise, even if HR-13 slips.
Out of scope, on the row: notification emails (gate is HR-16's — notify.ts is console-only); any HR-13 semantics change.

### 2. HR-13 scheduling note (on the existing HR-13 row — preserve-and-mark, dated addition)

HR-13 is scheduled ADJACENT to HR-22 — immediately after, its own row, its own audit-first session and ruling cycle (ratified 2026-08-10). Reason on the record: an org-wide bulk assign with a future due date drops every live compliance number the instant the button is pressed; a number that falls off a cliff the day an operator did the right thing is the wrong-answer-that-argues-back failure mode. HR-13 stays OUT of HR-22's session — it changes the meaning of a live compliance surface, and the row is currently title-only: exclude-until-due needs real spec work (does a future-due assignment join requiredTotal; does it get its own scheduled state; what do store rollups show). Interim behavior is covered by HR-22's disclosure guardrail.

### 3. Rulings transcription

File R-a through R-f as the board's conventions dictate for phase-scoping rulings (read how TPL-1's rulings were recorded and match it — whether that is row-embedded notes, a rulings-panel entry, or both is a convention question the file answers, not this prompt). Content, verbatim in substance:

- **R-a:** HR-20/21/22, HR- sequence, no TRN- series. Category OPTIONAL on modules; starter seed demoted to convenience.
- **R-b:** Duplicates skip-and-report. Unique constraint conditionally approved — §8.2 zero on all three branches, else back to Gary with rows. Future re-assignment, if ever built, uses a cycle column (HR-15b shape) — this ruling is what makes the constraint safe.
- **R-c:** STORE: no. /hr/training stays ADMIN-only; reversible-by-row on demonstrated need. (Session-recommended, ratified by Gary 2026-08-10.)
- **R-d:** ACTIVE-only always; corporate excluded from store expansion, individually reachable, in ADMIN's everyone; module-active and applicability server-side; every exclusion a named count; response sums to its input.
- **R-e:** Inline permission pattern; shared guards in api/hr/training/access.ts; zero registry edits.
- **R-f:** localStorage, key `froot.hr.training.view`, UX-2 caveat on HR-21's row with the 2026-08-10 personal-device confirmation.
- **HR-13 call:** scheduled adjacent to HR-22 with the two guardrails (own session; HR-22 discloses regardless). (Session-recommended, ratified by Gary 2026-08-10.)

### 4. DEPLOY_LOG standing-note extension

`docs/DEPLOY_LOG.md` carries a standing obligation: the next real promotion must name docs-only merges 65abb74 and f318d2e. Extend that note (preserve-and-mark, dated line) to also name 35a25c6 (training audit + session prompt) and THIS session's commit SHA — write the note so the new SHA is appended at commit time. The obligation list must live on the file, not in chat memory.

## OUT OF SCOPE

No edits to HR-16, HR-18, HR-19, DEBT-26's pointer, or DEBT-66's trigger line (the latter two are deferred to their rows' next substantive sessions by prior rider). No COMMENT-NOT-A-ROW lines from audit §9 — those land when the phase sessions naturally touch their files. No changes to the audit artifact (claimed wholesale, never edited afterward).

## DONE CRITERION

Row texts and rulings presented in-session → Gary approves → written to ROADMAP.yaml + DEPLOY_LOG.md → green `npm run build` → one docs commit → session report with the commit SHA and the unpushed-commits count. Pushes are Gary's.
