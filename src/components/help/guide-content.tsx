import Link from "next/link"
import { HelpCircle, Lock } from "lucide-react"
import type { VisibleArticle } from "@/lib/help-access"

// HELP-1a — the ONE renderer. Both shells ((app)/help and (my)/my/help) mount
// these components; nothing here knows which shell it is in beyond the
// `basePath` it is handed.
//
// EVERY component here takes VisibleArticle, never GuideArticle. That is the
// type-level half of ruling 6: an article that has not been through
// helpScope() cannot reach a renderer, because it does not have the right
// type. The filtering is not something a caller can forget to do.

// ─── MARKDOWN ────────────────────────────────────────────────────────────────
//
// A deliberately small renderer over the subset our own guide files use:
// paragraphs, `##`/`###` headings, `-` bullets, `**bold**`, `` `code` `` and
// links. NO new dependency, following audit §I's reasoning about the search
// library — the content is repo-authored in a known subset, and a full
// CommonMark implementation would be more surface than the job needs.
//
// It renders to REACT NODES, never to an HTML string, so there is no
// dangerouslySetInnerHTML anywhere in the help surface and no XSS vector to
// reason about later when article prose starts being pasted in from elsewhere.

type Inline = { text: string; bold?: boolean; code?: boolean; href?: string }

/** Split one line into bold / code / link runs. Non-nesting, by design. */
function inlines(line: string): Inline[] {
  const out: Inline[] = []
  const pattern = /(\*\*[^*]+\*\*)|(`[^`]+`)|(\[[^\]]+\]\([^)]+\))/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(line)) !== null) {
    if (match.index > last) out.push({ text: line.slice(last, match.index) })
    const token = match[0]
    if (token.startsWith("**")) {
      out.push({ text: token.slice(2, -2), bold: true })
    } else if (token.startsWith("`")) {
      out.push({ text: token.slice(1, -1), code: true })
    } else {
      const split = token.indexOf("](")
      out.push({ text: token.slice(1, split), href: token.slice(split + 2, -1) })
    }
    last = match.index + token.length
  }
  if (last < line.length) out.push({ text: line.slice(last) })
  return out
}

function Inlines({ line, inert }: { line: string; inert: boolean }) {
  return (
    <>
      {inlines(line).map((run, i) => {
        if (run.bold) return <strong key={i}>{run.text}</strong>
        if (run.code)
          return (
            <code key={i} className="rounded bg-[var(--color-muted)] px-1 py-0.5 text-[0.9em]">
              {run.text}
            </code>
          )
        if (run.href) {
          // Ruling 2, clause 3: in an upgrade preview, a link into the gated
          // routes renders INERT rather than navigating to a page the reader
          // cannot use. External links are left alone — they still work.
          const internal = run.href.startsWith("/")
          if (inert && internal) {
            return (
              <span key={i} className="text-[var(--color-muted-foreground)] underline decoration-dotted">
                {run.text}
              </span>
            )
          }
          return (
            <Link key={i} href={run.href} className="text-[var(--color-primary)] underline">
              {run.text}
            </Link>
          )
        }
        return <span key={i}>{run.text}</span>
      })}
    </>
  )
}

