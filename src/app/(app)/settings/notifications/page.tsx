import { redirect } from "next/navigation"
import Link from "next/link"
import { ChevronLeft, BriefcaseBusiness, CheckCircle, TrendingDown, XCircle } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getCurrentUser, hrModuleAvailable } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { paceThresholdPct } from "@/lib/pace-alerts"
import { listRecentEmails } from "@/lib/notification-log"
import { HrAckRecipientsField } from "./hr-ack-recipients"
import { PaceAlertsToggle, PaceAlertThresholdField } from "./pace-alerts-actions"
import { RecentEmails } from "./recent-emails"

// NOTIFY-2a — every email setting on one page (Gary's ruling, 2026-09-20).
// Before this, HR-16's acknowledgment recipients and F-5b's behind-pace toggle
// were two unrelated cards on /settings and the pace threshold was a
// deployment-wide env var. Both moved here; /settings keeps one link card.
//
// SHAPE COPIED FROM /settings/labor, which is the settings sub-page precedent:
// no layout file (there is none anywhere under settings/ — the chrome is the
// (app) shell), a ChevronLeft back-link to /settings, an h1 and one line of
// description, then cards.
//
// GATE: settings.access, the same capability as /settings itself and NOT
// labor's ADMIN||MANAGER pair. settings.access is ADMIN_ONLY
// (src/lib/permissions.ts:273) and is held out of the override grid, so it
// cannot be granted down. Both write routes re-check independently per PERM-2 —
// a gate on a page is not a gate on an endpoint.
//
// NO PLACEHOLDER CARDS. Operational reports and employee-facing notifications
// get a card each when they exist and not before.
//
// NOTIFY-2b ADDED A THIRD CARD, "Recent emails", AND IT IS NOT A PLACEHOLDER —
// it reads the AuditLog rows the three senders write. It is UNGATED by module,
// deliberately: the two cards above are per-consumer settings and hide when
// their consumer does not exist here, but the log is about this page's own
// subject (what Froot emailed) and an org with HR switched off still sends
// pace alerts and test messages.

