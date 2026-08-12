# TRAINING ACCESS AUDIT — STORE preview access + assignment capability

**Audit performed:** 2026-08-11
**Repo:** `~/Claude_Projects/Froot/froot`
**Branch:** `staging`
**HEAD at audit:** `ec42265` ("Fix bulk assign dialog scrolling past the viewport")
**Branch parity:** `main` and `staging` both at `ec42265` — level, 0 ahead / 0 behind, verified
before any reasoning began (the HR-22-follow-up near-miss rule,
`docs/prompts/HR-22-FOLLOWUP_AUDIT.md`). Tree clean except three untracked docs.
**Scope:** read-only audit of what a STORE login can reach across the training surface, what
the capability-override layer can and cannot express, and what it would cost to reverse the
R-c ruling — commissioned by `docs/prompts/2026-08-11_TRAINING_ACCESS_AUDIT_SESSION.md`.
**No database was queried by this session. No code was changed by this session.**

Modeled on `docs/prompts/2026-08-10_TRAINING_AUDIT.md`, which is also this audit's direct
predecessor: that audit produced R-a..R-f and the HR-20/21/22 trilogy; this one revisits the
one ruling of that set that was explicitly marked reversible.

It is a claim wholesale and is not edited afterwards.

---

## 0. Headline

Six sentences carry most of what the follow-on phase needs to know:

1. **The override layer is not merely restrict-only in copy — it is restrict-only twice over
   in code, and a grant is unrepresentable rather than unimplemented.** `can()` evaluates the
   role ceiling first and its only `return true` sits after it (`permissions.ts:309-320`);
   `PATCH /api/users/[id]` then filters the submitted array through `can({ role }, c)` before
   storing (`users/[id]/route.ts:104`), so the column is a *deny list* whose entries are
   meaningless above the baseline. **Item 5 cannot be expressed as an override at all.**
   Not "would be awkward" — the data structure has no direction for it (§7, R-i).

2. **HR ALREADY SHIPPED the exact architecture Gary is asking for, one module over.**
   `/hr/documents` has **no role gate** — every authenticated org member reads the library,
   ADMIN-only manage is enforced at the API while the UI hides the controls
   (`hr/documents/page.tsx:7-12, 37`). The policy is centralized in a named per-kind function,
   `canReadHrDocument` (`hr-files.ts:243-268`), with a stricter sibling
   `canReadHrSignedRecord` for the confidential tier. Items 1/3/4 are a request to make
   training behave like HR-3/HR-4 already behave. **This is the single most useful finding
   here** (§2.3, R-g, R-j, R-k).

3. **R-c's stated ground is weaker than R-c assumed.** R-c ruled `/hr/training` ADMIN-only
   because "training content is confidential (Keva's handbook)". The handbook *as a document*
   is readable by STORE today at `/hr/documents`, by design and with a comment saying why.
   The confidentiality asymmetry between the two surfaces is not defended anywhere in code
   (§2.3, R-k).

4. **The completion-disappears behavior in item 2 is WRITTEN — but it is not the guarantee
   Gary believes he is preserving.** It is one line on the `/my` home card,
   `openItems.filter((i) => i.status !== "complete")` (`(my)/my/page.tsx:72`), whose purpose
   is a to-do list. `/my/training` and `/my/training/[assignmentId]` have **no status filter
   at all** and render completed and certified modules in full, lessons and resource download
   links included. The material never left the building; it left one card (§4, R-m).

5. **The resource-download route is the sharp edge, and it fails in the direction nobody would
   check.** If STORE is admitted to HR-17's preview, `TrainingModuleView` renders download
   links unconditionally (`training-module-view.tsx:150-164`) while the route 404s for STORE
   — visible, dead links. Widening the route to fix that hands STORE a 307 to a signed blob
   URL for every module's attachments (§3.3, R-g).

6. **Training resources are the only HR file class with no policy function.** Documents ask
   `canReadHrDocument`; signed records ask `canReadHrSignedRecord`; training resources
   authorize inline inside the route handler and ask nothing
   (`resources/[id]/download/route.ts:18-69`). R-j's "what carries the distinction" has an
   answer the codebase already uses everywhere else (§3.3, R-j).

---

## 1. The page gate today

### 1.1 The gate stack, in execution order

`src/app/(app)/hr/training/page.tsx` is a 21-line server shell that fetches nothing:

| Line | Gate | Fails as |
|---|---|---|
| :13 | `if (!orgId) redirect("/dashboard")` | redirect |
| :14 | `if (!hrModuleAvailable(orgId)) notFound()` | 404 — HR must not exist here |
| :17 | `if (!org.activeModules.includes("hr")) redirect("/hr")` | redirect to the upsell |
| **:18** | **`if (dbUser?.role !== "ADMIN") redirect("/hr")`** | **redirect — the R-c gate** |

The page then renders `<TrainingClient />`, which fetches `GET /api/hr/training` in a
`useEffect` (`training-client.tsx:175`) — a **second, independent** ADMIN gate at
`requireHrTrainingAccess` (`access.ts:32-34`).

### 1.2 The card, which is the gate item 1 actually names

Gary's item 1 says STORE "cannot reach the training card at all". The card is on `/hr`, and
it is gated separately from the page:

- `(app)/hr/page.tsx:108-121` — the Training card renders only under
  `dbUser?.role === "ADMIN"`.
- Same file, same pattern: Agreement Forms `:94`, Signed Records `:122`, Compliance `:80`
  (`ADMIN || MANAGER`).
- **STORE reaching `/hr` today sees exactly two cards:** Staff Directory and Document Library.

So item 1 is a **three-gate** problem, not one: the card (`hr/page.tsx:108`), the page
(`hr/training/page.tsx:18`), and the list API (`access.ts:32`). All three must pass before a
STORE login sees a module list.

### 1.3 Every training guard, and every tier it admits

Two guards, 25 call sites, zero `can()` usage — R-e's inline pattern, held exactly.

| Guard | File/line | Admits | Extra it returns |
|---|---|---|---|
| `requireHrTrainingAccess` | `access.ts:11-37` (role test `:32`) | **ADMIN only** | `org`, `dbUser` |
| `requireHrTrainingManageAccess` | `access.ts:43-76` (role test `:65`) | **ADMIN + MANAGER** | `isAdmin`, `storeIds` |
| `findManageableStaffMember` | `access.ts:81-94` (scope test `:90`) | per-target | null → caller 404s |

**STORE is refused at `access.ts:65` with `403 "Manager or Admin access required"` on every
route in the module.** There is no third tier and no STORE branch anywhere in `access.ts`.

Call-site distribution (all 25, read at HEAD):

- `requireHrTrainingAccess` (ADMIN) — 14 sites: module list/create/bulk-status
  (`training/route.ts` ×3), module read/update/delete (`[id]/route.ts` ×3), import, export,
  upload-url, lesson resources POST, resource `[id]` PATCH/DELETE, categories collection ×2,
  categories `[id]` ×2, categories reassign.
- `requireHrTrainingManageAccess` (ADMIN+MANAGER) — 11 sites: assignments POST, bulk POST,
  bulk recipients GET, assignment PATCH/DELETE, certify, certificate, lesson capture,
  quiz-result, attempt review, **and the resource download route's first tier**.

### 1.4 The function each of Gary's five item-behaviors must pass

