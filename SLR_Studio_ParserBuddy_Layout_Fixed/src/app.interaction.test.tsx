// @vitest-environment jsdom
/// <reference types="node" />
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { useStudioStore } from "./store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no layout engine: the tree library needs real SVG measurement, which the
// browser tests in e2e/ cover instead.
vi.mock("react-d3-tree", () => ({ default: () => null }));
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };

let container: HTMLDivElement;
let root: Root;

const q = <T extends Element>(selector: string) => container.querySelector<T>(selector);
const press = (target: EventTarget, code: string, init: KeyboardEventInit = {}) =>
  act(() => { target.dispatchEvent(new KeyboardEvent("keydown", { code, key: code, bubbles: true, cancelable: true, ...init })); });
const click = (element: Element | null) => act(() => { (element as HTMLElement).click(); });

beforeEach(() => {
  window.location.hash = "";
  useStudioStore.getState().reset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<App />));
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe("App interactions", () => {
  it("moves focus into the drawer, traps Tab, closes on Escape, and returns focus", () => {
    const row = q<HTMLButtonElement>(".production-row")!;
    row.focus();
    click(row);

    const dialog = document.querySelector("[role=dialog]")!;
    expect(dialog).not.toBeNull();
    const closeButton = dialog.querySelector<HTMLButtonElement>("button[aria-label=Close]")!;
    expect(document.activeElement).toBe(closeButton);

    press(closeButton, "Tab"); // the only focusable control: Tab must not escape
    expect(dialog.contains(document.activeElement)).toBe(true);

    press(document.body, "Escape");
    expect(useStudioStore.getState().explanation).toBeNull();
    expect(document.activeElement).toBe(row);
  });

  it("steps with arrows, toggles play with Space, but leaves Space to focused buttons and Alt+Arrow to the browser", () => {
    const state = () => useStudioStore.getState();
    press(document.body, "ArrowRight");
    expect(state().activeStep).toBe(1);
    press(document.body, "ArrowLeft");
    expect(state().activeStep).toBe(0);
    press(document.body, "ArrowRight", { altKey: true });
    expect(state().activeStep).toBe(0);

    press(document.body, "Space");
    expect(state().playing).toBe(true);
    press(document.body, "Space");
    expect(state().playing).toBe(false);

    const tab = q<HTMLButtonElement>(".stage-tab")!;
    press(tab, "Space"); // native button activation handles this; the global handler must not also toggle
    expect(state().playing).toBe(false);

    const input = q<HTMLInputElement>("input[aria-label='Input string to parse']")!;
    press(input, "ArrowRight");
    expect(state().activeStep).toBe(0);
  });

  it("reports grammar errors and size limits instead of crashing", () => {
    const textarea = q<HTMLTextAreaElement>("textarea")!;
    const setValue = (element: HTMLTextAreaElement | HTMLInputElement, value: string) => act(() => {
      const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const generate = () => click(q(".generate-button"));

    setValue(textarea, "S -> 'oops");
    generate();
    expect(q("[role=alert]")?.textContent).toContain("Unclosed quote");

    setValue(textarea, "S -> S a | a");
    setValue(q<HTMLInputElement>("input[aria-label='Input string to parse']")!, Array(2001).fill("a").join(" "));
    generate();
    expect(q("[role=alert]")?.textContent).toContain("supports up to 2,000");

    setValue(q<HTMLInputElement>("input[aria-label='Input string to parse']")!, "a a a");
    generate();
    expect(q("[role=alert]")).toBeNull();
  });

  it("shows the input rules, including the spacing rule, without any interaction", () => {
    const rules = q<HTMLDetailsElement>("details.input-rules")!;
    expect(rules).not.toBeNull();
    expect(rules.textContent).toContain("put a space between every token");
    expect(rules.textContent).toContain("@ on its own is the only way to write the empty string");
    expect(rules.textContent).toContain("'=='");
  });

  it("keeps bullets on the input rules lists (Tailwind's reset removes them by default)", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync("src/index.css", "utf-8");
    const rule = css.match(/\.input-rules-body ul\s*\{[^}]*\}/)?.[0] ?? "";
    expect(rule).toContain("list-style: disc");
    expect(css).toMatch(/\.input-rules-body li\s*\{[^}]*display:\s*list-item/);
  });

  it("character mode makes run-together input parse, and the setting is kept in the link", () => {
    const setValue = (element: HTMLTextAreaElement | HTMLInputElement, value: string) => act(() => {
      const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
    setValue(q<HTMLTextAreaElement>("textarea")!, "S -> a S b | @");
    setValue(q<HTMLInputElement>("input[aria-label='Input string to parse']")!, "aabb");
    click(q(".generate-button"));
    expect(q(".stage-tab.active")).not.toBeNull();
    click(container.querySelectorAll(".stage-tab")[4]);
    expect(q(".outcome-banner")?.textContent).toContain("REJECTED");

    click(q(".mode-toggle input"));
    click(q(".generate-button"));
    expect(q(".outcome-banner")?.textContent).toContain("ACCEPTED");
    expect(window.location.hash).toContain("c=1");
  });

  it("shows grammar notices without blocking the parse", () => {
    const setValue = (element: HTMLTextAreaElement, value: string) => act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(q(".notices")).toBeNull();
    setValue(q<HTMLTextAreaElement>("textarea")!, "S -> Tt\nT -> a");
    click(q(".generate-button"));
    expect(q(".notices")?.textContent).toContain("Did you mean “T”?");
    expect(q("[role=alert]")).toBeNull();
  });

  it("copies a link that carries the current boxes, falling back to a prompt without clipboard access", () => {
    const original = window.prompt;
    let shown = "";
    window.prompt = (_message?: string, value?: string) => { shown = value ?? ""; return null; };
    click(q(".link-button"));
    window.prompt = original;
    expect(shown).toContain("#g=");
    expect(decodeURIComponent(shown.replace(/\+/g, " "))).toContain("E -> E + T | T");
  });
});

describe("shared links on load", () => {
  const mount = () => { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); act(() => root.render(<App />)); };

  it("fills in the boxes from a link", () => {
    act(() => root.unmount()); container.remove();
    window.location.hash = "#g=S+-%3E+a+S+b+%7C+%40&i=a+b&c=1";
    mount();
    expect(q<HTMLTextAreaElement>("textarea")!.value).toBe("S -> a S b | @");
    expect(q<HTMLInputElement>("input[aria-label='Input string to parse']")!.value).toBe("a b");
    expect(q<HTMLInputElement>(".mode-toggle input")!.checked).toBe(true);
    expect(q("[role=alert]")).toBeNull();
  });

  it("survives a broken link by keeping the text, showing why, and running the default grammar", () => {
    act(() => root.unmount()); container.remove();
    window.location.hash = "#g=S+-%3E+%27oops&i=a";
    mount();
    expect(q<HTMLTextAreaElement>("textarea")!.value).toBe("S -> 'oops");
    expect(q("[role=alert]")?.textContent).toContain("The shared link could not be loaded");
    expect(q(".stage-heading h1")?.textContent).toContain("Start with the grammar");
  });
});

describe("trace explanations agree with the trace", () => {
  const setText = (element: HTMLTextAreaElement | HTMLInputElement, value: string) => act(() => {
    const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });

  const grammars: [string, string][] = [
    ["E -> E + T | T\nT -> T * F | F\nF -> ( E ) | id", "id + id * ( id + id )"],
    ["S -> ( S ) S | @", "( ( ) ) ( )"],
    ["S -> A B\nA -> @ | a\nB -> @ | b", "a b"],
  ];

  for (const [grammar, input] of grammars) {
    it(`every "Why?" matches the table and stacks for: ${input}`, () => {
      setText(q<HTMLTextAreaElement>("textarea")!, grammar);
      setText(q<HTMLInputElement>("input[aria-label='Input string to parse']")!, input);
      click(q(".generate-button"));
      click(container.querySelectorAll(".stage-tab")[4]);

      const rows = Array.from(container.querySelectorAll(".trace-table tbody tr:not(.trace-spacer)"));
      expect(rows.length).toBeGreaterThan(5);
      const cell = (row: Element, index: number) => (row.querySelectorAll("td")[index].textContent ?? "").replace(/\s+/g, " ").trim();
      const topState = (row: Element) => cell(row, 1).split(" ").filter((part) => /^\d+$/.test(part)).at(-1);

      rows.forEach((row, index) => {
        if (index === 0) return;
        const action = cell(row, 3);
        click(row.querySelector(".trace-action-pill"));
        const text = (document.querySelector("[role=dialog]")?.textContent ?? "").replace(/\s+/g, " ");
        const where = `step ${index} "${action}"`;
        const shift = action.match(/^Shift to I(\d+)$/);
        const reduce = action.match(/^Reduce by (\S+) → (.*)$/);
        if (shift) {
          expect(text, where).toContain(`enter I${shift[1]}`);
          expect(topState(row), where).toBe(shift[1]);
        } else if (reduce) {
          const popped = reduce[2] === "ε" ? 0 : reduce[2].split(" ").length;
          expect(text, where).toContain(popped === 0 ? "Pop no grammar symbols" : `Pop ${popped} grammar symbol`);
          expect(text, where).toContain(`Push ${reduce[1]}`);
          expect(text, where).toContain(`enter I${topState(row)}`); // each row shows the stack after its action
          expect(text, where).not.toMatch(/ [.,;]/); // no stray space before punctuation
        } else if (action === "Accept") {
          expect(text.toLowerCase(), where).toContain("accept");
        }
        act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape", bubbles: true })); });
      });
    });
  }
});

