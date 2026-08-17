# HR-11n — ceremony-route audit

**Session:** 2026-08-15, read-only. Audited against local `staging` @ `68c5a2d`.
No file was edited, no command was run against any database, and no browser
observation was taken to produce this document. Every finding is from source at
that SHA plus the git and Vercel metadata named below.

**Occasioned by** a post-fix verification pass on staging (deployment built from
`68c5a2d`, org `org_3G02wO4QlVVSWppi8aqlnSZnsDa`, Clerk instance
`verified-snapper-7`, database branch `br-square-feather-a63z92vz` / `neondb`)
in which two signers of the same document, same version 4, produced certificates
listing different numbers of checkpoints:

- **Tommy Thomas**, completed `2026-08-16 01:25:58 UTC` — certificate lists 7
  checkpoints. Expected.
- **Gdogg Thomas**, completed `2026-08-15 20:05:58 UTC` — certificate lists 11,
  including all four retired Signature checkpoints, acknowledged
  `20:05:30`–`20:05:51 UTC`.

The four checkpoints were, and still are, retired: the admin list showed
`Retired (4)` throughout. The question put to this audit was whether some
ceremony route was presenting retired checkpoints, or whether the HR-11n
entry-drop was failing.

This file is a session artifact (CLAUDE.md § Where documents live). It is a
claim wholesale and is never edited after the fact.

---

## 0. THE FINDING, FIRST

**Neither. The drop was not bypassed and it is not broken. There was no
submission.**

Gdogg's four acknowledgments were written at **13:05 PDT**, which is
**2 hours 18 minutes before retirement existed in code** (`72df99a`, committed
15:24:01 PDT) and **5 hours 54 minutes before** the deployment they were
attributed to. No code path could have dropped them: there was no code to do the
dropping, and no request to drop.

His certificate lists 11 checkpoints because 11 were live at 13:05 PDT when it
was minted. `ensureSignedRecord` returns an existing record and never
regenerates (`src/lib/hr-signed-pdf.ts:270`). That is the forward-only rule
behaving exactly as ruled: *"Certificates already issued don't change and don't
get reissued. What a certificate says is what the ceremony was on the day that
person signed."*

**HR-11n does not reopen.**

### 0.1 The comparison required a timezone conversion

`HrDocumentAcknowledgment.signedAt` is `TIMESTAMP(3)` with **no time zone**
(`prisma/migrations/20260712120000_hr0_hr_training_compliance_schema/migration.sql:86`);
there is no `@db.Timestamptz` anywhere in `prisma/schema.prisma`, so Prisma
stores **UTC**. Vercel deployment times and git commit times are **local (PDT)**.
Compared without conversion, Gdogg's `20:05` acknowledgments read as an hour
*after* an 18:59 deployment. Converted, they are **five hours and fifty-four
minutes before it**.

The rule this produced now lives in CLAUDE.md § Database Evidence.

### 0.2 The rows were already in hand, twice over

They are the same rows returned by the HR-11n Phase A baseline query, run
**before** Phase A was committed. That query's `last_signed` column returned
`20:05:30.314`, `20:05:33.314`, `20:05:35.023`, `20:05:49.372`, `20:05:49.931`,
`20:05:51.63` — precisely the `20:05:30`–`20:05:51` range reported as new.

And the certificate itself is recorded verbatim in the **HR-11m row**, committed
at 13:33:22 PDT: *"Gdogg's v4 signed record stamped 10 field marks and the
certificate lists 11 checkpoints, 6 Signature."* Same document, same signer, same
11 checkpoints, same 10 marks. The artifact under investigation was described in
the repository twenty-eight minutes after it was created, five hours before the
deployment it was blamed on.

### 0.3 The 10-mark diagnostic pointed the right way for the wrong reason

The verification pass reasoned: the certificate says *"Stamped - 10 field marks
applied to the document body"* while listing 11 checkpoints, and 10 is the
correct mark count, so the `ackByCheckpoint` filter worked and the break must be
upstream.

The conclusion — that the break is upstream of `hr-signed-pdf.ts` — is right. The
premise is not: **that filter did not run at all.** It did not exist when the
certificate was generated. Ten marks is simply the count of confirmed anchors on
v4, and the stamping loop iterates anchors, not checkpoints. A correct reading
reached through an argument that does not hold is worth recording, because it
would have survived any amount of further checking of the certificate module.

---

## 1. THE EVIDENCE TABLE

All times **PDT (local)**. UTC values from the database are converted and the
conversion is stated. Commit times from `git log --date=format`; deployment time
as reported by the Vercel dashboard.

