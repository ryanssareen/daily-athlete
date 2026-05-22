// Unit tests for moderation email templating. The Brevo client is mocked so we
// assert the composed subject/body + the recipient, without any network.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../brevo", () => ({
  sendTransactionalEmail: vi.fn(async () => ({ sent: true })),
}));

import { sendTransactionalEmail } from "../brevo";
import { notifyModeration } from "../moderation-emails";

const mockSend = vi.mocked(sendTransactionalEmail);

beforeEach(() => {
  vi.clearAllMocks();
  mockSend.mockResolvedValue({ sent: true });
});

describe("notifyModeration", () => {
  it("disable: sends to the user with a 'disabled' subject and reason phrasing", async () => {
    await notifyModeration({ to: "u@x.com", action: "disable", reasonCode: "abuse" });
    expect(mockSend).toHaveBeenCalledTimes(1);
    const arg = mockSend.mock.calls[0]![0];
    expect(arg.to).toBe("u@x.com");
    expect(arg.subject).toMatch(/disabled/i);
    expect(arg.html).toContain("abusive");
  });

  it("delete: mentions the default 30-day grace window", async () => {
    await notifyModeration({
      to: "u@x.com",
      action: "delete",
      reasonCode: "tos_violation",
    });
    const arg = mockSend.mock.calls[0]![0];
    expect(arg.subject).toMatch(/deletion/i);
    expect(arg.html).toContain("30 days");
  });

  it("delete: honors a graceDays override", async () => {
    await notifyModeration({
      to: "u@x.com",
      action: "delete",
      reasonCode: "other",
      graceDays: 7,
    });
    expect(mockSend.mock.calls[0]![0].html).toContain("7 days");
  });

  it("includes and HTML-escapes the operator free-text reason", async () => {
    await notifyModeration({
      to: "u@x.com",
      action: "disable",
      reasonCode: "other",
      reason: "<script>x</script> repeated reports",
    });
    const html = mockSend.mock.calls[0]![0].html;
    expect(html).toContain("repeated reports");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("propagates the underlying send result (e.g. unconfigured)", async () => {
    mockSend.mockResolvedValue({ sent: false, reason: "unconfigured" });
    const res = await notifyModeration({
      to: "u@x.com",
      action: "disable",
      reasonCode: "spam",
    });
    expect(res).toEqual({ sent: false, reason: "unconfigured" });
  });
});
