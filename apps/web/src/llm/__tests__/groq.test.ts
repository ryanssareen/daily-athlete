// Unit tests for the Groq adapter (apps/web/src/llm/groq.ts).
//
// msw intercepts the OpenAI-compatible Chat Completions API so we exercise
// the real fetch/parse/error mapping without a live key or network. No
// Langfuse is configured here, so emitTrace is a no-op (config.langfuse.*
// are undefined in test).

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

import { GroqClient } from "../groq";
import { LlmInvalidOutput, LlmRateLimited, LlmTransient } from "../errors";

const COMPLETIONS_URL = "https://api.groq.com/openai/v1/chat/completions";
const TEST_KEY = "gsk_test-secret-key-do-not-leak";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function client() {
  return new GroqClient({ apiKey: TEST_KEY, model: "llama-3.3-70b-versatile" });
}

function reply(text: string, usage = { prompt_tokens: 11, completion_tokens: 22 }) {
  return HttpResponse.json({
    choices: [{ message: { role: "assistant", content: text } }],
    usage,
  });
}

const call = () =>
  client().generateStructured({
    system: "You are a planner.",
    prompt: "make a plan",
    traceName: "test.call",
  });

describe("GroqClient.generateStructured — success", () => {
  it("returns parsed JSON and usage on a clean JSON body", async () => {
    server.use(http.post(COMPLETIONS_URL, () => reply('{"weeks":3}')));
    const result = await call();
    expect(result.json).toEqual({ weeks: 3 });
    expect(result.usage.inputTokens).toBe(11);
    expect(result.usage.outputTokens).toBe(22);
    expect(result.usage.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("sends the bearer key and model in the request", async () => {
    let sentAuth: string | null = null;
    let sentBody: { model?: string; messages?: Array<{ role: string }> } = {};
    server.use(
      http.post(COMPLETIONS_URL, async ({ request }) => {
        sentAuth = request.headers.get("authorization");
        sentBody = (await request.json()) as typeof sentBody;
        return reply('{"ok":true}');
      })
    );
    await call();
    expect(sentAuth).toBe(`Bearer ${TEST_KEY}`);
    expect(sentBody.model).toBe("llama-3.3-70b-versatile");
    expect(sentBody.messages?.map((m) => m.role)).toEqual(["system", "user"]);
  });

  it("extracts JSON from a ```json fenced block", async () => {
    server.use(http.post(COMPLETIONS_URL, () => reply('```json\n{"a":2}\n```')));
    expect((await call()).json).toEqual({ a: 2 });
  });

  it("extracts JSON from prose-wrapped output", async () => {
    server.use(
      http.post(COMPLETIONS_URL, () => reply('Sure! Here it is:\n{"b":3}\nDone.'))
    );
    expect((await call()).json).toEqual({ b: 3 });
  });
});

describe("GroqClient.generateStructured — failures", () => {
  it("throws LlmInvalidOutput when there is no JSON", async () => {
    server.use(http.post(COMPLETIONS_URL, () => reply("sorry, no json here")));
    await expect(call()).rejects.toBeInstanceOf(LlmInvalidOutput);
  });

  it("throws LlmInvalidOutput when choices are empty", async () => {
    server.use(
      http.post(COMPLETIONS_URL, () => HttpResponse.json({ choices: [] }))
    );
    await expect(call()).rejects.toBeInstanceOf(LlmInvalidOutput);
  });

  it("maps 429 to LlmRateLimited with retry-after", async () => {
    server.use(
      http.post(COMPLETIONS_URL, () =>
        HttpResponse.json(
          { error: { message: "rate limit reached", type: "tokens" } },
          { status: 429, headers: { "retry-after": "12" } }
        )
      )
    );
    const err = await call().catch((e) => e);
    expect(err).toBeInstanceOf(LlmRateLimited);
    expect((err as LlmRateLimited).retryAfterSeconds).toBe(12);
  });

  it("maps 498 (flex-tier capacity) to LlmRateLimited", async () => {
    server.use(
      http.post(COMPLETIONS_URL, () =>
        HttpResponse.json({ error: {} }, { status: 498 })
      )
    );
    await expect(call()).rejects.toBeInstanceOf(LlmRateLimited);
  });

  it("maps 500 to LlmTransient carrying the status", async () => {
    server.use(
      http.post(COMPLETIONS_URL, () =>
        HttpResponse.json({ error: {} }, { status: 500 })
      )
    );
    const err = await call().catch((e) => e);
    expect(err).toBeInstanceOf(LlmTransient);
    expect((err as LlmTransient).status).toBe(500);
  });

  it("maps a network failure to LlmTransient", async () => {
    server.use(http.post(COMPLETIONS_URL, () => HttpResponse.error()));
    await expect(call()).rejects.toBeInstanceOf(LlmTransient);
  });

  it("never includes the API key in a thrown error message (secret hygiene)", async () => {
    server.use(
      http.post(COMPLETIONS_URL, () =>
        HttpResponse.json({ error: {} }, { status: 500 })
      )
    );
    const err = await call().catch((e) => e);
    expect((err as Error).message).not.toContain(TEST_KEY);
    expect((err as Error).message).not.toContain("gsk_");
  });
});
