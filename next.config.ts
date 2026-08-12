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
};

export default nextConfig;