| # | Behavior | Must pass | Today's answer for STORE |
|---|---|---|---|
| 1 | See the training card | `hr/page.tsx:108` role test | not rendered |
| 1 | Open the library page | `hr/training/page.tsx:18` | redirect `/hr` |
| 1 | Load the module list | `requireHrTrainingAccess` (`access.ts:32`) | 403 |
| 3 | Read one module's content | `hr/training/[id]/preview/page.tsx:31` | redirect `/hr` |
| 3 | Open an attached file | `resources/[id]/download/route.ts:21` then `:48` | 403 → 404 (§3.3) |
| 4 | **NOT** edit/create/delete | `requireHrTrainingAccess` on 14 routes | already refused ✔ |
| 4 | **NOT** assign | `requireHrTrainingManageAccess` (`access.ts:65`) | already refused ✔ |
| 5 | Assign under an override | — | **no mechanism exists** (§7) |

Note the shape of that table: **items 4's two "must not" rows already hold, server-side, with
no work at all.** Everything STORE must not do is refused by a guard STORE cannot reach past.
The work in items 1/3/4 is entirely about *opening* three read gates without opening the
fourteen write ones — and the guards are already split along exactly that line.

---

## 2. The STORE role's current surface

### 2.1 STORE's breadth is the capability registry, not scattered checks

Grepping `src` (excluding `src/generated`) for STORE role comparisons returns **twelve** hits
and only three of them are enforcement: `permissions.ts:120-123` (the tier constants),
`permissions.ts:267` (`isPermissionRole`), and `device-login.ts:67,138`. Everything else is a
form default or a Zod enum. There is no inline `role === "STORE"` gate anywhere in the app.

That is a good property and it should be said plainly: **STORE's surface is defined in one
file and can be read off it.** From `GRANTS` (`permissions.ts:129-264`), STORE holds every
capability tiered `ALL` or `OPERATIONAL`:

**`ALL` (includes STORE and STAFF):** `dashboard.view`, `checklists.view`,
`checklists.execute`, `messages.use`, `instagram.view`, `inventory.assets.view`,
`inventory.counts.execute`, `inventory.adjustments.record`, `labor.view`, **`hr.access`**,
**`hr.documents.view`**, `hr.sign.self`, `my.access`.

**`OPERATIONAL` (ADMIN/MANAGER/STORE, excludes STAFF):** `checklists.create`,
`storeview.access`, `inventory.nav.view`, `inventory.po.view`.

**Denied to STORE:** everything `MANAGE` or `ADMIN_ONLY` — including `staff.view`,
`reports.view`, `forecasting.view`, `hr.compliance.view`, `hr.records.view`,
`hr.sign.attest`, `hr.forms.execute`, and both training capabilities.

### 2.2 Where the "operational breadth, zero confidential or personal data" line is drawn

It is drawn in two places, and both are quotable rather than inferred:

**In the registry, as a comment on the inventory split** (`permissions.ts:201-206`):
operational data is "counts, adjustments, pars, item names and units — what a person on the
floor with a clipboard needs" and is granted to every role; commercial data — "vendor prices,
COGS, margin, valuation, turnover, variance, vendor spend" — is ADMIN/MANAGER.

**In the device-login copy** (`device-login.ts:33-37`), which is what an operator actually
reads when provisioning a store iPad:

> "Store device — Runs this location only. Checklists, counts, store view — no financial or
> personal data."

**That sentence is the promise the product makes about a STORE login, and it is the right
test to apply to items 1/3/4.** A store-specific equipment procedure is neither financial nor
personal. It is the clipboard, in Gary's words — read the procedure on the floor at the moment
the water heater needs restarting. Nothing in the line as drawn excludes it.

What the line *does* exclude, and what a training-library grant must therefore be checked
against: modules whose content is personal (a disciplinary or performance module) or
commercial. Whether such modules exist is a data question this session cannot answer without a
query — see §5 and R-h.

### 2.3 The precedent that decides most of this: `/hr/documents`

**`/hr/documents` has no role gate.** The full gate stack (`hr/documents/page.tsx:14-19`) is
availability → org toggle → render. Its header comment states the policy deliberately:

> "Both kinds are readable by every authenticated org member (staff must be able to read what
> they are asked to sign). Upload/manage is ADMIN-only (enforced by the API; the UI hides the
> controls)."

The page passes `isAdmin` to the client purely to hide controls (`:37`). Authorization for
the files themselves is a **named policy function** — `canReadHrDocument`
(`hr-files.ts:243-268`) — keyed on `HrDocument.kind`:

| kind | Who reads | Comment in code |
|---|---|---|
| `Reference` | **every org member** | "General HR library" |
| `Acknowledgment` (blank template) | **every org member** | "staff must be able to read what they are asked to sign" |
| `FillableForm` | ADMIN + MANAGER | template definitions |
| *(executed signed records)* | `canReadHrSignedRecord` — ADMIN, or MANAGER with store overlap | HR-7 rule 5 removed even the owning staff member |

**Three things follow, and they are the spine of R-g, R-j and R-k.**

1. **The pattern Gary is asking for is shipped and load-bearing.** Read for everyone, manage
   ADMIN-only at the API, UI hides controls, files behind a policy function. Items 1/3/4 are
   "make training look like documents", not a new architecture.
2. **R-c's confidentiality premise does not survive contact with this file.** R-c reasoned
   that training content is confidential *because the handbook is*. The handbook is a
   `Reference` document and STORE can read it today. The two surfaces are asymmetric and
   nothing in code defends the asymmetry — HR-6 simply shipped a builder page and gated the
   whole page because authoring was ADMIN-only (`training/page.tsx:6-8` says exactly that:
   "authoring is ADMIN-only, so unlike the document library the whole page is gated, not just
   the controls"). **The gate was a consequence of the page being an authoring tool, not a
   ruling about the content.** R-c inherited it as though it were the latter.
3. **HR knows how to express a confidentiality tier when it wants one** —
   `canReadHrSignedRecord` is stricter than any training check and was *tightened* by HR-7
   rule 5 to exclude the owning staff member. R-j does not need a new mechanism invented; it
   needs a decision about which existing one applies.

### 2.4 Two STORE-visible defects found in passing

- **`/hr` offers STORE a Staff Directory card that STORE cannot open.**
  `hr/page.tsx:58-70` renders the card unconditionally; `/staff` requires `staff.view`
  (`MANAGE`). A STORE login taps it and bounces. Triage §8 #2.
- **`hr/page.tsx:21` looks the user up by `clerkUserId` alone** —
  `prisma.user.findUnique({ where: { clerkUserId: userId }, select: { role: true } })` — the
  DEBT-55 pattern CLAUDE.md § Page Conventions names explicitly. Triage §8 #1.

---

## 3. The preview surface (HR-17)

### 3.1 What it is

`src/app/(app)/hr/training/[id]/preview/page.tsx`, 93 lines, shipped by HR-17 (`438a9ef`,
2026-07-25). Its own comment states the design: it renders the module "through
TrainingModuleView — the exact component `/my/training/[assignmentId]` uses — as a fresh
trainee would see it (zero progress, quiz unlocked but unsubmittable). No assignment exists
here, so no completion/attempt write is reachable and nothing counts toward compliance."

**Gate stack** (`:24-33`): auth → availability → org toggle → `role !== "ADMIN" && role !==
"MANAGER"` redirect `/hr` (`:31`) → derive `isAdmin` and `storeIds`.

**Applicability filter** (`:39-41`): ADMIN reaches any module in the org; MANAGER only
`appliesTo: "all"` OR a module with a store assignment overlapping their stores. A miss
`notFound()`s (`:51`) — the module-scoping precedent R-h would extend to STORE already exists
here, working, one `OR` clause.

### 3.2 What it renders and what it omits

`TrainingModuleView` (`components/hr/training-module-view.tsx`) is one renderer with two
modes (`:22-33`).

**Renders in preview mode:** title, description, every lesson in order with body content,
video links (`:140-148`), **every attached resource as a download link** (`:150-164`), the
quiz with its questions.

**Omits / disables in preview mode:** the lesson-complete button is replaced by a disabled
button (`:167`); the quiz renders via `<QuizClient preview …>` (`:192-193`) and cannot submit;
the certification block is `mode.kind === "execute"` only (`:91-95`); the answer key is
stripped for **both** modes by `toClientQuizQuestions` — the file comment at `:36` says the
payload "must never carry the answer key (rule shared by both modes so the preview can't
diverge from what a trainee is sent)".

