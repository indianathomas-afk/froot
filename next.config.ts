import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // HR-11b: pdfjs-dist is used server-side (anchor detection). Keep it external
  // so the serverless function requires it from node_modules at runtime instead
  // of bundling the legacy build — bundling it breaks the dynamic import in the
  // Vercel function (detection then throws and returns zero fields).
  serverExternalPackages: ["pdfjs-dist"],
};

export default nextConfig;
