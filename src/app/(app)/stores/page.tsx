import { MapPin, Clock, Mail, Phone, CheckCircle, Link2, Tablet, ShieldAlert, AlertTriangle } from "lucide-react"
import Link from "next/link"
import { StoreActions } from "./store-actions"
import { StoreHoursButton } from "./store-hours-button"
import { AddStoreButton } from "./add-store-button"
import { ImportSquareButton } from "./import-square-button"
import { CreateDeviceLoginButton } from "./create-device-login-button"
import { getUserStoreScope } from "@/lib/auth"
import { isDeviceLogin, isAboveStore } from "@/lib/device-login"
import { prisma } from "@/lib/prisma"
import { auth } from "@clerk/nextjs/server"
import { localDateStr } from "@/lib/reports"
import {
  DAY_CLOSE_GRACE_HOURS,
  dayCloseInstant,
  hoursForDate,
  jsDayOfWeek,
  shiftDateStr,
} from "@/lib/checklist-lifecycle"

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

type HoursRow = { dayOfWeek: number; openingTime: string | null; closingTime: string | null; isClosed: boolean }

// CHK-4 — THE FIRST OF THE TWO VISIBLE SIGNALS THE FALLBACK WAS RULED TO CARRY
// (plan §3.1, option (ii): "an inline note on /stores for any store with no
// hours"). The other is a column on CHK-5's operations report.
//
// This closes the handoff CHK-2 left in this file three blocks down — "what an
// unset store falls back to for day close is CHK-3's to say, on the session that
// makes it true". CHK-3 made it true; this session says it.
//
// WHY IT IS COMPUTED AND NOT JUST `hours.length === 0`. A store can hold hours
// for four weekdays and nothing for the other three, and it falls back on those
// three — a note keyed on "has no hours at all" would call that store fine. So
// each of the next seven store-local days is asked the same question the cron
// asks, through the same function, and the answer is grouped by weekday.
//
// A CLOSED DAY IS EXCLUDED, DELIBERATELY. `dayCloseInstant` returns four
// sources and three of them are the midnight fallback; `closed-day` is one of
// them and it is CORRECT — the operator said the store is shut, a shut store
// cannot miss a checklist, and nothing is materialised for it
// (api/cron/checklist-day-close/route.ts). Warning about it would, in that
// lib's own words, "tell an operator to go fix something they already did".
// That four-value split existing at all is why this note can be honest.
function fallbackWeekdays(hours: HoursRow[], timeZone: string, now: Date): string[] {
  const today = localDateStr(now, timeZone)
  const days: string[] = []
  for (let i = 0; i < 7; i++) {
    const dateStr = shiftDateStr(today, i)
    const { source } = dayCloseInstant(hoursForDate(hours, dateStr), dateStr, timeZone)
    if (source === "no-hours" || source === "no-close-time") days.push(DAYS[jsDayOfWeek(dateStr)])
  }
  // Back into Sun-first order, so the list reads like the hours block above it
  // rather than starting on whatever day the page happened to be loaded.
  return DAYS.filter((d) => days.includes(d))
}

// CHK-2: both halves of this function used to be unreachable, because nothing
// had ever written a StoreHours row (plan finding 2). Now that S2 ships the
// writer, two things it got away with have to be fixed:
//
//  (1) `${openingTime} - ${closingTime}` printed the literal string "null" for a
//      half-filled day. Times are independently nullable in the schema and the
//      editor lets a day carry one without the other, so a one-sided day now
//      reads "Opens 07:00" rather than "07:00 - null".
//  (2) The Mon-Fri group only rendered when all five weekdays were present AND
//      identical — so a store open different hours on Wednesday showed NOTHING
//      for Mon-Fri, silently. The collapse is kept for the common case and the
//      days are listed individually otherwise, rather than dropped.
function dayValue(h: HoursRow): string {
  if (h.isClosed) return "Closed"
  if (h.openingTime && h.closingTime) return `${h.openingTime} - ${h.closingTime}`
  if (h.openingTime) return `Opens ${h.openingTime}`
  if (h.closingTime) return `Closes ${h.closingTime}`
  return "—"
}

function formatHours(hours: HoursRow[]) {
  const sorted = [...hours].sort((a, b) => a.dayOfWeek - b.dayOfWeek)
  const groups: { label: string; value: string }[] = []

  // Group Mon-Fri when all five are set and agree; otherwise list each day set.
  const weekdays = sorted.filter((h) => h.dayOfWeek >= 1 && h.dayOfWeek <= 5)
  const allSameWeekday = weekdays.length === 5 && weekdays.every((h) => h.openingTime === weekdays[0].openingTime && h.closingTime === weekdays[0].closingTime && h.isClosed === weekdays[0].isClosed)
  if (allSameWeekday) {
    groups.push({ label: "Mon-Fri", value: dayValue(weekdays[0]) })
  } else {
    for (const h of weekdays) groups.push({ label: DAYS[h.dayOfWeek], value: dayValue(h) })
  }

  const sat = sorted.find((h) => h.dayOfWeek === 6)
  if (sat) groups.push({ label: "Sat", value: dayValue(sat) })

  const sun = sorted.find((h) => h.dayOfWeek === 0)
  if (sun) groups.push({ label: "Sun", value: dayValue(sun) })

  return groups
}

