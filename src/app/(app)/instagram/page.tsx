import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import { ExternalLink } from "lucide-react"
import { InstagramIcon } from "@/components/instagram-icon"
import { prisma } from "@/lib/prisma"
import {
  getInstagramTokenStatus,
  getRecentInstagramMedia,
  instagramProfileUrl,
  type InstagramMedia,
} from "@/lib/instagram"

// In-app Instagram grid. instagram.com can't be iframed (frame-blocking
// headers), so this renders the cached API feed; every tile links out to the
// post's stable permalink. media_url/thumbnail_url are short-lived CDN links —
// fine to render, never stored.

export default async function InstagramPage() {
  const { orgId } = await auth()
  if (!orgId) return null

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  // Defense in depth — the sidebar item is already hidden when off.
  if (!org || !org.instagramAccessToken || !org.instagramEnabled) redirect("/dashboard")

  const posts = await getRecentInstagramMedia(org, 24)
  const tokenStatus = getInstagramTokenStatus(org)
  const username = org.instagramUsername
  const profileUrl = username ? instagramProfileUrl(username) : null

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Instagram</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
            Latest posts from your Instagram account
          </p>
        </div>
        {profileUrl && (
          <a
            href={profileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-sm font-bold text-[var(--color-primary)] hover:underline"
          >
            @{username}
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>

      {posts.length === 0 ? (
        <EmptyState reconnectRequired={tokenStatus === "reconnect_required"} />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {posts.map((post) => (
            <PostTile key={post.id} post={post} />
          ))}
        </div>
      )}
    </div>
  )
}

function PostTile({ post }: { post: InstagramMedia }) {
  const src = post.media_type === "VIDEO" ? post.thumbnail_url : post.media_url
  const caption = post.caption ? (post.caption.length > 80 ? `${post.caption.slice(0, 80)}…` : post.caption) : null

  return (
    <a
      href={post.permalink}
      target="_blank"
      rel="noopener noreferrer"
      className="group block rounded-lg overflow-hidden border border-[var(--color-border)] bg-[var(--color-card)] hover:shadow-md transition-shadow"
    >
      <div className="aspect-square bg-[var(--color-muted)] overflow-hidden">
        {src ? (
          // Plain <img>: IG CDN hostnames rotate, so next/image remotePatterns can't pin them.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={caption ?? "Instagram post"}
            loading="lazy"
            className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[var(--color-muted-foreground)]">
            <InstagramIcon className="h-8 w-8" />
          </div>
        )}
      </div>
      {caption && (
        <p className="p-2.5 text-xs text-[var(--color-muted-foreground)] leading-snug">{caption}</p>
      )}
    </a>
  )
}

function EmptyState({ reconnectRequired }: { reconnectRequired: boolean }) {
  return (
    <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-12 text-center">
      <InstagramIcon className="h-10 w-10 mx-auto text-[var(--color-muted-foreground)]" />
      <h2 className="mt-4 font-medium text-[var(--color-foreground)]">
        {reconnectRequired ? "Instagram needs to be reconnected" : "No posts to show yet"}
      </h2>
      <p className="mt-1 text-sm text-[var(--color-muted-foreground)] max-w-md mx-auto">
        {reconnectRequired
          ? "Access to your Instagram account has expired. An admin can reconnect it from Settings → Integrations."
          : "Posts from your connected Instagram account will appear here. If you just connected, publish a post on Instagram and check back — the feed refreshes about once an hour."}
      </p>
    </div>
  )
}
