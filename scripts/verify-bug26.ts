/**
 * BUG-26 acceptance fixture: an archived template's card badge reads
 * "Archived" (muted), never "Active", and the /templates bulk bar pluralises
 * its count.
 *
 *   npx tsx scripts/verify-bug26.ts
 *
 * SOURCE CHECKS ONLY. No database, no network. The badge is a JSX ternary
 * inside templates-client.tsx, so the fixture reads the file and asserts on
 * the expressions. Section B also evaluates the label and the style choice
 * over all four (isArchived, isActive) states, using the same expressions the
 * card uses, copied here and checked against the source.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

let pass = 0
let fail = 0
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`}`)
}

const DIR = "src/app/(app)/templates"
const CLIENT = `${DIR}/templates-client.tsx`
const src = readFileSync(CLIENT, "utf8")

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : []
  })
}
const files = walk(DIR)

console.log("A — the badge handles isArchived first, everywhere it renders")
const LABEL = `{template.isArchived ? "Archived" : template.isActive ? "Active" : "Inactive"}`
const STYLE = `!template.isArchived && template.isActive ? "bg-[var(--color-success-bg)]`
check("card label expression checks isArchived first", src.includes(LABEL), true)
check("card success style requires !isArchived", src.includes(STYLE), true)
const bareTernary = files.filter((f) => /\bisActive \? "Active" : "Inactive"/.test(readFileSync(f, "utf8").replace(LABEL, "")))
check("no isActive-only Active/Inactive ternary left under /templates", bareTernary, [])
const activeLabels = files.flatMap((f) =>
  (readFileSync(f, "utf8").match(/\? "Active" :/g) ?? []).map(() => f),
)
check("exactly one Active badge render under /templates (the card)", activeLabels, [CLIENT])

console.log("B — the four states")
const label = (t: { isArchived: boolean; isActive: boolean }) =>
  t.isArchived ? "Archived" : t.isActive ? "Active" : "Inactive"
const success = (t: { isArchived: boolean; isActive: boolean }) => !t.isArchived && t.isActive
check("archived + active   → Archived, muted", [label({ isArchived: true, isActive: true }), success({ isArchived: true, isActive: true })], ["Archived", false])
check("archived + inactive → Archived, muted", [label({ isArchived: true, isActive: false }), success({ isArchived: true, isActive: false })], ["Archived", false])
check("live + active       → Active, success (unchanged)", [label({ isArchived: false, isActive: true }), success({ isArchived: false, isActive: true })], ["Active", true])
check("live + inactive     → Inactive, muted (unchanged)", [label({ isArchived: false, isActive: false }), success({ isArchived: false, isActive: false })], ["Inactive", false])

console.log("C — the bulk bar pluralises")
check("no bare \"templates selected\" under /templates", files.filter((f) => readFileSync(f, "utf8").includes("templates selected")), [])
const PLURAL = `{selected.size} template{selected.size !== 1 ? "s" : ""} selected`
check("count-aware form is present", src.includes(PLURAL), true)
const word = (n: number) => `${n} template${n !== 1 ? "s" : ""} selected`
check("1 → singular", word(1), "1 template selected")
check("2 → plural", word(2), "2 templates selected")

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
