// Empty shim for the `server-only` package in vitest. The real package
// throws at import time outside the Next.js RSC bundler. Aliased in
// vitest.config.ts so route handlers / db helpers that import
// `server-only` as a client-bundle safeguard can still be unit-tested
// in Node.
export {};
