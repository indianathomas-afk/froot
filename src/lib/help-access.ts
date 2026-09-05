import { can, type Capability, type PermissionUser } from "@/lib/permissions"

// HELP-1a — THE ONE PLACE that answers "what may this reader see" for the help
// surface. Every consumer goes through it: the search index, the article
// renderer's section filter, and the guide-image route. A second implementation
// of this question is a confidentiality bug waiting to happen — three
// implementations will eventually disagree, and every direction of disagreement
// leaks rather than merely looking wrong.
//
// The precedent is already in the repo twice: NAV-1's single isVisible() pass,
// and PERM-5C's rule that a hidden page must never sit over an API that still
// answers.
//
// BUILT FIRST, DELIBERATELY. If this file lands after its consumers, three
// near-copies of the policy exist before it does and the merge is a rewrite.
//
// SYNCHRONOUS, unlike the audit's §J sketch which typed it as async. There is
// no I/O here: can() is synchronous, `actor` and `org` are already loaded by
// getCurrentUser() (src/lib/auth.ts — THE LOAD POINT), and the articles are a
// build artifact. A Promise would advertise a query that does not exist and
// would make it easy to add one later without noticing. The audit's argument —
// one helper, three callers — is preserved exactly; only the signature differs.

export type GuideModule = "inventory" | "nutrition" | "hr" | "labor"

// Which shell an article's entry point lives in. Derived from `entry`, never
// authored — see surfaceOf() for why this exists at all.
export type GuideSurface = "app" | "my"

export type GuideImage = {
  id: string // the Blob id; never a path, and never the stored blob URL
  alt: string
  // The narrowest enclosing scope (ruling 7). null ⇒ the image sits in the
  // article body rather than inside a gated section, so the ARTICLE's
  // capability governs it.
  sectionId: string | null
}

export type GuideSection = {
  id: string
  heading: string
  // REQUIRED, never optional. The generator raises a parse error on a section
  // without one rather than defaulting to ungated (audit §G.2): an entry that
  // forgot its capability would render to everyone, which is the exact failure
  // direction ruling 6 exists to prevent. Ungated prose lives outside
  // `sections`.
  capability: Capability
  // The routes this SECTION documents, a subset of the article's `routes`.
  //
  // WHY A SECTION OWNS ROUTES AT ALL. Sections exist precisely because an
  // article's sub-routes can be gated more strictly than its entry point, so
  // the section is the only place that knows which routes those are. Without
  // this link the article's flat `routes` list travels to every reader who can
  // see the article — and for Ingredients that means shipping
  // "/inventory/ingredients/deleted" to a STORE login, which discloses that a
  // deleted-ingredients page exists. That is the same disclosure a greyed-out
  // section heading makes, and ruling 6 refuses it in both forms.
  //
  // Caught by scripts/verify-help-access.ts rather than by review: the search
  // index gained `routes` for the contextual "?" and the STORE index assertion
  // went red on the word "deleted" in a URL.
  routes: string[]
  body: string
  images: GuideImage[]
}

export type GuideArticle = {
  id: string
  title: string
  entry: string // where the ? and search results link. Must be a member of routes.
  routes: string[] // EVERY route this article claims — the coverage gate's input
  summary: string
  keywords: string[]
  // The ENTRY POINT's gate, not the union of the claimed routes (audit §G.2).
  // Deriving it from the strictest claimed route would hide the Ingredients
  // article from every STORE login over two admin sub-pages. Stricter
  // sub-routes are what `sections` is for. `null` is an explicit answer —
  // "this page is unrestricted" — not an omission.
  capability: Capability | null
  module: GuideModule | null
  order: number
  body: string
  sections: GuideSection[]
  images: GuideImage[] // article-level images (every one has sectionId === null)
}

// An article that has ALREADY been filtered for a specific reader. Distinct
// from GuideArticle by design rather than by convention: the renderer and the
// search index accept only this type, so handing an unfiltered article to
// either one is a type error rather than a silent disclosure. `sections` and
// `images` here are the reader's, not the file's.
export type VisibleArticle = {
  id: string
  title: string
  entry: string
  routes: string[]
  summary: string
  keywords: string[]
  capability: Capability | null
  module: GuideModule | null
  order: number
  body: string
  sections: GuideSection[]
  images: GuideImage[]
  // Ruling 2. The org has not bought this module, so the article renders in
  // full with an upgrade banner above it and its deep links inert. The module
  // is NOT a filter — a module-gated article is visible to every org.
  preview: boolean
}

