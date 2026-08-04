# DEBT-50 detour — roadmap package, 2026-08-04

Paste-ready text for `docs/ROADMAP.yaml` and `docs/DECISIONS.md`. Gary rules on
row numbering and placement; suggested numbers below assume DEBT-53 is next
free. All evidence gathered 2026-08-04 by Gary; branch and org ids named
inline per house rule.

---

## 1. NEW ROW — the F1 fix (suggested: DEBT-53, or fold into DEBT-50 as a note)

```yaml
  - id: DEBT-53
    status: staging
    commits: ["5695aab"]
    title: "Cross-org privilege escalation in getCurrentUser() — wrong-org User row was admitted with its role"
    notes: >
      VERIFIED ON STAGING 2026-08-04 (Gary). Deployed SHA confirmed
      3784c34c511f898087af57ce9ffa3820db18f583. Guard-path test: a
      two-membership identity (indianathomas+f1test, dev instance) with its
      User row in org cmr431pps000004lgngxtm5ku ("Microsoft") and session
      under the dev Keva Juice org was refused — /users, /settings, /staff,
      /stores all bounced to /dashboard, store lists empty, and the Vercel
      runtime log shows "[auth] cross-org User row refused:
      clerkUserId=user_3HSdr0ylU1kkaYGlEnMQWQA8qx5 ..." firing on /stores
      (307) and /dashboard. Happy path unchanged for single-org users. Test
      account deleted after.
      COST OF DOING NOTHING: LATENT, one dashboard click from LIVE — a Clerk
      identity with memberships in two orgs was admitted to the second org
      carrying the first org's role, and isAdmin short-circuits store
      scoping, so an ADMIN of org A saw every store, staff member, count and
      message in org B. Trigger: adding any second org membership to any
      existing identity — a single Clerk-dashboard action, no code change.
      MECHANISM: clerkUserId is @unique on User, so exactly one row exists
      per Clerk identity globally. auth.ts:67 resolved that row by
      clerkUserId alone; requireAdmin() (:74) tested dbUser.role without
      comparing dbUser.organizationId to the session org.
      FIX: a wrong-org row is treated as ABSENT — the same shape
      getActiveStaffSelf() has used since HR-7. Mismatch fails closed with a
      console.warn naming both org ids (Gary's ruling), so a lockout is one
      log grep, not a silent bounce loop.
      WHY IT IS SAFE: the change introduces no new throw — it only turns a
      non-null dbUser into null, which all 171 call sites already handle
      because findUnique could always return null. Enumerated at fix time:
      94 requireAdmin/requireManagerOrAdmin sites (52 API files -> 403, all
      wrapped; 7 page sites -> redirect), ~60 getUserStoreScope sites
      (null-total: empty scope, can() denies role:null), 17 direct sites.
      CANNOT CAUSE A WRONG-ORG WRITE: both User writers upsert on
      clerkUserId; the UPDATE branch writes email alone.
      PRE-PROMOTION LOCKOUT CHECK RUN 2026-08-04, branch
      br-sparkling-block-a620qvg4: live org
      cf888f2d-f234-48c7-8097-fd5b44b5b3dd holds all 6 real User rows; every
      other org's rows are dev-instance fossils or deleted-vanity-org rows
      (see DEBT-56). No production user sits on a wrong-org row. SAFE TO
      PROMOTE.
      KNOWN LOCKOUT CLASS, named not assumed away: a User row left stale by
      an org move — membership.deleted leaves the row carrying the old org
      and no writer can correct it. Before this fix such a user was silently
      served the old org's role (this bug firing on a single-membership
      user); now they degrade to STAFF-level with no in-app repair. Own row:
      DEBT-55.
      NOT SWEPT: 21 page-level findUnique({ clerkUserId }) sites with the
      same missing guard — UI-only in effect (every gate behind them refuses
      independently) but the reason a mismatched user still sees an
      overpromising sidebar. Sites listed in the F1+F4 session report. Own
      row: DEBT-54.
```

## 2. NEW ROW — the F4 fix (suggested: fold with F1 or own row)