export function GuideMarkdown({ source, inert = false }: { source: string; inert?: boolean }) {
  const blocks: React.ReactNode[] = []
  const lines = source.split("\n")
  let paragraph: string[] = []
  let bullets: string[] = []

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    blocks.push(
      <p key={`p${blocks.length}`} className="mb-4 leading-relaxed text-[var(--color-foreground)]">
        <Inlines line={paragraph.join(" ")} inert={inert} />
      </p>
    )
    paragraph = []
  }
  const flushBullets = () => {
    if (bullets.length === 0) return
    blocks.push(
      <ul key={`u${blocks.length}`} className="mb-4 list-disc space-y-1 pl-5 text-[var(--color-foreground)]">
        {bullets.map((b, i) => (
          <li key={i} className="leading-relaxed">
            <Inlines line={b} inert={inert} />
          </li>
        ))}
      </ul>
    )
    bullets = []
  }

  for (const line of lines) {
    const heading = /^(#{2,3})\s+(.+?)\s*$/.exec(line)
    const bullet = /^[-*]\s+(.+?)\s*$/.exec(line)
    if (heading) {
      flushParagraph()
      flushBullets()
      const level = heading[1].length
      blocks.push(
        level === 2 ? (
          <h2
            key={`h${blocks.length}`}
            id={slug(heading[2])}
            className="mb-3 mt-8 text-lg font-semibold text-[var(--color-foreground)]"
          >
            {heading[2]}
          </h2>
        ) : (
          <h3 key={`h${blocks.length}`} className="mb-2 mt-6 font-semibold text-[var(--color-foreground)]">
            {heading[2]}
          </h3>
        )
      )
    } else if (bullet) {
      flushParagraph()
      bullets.push(bullet[1])
    } else if (line.trim() === "") {
      flushParagraph()
      flushBullets()
    } else if (bullets.length > 0) {
      // CONTINUATION OF THE CURRENT BULLET, not a new paragraph.
      //
      // Without this, a bullet wrapped across source lines ENDED THE LIST at
      // the wrap and rendered its own tail as a full-width paragraph below —
      // "which you supply comma-separated. Use" closing the item and "this
      // wherever the answer should be…" escaping it. Found by looking at
      // /help/hr-forms, not by any assertion: every check in this repo reads
      // the payload, and the payload was correct. The bug was entirely in the
      // rendering of correct data.
      //
      // Matches CommonMark lazy continuation: any non-blank line that is not a
      // new bullet or heading belongs to the open item. Our files always leave
      // a blank line before a following paragraph, which is what keeps that
      // rule from swallowing one.
      bullets[bullets.length - 1] += ` ${line.trim()}`
    } else {
      paragraph.push(line.trim())
    }
  }
  flushParagraph()
  flushBullets()
  return <>{blocks}</>
}

export function slug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

// ─── UPGRADE PREVIEW BANNER ──────────────────────────────────────────────────
//
// RULED (Gary, 2026-09-04, fork 5): this is a BANNER ON A READABLE ARTICLE, not
// the full-page interstitial the 14 module-gated pages use for a blocked route.
// Different job, different component. The 14 existing copies are NOT touched by
// this phase and no shared card is extracted here.
//
// Ruling 2's value is that a prospective buyer can read what the module DOES. A
// preview that renders only a paywall teaches nothing, so the article's prose
// renders in full beneath this and only its internal links go inert.

export function UpgradeBanner({ module: moduleName }: { module: string }) {
  const label = moduleName.charAt(0).toUpperCase() + moduleName.slice(1)
  return (
    <div className="mb-6 rounded-lg border border-[var(--color-primary)]/30 bg-[var(--color-primary)]/5 p-4">
      <div className="flex items-start gap-3">
        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-primary)]" />
        <div>
          <p className="text-sm font-semibold text-[var(--color-foreground)]">
            {label} is not part of your plan yet
          </p>
          <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
            You can read this guide in full. The screens it describes unlock when {label} is added
            to your plan.{" "}
            <Link href="/settings" className="text-[var(--color-primary)] underline">
              See plans
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── ARTICLE ─────────────────────────────────────────────────────────────────

// Every guide image is served by an authenticated route (ruling 7). The `src`
// is never a stored blob URL and never a public path — it is this route, which
// re-resolves the image to its narrowest enclosing scope and 404s if the reader
// may not see it. An <img> that 404s for the wrong reader is the correct
// outcome, not a bug to paper over.
function GuideImages({ images, surface }: { images: { id: string; alt: string }[]; surface: string }) {
  if (images.length === 0) return null
  return (
    <>
      {images.map((image) => (
        <figure key={image.id} className="my-6">
          {/* eslint-disable-next-line @next/next/no-img-element -- the image
              route streams bytes behind a per-reader capability check; the
              Next image optimizer would cache the result across readers, which
              is exactly the shared-cache leak Cache-Control: private prevents. */}
          <img
            src={`/api/help/image/${image.id}?surface=${surface}`}
            alt={image.alt}
            className="rounded-lg border border-[var(--color-border)]"
          />
          <figcaption className="mt-2 text-xs text-[var(--color-muted-foreground)]">{image.alt}</figcaption>
        </figure>
      ))}
    </>
  )
}