export type HelpScope = {
  // The reader's article list for the surface they are on, already filtered
  // and sorted. Carries the ruling-2 preview flag, so "can they see it" and
  // "do they see it as a preview" are answered together and cannot drift.
  articles: VisibleArticle[]
  // Confidentiality checks. These are surface-INDEPENDENT — see helpScope().
  canReadArticle(articleId: string): boolean
  canReadSection(articleId: string, sectionId: string): boolean
  canReadImage(imageId: string): boolean
  // The filtered article by id, or null if this reader may not read it. The
  // body route uses this rather than trusting that the client only asks for
  // what it was shown (PERM-5C).
  article(articleId: string): VisibleArticle | null
}

// An article's shell is a fact about its entry route, not an authored field.
// Authoring it would let a file claim the wrong shell and quietly reintroduce
// the problem below.
export function surfaceOf(article: Pick<GuideArticle, "entry">): GuideSurface {
  return article.entry === "/my" || article.entry.startsWith("/my/") ? "my" : "app"
}

// WHY `surface` EXISTS, and it is not a style choice.
//
// can() is not sufficient on its own to decide whether a reader can reach a
// page. HR-7 in src/app/(app)/layout.tsx redirects a login to /my when it is
// STAFF **and** linked to a StaffMember **and** HR is available **and** the org
// has HR active. That is a SHELL-level gate; permissions.ts knows nothing about
// it. In staging and production HR is available and employee logins are linked
// by the invite webhook, so a STAFF reader in the portal is by construction the
// redirected kind — every (app) route bounces for them, including ones their
// capabilities allow. /labor is the worked example: labor.view is ALL, the page
// has no capability guard at all, and a linked STAFF login still cannot open it.
//
// Offering such an article would be ruling 3 failing quietly — visible in the
// list, readable, and its entry point bounces.
//
// The cheap correct answer is that the reader's presence on a surface IS the
// evidence of which shell they can reach. We do not recompute the HR-7
// condition (which would need `staffMember` added to getCurrentUser()'s
// include — a shared load point for the whole app — and would put a second copy
// of a redirect rule in a permissions helper).
//
// SCOPE LIMIT, STATED RATHER THAN IMPLIED: this shapes the LIST only. It does
// not gate the confidentiality checks, and that asymmetry is deliberate. An
// ADMIN reading /my/help must not get a 404 on an (app) article's image merely
// because of which page they browsed from — surface is about reachability of an
// entry route, not about who may know a thing. In HELP-1a the distinction is
// inert: all three articles are (app) articles gated at MANAGE or OPERATIONAL,
// so STAFF sees zero articles by capability alone and no shell question arises.
// It becomes live in HELP-1b, when the five /my/* articles land.
export type HelpScopeOptions = {
  surface: GuideSurface
}

