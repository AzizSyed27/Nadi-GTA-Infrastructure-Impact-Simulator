import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // V2.5d: the static read-only demo build (scripts/build-static-demo.mjs) sets
  // NEXT_STATIC_EXPORT=1 → `next build` emits a fully static `out/`. Normal builds stay a
  // server build so `npm run start` keeps working (the perf harness depends on it).
  output: process.env.NEXT_STATIC_EXPORT ? "export" : undefined,
  // V2.8: the shell lives at /app/. With trailingSlash the static export emits app/index.html,
  // which Cloudflare Pages AND a plain file server (the static-demo Playwright project) both
  // serve at /app/ - without it the export writes app.html, which a file server cannot find.
  trailingSlash: true,
};

export default nextConfig;
