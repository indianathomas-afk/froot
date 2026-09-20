/**
 * NOTIFY-2b acceptance fixture — the shared email template.
 *
 *   npx tsx scripts/verify-notify-template.ts
 *
 * NO DATABASE, NO NETWORK, NO ENVIRONMENT. It renders the three consumers'
 * inputs with fixed values and asserts the properties that are true of every
 * email Froot sends, then writes the three bodies to /tmp so the branding can
 * be reviewed in a browser rather than argued about in a diff.
 *
 * WHY THE APP URL IS HARD-CODED HERE. The "no http://" assertion is about the
 * TEMPLATE — it must never emit a mixed-content image or link — and a fixture
 * that read NEXT_PUBLIC_APP_URL would fail on any machine whose local value is
 * http://localhost:3000, which is a fact about the dev box and not about the
 * code under test.
 */
import { renderEmail, type EmailTemplateInput } from "../src/lib/email-template"
import { writeFileSync } from "node:fs"

const APP_URL = "https://staging.usefroot.example"
const ORG = "Keva Juice"

let failures = 0
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${label}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures += 1
}

// The three real shapes, kept in the same order the consumers appear in the
// phase. Each `text` is the consumer's OWN wording, passed through verbatim —
// see the note in each consumer about why the template renders html only.
const CASES: { name: string; file: string; ctaUrl: string; input: EmailTemplateInput }[] = [
  {
    name: "hr.ack",
    file: "/tmp/froot-email-hr-ack.html",
    ctaUrl: `${APP_URL}/api/hr/signed-records/rec_123/download`,
    input: {
      orgName: ORG,
      heading: "Tommy Tester completed all required acknowledgments.",
      intro: "",
      rows: [
        { label: "Document", value: "Employee Handbook, version 3" },
        { label: "Signer", value: "Tommy Tester  (executed as: Thomas Tester)" },
        { label: "Store", value: "Keva Juice — Riverside" },
        { label: "Completed", value: "2026-09-20 18:04:11 UTC" },
      ],
      cta: { label: "Download the record", url: `${APP_URL}/api/hr/signed-records/rec_123/download` },
      footer: `Sent by USE Froot on behalf of ${ORG}. This address does not accept replies.`,
      appUrl: APP_URL,
      text: "Tommy Tester completed all required acknowledgments.",
    },
  },
  {
    name: "pace.alert",
    file: "/tmp/froot-email-pace-alert.html",
    ctaUrl: `${APP_URL}/dashboard`,
    input: {
      orgName: ORG,
      heading: "Keva Juice — Riverside is trailing its September sales goal (through 2026-09-19).",
      intro: "",
      rows: [
        { label: "Month to date", value: "$41,200 of $58,000 goal (71.0%)" },
        { label: "Projected month end", value: "$65,100 vs $92,000 goal (70.8%)" },
        { label: "Alert threshold", value: "90% of MTD goal" },
      ],
      cta: { label: "Open the dashboard", url: `${APP_URL}/dashboard` },
      footer: `You'll get at most one alert per store per month. Sent by USE Froot on behalf of ${ORG}. This address does not accept replies.`,
      appUrl: APP_URL,
      text: "Keva Juice — Riverside is trailing its September sales goal (through 2026-09-19).",
    },
  },
  {
    name: "test",
    file: "/tmp/froot-email-test.html",
    ctaUrl: `${APP_URL}/settings/notifications`,
    input: {
      orgName: ORG,
      heading: "This is a USE Froot email delivery test.",
      intro:
        "If you are reading this in an inbox, real email delivery works in this environment. " +
        "Nothing else was sent — this route only ever writes to the address on the requesting " +
        "admin's own Clerk account.",
      rows: [
        { label: "Provider", value: "resend" },
        { label: "Deployment", value: "preview @ abc1234" },
        { label: "Sent at", value: "2026-09-20T18:04:11.000Z" },
      ],
      cta: { label: "Email notification settings", url: `${APP_URL}/settings/notifications` },
      footer: `Sent by USE Froot on behalf of ${ORG}. This address does not accept replies.`,
      appUrl: APP_URL,
      text: "This is a USE Froot email delivery test.",
    },
  },
]

for (const c of CASES) {
  const { html, text } = renderEmail(c.input)
  writeFileSync(c.file, html, "utf8")

  check(`${c.name}: html names the organization`, html.includes(ORG), ORG)
  check(`${c.name}: html carries the CTA url`, html.includes(c.ctaUrl), c.ctaUrl)
  check(`${c.name}: html links the hosted mark`, html.includes(`${APP_URL}/logo.png`))
  check(`${c.name}: no <script`, !html.includes("<script"))
  check(`${c.name}: no <link`, !html.includes("<link"))
  // MIXED CONTENT. One http:// url in an https email is enough for a client to
  // block the image or warn on the link.
  check(`${c.name}: no http:// (mixed content)`, !html.includes("http://"))
  check(`${c.name}: the text part survives verbatim`, text === c.input.text)
  check(`${c.name}: written to ${c.file}`, html.length > 0, `${html.length} bytes`)
}

// ── Escaping ────────────────────────────────────────────────────────────────
// An org name is tenant-supplied and an email body gets forwarded. This is the
// check that makes the three "no <script" assertions above mean something: they
// pass trivially for a well-behaved name, and this one proves they also hold
// for a hostile one.
const hostile = renderEmail({
  ...CASES[0].input,
  orgName: `<script>alert(1)</script> & "quoted"`,
  rows: [{ label: "Store", value: "<img src=x onerror=alert(1)>" }],
})
check("hostile org name is escaped, not emitted", !hostile.html.includes("<script"))
check("hostile row value is escaped, not emitted", !hostile.html.includes("<img src=x"))
check("the escaped form is present", hostile.html.includes("&lt;script&gt;"))
check("ampersands are escaped once, not doubly", !hostile.html.includes("&amp;amp;"))

// ── A javascript: CTA never reaches the document ────────────────────────────
const badCta = renderEmail({
  ...CASES[0].input,
  cta: { label: "Click", url: "javascript:alert(1)" },
})
check("a non-http(s) CTA is dropped entirely", !badCta.html.includes("javascript:"))

// ── The F1 fallback: no host, no image ──────────────────────────────────────
const noHost = renderEmail({ ...CASES[0].input, appUrl: undefined, cta: undefined })
check("with no app url the mark is omitted rather than broken", !noHost.html.includes("<img"))
check("with no app url the wordmark still renders", noHost.html.includes("USE Froot"))

// ── The generated text part, which no consumer uses today ───────────────────
// Every current consumer passes its own wording, so this is the only thing
// exercising the generator that the NEXT consumer (NOTIFY-3, NOTIFY-4) will use.
const generated = renderEmail({ ...CASES[2].input, text: undefined }).text
const genLines = generated.split("\n")
check("generated text opens with the heading", genLines[0] === CASES[2].input.heading, genLines[0])
check("generated text pads labels into a column", genLines.includes("Provider:    resend"), JSON.stringify(genLines))
check("generated text puts the CTA url on its own line", genLines.includes(`${APP_URL}/settings/notifications`))
check("generated text ends with the footer", genLines[genLines.length - 1] === CASES[2].input.footer)

console.log(
  `\n${failures === 0 ? "All NOTIFY-2b template checks passed" : `${failures} check(s) FAILED`}` +
    `\nOpen these in a browser to review the branding:\n  ${CASES.map((c) => c.file).join("\n  ")}`
)
process.exit(failures === 0 ? 0 : 1)