```yaml
  - id: DEBT-53b
    status: staging
    commits: ["3784c34"]
    title: "accept-invite failed toward sign-up — the one flow that can mint a duplicate identity"
    notes: >
      VERIFIED ON STAGING 2026-08-04 (Gary), same deployed SHA as DEBT-53.
      Three tests: (1) real invite link for an existing dev-instance account
      (gary@kevajuice.com) landed on /sign-in with __clerk_ticket intact;
      (2) regression test — the same ticket loaded at /accept-invite with NO
      __clerk_status parameter landed on /sign-in (before this commit that
      URL went to /sign-up); (3) Clerk's own reused-ticket error also
      directs to sign-in. Invitation revoked after.
      COST OF DOING NOTHING: LATENT, armed by any invite to an existing
      address — every __clerk_status except the single literal "sign_in"
      sent the invitee to the sign-up form, the one flow that can mint a
      second Clerk identity for an email that already has one. Triggers:
      rehires, re-invites, link rewriters that strip parameters, future
      Clerk status values.
      MECHANISM: route.ts:28 was status === "sign_in" ? "/sign-in" :
      "/sign-up" — an exact-equality allow-list of one value; absent,
      malformed and future statuses all fell to sign-up. This is DEBT-50
      hypothesis H2.
      FIX: default inverted — /sign-up only on the explicit "sign_up"
      status; everything else including absent goes to /sign-in. The
      failure direction now points at the flow that cannot create an
      identity. Ticket passthrough unchanged (set after dest,
      destination-agnostic; both targets read it off the query string).
      RELATED, NOT DONE: the invite guard (DEBT-50 audit Task 5) remains
      open as an option, deprioritised — see the DEBT-50 mechanism ruling:
      with F4 shipped and production restricted mode ON, no active
      duplicate-minting path remains on production.
```

## 3. DECISIONS.md ENTRY — the F3 ruling and the mechanism ruling

```
## DEBT-50 mechanism ruled; production sign-up closed (F3) — 2026-08-04 (Gary)

THE MECHANISM RULING. Production Clerk holds NO duplicate identities:
kevajuice14@icloud.com and gary@kevajuice.com each return exactly one
identity on the production instance (verified in the dashboard 2026-08-04).
The two "duplicates" measured in the production database (branch
br-sparkling-block-a620qvg4, queries a-d, all with branch id on output) are
fossils, not live twins:
- gary@kevajuice.com's second row belongs to the DEV instance's Keva Juice
  org (org_3FhMmIWVjja5HYpsou8n6rVtZn2) — cross-instance contamination from
  a period when dev-configured code wrote into this database. Production
  Clerk can never authenticate that identity; the row is a permanent
  fossil.
- kevajuice14@icloud.com's second row (user_3Fq6iuvkhK4TSsmdaJ8yMMcT4rf,
  STAFF, created 2026-07-03) points at a Clerk identity that NO LONGER
  EXISTS — a deleted account whose row survived because there is no
  user.deleted handler. This is DEBT-47's consequence measured in the wild.
The LIVE duplicate pair (two gary@kevajuice.com identities) exists only on
the dev instance, where the enabling conditions were: public sign-up, no
account linking, password + Apple + Google all enabled, AND the
accept-invite sign-up default (H2 — fixed by F4/3784c34). No single
hypothesis "won"; H2 was a real armed mechanism and is closed, H1's OAuth
door was never open on production (Apple/Google still "Setup required"),
and H3 (open org creation) is how the vanity orgs appeared.

THE F3 RULING (Gary). Production Clerk restricted mode: ON, effective
2026-08-04. Public sign-up had already produced one uninvited account
(blankettegirl@gmail.com, signed up ~2026-07-27, created "My Organization",
saw only its own empty org — tenant isolation held, no Keva data exposed).
Account and org deleted 2026-08-04; "Keva Smoothie Company" (Gary's 7-03
testing artifact, sole member gary@keva.com) also deleted. Froot is
invite-only by design; nothing legitimate arrives via public sign-up. The
dev instance deliberately stays open for testing.
INSTANCE DIVERGENCE recorded while ruling: dev REQUIRES a username as an
identifier, production has username OFF; dev has live shared-credential
Apple/Google, production has neither configured. The two instances are
independently configured — never assume a Clerk behavior transfers between
them.
```

## 4. DEBT-47 UPGRADE — replace/append to its notes

```
      UPGRADED 2026-08-04: the consequence is no longer hypothetical. The
      production database (br-sparkling-block-a620qvg4) carries a User row
      (user_3Fq6iuvkhK4TSsmdaJ8yMMcT4rf, STAFF, kevajuice14@icloud.com,
      created 2026-07-03) whose Clerk identity no longer exists — deleted in
      Clerk, row orphaned, still counted by every org-scoped query (the
      live org shows 6 DB rows vs 5 Clerk members). The 2026-08-04 Clerk
      cleanup (blankettegirl user + My Organization org + Keva Smoothie
      Company org) added three more orphans by the same mechanism, tallied
      in DEBT-56. COST OF DOING NOTHING: LIVE — member counts and rosters
      silently disagree with Clerk today.
```

## 5. DEBT-50 RESTATEMENT — replace the row's status summary

