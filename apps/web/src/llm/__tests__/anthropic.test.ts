// Unit tests for the Anthropic adapter (apps/web/src/llm/anthropic.ts).
//
// msw intercepts the Messages API so we exercise the real fetch/parse/error
// mapping without a live key or network. No Langfuse is configured here, so
// emitTrace is a no-op (config.langfuse.* are undefined in test).

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

// Ensure Langfuse is UNCONFIGURED before config loads, so emitTrace is a no-op
// and never fires a real fetch (which would trip onUnhandledRequest: "error").
vi.hoisted(() => {
  delete (process.env as Record<string, string | undefined>).LANGFUSE_PUBLIC_KEY;
  delete (process.env as Record<string, string | undefined>).LANGFUSE_SECRET_KEY;
  delete (process.env as Record<string, string | undefined>).LANGFUSE_HOST;
  (process.env as Record<string, string | undefined>).NODE_ENV = "test";
});

import { AnthropicClient, extractJson } from "../anthropic";
import { LlmInvalidOutput, LlmRateLimited, LlmTransient } from "../errors";

const MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const TEST_KEY = "sk-ant-test-secret-key-do-not-leak";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function client() {
  return new AnthropicClient({ apiKey: TEST_KEY, model: "claude-opus-4-8" });
}

function reply(text: string, usage = { input_tokens: 11, output_tokens: 22 }) {
  return HttpResponse.json({
    content: [{ type: "text", text }],
    usage,
  });
}

const call = () =>
  client().generateStructured({
    system: "You are a planner.",
    prompt: "make a plan",
    traceName: "test.call",
  });

describe("AnthropicClient.generateStructured — success", () => {
  it("returns parsed JSON and usage on a clean JSON body", async () => {
    server.use(http.post(MESSAGES_URL, () => reply('{"weeks":3}')));
    const result = await call();
    expect(result.json).toEqual({ weeks: 3 });
    expect(result.usage.inputTokens).toBe(11);
    expect(result.usage.outputTokens).toBe(22);
    expect(result.usage.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("sends the api key and model in the request", async () => {
    let sentKey: string | null = null;
    let sentBody: { model?: string } = {};
    server.use(
      http.post(MESSAGES_URL, async ({ request }) => {
        sentKey = request.headers.get("x-api-key");
        sentBody = (await request.json()) as { model?: string };
        return reply('{"ok":true}');
      })
    );
    await call();
    expect(sentKey).toBe(TEST_KEY);
    expect(sentBody.model).toBe("claude-opus-4-8");
  });

  it("extracts JSON from a ```json fenced block", async () => {
    server.use(http.post(MESSAGES_URL, () => reply('```json\n{"a":2}\n```')));
    expect((await call()).json).toEqual({ a: 2 });
  });

  it("extracts JSON from prose-wrapped output", async () => {
    server.use(
      http.post(MESSAGES_URL, () => reply('Sure! Here it is:\n{"b":3}\nDone.'))
    );
    expect((await call()).json).toEqual({ b: 3 });
  });
});

describe("AnthropicClient.generateStructured — failures", () => {
  it("throws LlmInvalidOutput when there is no JSON", async () => {
    server.use(http.post(MESSAGES_URL, () => reply("sorry, no json here")));
    await expect(call()).rejects.toBeInstanceOf(LlmInvalidOutput);
  });

  it("maps 429 to LlmRateLimited with retry-after", async () => {
    server.use(
      http.post(MESSAGES_URL, () =>
        HttpResponse.json(
          { type: "error", error: { type: "rate_limit_error", message: "slow down" } },
          { status: 429, headers: { "retry-after": "12" } }
        )
      )
    );
    const err = await call().catch((e) => e);
    expect(err).toBeInstanceOf(LlmRateLimited);
    expect((err as LlmRateLimited).retryAfterSeconds).toBe(12);
  });

  it("maps 529 (overloaded) to LlmRateLimited", async () => {
    server.use(
      http.post(MESSAGES_URL, () =>
        HttpResponse.json({ type: "error" }, { status: 529 })
      )
    );
    await expect(call()).rejects.toBeInstanceOf(LlmRateLimited);
  });

  it("maps 500 to LlmTransient carrying the status", async () => {
    server.use(
      http.post(MESSAGES_URL, () =>
        HttpResponse.json({ type: "error" }, { status: 500 })
      )
    );
    const err = await call().catch((e) => e);
    expect(err).toBeInstanceOf(LlmTransient);
    expect((err as LlmTransient).status).toBe(500);
  });

  it("maps a network failure to LlmTransient", async () => {
    server.use(http.post(MESSAGES_URL, () => HttpResponse.error()));
    await expect(call()).rejects.toBeInstanceOf(LlmTransient);
  });

  it("never includes the API key in a thrown error message (secret hygiene)", async () => {
    server.use(
      http.post(MESSAGES_URL, () =>
        HttpResponse.json({ type: "error" }, { status: 500 })
      )
    );
    const err = await call().catch((e) => e);
    expect((err as Error).message).not.toContain(TEST_KEY);
    expect((err as Error).message).not.toContain("sk-ant");
  });
});

describe("extractJson", () => {
  it("parses a bare object", () => {
    expect(extractJson('{"x":1}')).toEqual({ x: 1 });
  });
  it("parses a bare array", () => {
    expect(extractJson("[1,2,3]")).toEqual([1, 2, 3]);
  });
  it("returns undefined for empty / non-JSON", () => {
    expect(extractJson("")).toBeUndefined();
    expect(extractJson("just words")).toBeUndefined();
  });
  it("prefers the first balanced region in surrounding prose", () => {
    expect(extractJson('note: {"k":"v"} end')).toEqual({ k: "v" });
  });
});
