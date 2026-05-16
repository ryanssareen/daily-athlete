import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Moved out of experimental in Next.js 15.5.
  typedRoutes: true,
};

export default config;
