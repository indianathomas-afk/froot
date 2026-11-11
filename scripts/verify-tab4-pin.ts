/**
 * TAB-4 acceptance fixture — per-person PIN on shared tablets.
 *
 *   npx tsx scripts/verify-tab4-pin.ts
 *
 * Rulings: Gary, 2026-11-10 (Q1–Q11, pasted in chat; DRAFT in DECISIONS.md).
 * Plan: docs/prompts/TAB-4_PLAN.md (+ its addendum). Audit: TAB-4_AUDIT.md.
 *
 *   A. Pure — hashing, the token, the gate, the "who" list, the PIN-set
 *      permission matrix, the env check. No database.
 *   B. Structure — where the gate sits in each route, that nothing keys on the
 *      Tablet/Desktop view, that ONE file reads pinHash and only the verify
 *      route imports it, that no raw SQL reads StaffMember, that the switch
 *      refuses to turn on without both secrets. Negative controls included.
 *   C. Database (dev branch) — the atomic lockout against real rows, in series
 *      and in parallel; one AuditLog row per lockout; the hash never comes back
 *      from an ordinary read; the readiness line. Rows are under "TAB-4
 *      Fixture Org", staff "TAB-4 Staff …" (CLAUDE.md § Name every test
 *      principal), deleted in `finally`. NEEDS THE TAB-4 MIGRATION APPLIED.
 */
import "dotenv/config"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { prisma } from "../src/lib/prisma"
import {
  PIN_LOCK_MS,
  PIN_TOKEN_TTL_MS,
  hashPin,
  pinEnv,
  signPinToken,
  verifyPinHash,
  verifyPinToken,
} from "../src/lib/tablet-pin"
import { PIN_NAME_REQUIRED, checkPinGate, pinGateApplies } from "../src/lib/tablet-pin-gate"
import { NO_PIN_NOTE, whoOptions } from "../src/lib/tablet-pin-options"
import { PIN_ADMIN_ONLY, decidePinAccess } from "../src/lib/tablet-pin-access"
import { attemptPin, type PinAttemptResult } from "../src/lib/tablet-pin-attempt"
import { readinessLine, tabletPinReadiness } from "../src/lib/tablet-pin-staff"

