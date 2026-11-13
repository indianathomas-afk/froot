TIER 3 — TAB-16: Ask a manager — help requests from tablet tasks, posted to Messages and emailed

Repo: /Users/garythomas/Claude_Projects/Froot/froot
House rules: /Users/garythomas/Claude_Projects/Froot/froot/CLAUDE.md applies in full — evidence standards, migration stops, build gate, commit only, never push.
Design: the PDF attached to the launch message ("Tablet checklist — training resources"). This phase is A4 (the Ask a manager sheet), the "Ask a manager" buttons in A2/A3/B, C1 (new "Help request emails" section on /settings/notifications) and C2 (the email).
Depends on TAB-15. If the TAB-15 commits aren't on staging (git log), STOP.

## Why
When the how-to doesn't help, the team member needs a person. One tap should reach the store's managers plus anyone the admin picks from the Email Notification Settings Contacts list, and leave a record in Messages.

## Phase A — audit, plan, STOP
Read /Users/garythomas/Claude_Projects/Froot/froot/docs/ROADMAP.yaml (confirm TAB-16 is free; if not, STOP and report the next free id), /Users/garythomas/Claude_Projects/Froot/froot/docs/DECISIONS.md, /Users/garythomas/Claude_Projects/Froot/froot/docs/MIGRATIONS.md and the PDF. Then answer with file:line:
1. Messages: the message model and message types (TAB-11 — Shift Note, Shortage, …). Can a message reference a checklist task today? What would a "Help request" type take?
2. Email: the email-type registry behind /settings/notifications — on/off, "Also send to" contacts (NOTIFY-12), the org Contacts address book, "Send a test to me", sample previews, the accordion (NOTIFY-16), and how sends are logged (Resend webhook rows). Is there an existing event-triggered (not scheduled) email to copy?
3. Store managers: any existing helper that resolves everyone with the MANAGER role assigned to a store (StoreStaffAssignment). Do they all have an email address?
4. "Who's asking?": the source behind the tablet "Who completed this task?" picker (TAB-1b). Reuse it.
5. Permissions: who can post from the tablet (STORE login, MANAGER, ADMIN), and who can edit /settings/notifications (expected: ADMIN only, MANAGER refused, as in NOTIFY-13).
6. Plan: schema changes (if any) and the migration approach per MIGRATIONS.md, new and changed files, and the send path end to end.

STOP. Report the audit, the plan and any RULING NOW items. Gary ratifies the rulings below in DECISIONS.md, in his own words, before Phase B.

## Proposed rulings (suggested wording — Gary rewrites in his own words)
- R1 Record: "A help request always posts in Messages as a Help request with the task attached, even when the email is off. When Help request emails are off, the sheet skips the Send to list and just posts to Messages."
- R2 Recipients: "Help request emails go to the managers of the store that asked (everyone with the Manager role there) plus any contacts ticked under Also send to. Admins pick the default contacts in Settings."
- R3 Tablet picker: "The tablet shows the store's managers as one row plus every active contact. Default contacts start ticked; the team member can tick more. If 'Team members can add more contacts' is off, the tablet only shows the defaults. Manager email addresses are never shown on the tablet."
- R4 Who's asking: "The team member picks their name before sending, from the same list as 'Who completed this task?'. Always required — no setting." (This drops the second "On the tablet" switch shown in C1.)
- R5 Duplicates: "One help request per task per store every 15 minutes. A second tap inside that window shows when the first was sent and who got it — no second email."
- R6 Reasons and note: "Three fixed quick reasons — Watched it, still stuck / Something is broken / Missing supplies — plus an optional note up to 280 characters. Not editable in v1."
- R7 Settings: "Only Admins can change Help request emails. It ships switched off on production; I'll turn it on."
- R8 Email: "Subject: Help needed at [Store]: [Task]. The body stands on its own — who asked, store, checklist, task, reason, note, the training attached, and the time in the store's time zone — because contacts may not have a Froot login. Buttons: Reply in Messages and Open the checklist."
- R9 Failures: "If the email fails, the Messages post still stands and the sheet says the email didn't go out. Nothing retries silently."

## Phase B — migration (only if the plan needs one)
Generate the migration file per MIGRATIONS.md, then STOP. Gary applies it to dev with npx prisma migrate deploy and says go. No fixtures and no commits before that.

## Phase C — build
1. Buttons (A2, A3, B): "Still stuck? Ask a manager" in the How-to panel above Mark done; "Ask a manager" in the player's bottom bar and in B's expanded row. Each opens the sheet.
2. The sheet (A4), Tablet mode only: header; task card (checklist · store, task title, which training is attached); Who's asking (R4); quick reasons and note (R6); Send to list (R2, R3) with managers as one "[Store] store managers" row and contacts carrying a Default badge; footer summary ("Posts in Messages · Emails [Store] managers + N contacts"); Cancel and Send request. Send stays disabled until a name is picked and at least one recipient is ticked (or, with emails off, until a name is picked). It opens over the panel or player and counts as a sheet for TAB-5 and TAB-9.
3. After send: the sheet closes; the panel shows "Help sent to …" in place of the button; the Messages column shows the Help request (sender name, Help request chip, task chip, "Emailed to …"). Build the duplicate (R5) and failure (R9) states.
4. Settings (C1): a new "Help request emails" section in the /settings/notifications accordion, after the existing sections, with a "New" badge. Contents: on/off; Always send to: Store managers; Also send to: contacts (reuse NOTIFY-12's picker); On the tablet: "Team members can add more contacts"; read-only subject; "Send a test help request". Collapsed summary line: "On · Store managers + N contacts" or "Off · Messages only". Use the page's existing save pattern.
5. The email (C2): reuse the existing email layout; content per R8; footer "You're getting this because you're on the Help request emails list" with a link to Settings › Email Notification Settings. Logged like every other send.
6. Desktop Messages renders the Help request (type chip and task chip). Read-only rendering is enough.

## Guardrails
- Validate everything on the server: store, task, asker and every recipient belong to the org. A tablet can never email an address that isn't a manager of that store or an active contact.
- Time zone: the DB is UTC; show store-local time in the sheet and the email.
- Froot UI tokens, 44px touch targets. Desktop unchanged except the new Settings section and the Messages rendering.
- Staging email goes through the Preview Resend key — prove sends from Resend → Emails, not assumptions.

## Done when
- npm run build passes; commits per CLAUDE.md; a TAB-16 row in ROADMAP.yaml citing the DECISIONS.md entries.
- Report: audit answers, files changed, migration name (if any), out-of-scope findings classified FIX NOW / RULING NOW / COMMENT / ROW.
- Staging test list for Gary, at minimum:
  1. Ask from the panel with managers + 1 contact → Resend shows the email Delivered; Messages shows the Help request with the task.
  2. Ask from the full-screen player and from portrait.
  3. No name picked, or nobody ticked → Send stays disabled.
  4. Second ask on the same task within 15 minutes → no second email; the sheet says when the first went.
  5. Settings switched off → no Send to list on the tablet; the request still posts in Messages; no email.
  6. "Team members can add more contacts" off → the tablet only shows the defaults.
  7. A MANAGER login can't change the Help request emails section.
  8. "Send a test help request" arrives at the admin's address.
  9. The time in the email matches the store's local time.
