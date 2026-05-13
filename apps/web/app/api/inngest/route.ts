// Inngest serve handler. Single endpoint that the Inngest cloud (or local
// dev server) introspects, invokes functions on, and exchanges signing
// challenges with. See https://www.inngest.com/docs/quick-start.
//
// Functions live in apps/web/src/inngest/functions/. Phase A registers
// zero; Phase C and D add backfill, hydration, and matcher functions.

import { serve } from "inngest/next";

import { inngest } from "@/inngest/client";
import { functions } from "@/inngest/functions";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
});