| Local (PDT) | Event | Source |
|---|---|---|
| **13:05:30 – 13:05:58** | **Gdogg's four acknowledgments written; his v4 signed record minted** | `= 20:05:30 – 20:05:58 UTC`, `signedAt` / `completedAt` |
| 13:33:22 | `7ee53f5` — HR-11m row committed, recording Gdogg's certificate as 11 checkpoints / 10 marks | git |
| 14:17:15 | `0e49bdb` — ROADMAP lead paragraphs | git |
| **15:24:01** | **`72df99a` — HR-11n Phase A. Retirement did not exist in code before this commit.** | git |
| 15:25:40 | `26aa21d` — Phase A recorder, with the ratified ruling | git |
| **18:25:58** | **Tommy's v4 signed record minted** | `= 2026-08-16 01:25:58 UTC` |
| 18:54:33 | `7456565` — HR-11o display fixes | git |
| 18:55:52 | `68c5a2d` — HR-11o recorder | git |
| 18:59:39 | `68c5a2d` deployed to staging | Vercel |

**Read the two signers off this table:**

- **Gdogg** signed at 13:05, when 11 checkpoints were live and retirement did not
  exist. 11 is correct for that moment and is frozen.
- **Tommy** signed at 18:25:58 — after `26aa21d` (Phase A filters) and **34
  minutes before `68c5a2d` deployed**. He got 7 because Phase A's filters were
  live. Correct, and it validates **Phase A**.

---

## 2. ITEM 1 & 2 — EVERY ROUTE THAT CAN PRESENT THE CEREMONY

Swept by searching the **component names**, not the guard, per CLAUDE.md
§ Verifying a guard covers every path — a route missing a filter has nothing to
match on, and searching for the filter produces a false PASS.

**Exactly two files render a ceremony client. Both filter.**

| # | Renderer | Load | Filtered |
|---|---|---|---|
| 1 | `src/app/(app)/hr/acknowledge/[documentId]/page.tsx:45` | `checkpoints: { where: { retiredAt: null }, orderBy: { orderIndex: "asc" } }` | YES |
| 2 | `src/app/(my)/my/documents/[documentId]/page.tsx:33` | identical | YES |

Both verified present at `68c5a2d` by `git show HEAD:<path>`, not merely in the
working tree.

**`SigningClient` has exactly two importers** — its own file's page (1) and the
staff portal (2, across the `(app)`/`(my)` route-group boundary).
`AcknowledgeClient` has one, the attested branch of (1). **No third route
exists.** Route (1) serves two MODES (self and manager-attested), which is the
distinction HR-11j's stale comment collapsed; they are one file and one query.

Neither client holds a query. Both derive their entire step list from the
`checkpoints` prop (`signing-client.tsx:135,147,152–154`;
`acknowledge-client.tsx:83`), so filtering at the two pages covers all three
entry points.

**All eleven `checkpoints:` loads in `src/` are accounted for.** The nine-site
list from the Phase A audit was complete; nothing was missed.

| Load | Purpose | Filtered |
|---|---|---|
| `hr/acknowledge/[documentId]/page.tsx:45` | ceremony | YES |
| `(my)/my/documents/[documentId]/page.tsx:33` | ceremony | YES |
| `(app)/staff/[id]/page.tsx:185` | denominator | YES (`required` + `retiredAt`) |
| `(my)/my/documents/data.ts:53` | denominator | YES |
| `lib/hr-compliance.ts:240` | denominator | YES |
| `api/hr/documents/[id]/acknowledgments/route.ts:74` | capture | unfiltered BY DESIGN — see § 4 |
| `lib/hr-signed-pdf.ts:281` | certificate | filtered at `ackByCheckpoint`, not the load — see § 4.1 |
| `(app)/hr/documents/[id]/page.tsx:30` | admin list | unfiltered BY DESIGN — the admin must see retired rows |
| `(app)/hr/documents/[id]/page.tsx:90` | admin map | as above |
| `api/hr/documents/route.ts:114` | upload-time create | a write, not a read |

---

## 3. ITEM 3 — WHAT HAPPENS FROM `/staff/[id]`

`src/app/(app)/staff/[id]/staff-documents.tsx:141` renders:

```
/hr/acknowledge/${row.documentId}?staff=${staffId}
```

That is the **manager-attested mode of renderer (1)** — the same file, the same
`page.tsx:45` query, the same `retiredAt: null` filter. **There is no separate
page and no separate loader.** The `?staff=` parameter selects the attested
branch inside the file; it does not change how checkpoints are loaded.

**And that link would not have rendered for Gdogg.** It is gated at
`staff-documents.tsx:138` on `status` being `not-started`, `in-progress` or
`needs-current`, and on `!row.recordMissing`. Gdogg holds a signed record for
(v4, his staff id, current cycle), so `documentCompletion` returns `signed` and
the ceremony link is not offered at all — only the record download. The comment
at `:130–135` records why (R1): a manager re-running the ceremony would capture
nothing, because the acknowledgment write is idempotent within a cycle.

So the navigation described in the verification pass reached the **download** of
an existing record, which is the only action that surface offers for a signed
row.

---

## 4. ITEM 4 — THE ENTRY-DROP IS INTACT

`src/app/api/hr/documents/[id]/acknowledgments/route.ts:169–179`:

```
const liveCheckpoints    = doc.checkpoints.filter((c) => c.retiredAt == null)
const retiredCheckpointIds = new Set(doc.checkpoints.filter((c) => c.retiredAt != null).map((c) => c.id))
const liveEntries        = entries.filter((e) => !retiredCheckpointIds.has(e.checkpointId))
```

