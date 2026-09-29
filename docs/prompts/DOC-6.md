# DOC-6 — Key holder register: who has a key right now

**TIER 3.** It involves a schema change (new table + column) and a new write path gated by role. The sequence is:

1. Audit → STOP for rulings.
2. Build to the migration → STOP; Gary applies it to dev.
3. Build the rest → fixture → commit.

Commit only, never push.

Repo: `/Users/garythomas/Claude_Projects/Froot/froot` · Branch: `staging`

## Repo gate

1. On `staging`, tree clean apart from this prompt.
2. `git log --oneline staging..main` is empty (both at `d760714`).
3. Read the DOC-6 row in `docs/ROADMAP.yaml`. Confirm the id matches and read its notes.

## What Gary wants

- A register of **who currently holds a key**: signed the Key Agreement, not yet returned.
- A way to **record a return**.
- At termination, a visible list of anything the person hasn't returned.

Today the Key Agreement is an uploaded **Acknowledgment** document (category "Logs"). Its signed record proves the key was issued; nothing records it coming back.

## Phase 1 — Audit (read-only), then STOP

Write `docs/prompts/DOC-6_AUDIT.md` covering these six items:

1. **The Key Agreement as data:**
   - its `HrDocument` kind, checkpoints, and whether any Field checkpoint captures a **key number or key description** (and so whether the register can show which key);
   - the dev and staging shape, and the production shape only if already known from docs. Don't query deployed databases.
2. **Append-only posture.** Confirm `HrSignedRecord` has no update path and must stay that way (HR-4: "Append-only: no update/delete path exists"). A return therefore **cannot be a column on the signed record**; it must be a separate event row.
3. **The existing Check-Out/Check-In form pairing** (FillableForm `linkedFormId`, grouped on `/staff/[id]`). Report what it does today, whether Keva uses it on any branch, and whether it could serve as the return mechanism instead. This is fork F1.
4. **Holding semantics against existing rules:**
   - signing cycles (HR-15: does a rehire's prior-cycle record mean they still hold a key?);
   - versions (R2: does a v1 signer hold a key if the current version is v3?);
   - archived Key Agreement documents;
   - terminated staff.
5. **The termination flow:** the file and line where a staff member is terminated, and what it shows today. This is where the unreturned-items warning would go.
6. **Scope and guards:** the existing ADMIN / in-scope MANAGER helpers used by `/hr/compliance` and HR-7 rule 5. Name the helper that would gate "Mark returned".

Then STOP and present the forks below with evidence.

### Forks (Gary's leans pre-filled)

- **F1 Mechanism.** (A) A new append-only return-event table against the signed Key Agreement, or (B) convert keys to the Check-Out/Check-In form pair. **Lean: A.** The Key Agreement is already uploaded, assigned and signed as an Acknowledgment, and the compliance view counts it. (B) would move keys out of compliance (forms are outside the %, per HR-8 b).
- **F2 Which documents track returns.** An additive `HrDocument.tracksReturn Boolean @default(false)` set on the document's edit dialog, with an optional `returnItemLabel String?` (e.g. "Key"). The alternative is keying off the "Logs" category, which breaks the moment a category is renamed (DOC-5). **Lean: the boolean + label.** It also generalizes to equipment and uniforms later.
- **F3 Event model.** A new `HrReturnEvent` table:
  - fields: `id`, `organizationId`, `hrDocumentId`, `staffMemberId`, `type` (`Returned` | `Reissued`), `occurredOn` (date), `note?`, `recordedByUserId`, `createdAt`;
  - append-only, with no update or delete route. A mistake is corrected by appending the opposite event;
  - Restrict FKs, annotated.
  - **Holding** = the person has a signed record on any version of a `tracksReturn` document **and** their latest event for that document is not `Returned`.

  **Lean: yes.**
- **F4 Cycles and versions.** Holding is judged **per person per document, across all versions and cycles**. A key physically issued is held until returned, whatever re-signing happened since. **Lean: yes.** Ask Gary to confirm this exact sentence, because it deliberately differs from compliance's per-cycle rule.
- **F5 Who records.** ADMIN, plus MANAGER for staff in their stores. STAFF and STORE can't. **Lean: yes.**
- **F6 Where it shows:**
  - a **Key Register** section on `/hr/compliance`, below By Document: each `tracksReturn` document gets "N holding", and a list of holders by store with signed date, key number if captured (audit item 1), and a Mark returned button;
  - on `/staff/[id]`, the holdings with the same button;
  - in the terminate flow, a **non-blocking** warning listing unreturned items.

  **Lean: yes. Warn, don't block.** A manager may terminate someone who never returned a key and needs the record to say so.
- **F7 Terminated holders.** They stay in the register, flagged "Terminated — not returned", because that's the case that matters most. **Lean: yes.** This deliberately differs from compliance's active-only rule.

## Phase 2 — Build (after rulings)

1. Schema per the ruled forks: generate the migration with `prisma migrate diff --from-config-datasource`. **The only prisma commands allowed are `format` / `validate` / `generate` / `migrate diff`.** Then **STOP** and report the migration file. Gary runs `npx prisma migrate deploy` on dev and says go.
2. After Gary's go, build the rest:
   - `src/lib/hr-returns.ts` with **one** holding predicate, used by every surface;
   - POST route(s) for Returned / Reissued, guarded per F5, validating that the person has a signed record on that document;
   - the edit-dialog toggle and label (ADMIN, like other document config);
   - the F6 surfaces;
   - a guide section in `docs/guide/hr-compliance.md`.
3. Fixture `scripts/verify-doc6-key-register.ts` on dev, using a throwaway org, removed and re-queried afterward. Expected values come from the rulings. It asserts:
   - signed but not returned → holding;
   - returned → not holding;
   - returned then reissued → holding;
   - v1 signer while current is v3 → holding (F4);
   - rehire prior-cycle record, not returned → holding (F4);
   - a terminated holder appears and is flagged (F7);
   - a non-`tracksReturn` document never appears;
   - a return by a MANAGER outside their scope → 403, and a STAFF or STORE caller → 403;
   - there is no update or delete route (checked by reading the source; say so).
4. Run `npm run build` **after the final commit**. Make two commits: work, then docs (ROADMAP row `in_progress`, DECISIONS draft of the rulings, MIGRATIONS entry, this prompt and the audit). Stage only the files you touched.
5. No temporary public preview pages.

## Out of scope

- Due dates (DOC-8), reminders (NOTIFY-3) and export (DOC-9).
- Converting existing forms.
- Any change to compliance math. A key being held is not a compliance gap.

Classify findings FIX NOW / RULING NOW / COMMENT / ROW.

## Staging test plan (for the report)

As `indianathomas`:
1. Turn on "Tracks return" (label "Key") for a test document signed by 1–2 people. The Key Register shows them holding.
2. Mark one returned with a date. They leave the list, and the event shows on their `/staff/[id]`.
3. Reissue them. They're back.
4. Start terminating a holder and confirm the warning lists the key, then cancel.
5. As Tommy (STORE), POST a return to the route: `403`.
