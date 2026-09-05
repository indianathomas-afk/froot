import { notFound } from "next/navigation"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { getActiveStaffSelf } from "@/lib/auth"
import { myHelpScope } from "@/lib/help-server"
import { GuideArticleView } from "@/components/help/guide-content"
import { MyShell } from "../../my-shell"
import { MyDenied } from "../../denied"

// HELP-1a — one article inside the staff portal. Same re-check as the (app)
// article route: the body does not trust the list (ruling 3, clause 3).
export default async function MyHelpArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const self = await getActiveStaffSelf()
  if (!self.ok) return <MyDenied reason={self.reason} />
  const { org, dbUser } = self
  const article = myHelpScope(dbUser, org).article(slug)
  if (!article) notFound()
  return (
    <MyShell>
      <div className="p-4">
        <Link
          href="/my/help"
          className="mb-4 inline-flex items-center gap-1 text-sm text-[var(--color-muted-foreground)]"
        >
          <ArrowLeft className="h-4 w-4" />
          All help
        </Link>
        <GuideArticleView article={article} />
      </div>
    </MyShell>
  )
}