export function helpScope(
  actor: PermissionUser,
  org: { activeModules: readonly string[] },
  articles: readonly GuideArticle[],
  opts: HelpScopeOptions
): HelpScope {
  // Ruling 3, and the ONLY place it is decided. Capability only — module state
  // is ruling 2's business and deliberately does not filter.
  const allowedArticle = (article: GuideArticle): boolean =>
    article.capability === null || can(actor, article.capability)

  // Ruling 6. One can() call per section, against the same actor, so a PERM-5
  // denial or a PERM-8 grant moves the page, its article and its sections
  // together.
  const allowedSection = (section: GuideSection): boolean => can(actor, section.capability)

  const byId = new Map(articles.map((a) => [a.id, a]))

  const filter = (article: GuideArticle): VisibleArticle | null => {
    if (!allowedArticle(article)) return null
    const sections = article.sections.filter(allowedSection)
    // Routes owned by a section this reader cannot see are removed along with
    // it. `routes` reaches the client on every search-index row, so a route
    // left in here is a disclosure even when no prose accompanies it.
    const hiddenRoutes = new Set(
      article.sections.filter((s) => !allowedSection(s)).flatMap((s) => s.routes)
    )
    // A hidden section takes its images with it. Article-level images are
    // governed by the article, which we have already allowed.
    const sectionImages = sections.flatMap((s) => s.images)
    return {
      ...article,
      routes: article.routes.filter((r) => !hiddenRoutes.has(r)),
      sections,
      images: [...article.images, ...sectionImages],
      preview: article.module !== null && !org.activeModules.includes(article.module),
    }
  }

  // canReadImage is NOT a separate policy (ruling 7). It resolves the image to
  // its narrowest enclosing scope and defers to the same check the section and
  // article use. One mapping from help resource to governing capability; three
  // callers of it. Gating images at the article level would be correct for most
  // of them and wrong for exactly the ones ruling 6 exists to protect.
  const imageIndex = new Map<string, { articleId: string; sectionId: string | null }>()
  for (const article of articles) {
    for (const image of article.images) {
      imageIndex.set(image.id, { articleId: article.id, sectionId: null })
    }
    for (const section of article.sections) {
      for (const image of section.images) {
        imageIndex.set(image.id, { articleId: article.id, sectionId: section.id })
      }
    }
  }

  const canReadArticle = (articleId: string): boolean => {
    const article = byId.get(articleId)
    return article !== undefined && allowedArticle(article)
  }

  const canReadSection = (articleId: string, sectionId: string): boolean => {
    const article = byId.get(articleId)
    if (!article || !allowedArticle(article)) return false
    const section = article.sections.find((s) => s.id === sectionId)
    return section !== undefined && allowedSection(section)
  }

  const canReadImage = (imageId: string): boolean => {
    const where = imageIndex.get(imageId)
    if (!where) return false // unknown id — refuse, and the route 404s either way
    return where.sectionId === null
      ? canReadArticle(where.articleId)
      : canReadSection(where.articleId, where.sectionId)
  }

  const visible = articles
    .filter((a) => surfaceOf(a) === opts.surface)
    .map(filter)
    .filter((a): a is VisibleArticle => a !== null)
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title))

  return {
    articles: visible,
    canReadArticle,
    canReadSection,
    canReadImage,
    article: (articleId: string) => {
      const article = byId.get(articleId)
      if (!article) return null
      return filter(article)
    },
  }
}

// The search index row. Titles, summaries and keywords only — never bodies.
// This is not only a size decision (audit §F.3 measured 5.5 KB gzipped for the
// full 44-row ADMIN index); it is the confidentiality boundary. A summary is
// written to be safe in a search result and a body is not.
export type HelpIndexRow = {
  id: string
  entry: string
  // Every route this article claims. Carried so the contextual "?" can match
  // the reader's current pathname without importing the generated articles
  // into a client component — which would ship every article BODY, gated
  // sections included, into the JS bundle of every reader and undo ruling 6 in
  // the most complete way available. These rows are already capability
  // filtered, so a reader only ever receives the routes of articles they may
  // see.
  routes: string[]
  title: string
  summary: string
  keywords: string[]
  module: GuideModule | null
  preview: boolean
}

// Built from the reader's FILTERED articles, never from the raw files. A hidden
// section's heading must not reach this: if it did, a section absent from the
// page would still be findable by search and ruling 6 would be undone by the
// search box. Since VisibleArticle's sections are already filtered, the only
// way to get this wrong is to bypass helpScope — which is why searchIndex takes
// a HelpScope rather than an article list.
export function searchIndex(scope: HelpScope): HelpIndexRow[] {
  return scope.articles.map((a) => ({
    id: a.id,
    entry: a.entry,
    routes: a.routes,
    title: a.title,
    summary: a.summary,
    // A section's heading is a legitimate search term for a reader who can see
    // the section, and must be absent for one who cannot. Taking them from the
    // already-filtered sections gets both halves right in one expression.
    keywords: [...a.keywords, ...a.sections.map((s) => s.heading)],
    module: a.module,
    preview: a.preview,
  }))
}
