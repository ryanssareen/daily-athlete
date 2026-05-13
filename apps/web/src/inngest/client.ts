// Single Inngest client for the apps/web Next.js app. The id namespaces
// every event and function under this app in the Inngest dashboard.
//
// Event key / signing key come from the env. In local dev with the Inngest
// CLI dev server, missing keys are fine -- the SDK auto-discovers the dev
// endpoint. In production both keys must be set; the apps/web boot config
// validator (apps/web/src/config.ts) warns on missing INNGEST_EVENT_KEY
// and INNGEST_SIGNING_KEY but does not block boot so deploys without the
// queue layer in front of an event dispatch still come up.

import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: "da2-web",
  eventKey: process.env.INNGEST_EVENT_KEY,
  // signingKey is consumed by the serve handler (apps/web/app/api/inngest)
  // for inbound request verification. Wiring it on the client too is a
  // belt-and-suspenders nudge: any code that imports the client and
  // attempts a non-dev operation surfaces the missing key here rather than
  // at the framework boundary.
  signingKey: process.env.INNGEST_SIGNING_KEY,
});
