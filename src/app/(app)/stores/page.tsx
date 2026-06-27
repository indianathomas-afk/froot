import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { MapPin, Clock, Mail, Phone, Pencil, Trash2, CheckCircle } from "lucide-react"
import { StoreActions } from "./store-actions"
import { AddStoreButton } from "./add-store-button"
import { ImportSquareButton } from "./import-square-button"

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const DAY_LABELS: Record<string, string> = {
  "Mon-Fri": "Mon-Fri",
  Sat: "Sat",
  Sun: "Sun",
}

function formatHours(hours: { dayOfWeek: number; openingTime: string | null; closingTime: string | null; isClosed: boolean }[]) {
  const sorted = [...hours].sort((a, b) => a.dayOfWeek - b.dayOfWeek)
  const groups: { label: string; value: string }[] = []

  // Group Mon-Fri
  const weekdays = sorted.filter((h) => h.dayOfWeek >= 1 && h.dayOfWeek <= 5)
  const allSameWeekday = weekdays.length === 5 && weekdays.every((h) => h.openingTime === weekdays[0].openingTime && h.closingTime === weekdays[0].closingTime && h.isClosed === weekdays[0].isClosed)
  if (allSameWeekday && weekdays.length > 0) {
    const h = weekdays[0]
    groups.push({ label: "Mon-Fri", value: h.isClosed ? "Closed" : `${h.openingTime} - ${h.closingTime}` })
  }

  const sat = sorted.find((h) => h.dayOfWeek === 6)
  if (sat) groups.push({ label: "Sat", value: sat.isClosed ? "Closed" : `${sat.openingTime} - ${sat.closingTime}` })

  const sun = sorted.find((h) => h.dayOfWeek === 0)
  if (sun) groups.push({ label: "Sun", value: sun.isClosed ? "Closed" : `${sun.openingTime} - ${sun.closingTime}` })

  return groups
}

async function getStores() {
  const { orgId } = await auth()
  if (!orgId) return []
  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return []
  return prisma.store.findMany({
    where: { organizationId: org.id },
    include: { hours: true, userAssignments: true },
    orderBy: { name: "asc" },
  })
}

export default async function StoresPage() {
  const stores = await getStores()

  return (
    <div>
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Store Locations</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">Manage store locations, hours, and login accounts</p>
        </div>
        <div className="flex gap-2">
          <ImportSquareButton />
          <AddStoreButton />
        </div>
      </div>

      {stores.length === 0 ? (
        <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-16 text-center">
          <div className="text-[var(--color-muted-foreground)] mb-3">
            <MapPin className="h-10 w-10 mx-auto mb-3 opacity-30" />
          </div>
          <p className="font-medium text-[var(--color-foreground)] mb-1">No store locations yet</p>
          <p className="text-sm text-[var(--color-muted-foreground)]">Add your first store location to get started</p>
        </div>
      ) : (
        <div className="space-y-4">
          {stores.map((store) => {
            const hoursGroups = formatHours(store.hours)
            const hasAccount = store.userAssignments.length > 0

            return (
              <div key={store.id} className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-6">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded bg-[var(--color-muted)] flex items-center justify-center">
                      🏪
                    </div>
                    <div>
                      <h3 className="font-semibold text-[var(--color-foreground)]">
                        {store.storeNumber ? `Store #${store.storeNumber} - ` : ""}{store.name}
                      </h3>
                      {store.city && store.state && (
                        <p className="text-sm text-[var(--color-muted-foreground)]">{store.city}, {store.state}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {hasAccount && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-success-text)] bg-[var(--color-success-bg)] border border-[var(--color-success-border)] px-2 py-0.5 rounded-full">
                        <CheckCircle className="h-3 w-3" />
                        Has Account
                      </span>
                    )}
                    <StoreActions storeId={store.id} />
                  </div>
                </div>

                <div className="mt-4 space-y-2 text-sm">
                  {store.address && (
                    <div className="flex items-start gap-2 text-[var(--color-muted-foreground)]">
                      <MapPin className="h-4 w-4 mt-0.5 shrink-0" />
                      <div>
                        <p>{store.address}</p>
                        {(store.city || store.state || store.zip) && (
                          <p>{[store.city, store.state, store.zip].filter(Boolean).join(", ")}</p>
                        )}
                      </div>
                    </div>
                  )}

                  {store.phoneNumber && (
                    <div className="flex items-center gap-2 text-[var(--color-muted-foreground)]">
                      <Phone className="h-4 w-4 shrink-0" />
                      <span>{store.phoneNumber}</span>
                    </div>
                  )}

                  {hoursGroups.length > 0 && (
                    <div className="flex items-start gap-2 text-[var(--color-muted-foreground)]">
                      <Clock className="h-4 w-4 mt-0.5 shrink-0" />
                      <div>
                        {hoursGroups.map(({ label, value }) => (
                          <div key={label} className="flex gap-2">
                            <span className={value === "Closed" ? "text-[var(--color-destructive)]" : ""}>
                              <strong>{label}:</strong>{" "}
                              <span className={value === "Closed" ? "text-[var(--color-destructive)]" : "text-[var(--color-primary)]"}>
                                {value}
                              </span>
                            </span>
                          </div>
                        ))}
                        <button className="flex items-center gap-1 text-[var(--color-primary)] text-xs mt-1 hover:opacity-80">
                          📅 Edit Hours
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-2 text-[var(--color-muted-foreground)]">
                    <Clock className="h-4 w-4 shrink-0 opacity-0" />
                    <span>Timezone: {store.timezone.replace("America/", "").replace("_", " ")} ({store.timezone.includes("Los_Angeles") ? "PT" : store.timezone.includes("Denver") ? "MT" : store.timezone.includes("Chicago") ? "CT" : "ET"})</span>
                  </div>

                  {store.contactEmail && (
                    <div className="flex items-center gap-2 text-[var(--color-muted-foreground)]">
                      <Mail className="h-4 w-4 shrink-0" />
                      <span>{store.contactEmail}</span>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
