import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

const config = [
  { ignores: [".next/**", "node_modules/**"] },
  ...nextCoreWebVitals,
  {
    rules: {
      // New in React 19 / eslint-plugin-react-hooks. Triggers on common
      // load-on-mount patterns (useEffect calling a useCallback that setStates).
      // Re-enable and refactor to Suspense / server data loaders incrementally.
      "react-hooks/set-state-in-effect": "off",
    },
  },
];

export default config;
