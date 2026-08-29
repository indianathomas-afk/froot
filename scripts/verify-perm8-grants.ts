/**
 * PERM-8 — the above-baseline grant model, pinned.
 *
 *   npx tsx scripts/verify-perm8-grants.ts
 *
 * PURE, AND DELIBERATELY SO — the same shape as verify-comp-confidential.ts and
 * for the same reason. What this checks is not a query: it is the precedence
 * inside can() and the constraint list beside it. A database-backed fixture
 * would be green on dev's seven User rows (measured 2026-08-29, branch
 * br-broad-wave-a6vpjdw0, zero of which carry any grant) and would prove
 * nothing at all.
 *
 * A SIBLING RATHER THAN AN EXTENSION of verify-comp-confidential.ts: that file
 * is COMP-1's claim about compensation confidentiality, and PERM-8 touches
 * neither. Both are run at the end of this session; neither replaces the other.
 *
 * WHAT THIS CAN DETECT, stated so a green run means something:
 *   - THE ELEVATION BRANCH LOSING ITS GUARD. If can()'s last line drops the
 *     isGrantable() half, any capability in a user's grantedCapabilities column
 *     starts working — including users.manage on a STAFF account. Cases 10-13.
 *   - DENIAL STOPPING BEATING GRANT. If the denial check is moved below the
 *     elevation branch, a granted-and-denied user comes back true and a
 *     revocation silently fails. Cases 14-16.
 *   - THE GRANT LIST WIDENING BY ROLE. If GRANTABLE_CAPABILITIES gains a role
 *     it should not have, or an "all roles" spelling is introduced, cases 4-8
 *     fail.
 *   - THE BASELINE MOVING. If staff.import.square is ever taken off ADMIN_ONLY,
 *     case 2 fails — which matters because staff/page.tsx's canImport line
 *     relies on that tier to keep the Import button away from ungranted
 *     managers.
 *   - THE SPLIT COLLAPSING. If the bulk re-sync ever becomes grantable, case 9
 *     fails. That capability terminates staff members.
 *
 * WHAT IT CANNOT DETECT, equally important: it does not prove that PATCH
 * /api/users/[id] rejects a hand-rolled grant, because that is a route and this
 * is a unit fixture. The 400 is checked in the staging protocol (test 4). It
 * also cannot prove any ROUTE calls can() — the 403 tests on staging are for
 * that, and this fixture is not a substitute for either.
 */
import { can, isGrantable, type Capability, type PermissionUser } from "../src/lib/permissions"

let failures = 0
function check(name: string, actual: unknown, expected: unknown) {
  const ok = actual === expected
  if (!ok) failures++
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`)
}

// A caller with grants, built the way actorFor() builds one.
function withGrants(role: string, grants: Capability[], denied: Capability[] = []): PermissionUser {
  return {
    role,
    overrides: { loaded: true, denied: new Set(denied) },
    grants: new Set(grants),
  }
}

const IMPORT: Capability = "staff.import.square"
const BULK_SYNC: Capability = "staff.sync.square"
const USERS_MANAGE: Capability = "users.manage"

console.log("\nPERM-8 — above-baseline grants\n")

console.log("Baselines are UNMOVED — the split changed who enforces, not who is allowed")
check("1. ADMIN has the import capability at baseline", can({ role: "ADMIN" }, IMPORT), true)
// If this ever goes true, staff/page.tsx's canImport (which has no isAdmin &&)
// hands the Import button to EVERY manager in the org.
check("2. MANAGER does NOT have it at baseline", can({ role: "MANAGER" }, IMPORT), false)
check("3. ADMIN has the bulk re-sync at baseline", can({ role: "ADMIN" }, BULK_SYNC), true)

console.log("\nisGrantable — the constraint list, and it is ROLE-SPECIFIC")
check("4. import → MANAGER", isGrantable(IMPORT, "MANAGER"), true)
check("5. import → STORE", isGrantable(IMPORT, "STORE"), false)
check("6. import → STAFF", isGrantable(IMPORT, "STAFF"), false)
check("7. import → unknown role", isGrantable(IMPORT, "OWNER"), false)
check("8. import → null role", isGrantable(IMPORT, null), false)
// The destructive half. Granting this would let a manager terminate staff
// members org-wide and wipe every store assignment.
check("9. BULK RE-SYNC is not grantable to MANAGER", isGrantable(BULK_SYNC, "MANAGER"), false)

console.log("\nA capability NOT on the grantable list cannot be granted (Gary's assertion 1)")
// THE CASE THIS FIXTURE EXISTS FOR. Both users below have the capability
// sitting in their grantedCapabilities set. can() must still refuse, because
// the stored column is not the authority — the list is, re-checked on every
// read. If the isGrantable() half of the elevation branch is ever dropped,
// every one of these flips to true.
check("10. MANAGER granted users.manage (not on the list)", can(withGrants("MANAGER", [USERS_MANAGE]), USERS_MANAGE), false)
check("11. STAFF granted users.manage", can(withGrants("STAFF", [USERS_MANAGE]), USERS_MANAGE), false)
check("12. STORE granted the import (listed, but not for STORE)", can(withGrants("STORE", [IMPORT]), IMPORT), false)
check("13. MANAGER granted the bulk re-sync", can(withGrants("MANAGER", [BULK_SYNC]), BULK_SYNC), false)

console.log("\nThe grant that IS allowed, and denial beating it (Gary's assertion 2)")
check("14. MANAGER granted the import", can(withGrants("MANAGER", [IMPORT]), IMPORT), true)
// DENIAL BEATS GRANT. Both columns name the capability; the answer is no. If
// the denial check is ever moved below the elevation branch this returns true
// and an admin who revoked access would not have revoked it.
check("15. ...granted AND denied → denied wins", can(withGrants("MANAGER", [IMPORT], [IMPORT]), IMPORT), false)
// The same precedence on the baseline side, unchanged from PERM-5.
check("16. ADMIN denied the import (baseline + denial)", can(withGrants("ADMIN", [], [IMPORT]), IMPORT), false)

console.log("\nPre-PERM-8 callers are UNAFFECTED — no grants threaded, no behaviour change")
// Every unmigrated `{ role }` call site in the codebase looks like this. If any
// of these change, the grant layer has leaked into call sites that never opted
// into it.
check("17. bare { role } ADMIN", can({ role: "ADMIN" }, IMPORT), true)
check("18. bare { role } MANAGER", can({ role: "MANAGER" }, IMPORT), false)
check("19. actor with overrides but grants undefined", can({ role: "MANAGER", overrides: { loaded: true, denied: new Set() } }, IMPORT), false)
// The PERM-5 fail-closed rule, re-checked because can() was reordered: a failed
// override load must still restrict, and must not be rescued by a grant.
check("20. failed override load restricts, even with a valid grant", can({ role: "MANAGER", overrides: { loaded: false }, grants: new Set([IMPORT]) }, IMPORT), false)

console.log(
  failures === 0
    ? "\nAll checks passed.\n"
    : `\n${failures} CHECK(S) FAILED.\n`
)
process.exit(failures === 0 ? 0 : 1)