let passes = 0
let failures = 0
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) passes++
  else failures++
  console.log(`${ok ? "  ok  " : "FAIL  "}${name}${ok ? "" : `\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`)
}

const ENV = { TABLET_PIN_PEPPER: "tab4-fixture-pepper", TABLET_TOKEN_SECRET: "tab4-fixture-token-secret" }
const PEPPER = ENV.TABLET_PIN_PEPPER
const SECRET = ENV.TABLET_TOKEN_SECRET
const T0 = Date.UTC(2026, 10, 10, 18, 0, 0)
const A = { staffId: "staff-A", storeId: "store-1", orgId: "org-1", userId: "user-store-login" }

async function pure() {
  // ─── A. PURE ─────────────────────────────────────────────────────────────
  console.log("A. Pure")

  const h1 = await hashPin("4321", PEPPER)
  const h2 = await hashPin("4321", PEPPER)
  check("A1. hash: scrypt$N$r$p$salt$hash shape", /^scrypt\$\d+\$\d+\$\d+\$[^$]+\$[^$]+$/.test(h1), true)
  check("A2. hash: never contains the PIN", h1.includes("4321"), false)
  check("A3. hash: salted (same PIN, different hash)", h1 === h2, false)
  check("A4. verify: right PIN", await verifyPinHash("4321", h1, PEPPER), true)
  check("A5. verify: wrong PIN", await verifyPinHash("4322", h1, PEPPER), false)
  check("A6. verify: a rotated pepper invalidates the PIN", await verifyPinHash("4321", h1, "another-pepper"), false)
  check("A7. verify: malformed stored value is a mismatch, not a throw", await verifyPinHash("4321", "nonsense", PEPPER), false)
  check("A8. verify: non-4-digit input refused", await verifyPinHash("43210", h1, PEPPER), false)
  let threw = false
  try {
    await hashPin("12a4", PEPPER)
  } catch {
    threw = true
  }
  check("A9. hash: refuses a non-4-digit PIN", threw, true)

  const tok = signPinToken(A, SECRET, T0)
  check("A10. token: verifies for the same person/store/org/login", verifyPinToken(tok, A, SECRET, T0 + 1000), { ok: true })
  check("A11. token: A's token refused for person B", verifyPinToken(tok, { ...A, staffId: "staff-B" }, SECRET, T0), { ok: false, reason: "mismatch" })
  check("A12. token: refused for another store", verifyPinToken(tok, { ...A, storeId: "store-2" }, SECRET, T0), { ok: false, reason: "mismatch" })
  check("A13. token: refused for another org", verifyPinToken(tok, { ...A, orgId: "org-2" }, SECRET, T0), { ok: false, reason: "mismatch" })
  check("A14. token: refused for another login", verifyPinToken(tok, { ...A, userId: "user-other" }, SECRET, T0), { ok: false, reason: "mismatch" })
  check("A15. token: expired token refused (10 min + 1 ms)", verifyPinToken(tok, A, SECRET, T0 + PIN_TOKEN_TTL_MS + 1), { ok: false, reason: "expired" })
  check("A16. token: still good at 9m59s", verifyPinToken(tok, A, SECRET, T0 + PIN_TOKEN_TTL_MS - 1000), { ok: true })
  check("A17. token: wrong secret → signature refused", verifyPinToken(tok, A, "other-secret", T0), { ok: false, reason: "signature" })
  const [body, sig] = tok.split(".")
  const forged = Buffer.from(JSON.stringify({ s: "staff-B", st: A.storeId, o: A.orgId, u: A.userId, exp: T0 + 9e9 })).toString("base64url")
  check("A18. token: payload swapped under the old signature → refused", verifyPinToken(`${forged}.${sig}`, { ...A, staffId: "staff-B" }, SECRET, T0), { ok: false, reason: "signature" })
  check("A19. token: missing → refused", verifyPinToken(undefined, A, SECRET, T0), { ok: false, reason: "missing" })
  check("A20. token: truncated signature → refused (length check before timingSafeEqual)", verifyPinToken(`${body}.${sig.slice(0, 10)}`, A, SECRET, T0), { ok: false, reason: "signature" })

  // The gate. `view` is not an input at all — that IS the Desktop-view test:
  // a STORE login is gated by role, whatever the device's view cookie says.
  const on = { id: A.orgId, tabletPinRequired: true }
  const off = { id: A.orgId, tabletPinRequired: false }
  const gate = (o: typeof on, role: string, staffId: string | null, token: unknown, env: Record<string, string | undefined> = ENV, now = T0) =>
    checkPinGate({ org: o, role, userId: A.userId, storeId: A.storeId, staffId, token, env, now })

  check("A21. gate: switch OFF → STORE tick accepted with no token", gate(off, "STORE", A.staffId, undefined), { ok: true, freshToken: null })
  check("A22. gate: switch ON, personal login (MANAGER) → accepted, never asked", gate(on, "MANAGER", A.staffId, undefined), { ok: true, freshToken: null })
  check("A23. gate: switch ON, personal login (ADMIN, STAFF) → accepted", [gate(on, "ADMIN", null, undefined).ok, gate(on, "STAFF", null, undefined).ok], [true, true])
  const noTok = gate(on, "STORE", A.staffId, undefined)
  check("A24. gate: STORE login (Tablet OR Desktop view) without a token → refused 403 pin_required", noTok.ok ? "accepted" : [noTok.status, noTok.code], [403, "pin_required"])
  const unnamed = gate(on, "STORE", null, tok)
  check("A25. gate: STORE login unnamed (Team Member / Manager) → refused 400 name_required", unnamed.ok ? "accepted" : [unnamed.status, unnamed.code, unnamed.error], [400, "name_required", PIN_NAME_REQUIRED])
  check("A26. gate: A's token refused for a tick naming B", gate(on, "STORE", "staff-B", tok).ok, false)
  check("A27. gate: expired token refused", gate(on, "STORE", A.staffId, tok, ENV, T0 + PIN_TOKEN_TTL_MS + 1).ok, false)
  const good = gate(on, "STORE", A.staffId, tok, ENV, T0 + 5 * 60_000)
  check("A28. gate: valid token → accepted with a fresh token", good.ok && typeof good.freshToken === "string", true)
  if (good.ok && good.freshToken) {
    check("A29. gate: the fresh token is SLIDING — good at T0+5m+9m59s, past the old one's expiry", verifyPinToken(good.freshToken, A, SECRET, T0 + 5 * 60_000 + PIN_TOKEN_TTL_MS - 1000), { ok: true })
  }
  const failClosed = gate(on, "STORE", A.staffId, tok, { TABLET_PIN_PEPPER: PEPPER })
  check("A30. gate: switch ON + TABLET_TOKEN_SECRET missing → tick FAILS CLOSED (503), never skipped", failClosed.ok ? "accepted" : [failClosed.status, failClosed.code], [503, "pin_not_configured"])
  const failClosed2 = gate(on, "STORE", A.staffId, tok, { TABLET_TOKEN_SECRET: SECRET })
  check("A31. gate: switch ON + TABLET_PIN_PEPPER missing → fails closed too", failClosed2.ok ? "accepted" : failClosed2.status, 503)
  check("A32. gate: switch OFF + both vars missing → nothing changes (accepted)", gate(off, "STORE", null, undefined, {}).ok, true)
  check("A33. pinGateApplies: only switch on AND STORE", [pinGateApplies(on, "STORE"), pinGateApplies(on, "MANAGER"), pinGateApplies(off, "STORE")], [true, false, false])

  check("A34. env: both present → ok", pinEnv(ENV).ok, true)
  check("A35. env: the switch's precondition — either missing → not ok, names it", pinEnv({ TABLET_PIN_PEPPER: " " }), { ok: false, missing: ["TABLET_PIN_PEPPER", "TABLET_TOKEN_SECRET"] })

  const staff = [
    { id: "s1", displayName: "Ana", hasPin: true },
    { id: "s2", displayName: "Ben", hasPin: false },
  ]
  check("A36. who list, switch OFF: Team Member + Manager, then every name (today's list)", whoOptions(staff, false).map((o) => [o.label, !!o.disabled]), [["Team Member", false], ["Manager", false], ["Ana", false], ["Ben", false]])
  check("A37. who list, switch ON: the generic options are HIDDEN (Q7)", whoOptions(staff, true).some((o) => o.generic || o.id === "manager"), false)
  check("A38. who list, switch ON: no-PIN name greyed with the note (Q6)", whoOptions(staff, true).map((o) => [o.label, !!o.disabled, o.note ?? null]), [["Ana", false, null], ["Ben", true, NO_PIN_NOTE]])

  // PIN-set permission matrix (Q5).
  const mgr = { role: "MANAGER", isAdmin: false, storeIds: ["store-1"], selfStaffId: "staff-mgr" }
  const plain = { id: "staff-x", storeIds: ["store-1"], loginRole: null }
  check("A39. access: ADMIN sets anyone's PIN", decidePinAccess({ role: "ADMIN", isAdmin: true, storeIds: [], selfStaffId: null }, { ...plain, loginRole: "ADMIN" }), { ok: true, by: "admin" })
  check("A40. access: MANAGER sets their OWN PIN", decidePinAccess(mgr, { id: "staff-mgr", storeIds: ["store-1"], loginRole: "MANAGER" }), { ok: true, by: "self" })
  check("A41. access: MANAGER sets their store's staff", decidePinAccess(mgr, plain), { ok: true, by: "manager" })
  check("A42. access: MANAGER can't reset an ADMIN's PIN", decidePinAccess(mgr, { ...plain, loginRole: "ADMIN" }), { ok: false, status: 403, error: PIN_ADMIN_ONLY })
  check("A43. access: MANAGER can't reset another MANAGER's PIN", decidePinAccess(mgr, { ...plain, loginRole: "MANAGER" }), { ok: false, status: 403, error: PIN_ADMIN_ONLY })
  check("A44. access: MANAGER, staff outside their stores → 404", decidePinAccess(mgr, { ...plain, storeIds: ["store-9"] }).ok ? "allowed" : "refused", "refused")
  check("A45. access: STORE login → refused", decidePinAccess({ role: "STORE", isAdmin: false, storeIds: ["store-1"], selfStaffId: null }, plain).ok, false)
}

// ─── B. STRUCTURE ──────────────────────────────────────────────────────────
function structure() {
  console.log("\nB. Structure")
  const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/.*$/gm, "")
  const TASKLOG = readFileSync("src/app/api/checklists/[id]/task-log/route.ts", "utf8")
  const CAL = readFileSync("src/app/api/calendar/occurrences/[id]/complete/route.ts", "utf8")
  const GATE = readFileSync("src/lib/tablet-pin-gate.ts", "utf8")
  const SETTINGS = readFileSync("src/app/api/settings/tablet-pin/route.ts", "utf8")
  const PRISMA = readFileSync("src/lib/prisma.ts", "utf8")

  function taskLogOrderOk(src: string): boolean {
    const c = code(src)
    const resolve = c.indexOf("resolveTaskLogStaff({")
    const gate = c.indexOf("checkPinGate({")
    const pending = c.indexOf('status: "In Progress"')
    const create = c.indexOf("prisma.taskLog.create(")
    const guard = c.lastIndexOf("if (!existing) {", gate)
    return resolve > 0 && gate > resolve && guard > resolve && guard < gate && gate < pending && gate < create && /role,\s*\n\s*userId: dbUser\?\.id/.test(c)
  }
  check("B1. task-log: gate after CHK-15 resolve, inside `!existing` (un-tick never gated), before the Pending write and the create", taskLogOrderOk(TASKLOG), true)
  check("B2. NC: gate moved below the Pending write → B1 rejects", taskLogOrderOk(TASKLOG.replace("  // Upsert task log", "  checkPinGate({ x })\n  // Upsert task log").replace(/const gate = checkPinGate\(\{/, "const gate = noop({")), false)

  function calOrderOk(src: string): boolean {
    const c = code(src)
    const resolve = c.indexOf("resolveTaskLogStaff({")
    const gate = c.indexOf("checkPinGate({")
    const write = c.indexOf("prisma.calendarOccurrence.updateMany(")
    return resolve > 0 && gate > resolve && gate < write && !/where: \{ id: body\.completedByStaffId, organizationId/.test(c)
  }
  check("B3. calendar complete: CHK-15 resolver (parity) then the PIN gate, both before the write; the org-only check is gone", calOrderOk(CAL), true)
  check("B4. NC: org-only staff check restored → B3 rejects", calOrderOk(CAL.replace("resolveTaskLogStaff({", "prisma.staffMember.findFirst({ where: { id: body.completedByStaffId, organizationId: x } }); resolveTaskLogStaff({")), false)

  const viewFree = (src: string) => !/view-mode|froot_view|getViewMode|VIEW_COOKIE/.test(code(src))
  check("B5. the gate and both routes never read the Tablet/Desktop view (a STORE login is gated in Desktop view too)", [viewFree(GATE), viewFree(TASKLOG), viewFree(CAL)], [true, true, true])
  check("B6. NC: a view check added to the gate → B5 rejects", viewFree(GATE + '\nimport { getViewMode } from "@/lib/view-mode-server"'), false)

  // Every file under src/ that selects pinHash.
  const files: string[] = []
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f)
      if (statSync(p).isDirectory()) {
        if (f !== "generated") walk(p)
      } else if (/\.(ts|tsx)$/.test(f)) files.push(p)
    }
  }
  walk("src")
  const readers = files.filter((f) => /pinHash:\s*true/.test(code(readFileSync(f, "utf8"))) && f !== "src/lib/prisma.ts")
  check("B7. exactly ONE file opts back in to reading pinHash", readers, ["src/lib/tablet-pin-attempt.ts"])
  const importers = files.filter((f) => /from "@\/lib\/tablet-pin-attempt"/.test(readFileSync(f, "utf8")))
  check("B8. …and only the verify route imports it", importers, ["src/app/api/tablet-pin/verify/route.ts"])
  check("B9. the client omits pinHash globally", /omit:\s*\{\s*staffMember:\s*\{\s*pinHash:\s*true\s*\}\s*\}/.test(code(PRISMA)), true)
  const rawStaff = files.filter((f) => {
    const c = code(readFileSync(f, "utf8"))
    return /\$(queryRaw|executeRaw|queryRawUnsafe|executeRawUnsafe)/.test(c) && /"StaffMember"/.test(c)
  })
  check("B10. no raw SQL anywhere in src/ touches \"StaffMember\" (the omit can't cover raw queries)", rawStaff, [])
  const responders = files.filter((f) => /pinHash/.test(code(readFileSync(f, "utf8"))) && /NextResponse\.json\([^)]*pinHash/.test(code(readFileSync(f, "utf8"))))
  check("B11. no route puts pinHash in a response", responders, [])

  const switchOk = (src: string) => /parsed\.data\.enabled && !pinEnv\(\)\.ok\)[\s\S]{0,200}status: 409/.test(code(src))
  check("B12. the switch refuses to turn ON with a var missing (409), and turning OFF is always allowed", switchOk(SETTINGS), true)
  check("B13. NC: precondition removed → B12 rejects", switchOk(SETTINGS.replace("parsed.data.enabled && !pinEnv().ok", "false")), false)

  // THE 5TH-PIN RACE (Gary, 2026-11-10: "State plainly whether a correct 5th
  // PIN can come back locked"). A request that WON a slot at the reservation
  // never reads the lock again: the compare decides, and a right PIN returns
  // "ok" before anything else. So a correct PIN that got a slot — the 5th
  // included — cannot come back locked. (A 6th try can lock the name while the
  // 5th is still comparing; C16 covers that side.)
  const ATTEMPT = readFileSync("src/lib/tablet-pin-attempt.ts", "utf8")
  const rightFirst = (src: string) => {
    const c = code(src)
    const after = c.slice(c.indexOf("// 2.") >= 0 ? c.indexOf("const right =") : c.indexOf("const right ="))
    const okAt = after.indexOf('return { kind: "ok" }')
    const between = after.slice(0, okAt)
    return okAt > 0 && !/pinLockedUntil/.test(between) && !/lockOut\(/.test(between)
  }
  check("B14. a PIN that won a slot and is RIGHT returns ok with no lock read or lock set in between", rightFirst(ATTEMPT), true)
  check(
    "B15. NC: a lock re-check inserted before the ok → B14 rejects",
    rightFirst(ATTEMPT.replace("  if (right) {", "  const relock = await prisma.staffMember.findFirst({ select: { pinLockedUntil: true } })\n  if (right) {")),
    false
  )
}

// ─── C. DATABASE (dev) ─────────────────────────────────────────────────────
async function db() {
  console.log("\nC. Database (dev branch)")
  const branch = await prisma.$queryRaw<{ b: string | null }[]>`select current_setting('neon.branch_id', true) as b`
  console.log(`     branch id: ${branch[0]?.b ?? "(null — not Neon)"}  — expected dev br-broad-wave-a6vpjdw0`)

  const stamp = Date.now()
  const org = await prisma.organization.create({ data: { clerkOrgId: `tab4-fixture-${stamp}`, name: "TAB-4 Fixture Org" } })
  try {
    const store = await prisma.store.create({
      data: { organizationId: org.id, name: "TAB-4 Store", timezone: "America/Los_Angeles", squareLocationId: `tab4-loc-${stamp}` },
    })
    const mk = (name: string) =>
      prisma.staffMember.create({
        data: { organizationId: org.id, displayName: `TAB-4 Staff ${name}`, storeAssignments: { create: { storeId: store.id } } },
        select: { id: true },
      })
    const ana = await mk("Ana")
    await mk("Ben") // no PIN — for the readiness line
    const setPin = async (id: string, pin: string) =>
      prisma.staffMember.update({
        where: { id },
        data: { pinHash: await hashPin(pin, PEPPER), pinSetAt: new Date(), pinFailedAttempts: 0, pinLockedUntil: null },
        select: { id: true },
      })
    await setPin(ana.id, "2468")
    const now0 = new Date()
    const at = (ms: number) => new Date(now0.getTime() + ms)
    const attempt = (pin: string, now: Date) =>
      attemptPin({ organizationId: org.id, staffId: ana.id, storeId: store.id, pin, pepper: PEPPER, clerkUserId: null, staffName: "TAB-4 Staff Ana", now })
    const lockRows = () => prisma.auditLog.count({ where: { organizationId: org.id, action: "staff.pin.lockout", entityId: ana.id } })
    const counter = async () => (await prisma.staffMember.findFirst({ where: { id: ana.id }, select: { pinFailedAttempts: true } }))?.pinFailedAttempts

    // A plain read never carries the hash (global omit), nested or not.
    const plainRow = (await prisma.staffMember.findFirst({ where: { id: ana.id } })) as Record<string, unknown> | null
    check("C1. an ordinary staffMember read has NO pinHash key", !!plainRow && !("pinHash" in plainRow), true)
    const viaStore = await prisma.store.findFirst({ where: { id: store.id }, include: { staffAssignments: { include: { staffMember: true } } } })
    const nested = (viaStore?.staffAssignments[0]?.staffMember ?? {}) as Record<string, unknown>
    check("C2. …nor through a nested include", "pinHash" in nested, false)
    check("C3. pinSetAt is what says 'has a PIN'", plainRow?.pinSetAt instanceof Date, true)

    check("C4. right PIN → ok", await attempt("2468", at(0)), { kind: "ok" })
    check("C5. wrong PIN → wrong, 4 tries left", await attempt("1111", at(1000)), { kind: "wrong", triesLeft: 4 })
    check("C6. right PIN resets the count", [await attempt("2468", at(2000)), await counter()], [{ kind: "ok" }, 0])

    const series: PinAttemptResult[] = []
    for (let i = 0; i < 4; i++) series.push(await attempt("1111", at(3000 + i)))
    check("C7. tries 1–4 wrong → 4, 3, 2, 1 left", series.map((r) => (r.kind === "wrong" ? r.triesLeft : r.kind)), [4, 3, 2, 1])
    check("C8. try 5 wrong → LOCKED for 5 minutes", await attempt("1111", at(4000)), { kind: "locked", minutes: 5 })
    check("C9. one AuditLog lockout row", await lockRows(), 1)
    check("C10. the 6th try is locked out — even with the RIGHT PIN", (await attempt("2468", at(5000))).kind, "locked")
    check("C11. locked tries consume nothing and write no second row", [await counter(), await lockRows()], [0, 1])
    check("C12. after the 5-minute window the right PIN works (count clean)", await attempt("2468", at(4000 + PIN_LOCK_MS + 1)), { kind: "ok" })

    // Parallel: 8 wrong tries at once can never get past 5.
    await setPin(ana.id, "2468")
    const tLater = at(4000 + PIN_LOCK_MS + 60_000)
    const burst = await Promise.all(Array.from({ length: 8 }, () => attempt("9999", tLater)))
    const wrong = burst.filter((r) => r.kind === "wrong").length
    const locked = burst.filter((r) => r.kind === "locked").length
    check("C13. 8 parallel wrong tries: exactly 4 'wrong', 4 'locked' — the count never passes 5", [wrong, locked], [4, 4])
    check("C14. …and still exactly ONE new lockout row", await lockRows(), 2)
    const after = await prisma.staffMember.findFirst({ where: { id: ana.id }, select: { pinFailedAttempts: true, pinLockedUntil: true } })
    check("C15. …locked, counter zeroed", [!!after?.pinLockedUntil && after.pinLockedUntil > tLater, after?.pinFailedAttempts], [true, 0])

    // The race's other side: slot 5 is held by a try still comparing (counter
    // full, no lock yet). A 6th try — even with the RIGHT PIN — is locked out
    // and sets the lock itself, still one AuditLog row. (The in-flight 5th, if
    // right, returns ok — B14 — but the name stays locked for 5 minutes.)
    await setPin(ana.id, "2468")
    await prisma.staffMember.update({ where: { id: ana.id }, data: { pinFailedAttempts: 5 }, select: { id: true } })
    const rowsBefore = await lockRows()
    const tRace = at(4000 + PIN_LOCK_MS + 120_000)
    const sixth = await attempt("2468", tRace)
    const raced = await prisma.staffMember.findFirst({ where: { id: ana.id }, select: { pinFailedAttempts: true, pinLockedUntil: true } })
    check(
      "C16. slot 5 in flight: a 6th try, even RIGHT, is locked out and sets the lock (one row)",
      [sixth.kind, !!raced?.pinLockedUntil && raced.pinLockedUntil > tRace, raced?.pinFailedAttempts, (await lockRows()) - rowsBefore],
      ["locked", true, 0, 1]
    )

    const ready = await tabletPinReadiness(org.id)
    check("C17. readiness line (Q7)", ready.map(readinessLine), ["TAB-4 Store: 1 of 2 active staff have PINs"])
  } finally {
    await prisma.auditLog.deleteMany({ where: { organizationId: org.id } })
    await prisma.staffMember.deleteMany({ where: { organizationId: org.id } })
    await prisma.store.deleteMany({ where: { organizationId: org.id } })
    await prisma.organization.deleteMany({ where: { id: org.id } })
    const left = await prisma.organization.count({ where: { clerkOrgId: { startsWith: "tab4-fixture" } } })
    check("C18. cleanup: no TAB-4 fixture orgs left", left, 0)
  }
}

const runDb = !process.argv.includes("--no-db")
pure()
  .then(() => structure())
  .then(() => (runDb ? db() : console.log("\nC. skipped (--no-db)")))
  .catch((e) => {
    failures++
    console.error("FAIL  async section threw:", e)
  })
  .finally(async () => {
    await prisma.$disconnect()
    console.log(`\n${passes} passed, ${failures} failed`)
    process.exit(failures === 0 ? 0 : 1)
  })
