// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import ErrorBoundary from "./components/ErrorBoundary";
import { measureForest } from "./components/ParseTree";
import { generateParser } from "./parser";
import type { TreeNode } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("react-d3-tree", () => ({ default: () => null }));

describe("ErrorBoundary", () => {
  it("shows a message instead of unmounting the page, and recovers when the key changes", () => {
    const Broken = ({ broken }: { broken: boolean }) => { if (broken) throw new Error("boom"); return <p>fine</p>; };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    act(() => root.render(<ErrorBoundary resetKey="a"><Broken broken /></ErrorBoundary>));
    expect(container.querySelector("[role=alert]")?.textContent).toContain("This view could not be drawn");
    expect(container.textContent).toContain("boom");
    act(() => root.render(<ErrorBoundary resetKey="b"><Broken broken={false} /></ErrorBoundary>));
    expect(container.textContent).toBe("fine");
    quiet.mockRestore();
    act(() => root.unmount());
  });
});

describe("measureForest", () => {
  it("measures a 2,000-level tree without recursing", () => {
    const result = generateParser("S -> S a | a", Array(2000).fill("a").join(" "));
    const forest: TreeNode[] = result.trace.at(-1)!.forest;
    const { nodes, depth } = measureForest(forest);
    expect(depth).toBe(2001);
    expect(nodes).toBe(4000);
  });

  it("counts the ε node drawn under an empty reduction", () => {
    const forest = generateParser("S -> @", "").trace.at(-1)!.forest;
    expect(measureForest(forest)).toEqual({ nodes: 2, depth: 1 });
  });
});
