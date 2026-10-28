// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TutorError, askGroq } from "../services/groqService";
import { useChatStore } from "./useChatStore";

vi.mock("../services/groqService", async (importOriginal) => ({ ...(await importOriginal<typeof import("../services/groqService")>()), askGroq: vi.fn() }));
const ask = vi.mocked(askGroq);

type Options = NonNullable<Parameters<typeof askGroq>[2]>;
const state = () => useChatStore.getState();
const reset = () => { state().clearChat(); useChatStore.setState({ isOpen: false, hasOpened: false, context: "", error: null }); ask.mockReset(); };
beforeEach(reset);

/** A reply that streams `chunks` and resolves with their join, like the real service. */
const streaming = (...chunks: string[]) => async (_p: string, _c: string, options?: Options) => {
  for (const chunk of chunks) options?.onText?.(chunk);
  return chunks.join("");
};

describe("sending", () => {
  it("shows the question at once, grows the answer as text streams in, and finishes cleanly", async () => {
    const snapshots: string[] = [];
    ask.mockImplementation(async (_p, _c, options) => {
      await Promise.resolve(); // a real network never answers synchronously
      options?.onText?.("Hel");
      snapshots.push(state().messages.map((m) => `${m.role}:${m.content}`).join("|"));
      options?.onText?.("lo");
      snapshots.push(state().messages.map((m) => `${m.role}:${m.content}`).join("|"));
      return "Hello";
    });
    const done = state().sendMessage("  What is I0?  ");
    expect(state().isLoading).toBe(true);
    expect(state().messages).toEqual([{ id: expect.any(Number), role: "user", content: "What is I0?" }]);
    await done;
    expect(snapshots).toEqual(["user:What is I0?|assistant:Hel", "user:What is I0?|assistant:Hello"]);
    expect(state().messages).toHaveLength(2);
    expect(state().isLoading).toBe(false);
    expect(state().error).toBeNull();
  });

  it("uses the final text (for example the 'cut short' note) as the finished answer", async () => {
    ask.mockImplementation(async (_p, _c, options) => { options?.onText?.("part"); return "part\n\n*(cut short)*"; });
    await state().sendMessage("hi");
    expect(state().messages.at(-1)?.content).toBe("part\n\n*(cut short)*");
  });

  it("shows the answer even if nothing streamed", async () => {
    ask.mockResolvedValue("all at once");
    await state().sendMessage("hi");
    expect(state().messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(state().messages[1].content).toBe("all at once");
  });

  it("passes the context and the earlier conversation, but not the new question, as history", async () => {
    ask.mockImplementation(streaming("one"));
    useChatStore.setState({ context: "grammar: S -> a" });
    await state().sendMessage("first");
    ask.mockImplementation(streaming("two"));
    await state().sendMessage("second");
    const [, secondCall] = ask.mock.calls;
    expect(secondCall[0]).toBe("second");
    expect(secondCall[1]).toBe("grammar: S -> a");
    expect(secondCall[2]?.history).toEqual([{ role: "user", content: "first" }, { role: "assistant", content: "one" }]);
    expect(secondCall[2]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("ignores blank messages and refuses to start a second request while one is running", async () => {
    let finish: (text: string) => void = () => {};
    ask.mockImplementation(() => new Promise<string>((resolve) => { finish = resolve; }));
    await state().sendMessage("   ");
    expect(ask).not.toHaveBeenCalled();
    const first = state().sendMessage("one");
    await state().sendMessage("two");
    expect(ask).toHaveBeenCalledTimes(1);
    finish("done");
    await first;
    expect(state().messages.map((m) => m.content)).toEqual(["one", "done"]);
  });

  it("keeps the question and any partial answer when a request fails, and shows a safe message", async () => {
    ask.mockImplementation(async (_p, _c, options) => { options?.onText?.("Half an ans"); throw new TutorError("overloaded", "Groq is temporarily unavailable. Please try again."); });
    await state().sendMessage("hi");
    expect(state().error).toBe("Groq is temporarily unavailable. Please try again.");
    expect(state().messages.map((m) => m.content)).toEqual(["hi", "Half an ans"]);
    expect(state().isLoading).toBe(false);
  });

  it("falls back to a generic message for an error that is not ours", async () => {
    ask.mockRejectedValue("weird");
    await state().sendMessage("hi");
    expect(state().error).toBe("The tutor could not respond. Please try again.");
  });

  it("can send again after a failure", async () => {
    ask.mockRejectedValueOnce(new TutorError("network", "offline"));
    await state().sendMessage("hi");
    ask.mockImplementation(streaming("back"));
    await state().sendMessage("hi again");
    expect(state().error).toBeNull();
    expect(state().messages.at(-1)?.content).toBe("back");
  });
});

describe("cancelling", () => {
  it("aborts the network request when the chat is cleared, and ignores whatever arrives late", async () => {
    let signal: AbortSignal | undefined;
    let deliver: (text: string) => void = () => {};
    ask.mockImplementation((_p, _c, options) => { signal = options?.signal; return new Promise<string>((resolve) => { deliver = resolve; options?.onText?.("early"); }); });
    const pending = state().sendMessage("hi");
    expect(state().messages).toHaveLength(2);
    state().clearChat();
    expect(signal?.aborted).toBe(true);
    expect(state().messages).toEqual([]);
    expect(state().isLoading).toBe(false);
    deliver("too late");
    await pending;
    expect(state().messages).toEqual([]);
    expect(state().error).toBeNull();
  });

  it("does not show a cancellation as an error", async () => {
    ask.mockRejectedValue(new TutorError("aborted", "The request was cancelled."));
    await state().sendMessage("hi");
    expect(state().error).toBeNull();
  });

  it("lets a new question start right after clearing, unaffected by the old request", async () => {
    let deliverOld: (text: string) => void = () => {};
    ask.mockImplementationOnce(() => new Promise<string>((resolve) => { deliverOld = resolve; }));
    const old = state().sendMessage("old");
    state().clearChat();
    ask.mockImplementation(streaming("fresh"));
    await state().sendMessage("new");
    deliverOld("stale");
    await old;
    expect(state().messages.map((m) => m.content)).toEqual(["new", "fresh"]);
  });
});

describe("opening and bounds", () => {
  it("records that the drawer has been opened so the app can load it lazily", () => {
    expect(state().hasOpened).toBe(false);
    state().openChat();
    expect(state()).toMatchObject({ isOpen: true, hasOpened: true });
    state().closeChat();
    expect(state()).toMatchObject({ isOpen: false, hasOpened: true });
    state().clearChat();
    expect(state().hasOpened).toBe(true);
  });

  it("opens with context and asks the first question for the learner", async () => {
    ask.mockImplementation(streaming("sure"));
    state().openChatWithContext("grammar: S -> a", "Explain I0");
    await vi.waitFor(() => expect(state().isLoading).toBe(false));
    expect(state()).toMatchObject({ isOpen: true, context: "grammar: S -> a" });
    expect(ask.mock.calls[0].slice(0, 2)).toEqual(["Explain I0", "grammar: S -> a"]);
  });

  it("keeps only the most recent 100 messages in a very long session", async () => {
    ask.mockImplementation(streaming("a"));
    for (let i = 0; i < 70; i += 1) await state().sendMessage(`q${i}`);
    expect(state().messages).toHaveLength(100);
    expect(state().messages.at(-1)?.content).toBe("a");
  });
});
