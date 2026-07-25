import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // HR-11b: server-side anchor detection uses unpdf (a serverless build of
  // pdf.js with no browser-DOM dependencies). Keep it external so the function
  // loads it from node_modules at runtime. The direct pdfjs-dist legacy build
  // was replaced — it referenced DOMMatrix/Path2D/etc. and threw "DOMMatrix is
  // not defined" in the Vercel Node runtime. (pdfjs-dist stays a dependency for
  // the browser-side HR-11 viewer, which is unaffected.)
  serverExternalPackages: ["unpdf"],
};

export default nextConfig;
