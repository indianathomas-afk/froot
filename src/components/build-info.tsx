const sha = process.env.VERCEL_GIT_COMMIT_SHA
const branch = process.env.VERCEL_GIT_COMMIT_REF

export function BuildInfo() {
  const label = sha && branch ? `${sha.slice(0, 7)}~${branch}` : "local"

  return (
    <div className="fixed bottom-1 right-2 z-50 pointer-events-none select-none text-[10px] text-gray-400/50">
      {label}
    </div>
  )
}