async function getStores() {
  const { orgId } = await auth()
  if (!orgId) return { stores: [], isAdmin: false, orgStoreCount: 0, takenEmails: [] as string[] }
  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return { stores: [], isAdmin: false, orgStoreCount: 0, takenEmails: [] as string[] }
  const { isAdmin, storeIds } = await getUserStoreScope()
  const stores = await prisma.store.findMany({
    where: {
      organizationId: org.id,
      ...(isAdmin ? {} : { id: { in: storeIds } }),
    },
    // PERM-7 Task 6: the old "Has Account" badge was userAssignments.length > 0
    // — a COUNT, not a concept — so it could not tell a device login from a
    // manager who happens to be assigned here. The badge now needs WHO and at
    // WHAT ROLE, which means pulling the user through.
    include: {
      hours: true,
      userAssignments: {
        include: {
          user: {
            select: {
              id: true, name: true, email: true, role: true,
              _count: { select: { storeAssignments: true } },
            },
          },
        },
      },
    },
    orderBy: { name: "asc" },
  })

  // PERM-7 Task 3 needs the org-wide count for the blast-radius sentence — the
  // WHOLE org, not the caller's scoped list, because that is the real exposure
  // an ADMIN device account gets.
  const orgStoreCount = await prisma.store.count({ where: { organizationId: org.id } })

  // PERM-7 collision pre-check. Emails already spoken for in this org, so the
  // provisioning dialog can suggest a plus-addressed variant BEFORE the Clerk
  // call rather than surfacing a failure after it. PendingInvite counts: an
  // unaccepted invite still reserves the address.
  const [existingUsers, pendingInvites] = await Promise.all([
    prisma.user.findMany({ where: { organizationId: org.id }, select: { email: true } }),
    prisma.pendingInvite.findMany({ where: { organizationId: org.id }, select: { email: true } }),
  ])
  const takenEmails = [...existingUsers, ...pendingInvites]
    .map((r) => r.email)
    .filter(Boolean)
    .map((e) => e.toLowerCase())

  return { stores, isAdmin, orgStoreCount, takenEmails }
}

