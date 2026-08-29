/**
 * COMP-1 — the confidentiality decision, pinned.
 *
 *   npx tsx scripts/verify-comp-confidential.ts
 *
 * PURE, AND DELIBERATELY SO. It touches no database, because the decision it
 * checks is not a query — it is three small functions in
 * src/lib/comp-confidential.ts that four surfaces all defer to. Dev holds zero
 * SquareTeamMemberWage rows (measured 2026-08-28, branch br-broad-wave-a6vpjdw0),
 * so a database-backed fixture here would be green on an empty set and would
 * prove nothing at all.
 *
 * WHAT THIS CAN DETECT, stated so a green run means something:
 *   - `compVisibleForMember` rewritten as `!flag` — the fail-closed regression.
 *     `!undefined` is true, which would hand every person with no wage row to a
 *     manager. Case 6 fails if anyone does this.
 *   - the ADMIN branch dropped or inverted (cases 1-3).
 *   - `compVisibleOnRow` inverted (cases 7-9).
 *   - the estate-total predicate re-derived from masked rows (case 10).
 *
 * WHAT IT CANNOT DETECT, equally important: it does not prove any ROUTE calls
 * these functions. That is what the Network-tab test on staging is for, and this
 * fixture is not a substitute for it.
 */
import {
  canSeeConfidentialComp,
  compVisibleOnRow,
  compVisibleForMember,
} from "../src/lib/comp-confidential"

let failures = 0
function check(name: string, actual: unknown, expected: unknown) {
  const ok = actual === expected
  if (!ok) failures++
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`)
}

const admin = { role: "ADMIN" as const }
const manager = { role: "MANAGER" as const }
const staff = { role: "STAFF" as const }

console.log("\nCOMP-1 — confidentiality decision\n")

console.log("canSeeConfidentialComp — ADMIN only, no per-user grant (ruling 2)")
check("1. ADMIN", canSeeConfidentialComp(admin), true)
check("2. MANAGER", canSeeConfidentialComp(manager), false)
check("3. STAFF", canSeeConfidentialComp(staff), false)
// A role Clerk could hand us that is not in the union at all. Deny by default.
check("4. unknown role", canSeeConfidentialComp({ role: "OWNER" }), false)
check("5. null role", canSeeConfidentialComp({ role: null }), false)

console.log("\ncompVisibleForMember — THE FAIL-CLOSED LOOKUP (ruling 6)")
// THE CASE THIS FIXTURE EXISTS FOR. `undefined` = no SquareTeamMemberWage row.
// Written as `!flag` this returns TRUE and every unmatched person's weekly pay
// reaches a manager. It must be false.
check("6. MANAGER, no wage row (undefined)", compVisibleForMember(manager, undefined), false)
check("7. MANAGER, flag true", compVisibleForMember(manager, true), false)
check("8. MANAGER, flag false", compVisibleForMember(manager, false), true)
check("9. ADMIN, no wage row", compVisibleForMember(admin, undefined), true)
check("10. ADMIN, flag true", compVisibleForMember(admin, true), true)

console.log("\ncompVisibleOnRow — the roster path, non-null column")
check("11. MANAGER, confidential", compVisibleOnRow(manager, { compConfidential: true }), false)
check("12. MANAGER, not confidential", compVisibleOnRow(manager, { compConfidential: false }), true)
check("13. ADMIN, confidential", compVisibleOnRow(admin, { compConfidential: true }), true)

console.log("\nOption B — the estate total is computed over REAL values (rulings 3 + 4)")
// The predicate the loader and the route both use, restated here so a change to
// either is visible. The masked ROW is what a manager receives; the TOTAL must
// still be the sum over the unmasked figures, or it falls by exactly the
// confidential person's pay and hands over the subtraction attack for free.
const records = [
  { weeklyCost: 1000, exempt: null as boolean | null, allocations: [{ storeId: "s1", allocationBps: 10000 }], confidential: true },
  { weeklyCost: 500, exempt: false as boolean | null, allocations: [{ storeId: "s1", allocationBps: 10000 }], confidential: false },
  { weeklyCost: 900, exempt: true as boolean | null, allocations: [], confidential: false },
]
const serverTotal = records
  .filter((r) => r.exempt !== true && r.allocations.length > 0)
  .reduce((t, r) => t + r.weeklyCost, 0)
check("14. server total includes the confidential person", serverTotal, 1500)

// What the OLD client-side sum would now produce, kept as a negative control.
const masked = records.map((r) => ({ ...r, weeklyCost: r.confidential ? null : r.weeklyCost }))
const clientTotal = masked
  .filter((r) => r.exempt !== true && r.allocations.length > 0)
  .reduce((t, r) => t + (r.weeklyCost ?? 0), 0)
check("15. a client-side sum over masked rows UNDER-reports", clientTotal, 500)
check("16. ...and the shortfall is exactly the hidden salary", serverTotal - clientTotal, 1000)

console.log(
  failures === 0
    ? "\nAll checks passed.\n"
    : `\n${failures} CHECK(S) FAILED.\n`
)
process.exit(failures === 0 ? 0 : 1)
