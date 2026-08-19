import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { CheckCircle, XCircle, AlertTriangle, BriefcaseBusiness, Clock } from "lucide-react"
import { InstagramIcon } from "@/components/instagram-icon"
import Link from "next/link"
import { getCurrentUser, hrModuleAvailable, laborModuleAvailable, squareLaborAvailable } from "@/lib/auth"
import { can, type PermissionUser } from "@/lib/permissions"
import { redirect } from "next/navigation"
import { getInstagramTokenStatus } from "@/lib/instagram"
import { InstagramActions, InstagramConnectButton } from "./instagram-actions"
import { HrModuleToggle } from "./hr-actions"
import { LaborModuleToggle } from "./labor-actions"
import { SquareLaborToggle } from "./square-labor-actions"

async function getOrgData() {
  const { orgId } = await auth()
  if (!orgId) return null
  return prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
}

export default async function SettingsPage() {
  // PERM-5C. Was requireAdmin(). settings.access is ADMIN_ONLY — same baseline,
  // now override-aware, and the same capability the sidebar has asked for the
  // Settings link since PERM-1.
  //
  // COARSE BY RULING, and HELD OUT OF THE OVERRIDE GRID (Gary, 2026-08-04).
  // Splitting settings.access into view/manage would duplicate a manage tier
  // that already exists one level down: every control on this page is governed
  // by its own capability — hr.toggle, labor.toggle, instagram.manage,
  // square.manage — and a settings.view that renders a page of switches which
  // all refuse is worse than removing the page. Those toggle APIs deliberately
  // keep their inline checks: MODULE GOVERNANCE OWNS THEM, not this page.
  //
  // That leaves settings.access enforcing the page and the nav entry but not
  // the endpoints, which is normally the PERM-2 bug class. It is not
  // expressible here: settings.access is absent from ENFORCED_CAPABILITIES, so
  // the grid cannot deny it and PATCH /api/users/[id] rejects a hand-rolled
  // denial with a 400. No forbidden state exists to reach.
  //
  // redirect() throws NEXT_REDIRECT, so it stays outside the try.
  let actor: PermissionUser = { role: null }
  try {
    actor = (await getCurrentUser()).actor
  } catch {
    actor = { role: null }
  }
  if (!can(actor, "settings.access")) redirect("/dashboard")

  const org = await getOrgData()
  const isSquareConnected = !!org?.squareAccessToken
  const isInstagramConnected = !!org?.instagramAccessToken
  const instagramTokenStatus = org ? getInstagramTokenStatus(org) : "not_connected"
  const needsInstagramReconnect = isInstagramConnected && instagramTokenStatus === "reconnect_required"
  // Availability gate — while false, HR must not appear anywhere on this page.
  const hrAvailable = hrModuleAvailable(org?.clerkOrgId)
  const hrActive = !!org?.activeModules.includes("hr")
  // Same availability gate for Labor — hidden entirely while unavailable.
  const laborAvailable = laborModuleAvailable(org?.clerkOrgId)
  const laborActive = !!org?.activeModules.includes("labor")
  // AL-1 / L-2 seam (a). THREE conditions, all required, and the Labor ones come
  // FIRST so the incoherent state square-labor-without-labor is not renderable:
  // the Labor module must exist here and be bought, and the Square overlay must
  // exist here. Note what is NOT in this list — whether Square is connected. A
  // disconnect does not turn the overlay off (Gary, 2026-08-05), so hiding the
  // control while disconnected would strand an admin who wants it back.
  const showSquareLabor = laborAvailable && laborActive && squareLaborAvailable(org?.clerkOrgId)

  const addOns = [
    { name: "Inventory Management", desc: "Physical counts, COGS tracking, storage areas, and adjustments", module: "inventory" },
    { name: "Nutritional Information", desc: "Menu item nutrition facts with embeddable public page", module: "nutrition" },
    ...(hrAvailable
      ? [{ name: "HR, Training & Compliance", desc: "Employee handbooks, e-signature acknowledgments, agreement forms, manager notes, and trackable training.", module: "hr" }]
      : []),
    ...(laborAvailable
      ? [{ name: "Weekly Labor Model", desc: "Weekly labor budget from projected sales, a schedulable-hours target, and recommended coverage on the dashboard.", module: "labor" }]
      : []),
  ]

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Settings</h1>
        <p className="text-sm text-[var(--color-muted-foreground)] mt-1">Manage your organization settings and integrations</p>
      </div>

      <Tabs defaultValue="integrations">
        <TabsList className="mb-6">
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
          <TabsTrigger value="organization">Organization</TabsTrigger>
          <TabsTrigger value="billing">Billing</TabsTrigger>
        </TabsList>

        <TabsContent value="integrations">
          <Card>
            <CardHeader>
              <CardTitle>Square Integration</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-start justify-between p-4 border border-[var(--color-border)] rounded-lg">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded bg-[#006aff] flex items-center justify-center text-white font-bold text-sm">S</div>
                  <div>
                    <h3 className="font-medium text-[var(--color-foreground)]">Square</h3>
                    <p className="text-sm text-[var(--color-muted-foreground)]">Import locations, team members, and sync inventory data</p>
                    <div className="flex items-center gap-1.5 mt-1.5">
                      {isSquareConnected ? (
                        <>
                          <CheckCircle className="h-4 w-4 text-[var(--color-success)]" />
                          <span className="text-sm text-[var(--color-success-text)] font-medium">Connected</span>
                        </>
                      ) : (
                        <>
                          <XCircle className="h-4 w-4 text-[var(--color-muted-foreground)]" />
                          <span className="text-sm text-[var(--color-muted-foreground)]">Not connected</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                {isSquareConnected ? (
                  <form action="/api/square/disconnect" method="POST">
                    <button className="border border-[var(--color-destructive)] text-[var(--color-destructive)] px-3 py-1.5 rounded-md text-sm font-medium hover:bg-red-50 transition-colors">
                      Disconnect
                    </button>
                  </form>
                ) : (
                  <Link
                    href="/api/square/auth"
                    className="bg-[var(--color-primary)] text-[var(--color-primary-foreground)] px-3 py-1.5 rounded-md text-sm font-medium hover:opacity-90 transition-opacity"
                  >
                    Connect Square
                  </Link>
                )}
              </div>

              {showSquareLabor && (
                <div className="flex items-start justify-between p-4 mt-3 border border-[var(--color-border)] rounded-lg">
                  <div>
                    <h3 className="font-medium text-[var(--color-foreground)]">Advanced Labor</h3>
                    <p className="text-sm text-[var(--color-muted-foreground)]">
                      Sync worked hours from Square to measure actual labor % against your budget. Read
                      only — Froot never writes to Square.
                    </p>
                    {!isSquareConnected && (
                      <p className="text-sm text-[var(--color-muted-foreground)] mt-1.5">
                        Square is not connected — synced data will show as out of date until you reconnect.
                      </p>
                    )}
                  </div>
                  <SquareLaborToggle enabled={!!org?.squareLaborEnabled} />
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="mt-4">
            <CardHeader>
              <CardTitle>Instagram Integration</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-start justify-between p-4 border border-[var(--color-border)] rounded-lg">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded bg-gradient-to-tr from-[#f9ce34] via-[#ee2a7b] to-[#6228d7] flex items-center justify-center text-white">
                    <InstagramIcon className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-medium text-[var(--color-foreground)]">Instagram</h3>
                    <p className="text-sm text-[var(--color-muted-foreground)]">
                      Show your latest posts on the dashboard and an in-app Instagram page
                    </p>
                    <div className="flex items-center gap-1.5 mt-1.5">
                      {isInstagramConnected ? (
                        <>
                          <CheckCircle className="h-4 w-4 text-[var(--color-success)]" />
                          <span className="text-sm text-[var(--color-success-text)] font-medium">
                            Connected{org?.instagramUsername ? ` · @${org.instagramUsername}` : ""}
                          </span>
                        </>
                      ) : (
                        <>
                          <XCircle className="h-4 w-4 text-[var(--color-muted-foreground)]" />
                          <span className="text-sm text-[var(--color-muted-foreground)]">Not connected</span>
                        </>
                      )}
                    </div>
                    {needsInstagramReconnect && (
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <AlertTriangle className="h-4 w-4 text-[var(--color-warning)]" />
                        <span className="text-sm text-[var(--color-warning)] font-medium">
                          Access expired — reconnect to keep posts up to date
                        </span>
                      </div>
                    )}
                    <p className="text-xs text-[var(--color-muted-foreground)] mt-1.5">
                      Requires an Instagram Professional (Business or Creator) account.
                    </p>
                  </div>
                </div>
                {isInstagramConnected ? (
                  <div className="flex flex-col items-end gap-2">
                    <InstagramActions enabled={!!org?.instagramEnabled} />
                    {needsInstagramReconnect && <InstagramConnectButton reconnect />}
                  </div>
                ) : (
                  <InstagramConnectButton />
                )}
              </div>
            </CardContent>
          </Card>

          {hrAvailable && (
            <Card className="mt-4">
              <CardHeader>
                <CardTitle>HR, Training &amp; Compliance</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-start justify-between p-4 border border-[var(--color-border)] rounded-lg">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded bg-[var(--color-primary)] flex items-center justify-center text-white">
                      <BriefcaseBusiness className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="font-medium text-[var(--color-foreground)]">HR Module</h3>
                      <p className="text-sm text-[var(--color-muted-foreground)]">
                        Employee handbooks, e-signature acknowledgments, agreement forms, manager notes, and trackable training
                      </p>
                      <div className="flex items-center gap-1.5 mt-1.5">
                        {hrActive ? (
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
                      <p className="text-xs text-[var(--color-muted-foreground)] mt-1.5">
                        Runs alongside Square Payroll — Froot never stores SSN, W-4, I-9, or bank details.
                      </p>
                    </div>
                  </div>
                  <HrModuleToggle enabled={hrActive} />
                </div>
              </CardContent>
            </Card>
          )}

          {laborAvailable && (
            <Card className="mt-4">
              <CardHeader>
                <CardTitle>Weekly Labor Model</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-start justify-between p-4 border border-[var(--color-border)] rounded-lg">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded bg-[var(--color-primary)] flex items-center justify-center text-white">
                      <Clock className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="font-medium text-[var(--color-foreground)]">Labor Module</h3>
                      <p className="text-sm text-[var(--color-muted-foreground)]">
                        Weekly labor budget from projected sales, a schedulable-hours target, and recommended coverage on the dashboard
                      </p>
                      <div className="flex items-center gap-1.5 mt-1.5">
                        {laborActive ? (
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
                      {laborActive && (
                        <Link
                          href="/settings/labor"
                          className="inline-block text-xs font-medium text-[var(--color-primary)] hover:underline mt-1.5"
                        >
                          Manage labor settings &amp; positions →
                        </Link>
                      )}
                    </div>
                  </div>
                  <LaborModuleToggle enabled={laborActive} />
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="organization">
          <Card>
            <CardHeader>
              <CardTitle>Organization Details</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-[var(--color-foreground)]">Organization Name</label>
                  <p className="text-sm text-[var(--color-muted-foreground)] mt-1">{org?.name ?? "—"}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-[var(--color-foreground)]">Plan</label>
                  <p className="text-sm text-[var(--color-muted-foreground)] mt-1">Core</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-[var(--color-foreground)]">Active Modules</label>
                  <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
                    {org?.activeModules.length ? org.activeModules.join(", ") : "None (Core plan)"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="billing">
          <Card>
            <CardHeader>
              <CardTitle>Subscription &amp; Billing</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="p-4 border border-[var(--color-border)] rounded-lg mb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium text-[var(--color-foreground)]">Core Plan</h3>
                    <p className="text-sm text-[var(--color-muted-foreground)]">Checklists, Templates, Stores, Staff, Reports</p>
                  </div>
                  <span className="text-xs font-medium bg-[var(--color-success-bg)] text-[var(--color-success-text)] border border-[var(--color-success-border)] px-2 py-0.5 rounded-full">
                    Active
                  </span>
                </div>
              </div>

              <h3 className="font-medium text-[var(--color-foreground)] mb-3">Available Add-Ons</h3>
              <div className="space-y-3">
                {addOns.map(({ name, desc, module }) => (
                  <div key={module} className="flex items-start justify-between p-4 border border-[var(--color-border)] rounded-lg">
                    <div>
                      <h4 className="font-medium text-[var(--color-foreground)]">{name}</h4>
                      <p className="text-sm text-[var(--color-muted-foreground)] mt-0.5">{desc}</p>
                    </div>
                    <button className="ml-4 shrink-0 bg-[var(--color-primary)] text-[var(--color-primary-foreground)] px-3 py-1.5 rounded-md text-sm font-medium hover:opacity-90">
                      Upgrade
                    </button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