export function GuideArticleView({
  article,
  surface = "app",
}: {
  article: VisibleArticle
  surface?: string
}) {
  // Ruling 6, the renumbering half. The contents list is built from what is
  // ACTUALLY BEING RENDERED — body headings plus the sections that survived
  // filtering — so it numbers 1..n positionally and a removed section leaves no
  // gap. There is no stored numbering to drift out of step, because there is no
  // stored numbering.
  const bodyHeadings = article.body
    .split("\n")
    .map((l) => /^##\s+(.+?)\s*$/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => m[1])
  const contents = [...bodyHeadings, ...article.sections.map((s) => s.heading)]

  return (
    <article className="max-w-2xl">
      <h1 className="mb-2 text-2xl font-bold text-[var(--color-foreground)]">{article.title}</h1>
      <p className="mb-6 text-[var(--color-muted-foreground)]">{article.summary}</p>

      {article.preview && article.module && <UpgradeBanner module={article.module} />}

      {contents.length > 1 && (
        <nav className="mb-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)]/40 p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
            On this page
          </p>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {contents.map((heading, i) => (
              <li key={i}>
                <a href={`#${slug(heading)}`} className="text-[var(--color-primary)] hover:underline">
                  {heading}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      )}

      <GuideMarkdown source={article.body} inert={article.preview} />
      <GuideImages images={article.images.filter((i) => i.sectionId === null)} surface={surface} />

      {/* Sections that survived filtering. A section the reader lacks the
          capability for never reaches this component — it was removed from the
          payload server-side by helpScope(), not hidden here. */}
      {article.sections.map((section) => (
        <section key={section.id}>
          <h2
            id={slug(section.heading)}
            className="mb-3 mt-8 text-lg font-semibold text-[var(--color-foreground)]"
          >
            {section.heading}
          </h2>
          <GuideMarkdown source={section.body} inert={article.preview} />
          <GuideImages images={section.images} surface={surface} />
        </section>
      ))}
    </article>
  )
}

// ─── LIST ────────────────────────────────────────────────────────────────────

export function GuideArticleList({
  articles,
  basePath,
}: {
  articles: VisibleArticle[]
  basePath: string
}) {
  if (articles.length === 0) return <GuideEmptyState />
  return (
    <ul className="max-w-2xl divide-y divide-[var(--color-border)]">
      {articles.map((article) => (
        <li key={article.id}>
          <Link href={`${basePath}/${article.id}`} className="block py-4 hover:opacity-80">
            <p className="font-semibold text-[var(--color-foreground)]">{article.title}</p>
            <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">{article.summary}</p>
          </Link>
        </li>
      ))}
    </ul>
  )
}

// THE EMPTY STATE, AND ITS COPY IS LOAD-BEARING.
//
// RULED (Gary, 2026-09-04): one sentence, and nothing else. No search hint, no
// "check back later", no explanation.
//
// It must read IDENTICALLY whether the list is empty because no article has
// been written for this surface yet (HELP-1a: all three articles are (app)
// articles, so the portal renders this for every reader) or because the
// reader's capabilities filtered every article away.
//
// THAT IS WHY THERE IS NOTHING ELSE HERE. "Coming soon" would be true today and
// would become a DISCLOSURE in HELP-1b — a reader who could see nothing would
// be told that content exists and is being withheld. Any copy that hints at
// filtering is the visible lock ruling 3 forbids, and an explanation is exactly
// where such a hint gets added by someone trying to be helpful. The sentence
// below is true in both cases and distinguishes neither.
export function GuideEmptyState() {
  return (
    <div className="max-w-2xl rounded-lg border border-dashed border-[var(--color-border)] p-8 text-center">
      <HelpCircle className="mx-auto mb-3 h-8 w-8 text-[var(--color-muted-foreground)]" />
      <p className="text-[var(--color-foreground)]">There aren&apos;t any help articles here yet.</p>
    </div>
  )
}
