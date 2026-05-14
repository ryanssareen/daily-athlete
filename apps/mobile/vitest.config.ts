import { defineConfig } from "vitest/config";

// Mobile-side unit tests cover ONLY pure modules (no Expo / React Native
// imports). Component tests run on a real device or simulator via
// EAS dev build manual QA per the Phase B plan. The include pattern
// matches the `strava-machine.ts` family (and future pure modules);
// expand carefully -- importing anything that pulls in `react-native` or
// `expo-*` will fail in this Node environment.

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
    testTimeout: 5_000,
  },
});
