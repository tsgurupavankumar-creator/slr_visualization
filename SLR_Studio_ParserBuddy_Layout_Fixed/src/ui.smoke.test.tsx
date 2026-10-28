import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import StageContent from "./components/Stages";
import ExplanationPanel from "./components/ExplanationPanel";
import { generateParser, DEFAULT_GRAMMAR } from "./parser";
import type { StageId } from "./store";

const stages: StageId[] = ["grammar", "sets", "states", "table", "trace"];
const cases: [string, string, string][] = [
  ["default", DEFAULT_GRAMMAR, "id + id * id"],
  ["eps only", "S -> @", ""],
  ["nullable", "S -> A B\nA -> @ | a\nB -> @ | b", "a"],
  ["primed", "E -> T E'\nE' -> + T E' | @\nT -> id", "id + id"],
  ["conflict", "E -> E + E | id", "id + id + id"],
  ["rejected", DEFAULT_GRAMMAR, "id + + id"],
  ["unknown token", DEFAULT_GRAMMAR, "id ? id"],
  ["empty input", DEFAULT_GRAMMAR, ""],
  ["not SLR", "S -> L = R | R\nL -> * R | id\nR -> L", "id = id"],
];

describe("UI smoke render", () => {
  for (const [name, grammar, input] of cases) {
    it(`renders every stage and step for: ${name}`, () => {
      const result = generateParser(grammar, input);
      for (const stage of stages) {
        const steps = stage === "trace" ? result.trace.map((_, i) => i) : [0];
        for (const activeStep of steps) {
          const html = renderToString(
            <StageContent result={result} stage={stage} activeStep={activeStep} explain={() => {}} setStep={() => {}} />,
          );
          expect(html.length).toBeGreaterThan(200);
        }
      }
    });
  }

  it("renders a * terminal as bold text instead of an empty bold plus a stray star", () => {
    const html = renderToString(
      <ExplanationPanel explanation={{ title: "t", body: "so add ***** to FOLLOW(**T**)" }} onClose={() => {}} />,
    );
    expect(html).not.toContain("<strong></strong>");
  });
});