```
      RESTATED 2026-08-04 after the audit + fix + evidence cycle. The row's
      two halves now stand as: (A) DUPLICATE IDENTITIES — mechanism ruled
      (see DECISIONS.md 2026-08-04): no live duplicates on production, the
      dev pair is a known artifact of dev's open configuration, the
      measured production "duplicates" are fossils (one cross-instance, one
      DEBT-47 ghost). Production minting paths closed by F4 (3784c34) and
      restricted mode (F3 ruling). The Task 5 invite guard remains an
      optional hardening, deprioritised. (B) ORG SWITCHER / MULTI-ORG —
      unchanged: not supported by the schema (clerkUserId @unique + required
      organizationId), sized L (Option 1, composite uniqueness) in the
      2026-08-04 audit, and MUST NOT ship before the DEBT-54 sweep; the F1
      guard (5695aab) is the prerequisite that made the current state safe.
      This half stays planned.
      The row's title and Disconfirmed-by clause were wrong (tested the
      switcher, not the duplicates) — corrected with this restatement.
```

## 6. NEW ROW — the 21-site sweep (suggested: DEBT-54)

```yaml
  - id: DEBT-54
    status: open
    title: "21 page-level findUnique({ clerkUserId }) lookups lack the org guard getCurrentUser() now has"
    notes: >
      COST OF DOING NOTHING: LATENT — UI-only today (every gate behind
      these pages refuses independently via the DEBT-53 guard), but they
      are why a cross-org session still renders an overpromising sidebar,
      and any future page that trusts one of these lookups for data
      inherits the pre-F1 bug. HARD PREREQUISITE for DEBT-50's org-switcher
      half. The sweep is mechanical: findUnique -> findFirst with
      organizationId: org.id, or route through getCurrentUser(). Exemplars
      already in-repo: task-log/route.ts:36, users/[id]/route.ts:201. Site
      list: the F1+F4 session report of 2026-08-03 (20 pages + layout.tsx).
```

## 7. NEW ROW — the org-move stale-row defect (suggested: DEBT-55)

```yaml
  - id: DEBT-55
    status: open
    title: "organizationMembership.deleted leaves User.organizationId pointing at the departed org — no writer can ever correct it"
    notes: >
      COST OF DOING NOTHING: LATENT, consequence CHANGED by DEBT-53 — a
      user moved between orgs used to be silently served the OLD org's role
      in the new org (the F1 bug firing on a single-membership user); now
      they degrade to STAFF-level with no in-app repair, and the
      console.warn names them in Vercel logs. Needs a RULING, not a patch:
      either move the row on membership.created when the identity has
      exactly one membership, or delete the row on membership.deleted
      (cleaner, but drops defaultStoreId and every FK off User — schema
      consequences need enumeration first). Found by the F1 fix session
      2026-08-03.
```

## 8. NEW ROW — fossil cleanup (suggested: DEBT-56)

```yaml
  - id: DEBT-56
    status: open
    title: "Production DB fossil rows: cross-instance + deleted-Clerk-identity orphans, measured 2026-08-04"
    notes: >
      COST OF DOING NOTHING: LIVE — org member counts and rosters disagree
      with Clerk today (live org: 6 DB rows vs 5 Clerk members). Measured
      on br-sparkling-block-a620qvg4 (queries recorded in the DEBT-50
      audit; every result carried db + branch id):
      (1) User cmr564cr1... / user_3Fq6iuvkhK4TSsmdaJ8yMMcT4rf (STAFF,
      kevajuice14@icloud.com) — Clerk identity deleted, row orphaned
      (DEBT-47 ghost) — sits INSIDE the live org and inflates its roster.
      (2) User cmqvpgn4f... / user_3FhMl9WeyNaGexqdaCEa5gEkU6P
      (gary@kevajuice.com, ADMIN) under org cmqvpe2bf... — the DEV
      instance's Keva Juice org, cross-instance contamination.
      (3) After the 2026-08-04 Clerk cleanup: blankettegirl@gmail.com's
      User row + "My Organization" org row (cms3o8i9u...), and
      gary@keva.com's User row + "Keva Smoothie Company" org row
      (cmr595zt9...), all now pointing at deleted Clerk objects.
      Also: Organization row cmr431pps... ("Microsoft") with 0 users —
      the dev org row itself, cross-instance.
      FIX SHAPE: read-only verification query first, then hand-authored
      DELETEs presented for approval per house rule (additive-only governs
      schema, not data cleanup — but every mutation is still
      approve-before-run). Check FKs off each User row before deleting.
      Do NOT fold into DEBT-47's handler work — this is the backlog, that
      is the faucet.
```

## 9. PROCESS NOTES (for CLAUDE.md or DECISIONS.md, Gary's placement call)

- Dev-instance webhooks/config once wrote into the production database
  (the gary@ dev-org row proves it). Worth one grep someday for how, so it
  cannot recur — likely historical env mix, possibly pre-dating the
  three-branch Neon setup.
- Clerk dev instance has Test mode ON (+clerk_test emails, code 424242) —
  another way dev accumulates odd accounts; fine, just known.
- The /users invite-dialog copy actively teaches plus-addressing as the
  workaround for "email already has a login" — accurate, but it multiplies
  accounts per human; revisit the copy when the invite guard question is
  next opened.
```
