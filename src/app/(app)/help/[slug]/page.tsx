import { notFound } from "next/navigation"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { appHelpScope } from "@/lib/help-server"
import { GuideArticleView } from "@/components/help/guide-content"

// HELP-1a — one article inside the admin shell.
//
// THE BODY RE-RUNS THE CHECK (ruling 3, clause 3). It does not trust that the
// client only asks for what the list showed it. scope.article() returns null
// for an article this reader may not read, and that is a 404 — the same
// refusal an unknown slug gets, so the response does not confirm that a
// forbidden article exists.
export default async function HelpArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const scope = await appHelpScope()
  const article = scope.article(slug)
  if (!article) notFound()
  return (
    <div>
      <Link
        href="/help"
        className="mb-6 inline-flex items-center gap-1 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
      >
        <ArrowLeft className="h-4 w-4" />
        All help
      </Link>
      <GuideArticleView article={article} />
    </div>
  )
}