export default async function StoresPage() {
  const { stores, isAdmin, orgStoreCount, takenEmails } = await getStores()
  // One instant for the whole page, so two store cards cannot be evaluated
  // against different "today"s.
  const now = new Date()

  return (
    <div>
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Store Locations</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">Manage store locations, hours, and login accounts</p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <ImportSquareButton />
            <AddStoreButton />
          </div>
        )}
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
            const fallbackDays = fallbackWeekdays(store.hours, store.timezone, now)

            // PERM-7 Task 6. Replaces `hasAccount = store.userAssignments.length > 0`
            // — a count that lit up identically for a device login and for a
            // manager assigned to three stores, so the page could not answer
            // the question it was being asked: "does this store have a login,
            // and whose is it?"
            const deviceLogins = store.userAssignments
              .map((a) => a.user)
              .filter((u) => isDeviceLogin({ role: u.role, assignmentCount: u._count.storeAssignments }))
            const otherAccess = store.userAssignments
              .map((a) => a.user)
              .filter((u) => !isDeviceLogin({ role: u.role, assignmentCount: u._count.storeAssignments }))

            // Task 4 — ambient, not a moment. A one-time modal is forgotten in
            // a week; the next admin (or Gary in six months) needs the fact to
            // be sitting on the page. Any account holding this store at a role
            // above STORE is surfaced permanently.
            const elevated = store.userAssignments
              .map((a) => a.user)
              .filter((u) => isAboveStore(u.role))

            // Task 5 — drift, surfaced rather than silently reconciled or
            // silently ignored. The seed is ONE-WAY: after provisioning, Clerk
            // owns the credential, so a later divergence between the location's
            // contact email and the device's login is expected and must be
            // visible. Existing accounts are never retro-repointed.
            const drifted =
              store.contactEmail &&
              deviceLogins.length > 0 &&
              !deviceLogins.some((u) => u.email.toLowerCase() === store.contactEmail!.toLowerCase())

            return (
              <div key={store.id} className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-6">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded bg-[var(--color-muted)] flex items-center justify-center">
                      🏪
                    </div>
                    <div>
                      <h3 className="font-semibold text-[var(--color-foreground)]">
                        {store.storeNumber ? `#${store.storeNumber} — ` : ""}{store.name}
                      </h3>
                      {store.city && store.state && (
                        <p className="text-sm text-[var(--color-muted-foreground)]">{store.city}, {store.state}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {store.squareLocationId && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-primary)] bg-[var(--color-accent)] border border-[var(--color-border)] px-2 py-0.5 rounded-full">
                        <Link2 className="h-3 w-3" />
                        Square Linked
                      </span>
                    )}
                    {deviceLogins.length > 0 && (
                      <Link
                        href="/users"
                        className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-success-text)] bg-[var(--color-success-bg)] border border-[var(--color-success-border)] px-2 py-0.5 rounded-full hover:opacity-80"
                        title={deviceLogins.map((u) => u.email).join(", ")}
                      >
                        <Tablet className="h-3 w-3" />
                        Device login: {deviceLogins[0].name ?? deviceLogins[0].email}
                        {deviceLogins.length > 1 ? ` +${deviceLogins.length - 1}` : ""}
                      </Link>
                    )}
                    {otherAccess.length > 0 && (
                      <Link
                        href="/users"
                        className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-muted-foreground)] bg-[var(--color-muted)] border border-[var(--color-border)] px-2 py-0.5 rounded-full hover:opacity-80"
                        title={otherAccess.map((u) => `${u.email} (${u.role})`).join(", ")}
                      >
                        <CheckCircle className="h-3 w-3" />
                        {otherAccess.length} with access
                      </Link>
                    )}
                    {elevated.length > 0 && (
                      <span
                        className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-warning-text)] bg-[var(--color-warning-bg)] border border-[var(--color-warning-border)] px-2 py-0.5 rounded-full"
                        title={elevated.map((u) => `${u.email} (${u.role})`).join(", ")}
                      >
                        <ShieldAlert className="h-3 w-3" />
                        {elevated.some((u) => u.role === "ADMIN") ? "Admin-level login" : "Manager-level login"}
                      </span>
                    )}
                    {drifted && (
                      <span
                        className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-warning-text)] bg-[var(--color-warning-bg)] border border-[var(--color-warning-border)] px-2 py-0.5 rounded-full"
                        title={`Square contact: ${store.contactEmail} · device login: ${deviceLogins.map((u) => u.email).join(", ")}`}
                      >
                        <AlertTriangle className="h-3 w-3" />
                        Email differs from Square
                      </span>
                    )}
                    {isAdmin && (
                      <CreateDeviceLoginButton
                        store={{
                          id: store.id,
                          name: store.name,
                          storeNumber: store.storeNumber,
                          contactEmail: store.contactEmail,
                        }}
                        orgStoreCount={orgStoreCount}
                        takenEmails={takenEmails}
                      />
                    )}
                    {isAdmin && (
                      <StoreActions
                        store={{
                          id: store.id,
                          name: store.name,
                          storeNumber: store.storeNumber,
                          brand: store.brand,
                          address: store.address,
                          city: store.city,
                          state: store.state,
                          zip: store.zip,
                          timezone: store.timezone,
                          contactEmail: store.contactEmail,
                          phoneNumber: store.phoneNumber,
                          squareLocationId: store.squareLocationId,
                        }}
                      />
                    )}
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

                  {/* CHK-2: this block used to render ONLY when hours existed, and
                      its "Edit Hours" button had no onClick — a dead affordance
                      inside an unreachable branch, since no store could have hours.
                      Now the editor has to be reachable for a store with none, which
                      is every store on day one. "Not set" is stated plainly and
                      neutrally: what an unset store falls back to for day close is
                      CHK-3's to say, on the session that makes it true. */}
                  <div className="flex items-start gap-2 text-[var(--color-muted-foreground)]">
                    <Clock className="h-4 w-4 mt-0.5 shrink-0" />
                    <div>
                      {hoursGroups.length > 0 ? (
                        hoursGroups.map(({ label, value }) => (
                          <div key={label} className="flex gap-2">
                            <span className={value === "Closed" ? "text-[var(--color-destructive)]" : ""}>
                              <strong>{label}:</strong>{" "}
                              <span className={value === "Closed" ? "text-[var(--color-destructive)]" : "text-[var(--color-primary)]"}>
                                {value}
                              </span>
                            </span>
                          </div>
                        ))
                      ) : (
                        <span>Hours: not set</span>
                      )}
                      {/* CHK-4: the fallback, stated where the hours are, so it
                          is never a default nobody chose running silently for
                          months — DEBT-59's lesson at store scale (plan §3.1).
                          The "Set hours" affordance is the existing
                          StoreHoursButton immediately below; the note points at
                          it rather than duplicating it, and a non-admin sees the
                          fact without a control they cannot use. */}
                      {fallbackDays.length > 0 && (
                        <p className="mt-1 flex items-start gap-1.5 text-xs text-[var(--color-warning-text)]">
                          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                          <span>
                            {fallbackDays.length === 7
                              ? `No hours set — checklists for this store close at midnight + ${DAY_CLOSE_GRACE_HOURS}h, and no checklist here can have an expected window.`
                              : `No closing time on ${fallbackDays.join(", ")} — checklists on those days close at midnight + ${DAY_CLOSE_GRACE_HOURS}h and have no expected window.`}
                            {isAdmin ? " Set hours below to change that." : ""}
                          </span>
                        </p>
                      )}
                      {isAdmin && (
                        <StoreHoursButton
                          store={{
                            id: store.id,
                            name: store.name,
                            hours: store.hours.map((h) => ({
                              dayOfWeek: h.dayOfWeek,
                              openingTime: h.openingTime,
                              closingTime: h.closingTime,
                              isClosed: h.isClosed,
                            })),
                          }}
                        />
                      )}
                    </div>
                  </div>

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
