// Request contract for POST /api/admin/users/[id]/moderation. Hand-authored to
// match the route handler; reasonCode is required for the punitive actions
// (disable / delete) and optional for enable / restore. `reason` is the
// operator's free-text, capped — it is emailed to the user but never persisted
// or audited.

import { z } from "zod";

import { ModerationReasonCodeSchema } from "./users";

export const ModerationActionSchema = z.enum([
  "disable",
  "enable",
  "delete",
  "restore",
]);
export type ModerationAction = z.infer<typeof ModerationActionSchema>;

export const UserModerationRequestSchema = z
  .object({
    action: ModerationActionSchema,
    reasonCode: ModerationReasonCodeSchema.optional(),
    reason: z.string().max(500).optional(),
  })
  .refine(
    (v) =>
      v.action === "disable" || v.action === "delete"
        ? v.reasonCode !== undefined
        : true,
    { message: "reasonCode is required for disable and delete", path: ["reasonCode"] }
  );

export type UserModerationRequest = z.infer<typeof UserModerationRequestSchema>;