Read-only is therefore **structural for writes** — there is no `assignmentId` in preview mode,
so no write endpoint has a target. It is **not** read-only for files.

### 3.3 The resource-download route — the sharp item (rider 2)

`src/app/api/hr/training/resources/[id]/download/route.ts`, 69 lines. Its history is written
into its own comment (`:7-17`): "HR-7 widened the route, not the blob store; **HR-17 widened
tier 1 from ADMIN to the manage tier so the preview page's file links work for managers**".

**Tier 1 — manage** (`:21-46`): `requireHrTrainingManageAccess()`; resource resolved through
`trainingLesson.trainingModule` with `organizationId` scoping and, for non-admins, the same
`appliesTo`/store-overlap `OR` (`:31-38`). Hit → **307 to a signed blob URL** (`:43`).

**Tier 2 — self** (`:48-68`): `getActiveStaffSelf()`; resource resolved through
`trainingModule.assignments: { some: { staffMemberId: self.staffMember.id } }` (`:60`). Hit →
307 (`:68`). Miss → 404.

**The signed URL** is minted by `getHrFileDownloadUrl` (`hr-files.ts:217-226`) with
`SIGNED_URL_TTL_MS = 5 * 60 * 1000` (`:26`) — a **five-minute bearer URL**. Five minutes
bounds who can *start* a download; it does nothing about the file once it is on the device.
For item 2's stated concern — trade-secret material walking out of the building — the relevant
event is the 307, not the TTL.

**What happens today if STORE reaches a preview page.** Suppose only `preview/page.tsx:31` is
widened to admit STORE:

1. `TrainingModuleView` renders `<a href="/api/hr/training/resources/{id}/download">` for
   every resource. **The link block at `:150-164` is not conditioned on `mode` at all** — it
   is outside both the preview and execute branches.
2. The request hits tier 1. `requireHrTrainingManageAccess` 403s STORE at `access.ts:65`, so
   `manage.ok` is false and the `isAdmin` 404 short-circuit at `:45` is skipped.
3. It falls through to tier 2. `getActiveStaffSelf` (`auth.ts:143-164`) requires a linked
   ACTIVE `StaffMember`. A PERM-7 device login is a `User` with role STORE and **no**
   StaffMember link → `no-profile` → **404**.

**Result: STORE would see a full list of downloadable files, every one of which 404s.** Not a
leak — a visible, dead affordance on the shared iPad, on the exact screen someone is using
because a water heater is broken. This is the failure that would be discovered on the floor
rather than in review, because a reviewer widening a *page* gate has no reason to read a
*route* in a different directory.

**What guard change would be required to hold item 2's line.** Three options, none free:

- **(a) Widen tier 1's role test to include STORE.** Cheapest to type, worst blast radius:
  `requireHrTrainingManageAccess` backs **eleven** routes including certify, assignment
  PATCH/DELETE and every capture route. Widening it hands STORE all of them. **Rejected on
  sight — recorded so the rejection is deliberate rather than unconsidered.**
- **(b) A third tier inside the download route.** A STORE branch resolving the resource with
  the same `appliesTo`/store-overlap clause the preview page uses, keyed on the STORE login's
  own store. Contained to one file, no other route moves. Cost: STORE gains a 307 for every
  applicable module's attachments — genuinely *more* file reach than an EMPLOYEE has, since
  tier 2 requires an assignment and this would not.
- **(c) Suppress the links for STORE and ship read-without-files.** Add a mode or a flag to
  `TrainingModuleView` so resource links render only for tiers that can fetch them. Holds item
  2's line absolutely; costs item 3 whatever content lives in a PDF rather than in lesson
  bodies. **Whether that guts the feature is a content question this session cannot answer**
  — if the water-heater procedure *is* a PDF attachment, (c) delivers an empty page. That is
  R-g's central unknown and it needs Gary, not a query.

**The finding under all three:** the download route authorizes inline and asks no policy
function, unlike every other HR file class (§2.3). Any of (b)/(c) is the natural moment to
give training resources a `canReadTrainingResource` — which is also R-j's mechanism.

---

## 4. The completion-disappears behavior (item 2) — LOCATED, and it is not what it looks like

### 4.1 What Gary observed is real, and one line causes it

`src/app/(my)/my/page.tsx:72`:

```ts
const openItems = (detail?.items ?? []).filter((i) => i.status !== "complete")
```

`/my` is the staff home. The "My Compliance & Training" card renders `openItems` only, sorted
by a status rank that has no `complete` entry (`:73-74`). When an assignment completes, its
row leaves that card and the card eventually reads "You're all caught up."

**Per the rider: this is WRITTEN, not emergent.** It is a deliberate line with a deliberate
purpose — it is a to-do list, and a to-do list that keeps finished items is a worse to-do
list. The surrounding comment (`:20-26`) describes the card as "open compliance & training
items". Nothing about it was accidental.

### 4.2 But it is not the guarantee item 2 describes, and three facts say so

**Fact 1 — `/my/training` has no status filter.**
`(my)/my/training/page.tsx:16-31`:

```ts
const assignments = await prisma.trainingAssignment.findMany({
  where: { staffMemberId: self.staffMember.id },
  …
  orderBy: { createdAt: "desc" },
})
```

Every assignment, forever. The page then renders a **"Completed"** or **"Certified"** badge
for exactly those rows (`:65-73`) — the UI is not merely tolerating completed modules, it is
*designed* to display them.

