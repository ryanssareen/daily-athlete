// Inngest serve handler. Single endpoint that the Inngest cloud (or local
// dev server) introspects, invokes functions on, and exchanges signing
// challenges with. See https://www.inngest.com/docs/quick-start.
//
// Functions live in apps/web/src/inngest/functions/. Phase A registers
// zero; Phase C and D add backfill, hydration, and matcher functions.
//
// The signingKey verifies that inbound POST/PUT requests come from Inngest
// cloud (HMAC over the request body). Without it the SDK falls back to
// dev mode and accepts unsigned requests -- fine locally, never fine in
// production. apps/web/src/config.ts warns on missing INNGEST_SIGNING_KEY
// at boot so misconfig surfaces in deploy logs before any inbound traffic.

import { serve } from "inngest/next";

import { inngest } from "@/inngest/client";
import { functions } from "@/inngest/functions";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
  signingKey: process.env.INNGEST_SIGNING_KEY,
});
