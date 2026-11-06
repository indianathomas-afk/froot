/**
 * BUG-27 acceptance fixture: on /hr/training an archived module's badge reads
 * "Archived" (muted), never "Active", on cards AND table, and the bulk bar
 * pluralises its count. Same rulings as BUG-26 (R1–R2), applied to training.
 *
 *   npx tsx scripts/verify-bug27.ts
 *
 * SOURCE CHECKS ONLY. No database, no network. StatusBadge is local to
 * training-client.tsx, so the fixture reads that file and asserts on the
 * component and on each of its call sites. Section B evaluates the label and
 * style choice over all four (isArchived, isActive) states with the same
 * expressions, which Section A checks are the ones in the source.
 */
import { readFileSync } from "node:fs"

let pass = 0
let fail = 0
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`}`)
}

const FILE = "src/app/(app)/hr/training/training-client.tsx"
const src = readFileSync(FILE, "utf8")

console.log("A — StatusBadge handles isArchived first, at every call site")
check("StatusBadge takes isArchived", src.includes("function StatusBadge({ isActive, isArchived }: { isActive: boolean; isArchived: boolean })"), true)
check("label checks isArchived first", src.includes(`{isArchived ? "Archived" : isActive ? "Active" : "Inactive"}`), true)
check("success style requires !isArchived", src.includes(`!isArchived && isActive ? "bg-[var(--color-success-bg)]`), true)
const calls = src.match(/<StatusBadge\b[^>]*\/>/g) ?? []
check("two call sites (cards + table)", calls.length, 2)
check("every call site passes isArchived={m.isArchived}", calls.filter((c) => !c.includes("isArchived={m.isArchived}")), [])
check("no isActive-only Active/Inactive ternary left in the file", /(?<!"Archived" : )\bisActive \? "Active" : "Inactive"/.test(src), false)

console.log("B — the four states")
const label = (t: { isArchived: boolean; isActive: boolean }) =>
  t.isArchived ? "Archived" : t.isActive ? "Active" : "Inactive"
const success = (t: { isArchived: boolean; isActive: boolean }) => !t.isArchived && t.isActive
check("archived + active   → Archived, muted", [label({ isArchived: true, isActive: true }), success({ isArchived: true, isActive: true })], ["Archived", false])
check("archived + inactive → Archived, muted", [label({ isArchived: true, isActive: false }), success({ isArchived: true, isActive: false })], ["Archived", false])
check("live + active       → Active, success (unchanged)", [label({ isArchived: false, isActive: true }), success({ isArchived: false, isActive: true })], ["Active", true])
check("live + inactive     → Inactive, muted (unchanged)", [label({ isArchived: false, isActive: false }), success({ isArchived: false, isActive: false })], ["Inactive", false])

console.log("C — the bulk bar pluralises")
check("no bare \"modules selected\"", src.includes("} modules selected"), false)
check("count-aware form is present", src.includes(`{selected.size} module{selected.size !== 1 ? "s" : ""} selected`), true)
const word = (n: number) => `${n} module${n !== 1 ? "s" : ""} selected`
check("1 → singular", word(1), "1 module selected")
check("2 → plural", word(2), "2 modules selected")

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
