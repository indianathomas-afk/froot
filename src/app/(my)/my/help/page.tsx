import { getActiveStaffSelf } from "@/lib/auth"
import { myHelpScope } from "@/lib/help-server"
import { GuideArticleList } from "@/components/help/guide-content"
import { MyShell } from "../my-shell"
import { MyDenied } from "../denied"

// HELP-1a — the help landing page inside the staff portal.
//
// A SECOND SHELL, NOT A SHARED ONE. The admin sidebar and MyShell have no
// common ancestor (audit §D.3), so the portal gets its own thin shell over the
// same renderer.
//
// IT RENDERS EMPTY IN HELP-1a AND THAT IS CORRECT, NOT BROKEN. All three
// articles this phase ships are (app) articles, and the surface filter in
// helpScope() keeps (app) articles out of the portal — see the long note in
// src/lib/help-access.ts for why offering one here would be ruling 3 failing
// quietly. The five /my/* articles that will fill this list are HELP-1b.
export default async function MyHelpPage() {
  const self = await getActiveStaffSelf()
  if (!self.ok) return <MyDenied reason={self.reason} />
  const { org, dbUser } = self
  const scope = myHelpScope(dbUser, org)
  return (
    <MyShell>
      <div className="p-4">
        <h1 className="mb-4 text-xl font-bold text-[var(--color-foreground)]">Help</h1>
        <GuideArticleList articles={scope.articles} basePath="/my/help" />
      </div>
    </MyShell>
  )
}
