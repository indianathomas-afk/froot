import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // HR-11b: server-side anchor detection uses unpdf (a serverless build of
  // pdf.js with no browser-DOM dependencies). Keep it external so the function
  // loads it from node_modules at runtime. The direct pdfjs-dist legacy build
  // was replaced — it referenced DOMMatrix/Path2D/etc. and threw "DOMMatrix is
  // not defined" in the Vercel Node runtime. (pdfjs-dist stays a dependency for
  // the browser-side HR-11 viewer, which is unaffected.)
  // HR-28 carried an "isomorphic-dompurify" entry here for one commit. It is
  // gone along with the package: making it external is what FORCED the runtime
  // require() that threw ERR_REQUIRE_ESM inside jsdom's tree, so the entry made
  // things worse, not better. Its replacement (sanitize-html) needs no DOM and
  // must stay bundled — do not add it here.
  serverExternalPackages: ["unpdf"],

  // N-3 (Gary, "Accept all leans" — R-1(b) and N3-F5). Before N-3 NO route
  // sent framing headers, so any site could iframe any page (measured on
  // production 2026-11-02, docs/prompts/N-3_AUDIT.md § B). Now:
  //   - the public nutrition menu, /menu/*, may be framed by ANY site (that is
  //     the embed), and sends no X-Frame-Options — it has no allow-all value,
  //     and a browser honouring it would ignore the CSP;
  //   - EVERY OTHER path refuses all framing.
  // The negative lookahead keeps the two rules disjoint, so neither overrides
  // the other. A CSP of only frame-ancestors restricts nothing else. The app's
  // own iframes (YouTube embeds) are outbound and unaffected.
  async headers() {
    return [
      {
        source: "/:path((?!menu/).*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        ],
      },
      {
        // `+`, not `*`: `*` also matches bare /menu, which the rule above
        // already covers — measured on a dev server, /menu got both headers.
        source: "/menu/:path+",
        headers: [{ key: "Content-Security-Policy", value: "frame-ancestors *" }],
      },
    ]
  },
};

export default nextConfig;
