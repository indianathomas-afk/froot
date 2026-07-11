import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { CheckCircle, XCircle, AlertTriangle } from "lucide-react"
import { InstagramIcon } from "@/components/instagram-icon"
import Link from "next/link"
import { requireAdmin } from "@/lib/auth"
import { redirect } from "next/navigation"
import { getInstagramTokenStatus } from "@/lib/instagram"
import { InstagramActions, InstagramConnectButton } from "./instagram-actions"

async function getOrgData() {
  const { orgId } = await auth()
  if (!orgId) return null
  return prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
}

export default async function SettingsPage() {
  try {
    await requireAdmin()
  } catch {
    redirect("/dashboard")
  }

  const org = await getOrgData()
  const isSquareConnected = !!org?.squareAccessToken
  const isInstagramConnected = !!org?.instagramAccessToken
  const instagramTokenStatus = org ? getInstagramTokenStatus(org) : "not_connected"
  const needsInstagramReconnect = isInstagramConnected && instagramTokenStatus === "reconnect_required"

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
                {[
                  { name: "Inventory Management", desc: "Physical counts, COGS tracking, storage areas, and adjustments", module: "inventory" },
                  { name: "Nutritional Information", desc: "Menu item nutrition facts with embeddable public page", module: "nutrition" },
                ].map(({ name, desc, module }) => (
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
