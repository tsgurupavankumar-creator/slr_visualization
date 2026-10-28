// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { askGroq, buildMessages, LIMITS, redact, TutorError } from "./groqService";
beforeEach(() => { vi.stubEnv("VITE_GROQ_API_KEY", "test-key-never-real"); vi.stubEnv("VITE_GROQ_MODEL", "llama-3.3-70b-versatile"); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const respond = (text: string, finish_reason = "stop", status = 200) => new Response(JSON.stringify({ choices: [{ message: { content: text }, finish_reason }] }), { status, headers: { "Content-Type": "application/json" } });
describe("Groq tutor", () => {
  it("reports missing key", async () => { vi.stubEnv("VITE_GROQ_API_KEY", "your_groq_api_key_here"); await expect(askGroq("Why?", "")).rejects.toMatchObject({ kind: "config" }); });
  it("sends active grammar as user data, not system instructions", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond("State I0 is the closure.")); vi.stubGlobal("fetch", fetchMock);
    const onText = vi.fn(); const answer = await askGroq("Explain I0", "Grammar: S -> a", { onText });
    expect(answer).toContain("closure"); expect(onText).toHaveBeenCalledWith(answer);
    const [url, init] = fetchMock.mock.calls[0]; expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer test-key-never-real");
    const body = JSON.parse(init.body); expect(body.messages[0].content).not.toContain("Grammar: S -> a");
    expect(body.messages.at(-1).content).toContain("Grammar: S -> a");
  });
  it("limits the conversation and question", () => {
    const messages = buildMessages("x".repeat(3000), "G -> a", [{ role: "user", content: "Hi" }, { role: "assistant", content: "Hello" }]);
    expect(messages.map(m => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(messages.at(-1)?.content.length).toBeLessThan(LIMITS.prompt + 100);
  });
  it("maps HTTP errors", async () => {
    for (const [status, kind] of [[403, "auth"], [404, "model"], [429, "rate_limit"], [503, "overloaded"]] as const) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status })));
      await expect(askGroq("hello", "")).rejects.toMatchObject({ kind });
    }
  });
  it("adds truncation note", async () => { vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond("Short answer", "length"))); expect(await askGroq("hello", "")).toContain("cut short"); });
  it("handles empty answers", async () => { vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond(""))); await expect(askGroq("hello", "")).rejects.toMatchObject({ kind: "unknown" }); });
  it("redacts keys", () => { expect(redact("gsk_" + "A".repeat(40))).toBe("[redacted]"); expect(new TutorError("network", "fail").kind).toBe("network"); });
});