**Fact 2 — the module content page has no status filter either.**
`(my)/my/training/[assignmentId]/page.tsx:28-46` resolves on `{ id, staffMemberId }` and
nothing else. A completed module opens in full: every lesson body, every video link, every
resource download link (§3.2's renderer, execute mode).

**Fact 3 — the resource route explicitly grants completed assignments.**
`resources/[id]/download/route.ts:60` matches on
`assignments: { some: { staffMemberId: self.staffMember.id } }` — **any** assignment, no
status predicate. An employee who completed the module in March can still 307 its PDFs in
December.

### 4.3 What is actually true today

**A completed module leaves one card on the home screen and remains fully reachable, with its
files, from two other routes the employee can navigate to directly.**

The one mitigation, and it is real but thin: `/my/training` was **removed from the staff
portal's bottom tab bar** by STAFF-1/F7. `my-shell.tsx:12-14` says so —

> "Training dropped from the bar (F7) — the Home compliance card carries direct links and
> `/my/training/*` routes stay live."

So after completion there is no *navigational* path to the module from within the portal
chrome: the home card no longer links it and the tab bar never did. Reaching it requires
typing `/my/training`, or a browser history entry, or a bookmark. **That is obscurity, not a
gate** — and the route comment says "stay live" in as many words.

**Therefore item 2's behavior is written, its cause is a to-do filter, and the property Gary
wants preserved — completed training not reachable from a personal after-hours session — does
not currently hold.** Preserving what exists preserves the appearance. Ruling packet R-m.

**Why this matters more than a normal finding:** the session prompt says a behavior nobody
wrote on purpose is not yet a guarantee. This is the adjacent case and it is worse — a
behavior that *was* written on purpose, for a different purpose, which is now being read as a
security property it was never asked to provide. Nobody would ever look at line 72 of a home
page and think "this is our trade-secret control", which is exactly why it should not be one.

---

## 5. The assignment write paths

### 5.1 Single assign — `POST /api/hr/training/assignments`

- **Guard:** `requireHrTrainingManageAccess()` at `:18`. **STORE → 403 at `access.ts:65`.**
- **Target scope:** `findManageableStaffMember` at `:27` → 404 on miss.
- **Terminated:** 409 at `:29-31`.
- **Module filter** (`:35-38`): org-scoped, `isArchived: false` only. Inactive modules
  accepted, applicability ignored — audit findings #2/#3, ruled to **HR-23** (planned) on
  2026-08-11, deliberately not absorbed by HR-22.
- **Duplicates:** read-then-skip (`:48-53`) plus `skipDuplicates: true` on `createMany`
  (HR-22's retrofit, comment at `:64-70`).

### 5.2 Bulk assign — `POST /api/hr/training/assignments/bulk`

- **Guard:** `requireHrTrainingManageAccess()` at `:46`. **STORE → 403, same line.**
- Store ids validated against org ownership **and** caller scope (`:73-81`); staff ids
  likewise (`:95-102`); expansion honours `isAdmin` (`:132-134`, `:152`).
- Companion `GET .../bulk/recipients` uses the **same guard** at `:15`, with a comment saying
  so — "so what the picker offers is what the write will accept".

### 5.3 The concrete enforcement point for item 5

**One line: `src/app/api/hr/training/access.ts:65.**

```ts
if (role !== "ADMIN" && role !== "MANAGER") {
  return fail("Manager or Admin access required", 403)
}
```

Every assignment write in the module — single, bulk, and the recipients picker that feeds it —
passes through that test. Item 5 is not an abstraction about capabilities; it is a question
about whether a third role name belongs in that condition, and if so, under what per-login
control. **That guard also backs eight capture/certify routes**, which is why widening it in
place is the wrong shape (§3.3(a), R-i).

---

## 6. HR-18's boundary — where "witnesses" ends and "assigns" begins

HR-18 (`planned`, prompt at `docs/prompts/HR-18_supervised_training_completion.md`, `8fb86bb`)
plans a third capture path: an elevated user (ADMIN, MANAGER **or STORE**) on a shared device
opens a proctored session from the staff profile's Training tab and hands the device over
(prompt `:30-34`). Its row states the framing in capitals: "**A THIRD CAPTURE PATH, NOT A
PERMISSION WIDENING**" (ROADMAP HR-18 `:3124`).

**The seam, stated plainly:**

- **HR-18 gives STORE a role in a completion that already exists.** The obligation was created
  by someone else; STORE's contribution is presence and attestation of presence. The record it
  produces is evidentiary — the prompt's own legal argument (`:36-38`): attested says "I
  confirm this person was trained", supervised says "this person did the work; I watched".
- **Item 5 would give STORE the power to create obligations.** A new `TrainingAssignment` row
  is a compliance denominator entry (HR-8: every assignment counts from creation) that moves
  the member's percentage, their store's rollup, and the org headline. HR-22's disclosure line
  exists precisely because that effect is immediate and surprising.

**They do not collide today and the reason is structural: HR-18 has not been built, and
STORE cannot reach `/staff/[id]` — the surface HR-18 plans to hang its affordance on.**
`staff.view` is `MANAGE` (`permissions.ts:166`), and the HR-derived tabs on that page sit
behind `canSeeHrTabs = dbUser?.role === "ADMIN" || dbUser?.role === "MANAGER"`
(`staff/[id]/page.tsx:107`) — the PERM-5C boundary comment at `:102-106`. HR-18's own prompt
asks the question directly (`:55-58`): "**Does the STORE role currently have access to
`/staff` at all?** … If STORE cannot reach a Staff profile today, tell me what it would take —
and whether that is in scope or a separate phase. **Do not silently grant it.**"

**The answer, for HR-18's benefit as well as this session's: no. STORE reaches neither
`/staff` nor `/staff/[id]`, and both HR-18 and item 5 depend on a surface that does not exist
for STORE yet.**

**Two collision risks to name now, both cheap to avoid and expensive to discover later:**

1. **Whoever opens `/staff/[id]` to STORE opens it for both features at once.** If HR-18 ships
   first and grants STORE the staff profile for proctoring, item 5's assign affordance lands
   on a page STORE already holds — and the *next* session's diff would show only a button.
   The permission decision would already have been made, invisibly, by the earlier phase.
2. **HR-18's §3 "session containment" is a first-class requirement of that prompt** — handing
   a logged-in elevated session to a trainee exposes whatever the session can reach. Every
   capability item 5 adds to STORE becomes something a *trainee* holds for the duration of a
   proctored session. **An assign capability on a device that is deliberately handed to
   employees is the sharpest version of item 5's blast radius**, and it is a fact HR-18 will
   have to price whether or not item 5 ships.

**Recommendation to the phase split, not a ruling: sequence the read path (items 1/3/4) ahead
of both, since it touches neither `/staff/[id]` nor the assignment guard.**

---

## 7. The override layer — restrict-only in code, not just in copy

The prompt asks whether the `/users` copy is stricter than the implementation. **It is the
other way round: the implementation is stricter than the copy, in two independent places, and
the second one is the decisive one.**

**The copy** (`(app)/users/user-actions.tsx:355-356`), verbatim:

> "Turn things off for this person only. You can restrict below what their role allows, never
> above it — to give more access, change the role."

**Enforcement 1 — the seam in `can()`** (`permissions.ts:309-320`). The comment at `:296-308`
describes the structure as deliberate, and the code matches it:

```ts
export function can(user: PermissionUser, capability: Capability): boolean {
  // ── Ceiling. Every return below this line is false. ──
  if (!isPermissionRole(user.role)) return false
  const granted = GRANTS[capability]
  if (!granted) return false
  if (!granted.includes(user.role)) return false
  // ── The role allows it. From here an override may only SUBTRACT. ──
  const override = user.overrides
  if (!override) return true                       // absent → pure role baseline
  if (!override.loaded) return false               // fail closed
  return !override.denied.has(capability)
}
```

The only `return true` sits after the ceiling; the override block contains no `true` literal.
Adding a grant path means adding a `return true` above the ceiling — "a visible, reviewable
act rather than an accident" (`:306-308`).

**Enforcement 2 — the write path, and this is the one that makes item 5 unrepresentable.**
`PATCH /api/users/[id]`, `:104`:

```ts
nextDenied = registered.filter((c) => can({ role }, c))
```

Submitted capabilities are filtered against the role the request **will produce**, before
storage. Entries the role does not grant are dropped rather than stored (the comment at
`:78-86` explains why: a stored no-op denial becomes "a landmine tomorrow" on promotion).
`DENIABLE` (`ENFORCED_CAPABILITIES`) is enforced separately at `:97-103` with a 400.

**The column is `User.deniedCapabilities: String[]`.** There is no `grantedCapabilities`, no
sign, no direction field. A row saying "this STORE login may assign training" has **nowhere to
be written**. This is why R-i cannot be answered with "loosen the check": the check is
downstream of a data structure that cannot carry the fact.

**Two further facts that bound R-i's options:**

- **`hr.training.author` (`ADMIN_ONLY`) and `hr.training.manage` (`MANAGE`) exist in the
  registry** (`permissions.ts:258-259`) **and enforce nothing.** No training route calls
  `can()` (§1.3 — 25 sites, two inline guards, zero). Neither appears in
  `ENFORCED_CAPABILITIES` (`:399-547`), so neither is deniable from the `/users` grid either.
  They are registry entries awaiting HR-19.
- **The grid's own founding rule bears directly on any option that adds a toggle.**
  `permissions.ts:353-357`: "A toggle that does nothing is WORSE than no toggle — an admin who
  flips it believes they restricted someone, and nobody finds out otherwise until it matters."
  Any option that puts a training row in that grid must first make a training route ask
  `can()` — which is HR-19's migration, arriving early and partially.

---

## 8. Out-of-scope findings — triage

Nothing was fixed this session. FIX NOW records intent only; this session made no edits.

**Counts: FIX NOW 0 · RULING NOW 3 · COMMENT NOT A ROW 3 · ROW 2.**

| # | Finding | Evidence | Triage |
|---|---|---|---|
| 1 | `/hr` looks the user up by `clerkUserId` alone — the DEBT-55 pattern | `(app)/hr/page.tsx:21`; CLAUDE.md § Page Conventions | **COMMENT NOT A ROW** — already homed on DEBT-55, which Gary ruled 2026-08-06 (R1) to leave latent. Recorded so the count is right, not to re-open it. Every gate behind this page refuses independently (§1.1). |
| 2 | `/hr` renders a Staff Directory card to STORE that bounces — `/staff` needs `staff.view` (`MANAGE`) | `(app)/hr/page.tsx:58-70` vs `permissions.ts:166`; §2.4 | **ROW (S)** — a live STORE-visible defect. Note for the filer: whichever phase adds a STORE-visible Training card edits this exact grid, so it can absorb the fix; file it anyway so it does not depend on that phase happening. |
| 3 | Training resource downloads authorize inline and ask no policy function, unlike every other HR file class | `resources/[id]/download/route.ts:18-69` vs `hr-files.ts:243-268`, `:270-288`; §3.3 | **RULING NOW (R-j)** — the mechanism question is R-j's whole subject; filing it separately would decide it by omission. |
| 4 | `/my/training` + `/my/training/[assignmentId]` have no status filter — completed modules render in full with resource links | `(my)/my/training/page.tsx:17`, `[assignmentId]/page.tsx:29`; §4.2 | **RULING NOW (R-m)** — this IS the item-2 packet. |
| 5 | The self tier of the resource route matches any assignment regardless of status — completed-module files stay downloadable indefinitely | `resources/[id]/download/route.ts:60`; §4.2 fact 3 | **RULING NOW (R-m)** — same packet; separating it would let the page be fixed while the route stays open, which is the failure mode the packet exists to prevent. |
| 6 | The resource-link block in `TrainingModuleView` is not conditioned on mode, so any future viewing tier inherits download links by default | `training-module-view.tsx:150-164`; §3.3 | **COMMENT NOT A ROW** — correct today (both existing tiers may download). It is a latent trap for the next tier added, and R-g's option (c) is where it gets decided. Recorded so that session finds it. |
| 7 | `hr.training.author` / `hr.training.manage` are registered but enforce nothing and are not deniable | `permissions.ts:258-259` vs §1.3, `:399-547` | **COMMENT NOT A ROW** — HR-19's surface by definition; PERM-5C left it deliberately (`staff/[id]/page.tsx:102-106`). Named here because R-i's options touch it. |
| 8 | `/my/training` is unreachable from the staff portal's tab bar but its routes stay live — obscurity currently doing a job that reads like a gate | `my-shell.tsx:12-20`; §4.3 | **ROW (S)** — not a defect today (F7 removed it deliberately for tab-bar economy), but §4 shows it is now load-bearing for a property nobody assigned it. Worth a row so the next person to restore that tab knows what else it would restore. Subsumed if R-m rules the guarantee in. |

---

## 9. Ruling packets — R-g through R-m. Evidence and prices. NOTHING DECIDED HERE.

Seven, not six: **R-m is new**, per the session's rider on §5.

### 9.1 R-g — STORE read access shape

**Facts.** HR-17's preview is a working read-only renderer with an ADMIN|MANAGER gate
(`preview/page.tsx:31`) and a store-applicability filter already written for the non-admin
case (`:39-41`). Read-only is structural for **writes** (no `assignmentId` → no write target)
and the answer key is stripped for both modes (`training-module-view.tsx:36`). It is **not**
read-only for **files**: the resource block renders unconditionally (`:150-164`), and the
route behind it would 404 for STORE (§3.3).

**Options.**

- **(i) Reuse the preview, admit STORE at `:31`.** One line for the page. Reuses the
  applicability filter verbatim, which is also R-h's mechanism. **Does not work alone** — see
  the dead-links analysis (§3.3). Must be paired with one of the download decisions below.
- **(ii) A distinct STORE read view.** A second component or a third mode. Cost: a second
  renderer is the thing HR-17 explicitly avoided ("no second renderer", HR-17 row), and
  divergence between what STORE sees and what a trainee sees is exactly the drift that rule
  was written against. **The audit found no capability (ii) has that (i)+(c) lacks.**
- **Attachments — the three sub-options, priced in §3.3:** (a) widen tier 1 — rejected on
  sight, it carries eleven routes including certify; (b) a third tier in the download route —
  contained, but gives STORE *more* file reach than an EMPLOYEE has, since tier 2 requires an
  assignment; (c) suppress links for STORE — holds item 2's line absolutely, and may deliver
  an empty page if the procedures live in PDFs.

**The unknown that decides it, and it is Gary's to answer, not a query's:** is the
water-heater procedure lesson *body* content, or an attached PDF? If body content, (c) costs
nothing and is strictly safest. If PDF, (c) guts item 3 and the choice is (b) with its
wider-than-EMPLOYEE consequence stated on the row.

### 9.2 R-h — Scope of what STORE sees

**Facts.** The `appliesTo` mechanism is live and battle-tested on three surfaces: the preview
page's non-admin clause (`preview/page.tsx:41`), the `/staff/[id]` assignable-module filter
(`staff/[id]/page.tsx:394-399`), and HR-22's bulk applicability enforcement. A STORE device
login is exactly one store by construction — `isDeviceLogin` is "role STORE with exactly one
store" (`device-login.ts:67`) — so a store filter for STORE is unambiguous in a way it is not
for a multi-store MANAGER.

**Options.**

- **(i) Every module in the org.** Simplest; matches `/hr/documents`, which applies no
  store filter to the Reference library at all (`hr/documents/page.tsx:21-25`). Cost: a
  store-specific procedure for Store A is visible on Store B's iPad — clutter, and the thin
  end of R-j if any module is sensitive.
- **(ii) Applicable modules only** (`appliesTo: "all"` OR store overlap). Reuses an existing,
  correct clause; a water-heater procedure scoped to its store appears only there. Cost:
  modules default to `appliesTo: "all"` (`schema.prisma:1908`, TrainingModule), so **the
  filter changes nothing until someone scopes modules** — it is a mechanism whose value
  depends on data discipline that is not in evidence.
- **(iii) (ii) plus a visible "applies to N stores" indicator**, so an ADMIN can see why a
  module is or is not on a given iPad. Cost: small UI, on the surface the read phase is
  building anyway.

**Note for whichever is chosen:** (ii) and (iii) make module applicability load-bearing for
*visibility* for the first time. Today it governs *assignability*. That is a semantic
promotion of an existing field and should be named on the row, because the next person to set
`appliesTo` will not expect it to hide content.

### 9.3 R-i — Item 5's mechanism (the override-direction problem)

**Facts, all established in §7.** The override column is `deniedCapabilities: String[]` — a
deny list with no direction. `can()`'s ceiling precedes its only `true`. `PATCH
/api/users/[id]:104` drops any submitted capability the role does not grant, so a grant cannot
even be *stored*. PERM-5's row records restrict-only as "a RECORDED RULING, not just an
implementation note" (ROADMAP PERM-5 `:4126-4133`), with `DECISIONS.md` 2026-07-27 behind it,
and it names this exact situation in advance: "**If a future session finds itself asking
PERM-5 to grant something a role does not already have, the answer is a different role, not a
wider override.**" Item 5 is that session. Assignment enforcement is one line
(`access.ts:65`) backing eleven routes.

**Options, priced.**

- **(A) Grant-direction override** — add `grantedCapabilities`, or a signed entry, and a
  grant path in `can()`.
  **Blast radius: the whole permission model.** It requires a `return true` above the ceiling
  — the precise act `permissions.ts:296-308` was structured to make visible — and it
  overturns a ruling recorded in `DECISIONS.md` and restated on PERM-5's row. Every future
  reader of `can()` loses the one-line guarantee that overrides only subtract. **Price: highest
  of the five, and it is paid by every capability, not just this one.**
- **(B) Assignment becomes a STORE baseline, restricted by default via denials.**
  Mechanically expressible today: add STORE to the assignment tier, add a capability to
  `ENFORCED_CAPABILITIES`, deny it per-login.
  **Blast radius, stated concretely because the prompt asks for it: every STORE login in the
  fleet holds the capability from the moment of deploy until someone removes it, one login at
  a time.** With 11 stores that is 11 shared iPads that can create compliance obligations by
  default, and the failure is silent — nothing errors, rows just appear. Worse, two
  preconditions bite: the assignment routes do not call `can()` at all (§1.3), so a grid
  toggle would be the "toggle that does nothing" the grid's own rule forbids
  (`permissions.ts:353-357`) until HR-19 migrates the seam; and widening `access.ts:65`
  carries the other eight capture/certify routes with it unless a separate guard is split out
  first. **Price: a partial HR-19 plus a fleet-wide default-on window.**
- **(C) A per-login flag outside the capability layer** — e.g. a boolean on `User` consulted
  by a new `requireHrTrainingAssignAccess`.
  Additive, default-off, no baseline moves, PERM-5 untouched. **Price: a second permission
  mechanism.** The codebase spent PERM-1 through PERM-5C consolidating scattered checks into
  one registry; this re-scatters, and HR-19 inherits a bespoke flag alongside 35 routes.
  Cheapest to build, most expensive to have built.
- **(D) A different role — provision the device as MANAGER.** The answer PERM-5's row already
  gives. MANAGER holds assignment today, store-scoped, with `findManageableStaffMember`
  enforcing the target check, and `DEVICE_ROLE_OPTIONS` already **recommends MANAGER for
  device accounts** (`device-login.ts:38-41`): "Everything the store device can do, plus reports
  and forecasting — still limited to this location." **Price: it is not a subset.** MANAGER
  also grants `reports.view`, `forecasting.view` (windowed), `staff.view`, `staff.manage`,
  `hr.compliance.view`, `hr.records.view`, `inventory.costs.view` — financial and personal
  data, on a shared iPad, contradicting the STORE promise in `device-login.ts:36`. **Denials
  could subtract those back down** — that is restrict-only working as designed, and it is the
  PERM-7 motivating case verbatim (PERM-5 row `:4134-4140`). But it inverts the default: the
  device is over-privileged until an admin dials it down, per store, and a forgotten store is
  a MANAGER iPad on the floor.
- **(E) Do not express item 5 at all** — the assign action stays ADMIN/MANAGER; the STORE read
  path (items 1/3/4) ships alone.
  **Price: zero, and it is the only option with that price.** Cost: Gary does not get the
  thing he asked for in item 5. Recorded as an option because the read path is genuinely
  separable (R-l) and because four of the five alternatives cost more than the feature might
  be worth.

**The audit recommends nothing.** One observation offered as information rather than
advocacy: **(B) and (D) are the same trade in opposite directions** — (B) starts from STORE
and adds one thing too many across the fleet; (D) starts from MANAGER and subtracts several
things, per device, using a mechanism built for exactly that. Neither is clean, and the
cleanliness of (E) is the reason it belongs on the list.

### 9.4 R-j — Content classification

**Facts.** `TrainingCategory` exists (HR-20, migration
`20260810194426_hr20_training_category_entity`) with `colorKey` and `sortOrder`, and is
**purely a label today** — nothing filters or branches on it for access. `appliesTo` /
`TrainingModuleStoreAssignment` is a *scoping* taxonomy, and the 2026-08-10 audit §1.4 warns
explicitly against confusing the two. Meanwhile HR **already has** a content-classification
mechanism with teeth: `canReadHrDocument` keyed on `HrDocument.kind`, four kinds, three tiers,
each with a comment saying why (`hr-files.ts:243-268`), plus `canReadHrSignedRecord` as the
strict tier (`:270-288`). Training resources ask neither (§3.3, triage #3). HR-20's production
evidence, recorded on that row: 12 of 12 Keva production modules are **uncategorized** —
`subject` held subtitles, not categories, so the backfill was removed and every module starts
with no category.

**Options.**

- **(i) No distinction — STORE gets everything.** Matches `/hr/documents`'s Reference tier.
  Cheapest; correct if every module is operational. **Unverifiable from code** — see the stop
  below.
- **(ii) Carry it on `TrainingCategory`.** Attractive because the entity is new and shaped for
  it. Cost: promotes a **cosmetic label into a permission input**, and 12 of 12 production
  modules are uncategorized — so on day one the rule would either expose everything
  (uncategorized = visible) or hide everything (uncategorized = hidden), and both are wrong.
  Requires a hand-categorization pass **before** the read path can ship safely. HR-21 shipped
  the Uncategorized chip precisely as "the working queue for hand-categorizing the backlog"
  (HR-21 row) — the tool exists; the pass has not been run.
- **(iii) A per-module boolean** (`isConfidential` / `storeVisible`). Additive, explicit,
  DEBT-59-clean if it has an honest default. Cost: a new column and a form control; and the
  default **is** the ruling — `false` means opt-in and the feature is empty until someone
  works the backlog, `true` means opt-out and every existing module is exposed on deploy.
- **(iv) Reuse store applicability** (R-h(ii)) as the only filter. No new concept. Cost:
  conflates "which store needs this" with "who may read this" — two questions that agree today
  and will not always.
- **(v) A `canReadTrainingModule` / `canReadTrainingResource` policy function**, following
  `canReadHrDocument`. Orthogonal to (i)-(iv): whichever *input* is chosen, this is where it
  should be *asked*. It also closes triage #3 and gives R-g's option (c) a natural home.

**A STOP, per the ground rules.** Deciding between (i) and (ii)/(iii) requires knowing what is
in the library — how many modules exist per org, and whether any are personal or commercial
rather than operational. **This audit will not query for it.** If Gary wants the measurement
before ruling, §10 carries the query, formatted for the Neon console with the branch id
selected inside it.

### 9.5 R-k — R-c's status: reaffirmed, amended, or superseded

**What R-c said** (HR-20 row `:3298-3299`): "STORE: no. `/hr/training` stays ADMIN-only;
reversible-by-row on demonstrated need. (Session-recommended, ratified by Gary 2026-08-10.)"

**What R-c contemplated and what it did not.** The 2026-08-10 audit §10.3 priced three
options: ADMIN-only, ADMIN+MANAGER, and "STORE: no". Read the reasoning for the last one
(§10.3, verbatim): "Nothing in the surface argues otherwise, and HR-18's supervise-vs-assign
distinction argues for keeping it that way." **Both clauses are about STORE as an
*assigner*.** The audit's STORE analysis was conducted entirely in the context of "who can
bulk assign" — that was §10.3's title. **A STORE *read* path was never considered, priced, or
refused.** R-c is not wrong about what it decided; it simply does not reach items 1/3/4.

**What reversing R-c costs — the honest accounting.**

*It costs less than it appears, in four ways:*

1. **The write side needs no change whatsoever.** All 14 authoring routes sit behind
   `requireHrTrainingAccess` (ADMIN, `access.ts:32`), and all 11 assignment/capture routes
   behind `requireHrTrainingManageAccess` (`:65`). A STORE read path does not touch either
   guard. Item 4's "no edit, assign, or delete" is already true and stays true **by default**
   rather than by new code (§1.4).
2. **The architecture is proven in the same module.** `/hr/documents` is read-for-all,
   manage-for-ADMIN, files behind a policy function, shipped since HR-3/HR-4 (§2.3).
3. **The renderer exists** and is deliberately shared (HR-17: "no second renderer").
4. **The scoping clause exists**, in three places (R-h).

*It costs more than it appears, in three ways:*

1. **The `/hr/training` page itself is an authoring tool, and reversing R-c does not make it a
   reading surface.** `training-client.tsx` is the builder list: bulk activate/deactivate/
   archive, Manage Categories, Create/Import/Export, Bulk Assign, Edit/Duplicate per card. A
   STORE read path needs a **different surface** — a card on `/hr` and a list that links to
   previews — not this page with buttons hidden. **Hiding controls on the builder page would
   be the most expensive possible way to deliver items 1/3/4**, and it would put STORE one
   un-hidden button away from an authoring action on every future edit of a 400-line client.
2. **The attachment problem is unavoidable and is not a UI detail** (§3.3, R-g).
3. **It converts `appliesTo` from an assignability filter into a visibility filter** if R-h
   goes that way (R-h's closing note).

**What reversing R-c does NOT cost — stated because the prompt asks:**

- **It does not change MANAGER's position.** MANAGER's exclusion from `/hr/training` rests on
  the same `:18` role test, but a STORE *read* surface built elsewhere leaves that line
  untouched. MANAGER continues to reach assignment through `/staff/[id]` and preview through
  `/hr/training/[id]/preview` (which already admits MANAGER, `:31`). **MANAGER page access
  should stay a separate future row.** Folding it in would re-open R-c's actual subject — who
  can bulk assign, and from which page — inside a session scoped to STORE reading. That is the
  ADMIN+MANAGER option (2026-08-10 §10.3(ii)) and it deserves its own decision.
- **It does not touch HR-19, PERM-5C's boundary comment, or the registry.** Nothing in
  items 1/3/4 requires `can()`.
- **It does not affect compliance arithmetic.** No assignment is created by reading.

**The three postures:**

- **Reaffirm** — R-c stands as ruled; items 1/3/4 are refused. Requires an argument that
  training content is more confidential than the handbook at `/hr/documents`, which the audit
  could not find in code (§2.3).
- **Amend** — R-c's ADMIN-only holds for `/hr/training` *the authoring page* (it is an
  authoring tool; that is what its own comment says), and a **new** STORE-reachable read
  surface is added elsewhere. This is the only posture consistent with every fact in §§1-3,
  and it is the one that leaves MANAGER's question genuinely separate.
- **Supersede** — R-c is replaced wholesale by a new access ruling covering all roles.
  Cleanest paperwork; pulls MANAGER's page access into scope, which the prompt asks to keep
  separable.

### 9.6 R-l — Phase IDs and split

**Numbering.** Training rows are HR- (HR-6, HR-7, HR-17, HR-18, HR-20/21/22, HR-23). R-a
settled it: continue HR-, no second prefix (HR-20 row `:3292`; the labor track's "never a
third numbering" lesson). **Next free id is HR-24.**

**The read path and the capability question are separable, and the evidence says they should
be separated.** They share no file: items 1/3/4 touch `hr/page.tsx`, a new read surface, the
preview gate, and the download route. Item 5 touches `access.ts:65`, the permission model, and
possibly `/staff/[id]`. Different reviewers, different blast radii, different rulings
outstanding.

**Proposed split — three rows, sizes in the board's S/M/L vocabulary:**

- **HR-24 — STORE read access to training modules (M).** Depends on R-g, R-h, R-j, R-k.
  A STORE-reachable Training card on `/hr` (fixing triage #2 in the same grid edit); a read
  surface listing modules per R-h's scope; module read via the HR-17 renderer with the gate
  widened per R-g; the attachment decision implemented per R-g's (b) or (c); a
  `canReadTrainingResource` policy function if R-j goes to (v). **All 25 existing guards
  unchanged.** Ships items 1, 3 and 4 complete.
- **HR-25 — Completed-training reachability (S-M).** Depends on R-m. Only if R-m rules the
  behavior into a guarantee: a status predicate on `/my/training`, the assignment page, and
  the resource route's self tier — the three sites in §4.2, which must move together or the
  fix is cosmetic. **Sequence note: if R-m rules "guarantee", this should ship BEFORE or WITH
  HR-24**, because HR-24 widens who can read module content while the employee-side line is
  still open. Ordering them the other way is defensible only if R-m rules "incidental".
- **HR-26 — STORE assignment capability (M-L, or no row at all).** Depends on R-i. Size and
  shape are entirely R-i's output: option (E) means no row; (D) means a docs/ops change and
  possibly no code; (B) means a partial HR-19 plus a guard split; (A) means a permission-model
  phase that should not be filed under HR- at all. **Do not file this row until R-i is ruled**
  — its size is unknowable beforehand, and a row with an unknowable size is how an L phase
  becomes unbounded (HR-19's row makes the same point).

**Dependency:** HR-24 needs no other row. HR-25 is independent of HR-24 but interacts (see the
sequence note). HR-26 depends on nothing structurally and on R-i entirely.

### 9.7 R-m — The completion-disappears behavior: guarantee or incidental (NEW, per the rider)

**Facts, all in §4.** The behavior is **written**, at `(my)/my/page.tsx:72`, as a to-do filter
on the home card. It is **not** a filter on `/my/training` (`:17` — no status predicate), nor
on `/my/training/[assignmentId]` (`:29` — resolves on id + staff member only), nor on the
resource route's self tier (`download/route.ts:60` — any assignment, any status). The only
additional mitigation is navigational: F7 removed Training from the portal tab bar, and
`my-shell.tsx:14` records that "`/my/training/*` routes stay live". A completed module is
therefore reachable by URL, history or bookmark, with every lesson body and a 307 to every
attached file.

**So Gary's observation is accurate, his endorsement is coherent, and the property he wants
preserved does not currently exist.** Preserving today's behavior preserves a card filter.

**Options.**

- **(i) Accept as incidental.** Record that the disappearance is a to-do-list affordance, not
  an access control, and that completed material stays reachable. Zero code. Cost: the
  trade-secret concern in item 2 is unaddressed, and — worse — is now *documented as
  addressed* unless the row says otherwise plainly.
- **(ii) Make it a guarantee — all three sites.** A status predicate on the `/my/training`
  list, a refusal on the assignment page for completed rows, and a status predicate on the
  self tier of the resource route. **All three or none**: fixing the two pages while
  `download/route.ts:60` still matches any assignment leaves the files reachable by direct
  URL, which is precisely the shape of the current problem one layer down.
  Cost, and it is real: an employee loses the ability to re-read training they completed —
  refreshers, reference during a shift, the food-safety module they want to check. That is a
  genuine operational loss and it argues against (ii) on its merits, not just its price.
- **(iii) Split the difference — content stays, files go.** Completed modules remain readable
  (lesson bodies, quiz results) but attached resources stop resolving once complete. Targets
  item 2's actual concern — *material* walking out — while keeping the refresher use case.
  Cost: one predicate at `download/route.ts:60`, plus a UI decision about whether dead links
  render (triage #6 again).
- **(iv) Time-bound it.** Reachable for N days after completion, then not. Cost: a new
  concept, a new number to defend, and nothing in the codebase does anything like it.

**The audit recommends nothing.** One note, offered because it changes how the options read:
**item 2's stated concern is specifically about material leaving the building after hours,
which is a statement about files, not about lesson text.** Option (iii) is the only one that
tracks that sentence exactly. Options (i) and (ii) both answer a broader question than the one
Gary asked.

---

## 10. Blast-radius SQL — for Gary, per branch, ONLY if R-j needs measuring

**No query was run by this session and none is required to rule R-g, R-h, R-i, R-k, R-l or
R-m.** The single place a measurement would change a ruling is **R-j**: whether the library is
one bucket or two depends on what is in it.

Branch id selected inside the query per CLAUDE.md § Database Evidence. Run on production
first — that is the library that matters — and label the result with the branch name as well
as the id.

**10.1 What the training library actually contains, per org:**

```sql
SELECT current_setting('neon.branch_id', true) AS branch,
       m."organizationId"                      AS org_id,
       c."name"                                AS category,
       m."appliesTo",
       m."isActive",
       m."isArchived",
       COUNT(*)                                AS modules
FROM "TrainingModule" m
LEFT JOIN "TrainingCategory" c ON c."id" = m."categoryId"
GROUP BY 1, 2, 3, 4, 5, 6
ORDER BY 2, 7 DESC;
```

Answers: how many modules a STORE login would see under R-h(i) vs R-h(ii); whether any module
is scoped (`appliesTo = 'selected'`) today or whether all are `'all'`, which decides whether
R-h(ii) is a real filter or a no-op; and how much of the library is categorized, which is
R-j(ii)'s precondition. HR-20's row predicts 12 uncategorized modules in Keva production
(`cf888f2d-…`) — this confirms or refutes that at HEAD.

**10.2 How much of the content is in attachments rather than lesson bodies — R-g's deciding
unknown:**

```sql
SELECT current_setting('neon.branch_id', true)          AS branch,
       m."organizationId"                               AS org_id,
       m."id"                                           AS module_id,
       m."title",
       COUNT(DISTINCT l."id")                           AS lessons,
       COUNT(r."id")                                    AS resources
FROM "TrainingModule" m
LEFT JOIN "TrainingLesson"   l ON l."trainingModuleId" = m."id"
LEFT JOIN "TrainingResource" r ON r."trainingLessonId" = l."id"
GROUP BY 1, 2, 3, 4
ORDER BY 6 DESC;
```

Answers R-g directly: if `resources` is 0 across the library, option (c) — suppress links for
STORE — costs nothing and is strictly safest. If the water-heater-type modules carry PDFs,
(c) delivers an empty page and the choice is (b).

---

## 11. Summary — the session prompt's questions, answered at `ec42265`

| Question | Answer |
|---|---|
| Is the override layer restrict-only in code, or is the copy stricter? | **The code is stricter than the copy.** `can()`'s ceiling precedes its only `return true` (`permissions.ts:309-320`), and `PATCH /api/users/[id]:104` filters submitted denials through `can({ role }, c)` before storing. The column is a deny list with no direction — a grant is unrepresentable, not just unimplemented (§7). |
| Does a training-assignment capability key exist? What grants it? Where enforced? | `hr.training.author` (ADMIN_ONLY) and `hr.training.manage` (MANAGE) exist at `permissions.ts:258-259` and **enforce nothing** — no training route calls `can()`, and neither key is in `ENFORCED_CAPABILITIES`, so neither is deniable. Real enforcement is one inline line: `access.ts:65` (§1.3, §5.3, §7). |
| What would it actually take to express item 5? | Five options priced at R-i: (A) grant-direction override — overturns a recorded ruling and costs every capability; (B) STORE baseline + default-off denials — 11 iPads hold it until dialled down, and needs a partial HR-19 plus a guard split; (C) a bespoke per-login flag — cheapest to build, re-scatters what PERM-1..5C consolidated; (D) provision as MANAGER and subtract — the answer PERM-5's row already gives, but MANAGER is not a superset-minus-one; (E) don't express it — the only zero-cost option. **Nothing recommended.** |
| The page gate today, and the function each behavior must pass | Three gates for item 1 (card `hr/page.tsx:108`, page `training/page.tsx:18`, list API `access.ts:32`); preview `preview/page.tsx:31` for item 3; **item 4's two prohibitions already hold with no work** (§1.4). |
| Is the training library one bucket or two? | Undecided — R-j. HR has a proven mechanism (`canReadHrDocument`, four kinds, three tiers) that training resources uniquely bypass. `TrainingCategory` is a label with no access role and 12 of 12 production modules are uncategorized (§2.3, §9.4). |
| The preview surface — what it renders, omits, and whether resources are reachable | Renders everything a trainee sees minus the answer key; writes are structurally unreachable; **resource links render unconditionally in both modes** (`training-module-view.tsx:150-164`) and 307 to a 5-minute signed blob URL. For STORE today the links would render and 404 (§3). |
| The completion-disappears behavior — located? | **Yes — `(my)/my/page.tsx:72`, a to-do filter on the home card.** Written, not emergent. But `/my/training`, the assignment page, and the resource route's self tier have **no status predicate**, so completed modules and their files stay fully reachable. The property being preserved does not exist (§4, R-m). |
| The assignment write paths and their guards | Single `assignments/route.ts:18`, bulk `bulk/route.ts:46`, recipients `bulk/recipients/route.ts:15` — all three `requireHrTrainingManageAccess`, all three STORE-403 at `access.ts:65` (§5). |
| HR-18's seam | HR-18 = a role in an existing completion (evidentiary); item 5 = the power to create obligations (compliance-moving). They do not collide today because **STORE reaches neither `/staff` nor `/staff/[id]`** — HR-18's own prompt asks this and says "do not silently grant it". Two collision risks named at §6. |
| R-c's status | Not wrong — **out of reach.** §10.3 priced STORE only as an *assigner*; a STORE read path was never considered. Reversal costs no guard change and reuses a shipped architecture; it costs a new surface (not the builder page with buttons hidden), the attachment decision, and possibly a semantic promotion of `appliesTo`. **MANAGER page access should stay a separate row** (§9.5). |
| Phase IDs and split | HR-24 (STORE read, M) · HR-25 (completed-training reachability, S-M, only if R-m rules "guarantee") · HR-26 (STORE assignment — **do not file until R-i is ruled**; size unknowable, may be no row) (§9.6). |

**Not measured here (would need Gary's Neon console):** what the training library contains per
org, and how much of it lives in attachments rather than lesson bodies — §10's two queries.
Only R-j and R-g's option choice depend on them; every other packet is decidable on the code
evidence above.
