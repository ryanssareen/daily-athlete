// Unit tests for the Brevo client. config is mocked so configured/unconfigured
// can be toggled per test; global fetch is stubbed. Asserts the no-throw
// contract and the request shape (api-key header, sender/recipient/body).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  brevoApiKey: undefined as string | undefined,
  sender: undefined as string | undefined,
}));

vi.mock("@/config", () => ({
  config: {
    get email() {
      return { brevoApiKey: mocks.brevoApiKey, sender: mocks.sender };
    },
  },
}));

import { sendTransactionalEmail } from "../brevo";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.brevoApiKey = "xkeysib-test-key";
  mocks.sender = "ops@example.com";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sendTransactionalEmail", () => {
  it("returns unconfigured and skips fetch when the API key is missing", async () => {
    mocks.brevoApiKey = undefined;
    const res = await sendTransactionalEmail({
      to: "u@x.com",
      subject: "s",
      html: "<p>h</p>",
    });
    expect(res).toEqual({ sent: false, reason: "unconfigured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns unconfigured when the sender is missing", async () => {
    mocks.sender = undefined;
    const res = await sendTransactionalEmail({
      to: "u@x.com",
      subject: "s",
      html: "<p>h</p>",
    });
    expect(res).toEqual({ sent: false, reason: "unconfigured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs to Brevo with the api-key header and returns sent on 2xx", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201 });
    const res = await sendTransactionalEmail({
      to: "user@x.com",
      subject: "Subject",
      html: "<p>Body</p>",
    });
    expect(res).toEqual({ sent: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect((init.headers as Record<string, string>)["api-key"]).toBe(
      "xkeysib-test-key"
    );
    const body = JSON.parse(init.body as string);
    expect(body.sender.email).toBe("ops@example.com");
    expect(body.to).toEqual([{ email: "user@x.com" }]);
    expect(body.subject).toBe("Subject");
    expect(body.htmlContent).toBe("<p>Body</p>");
  });

  it("defaults replyTo to the configured sender", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201 });
    await sendTransactionalEmail({ to: "u@x.com", subject: "s", html: "<p>h</p>" });
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.replyTo).toEqual({ email: "ops@example.com" });
  });

  it("returns http_<status> on a non-2xx response", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400 });
    const res = await sendTransactionalEmail({
      to: "u@x.com",
      subject: "s",
      html: "<p>h</p>",
    });
    expect(res).toEqual({ sent: false, reason: "http_400" });
  });

  it("returns error and never throws when fetch rejects", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const res = await sendTransactionalEmail({
      to: "u@x.com",
      subject: "s",
      html: "<p>h</p>",
    });
    expect(res).toEqual({ sent: false, reason: "error" });
  });
});
