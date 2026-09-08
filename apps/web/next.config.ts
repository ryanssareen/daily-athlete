import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Moved out of experimental in Next.js 15.5.
  typedRoutes: true,
  experimental: {
    // Every authed route reads cookies (auth.getUser()) so Next treats it
    // as fully dynamic, and the framework default for dynamic routes is 0 --
    // navigating back to a page you just left always refetches from the
    // server. 30s lets the client Router Cache reuse that recent render
    // instead. Client-fetched content inside a page (e.g. ProposalReview's
    // own /api/weekly-review call) is unaffected and still always fresh;
    // only the server-rendered shell around it can be up to 30s stale.
    staleTimes: {
      dynamic: 30,
    },
  },
};

export default config;