export default async function NotificationSettingsPage() {
  let ctx: Awaited<ReturnType<typeof getCurrentUser>>
  try {
    ctx = await getCurrentUser()
  } catch {
    redirect("/dashboard")
  }
  const { org, actor } = ctx

  // getCurrentUser() throws on no Clerk session and returns actorFor(null) —
  // role undefined, no overrides — for a caller whose User row belongs to
  // another org, so a cross-org identity reaches here roleless and ADMIN_ONLY
  // refuses it. That is the DEBT-50/F1 guard doing its job; this page does not
  // roll its own clerkUserId lookup (CLAUDE.md § Page Conventions).
  if (!can(actor, "settings.access")) redirect("/dashboard")

  // F2 (Gary, 2026-09-20). TWO GATES, AND THEY DO DIFFERENT THINGS.
  //
  // hrAvailable is the ENVIRONMENT gate — does the HR module exist in this
  // deployment at all? Where it does not, there is NO CARD, because the field
  // writes a column whose only consumer is code that is not here.
  //
  // hrActive is the org's own module switch. Available-but-inactive renders the
  // card DISABLED with one line, rather than hiding it: the setting is real and
  // the org could have it, so the honest thing is to say what is missing. The
  // route is unchanged by this phase and still gates on availability alone —
  // the column is inert while the module is off and deliberately survives a
  // toggle (HR-16), so nothing is at risk in the gap between the two.
  const hrAvailable = hrModuleAvailable(org.clerkOrgId)
  const hrActive = org.activeModules.includes("hr")

  // F2: the newest 50. Fetched here rather than behind a route — the page is
  // already the ADMIN_ONLY gate and the card neither refreshes nor paginates.
  const recentEmails = await listRecentEmails(org.id)

  const paceAlertsActive = org.paceAlertsEnabled
  // The fallback an empty threshold resolves to, read here rather than assumed
  // to be 90 — see the field's own comment.
  const paceDefaultPct = paceThresholdPct()

  return (
    <div>
      <div className="mb-6">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-primary)] mb-2"
        >
          <ChevronLeft className="h-4 w-4" /> Settings
        </Link>
        <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Email notifications</h1>
        <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
          Who Froot emails, and when. Every email the app sends is configured here.
        </p>
      </div>

      {hrAvailable && (
        <Card>
          <CardHeader>
            <CardTitle>Signed-acknowledgment emails</CardTitle>
          </CardHeader>
          <CardContent>
            {hrActive ? (
              <HrAckRecipientsField recipients={org.hrAckRecipients} />
            ) : (
              <div className="p-4 border border-[var(--color-border)] rounded-lg">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded bg-[var(--color-muted)] flex items-center justify-center text-[var(--color-muted-foreground)]">
                    <BriefcaseBusiness className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-medium text-[var(--color-foreground)]">
                      Acknowledgment notification emails
                    </h3>
                    <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
                      Turn on the HR module to use acknowledgment emails.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card className={hrAvailable ? "mt-4" : undefined}>
        <CardHeader>
          <CardTitle>Behind-pace alerts</CardTitle>
        </CardHeader>
        <CardContent>
          {/* The module row, moved from /settings verbatim. The help text names
              WHO is emailed and HOW OFTEN because an admin flipping this on is
              choosing to put their managers on a mailing list, and the switch
              should say so before it is flipped. */}
          <div className="flex items-start justify-between p-4 border border-[var(--color-border)] rounded-lg">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded bg-[var(--color-primary)] flex items-center justify-center text-white">
                <TrendingDown className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-medium text-[var(--color-foreground)]">Behind-pace alert emails</h3>
                <p className="text-sm text-[var(--color-muted-foreground)]">
                  Emails admins and the store&apos;s assigned managers once per store per month when
                  month-to-date sales fall below the alert threshold.
                </p>
                <div className="flex items-center gap-1.5 mt-1.5">
                  {paceAlertsActive ? (
                    <>
                      <CheckCircle className="h-4 w-4 text-[var(--color-success)]" />
                      <span className="text-sm text-[var(--color-success-text)] font-medium">Enabled</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="h-4 w-4 text-[var(--color-muted-foreground)]" />
                      <span className="text-sm text-[var(--color-muted-foreground)]">Disabled</span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <PaceAlertsToggle enabled={paceAlertsActive} />
          </div>

          <PaceAlertThresholdField
            thresholdPct={org.paceAlertThresholdPct}
            defaultPct={paceDefaultPct}
          />

          {/* RECIPIENTS ARE STILL ROLE-BASED AND THERE IS STILL NO LIST TO EDIT
              HERE. Every ADMIN plus the store's assigned MANAGERs, resolved per
              store at send time (the recipient query in src/lib/pace-alerts.ts).

              NOTIFY-2c CHANGED THE LAST SENTENCE, NOT THE RULE. This used to
              read "This is not editable", which stopped being true the moment
              an admin could untick a person's row on /users — and a settings
              page that denies the existence of a control someone else on the
              team is using is worse than one that says nothing. What is still
              true, and is why the line stays: there is no recipient BOX on this
              page, because the decision is made per user, on the user.

              STILL NOT SELF-SERVICE (Gary, 2026-09-20). An ADMIN sets it, from
              the row of the person it affects; nobody opts themselves out and
              there is no unsubscribe anywhere. The org toggle above outranks it
              — off here means nobody, whatever any user's row says. */}
          <p className="text-sm text-[var(--color-muted-foreground)] mt-4">
            <span className="font-medium text-[var(--color-foreground)]">Recipients:</span>{" "}
            sent to every admin and the store&apos;s assigned managers. Turn this off for an
            individual user from their row on the{" "}
            <Link href="/users" className="underline hover:text-[var(--color-foreground)]">
              Users page
            </Link>
            .
          </p>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Recent emails</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[var(--color-muted-foreground)] mb-4">
            The last {recentEmails.length === 1 ? "email" : `${recentEmails.length} emails`} Froot sent
            for this organization, newest first. <span className="font-medium text-[var(--color-foreground)]">Delivered</span>{" "}
            means the receiving mail server accepted it; <span className="font-medium text-[var(--color-foreground)]">Sent</span>{" "}
            means it was handed to the provider and no delivery result has come back yet.
          </p>
          <RecentEmails entries={recentEmails} timeZone={org.timezone} />
        </CardContent>
      </Card>
    </div>
  )
}
