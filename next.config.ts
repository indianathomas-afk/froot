import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // HR-11b: server-side anchor detection uses unpdf (a serverless build of
  // pdf.js with no browser-DOM dependencies). Keep it external so the function
  // loads it from node_modules at runtime. The direct pdfjs-dist legacy build
  // was replaced — it referenced DOMMatrix/Path2D/etc. and threw "DOMMatrix is
  // not defined" in the Vercel Node runtime. (pdfjs-dist stays a dependency for
  // the browser-side HR-11 viewer, which is unaffected.)
  // HR-28: isomorphic-dompurify loads jsdom, which the bundler cannot trace —
  // staging built green and then 500'd at RUNTIME on every /api/hr/training
  // request with "Failed to load external module jsdom". Same treatment as
  // unpdf above: keep it external so the function requires it from
  // node_modules instead of being bundled.
  serverExternalPackages: ["unpdf", "isomorphic-dompurify"],
};

export default nextConfig;
