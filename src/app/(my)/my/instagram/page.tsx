import { notFound } from "next/navigation"
import { ExternalLink } from "lucide-react"
import { InstagramIcon } from "@/components/instagram-icon"
import { getActiveStaffSelf } from "@/lib/auth"
import {
  getInstagramTokenStatus,
  getRecentInstagramMedia,
  instagramProfileUrl,
  type InstagramMedia,
} from "@/lib/instagram"
import { MyShell } from "../my-shell"
import { MyDenied } from "../denied"

// /my/instagram — STAFF-1: the org's Instagram grid inside the staff portal.
// Mirrors the (app)/instagram rendering rules: cached API feed only (never a
// page-load API call beyond the org-level cache), tiles link out to stable
// permalinks, short-lived media_url CDN links are rendered but never stored.
export default async function MyInstagramPage() {
  const self = await getActiveStaffSelf()
  if (!self.ok) return <MyDenied reason={self.reason} />
  const { org } = self

  if (!org.instagramAccessToken || !org.instagramEnabled) notFound()

  const posts = await getRecentInstagramMedia(org, 24)
  const tokenStatus = getInstagramTokenStatus(org)
  const username = org.instagramUsername
  const profileUrl = username ? instagramProfileUrl(username) : null

  return (
    <MyShell showInstagram>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <h1 className="text-xl font-bold text-[var(--color-foreground)]">Instagram</h1>
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
        <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-10 text-center">
          <InstagramIcon className="h-10 w-10 mx-auto text-[var(--color-muted-foreground)]" />
          <h2 className="mt-4 font-medium text-[var(--color-foreground)]">
            {tokenStatus === "reconnect_required"
              ? "Instagram needs to be reconnected"
              : "No posts to show yet"}
          </h2>
          <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
            {tokenStatus === "reconnect_required"
              ? "Access to the Instagram account has expired. An admin can reconnect it."
              : "Posts from the connected account will appear here — the feed refreshes about once an hour."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {posts.map((post) => (
            <PostTile key={post.id} post={post} />
          ))}
        </div>
      )}
    </MyShell>
  )
}

function PostTile({ post }: { post: InstagramMedia }) {
  const src = post.media_type === "VIDEO" ? post.thumbnail_url : post.media_url
  const caption = post.caption
    ? post.caption.length > 80
      ? `${post.caption.slice(0, 80)}…`
      : post.caption
    : null

  return (
    <a
      href={post.permalink}
      target="_blank"
      rel="noopener noreferrer"
      className="group block rounded-lg overflow-hidden border border-[var(--color-border)] bg-[var(--color-card)]"
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
