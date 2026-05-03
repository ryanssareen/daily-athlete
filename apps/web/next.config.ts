import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Promoted to top-level in Next 15.5; was experimental.typedRoutes.
  typedRoutes: true,
};

export default config;
