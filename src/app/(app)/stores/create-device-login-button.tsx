"use client"

import { useState } from "react"
import { Tablet } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useRouter } from "next/navigation"
import {
  DEVICE_ROLE_OPTIONS, blastRadius, deviceConsequences, isAboveStore, plusAddress,
} from "@/lib/device-login"

// PERM-7 Tasks 1/2/3/5 — provision a store device login in one step from the
// page the admin is already on.
//
// ONE STORE PER DEVICE ACCOUNT (PERM-7(a)). Deliberately no multi-store picker:
// a one-store account has no primary-store ambiguity, which is what sidesteps
// BUILD-2 for devices. A human who needs several stores is a normal user
// invited on /users.
//
// This is NOT a second permission model. It mints a normal User with one
// StoreUserAssignment through the SAME invite path /users uses — Clerk
// invitation, PendingInvite, then the Clerk webhook on acceptance.
export function CreateDeviceLoginButton({
  store,
  orgStoreCount,
  takenEmails,
}: {
  store: { id: string; name: string; storeNumber: string | null; contactEmail: string | null }
  orgStoreCount: number
  /** Lowercased emails already used by a User or a PendingInvite in this org. */
  takenEmails: string[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [role, setRole] = useState<string>("STORE")

  // Task 5: SEEDED from Square (via Store.contactEmail, populated by Task 0),
  // editable before submit. ONE-WAY — after provisioning Clerk owns the
  // credential and this is never re-synced. A live sync would mean editing a
  // location's email in Square silently locks the iPad out of its own account.
  const seed = store.contactEmail ?? ""
  const taken = new Set(takenEmails.map((e) => e.toLowerCase()))
  const seedCollides = !!seed && taken.has(seed.toLowerCase())
  // The collision is REAL, not hypothetical: Square's business_email is free
  // text and production carries one address across four locations. Rather than
  // demanding the operator invent an address — which a single-mailbox operator
  // cannot do — suggest the plus-addressed variant, editable.
  const suggestion = seedCollides
    ? plusAddress(seed, store.storeNumber ?? store.name)
    : seed
  const [email, setEmail] = useState(suggestion)

  function handleOpen() {
    setRole("STORE")
    setEmail(suggestion)
    setError(null)
    setOpen(true)
  }

  async function submit() {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role, storeIds: [store.id] }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(data?.error ?? "Couldn't create the device login.")
        return
      }
      setOpen(false)
      router.refresh()
    } finally {
      setSubmitting(false)
    }
  }

  // Task 3: an AlertDialog only when the chosen role reaches beyond the store.
  // At STORE there is nothing to warn about, and a confirmation nobody needs is
  // a confirmation nobody reads.
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (isAboveStore(role)) setConfirmOpen(true)
    else void submit()
  }

  const warning = blastRadius(role, store.name, orgStoreCount)
  const consequences = deviceConsequences(role)
  const label = store.storeNumber ? `#${store.storeNumber} — ${store.name}` : store.name

  return (
    <>
      <button
        className="p-1.5 rounded hover:bg-[var(--color-accent)] transition-colors"
        onClick={handleOpen}
        aria-label="Create device login"
        title="Create device login"
      >
        <Tablet className="h-4 w-4 text-[var(--color-muted-foreground)]" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create device login for {store.name}</DialogTitle>
            <DialogDescription>
              A shared login for the iPad or computer at this location. It gets access to this store
              only. Individual staff logins are separate — invite those from Staff.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="store@example.com"
              />
              {seedCollides ? (
                <p className="text-xs text-[var(--color-warning-text,var(--color-muted-foreground))]">
                  {seed} is already used by another login. Each login needs its own address, so
                  we&apos;ve suggested a variant that still delivers to the same mailbox.
                </p>
              ) : seed ? (
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  From this location&apos;s Square contact email. Edit it if the device should sign in
                  as something else — after this, Square never changes it.
                </p>
              ) : (
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  This location has no contact email yet. Resync it from Square, or type the address
                  the device should sign in with.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Access level</Label>
              <div className="space-y-2">
                {DEVICE_ROLE_OPTIONS.map((r) => (
                  <label
                    key={r.value}
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      role === r.value
                        ? "border-[var(--color-primary)] bg-[var(--color-primary)]/5"
                        : "border-[var(--color-border)] hover:bg-[var(--color-accent)]"
                    }`}
                  >
                    <input
                      type="radio"
                      name="device-role"
                      value={r.value}
                      checked={role === r.value}
                      onChange={() => setRole(r.value)}
                      className="mt-0.5"
                    />
                    <div>
                      <p className="text-sm font-medium">
                        {r.label}
                        {r.recommended && (
                          <span className="ml-2 text-xs font-normal text-[var(--color-primary)]">
                            Recommended
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-[var(--color-muted-foreground)]">{r.description}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <p className="text-xs text-[var(--color-muted-foreground)]">
              An email invitation goes to this address. Whoever sets up the device needs to accept it
              once — the account is named <strong>{label}</strong> automatically.
            </p>

            {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting || !email}>
                {submitting ? "Sending invite..." : "Send invite"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Task 3. The warning states the ACTUAL blast radius computed from the
          org's store count — unalarming for a single-location operator,
          stopping for a twelve-store one, with the product making no judgement
          about who is sophisticated. Consequences are named concretely; the
          phrase "elevated access" is deliberately absent. */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Give this shared device {role === "ADMIN" ? "admin" : "manager"} access?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>{warning}</p>
                {consequences.length > 0 && (
                  <ul className="list-disc pl-4 space-y-1">
                    {consequences.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false)
                void submit()
              }}
            >
              Create anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