**`liveEntries` is the only downstream consumer.** Traced every reference to
`entries` after line 173:

| Line | Uses |
|---|---|
| `:183` | validation loop — `liveEntries` |
| `:268` | `rows = liveEntries.map(...)` — the insert payload |
| `:336` | `checkpointsComplete` — `liveCheckpoints` |

`entries` is referenced after the filter **only** inside the drop's own count and
log line (`:174–178`). No path reaches the insert with a retired entry.

**One writer exists in the entire codebase.** A sweep for
`hrDocumentAcknowledgment.create` / `.upsert` / `.update` across `src/` returns a
single hit: `createMany` at `:314`, inside the `rows.length > 0` guard, fed by
`liveEntries`. There is no second write path, no server action, no script.

The load at `:74` stays **unfiltered on purpose**: retired and unknown are
different answers (drop versus 400), and a filtered load would collapse them into
one. This is the § 0 finding's mirror — the drop had to be written explicitly
precisely because the unfiltered load would otherwise have let a retired entry
sail through validation and be inserted.

**Verdict: not bypassed, not broken, not involved.** The rows predate it.

### 4.1 The certificate module, for completeness

`hr-signed-pdf.ts` filters at `ackByCheckpoint` (`:291–316`) rather than at the
checkpoint load, because inline stamping resolves an acknowledgment through the
ANCHOR's `generatedCheckpointId` (`:470`, `:486`) and never through
`doc.checkpoints`. Filtering the load would have satisfied the rule on the
certificate table and left the stamps. This is correct as shipped and is not
implicated in the incident — it did not run for Gdogg's certificate, which
predates it.

---

## 5. ITEM 5 — A STALE BROWSER PAGE COULD NOT HAVE DONE THIS EITHER

**Can the server distinguish a stale client from a fresh one?** No. The
submission carries no page-load token, no version stamp, no client build id. The
server cannot tell when the page that produced a payload was loaded.

**It does not need to.** The drop is evaluated **server-side, against database
state at request time** — `doc.checkpoints` is read fresh on every POST
(`:71–78`). A page loaded before a retirement submits entries for a checkpoint
that is retired *by the time the request arrives*, and those entries are dropped
on arrival. Staleness of the client is irrelevant to the outcome; only the state
of the database at request time matters. **The drop is fail-safe on this axis.**

**And a replay writes nothing regardless.** `HrDocumentAcknowledgment` carries
`@@unique([checkpointId, hrDocumentVersionId, staffMemberId, signingCycle])`
(`prisma/schema.prisma:1812`), and the insert passes `skipDuplicates: true`
(`:314–316`). A re-submitted checkpoint within the same signing cycle is silently
skipped, so the original row and its evidence are never replaced and no duplicate
appears. Between the drop and the constraint there are two independent reasons a
stale page cannot produce the observed rows.

**Would the server have rejected stale entries if the drop were working?** It
would have DROPPED them — not rejected. The submission proceeds and completion is
computed against the live set, because a signer mid-signature must be able to
finish. That is the ruled behaviour ("Anybody in the middle of signing when I
retire something doesn't get an error and doesn't get their entry quietly
recorded against a step I just retired. They just finish.") and it is what the
code does.

---

## 6. WHAT IS GENUINELY UNVERIFIED

**None of the three HR-11o display fixes have been exercised.** Tommy's
certificate — the only one produced after Phase A — was generated at 18:25:58
PDT, **34 minutes before `68c5a2d` deployed at 18:59:39**. It came from
`26aa21d`, which carries Phase A's `retiredAt` filters and **none** of HR-11o.
Gdogg's stamped page 3 is from 13:05 PDT and is pre-fix by a wider margin still.

So D1 (chronological certificate table), D2 (affordance placement) and D3
(opaque identity chip) remain unobserved. If Tommy's checkpoint table read in
ceremony order rather than time order, that is expected rather than a regression:
the sort was not deployed.

Recorded on the HR-11o row, which stays `in_progress` for this specific reason.

**If the drop's own evidence is ever wanted**, the log line at `:175` emits
`[hr-11n] dropped N entr(ies) for retired checkpoints` to the Vercel function
logs. On this analysis it has never fired.

---

## 7. WHAT SHOULD HAVE CAUGHT THIS SOONER

The trap fired **three times in one day**: it nearly re-opened HR-11m during
Phase A, it caused Gdogg's signing to be mis-dated by six hours, and after that
correction it mis-dated the same rows a second time and produced this
investigation.

Each time the naive comparison produced a **coherent, urgent, entirely wrong
conclusion** supported by real observations. It never looks like an error. That
is the property that makes it expensive, and it is why the rule now lives in
CLAUDE.md § Database Evidence rather than in a session note.

The cheap check, in order:

1. Ask what zone each timestamp is in **before** comparing them, not after the
   comparison looks surprising.
2. Convert, and state the conversion in the same output as the comparison.
3. When a result implies a defect, check whether the artifact predates the code
   it is being blamed on — `git log --date=format` on the relevant commit takes
   one command and would have ended this in a minute.
