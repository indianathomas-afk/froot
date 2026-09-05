import { appHelpScope } from "@/lib/help-server"
import { GuideArticleList } from "@/components/help/guide-content"

// HELP-1a — the help landing page inside the admin shell. A thin shell: the
// scope decides what is in the list and the shared renderer draws it.
export default async function HelpPage() {
  const scope = await appHelpScope()
  return (
    <div>
      <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Help</h1>
      <p className="mb-8 mt-1 text-sm text-[var(--color-muted-foreground)]">
        Guides to the parts of Froot you can reach.
      </p>
      <GuideArticleList articles={scope.articles} basePath="/help" />
    </div>
  )
}
