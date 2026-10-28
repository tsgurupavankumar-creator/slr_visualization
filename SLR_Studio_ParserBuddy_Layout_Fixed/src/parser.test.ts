import { describe, expect, it } from "vitest";
import { DEFAULT_GRAMMAR, DEFAULT_INPUT, describeConflict, generateParser, getSetDerivation, parseGrammar } from "./parser";

describe("SLR parser generation", () => {
  it("builds the expression grammar sets, states, and accepting trace", () => {
    const result = generateParser(DEFAULT_GRAMMAR, DEFAULT_INPUT);

    expect([...result.first.get("E")!].sort()).toEqual(["(", "id"]);
    expect([...result.follow.get("E")!].sort()).toEqual(["$", ")", "+"]);
    expect(result.states).toHaveLength(12);
    expect(result.table.conflicts).toHaveLength(0);
    expect(result.outcome).toBe("accepted");
    expect(result.trace.at(-1)?.kind).toBe("accept");

    const followExplanation = getSetDerivation("FOLLOW", "E", result.follow, result.followReasons);
    expect(followExplanation.result).toBe("FOLLOW(E) = { $, ), + }");
    expect(followExplanation.steps[0].rule).toContain("start symbol");
    expect(followExplanation.steps.some((step) =>
      step.productionId === 1 && step.position === 0 && step.explanation.includes("position 1"),
    )).toBe(true);
    expect(followExplanation.steps.some((step) =>
      step.productionId === 5 && step.explanation.includes(")"),
    )).toBe(true);
    expect(result.firstReasons.get("E")?.get("id")?.[0].explanation).toContain("E → T");
  });

  it("propagates nullable FIRST/FOLLOW entries and parses an empty derivation", () => {
    const grammar = "S -> A b\nA -> @ | a";
    const result = generateParser(grammar, "b");

    expect([...result.first.get("A")!].sort()).toEqual(["a", "ε"]);
    expect([...result.follow.get("A")!]).toEqual(["b"]);
    expect(result.followReasons.get("A")?.get("b")?.[0].productionId).toBe(1);
    const shiftedB = result.trace.find((entry) =>
      entry.kind === "shift" && entry.forest.some((node) => node.symbol === "b"),
    );
    expect(shiftedB?.forest.some((node) => node.symbol === "b" && node.id?.startsWith("shift-"))).toBe(true);
    expect(result.outcome).toBe("accepted");
    expect(generateParser("S -> @", "").outcome).toBe("accepted");
  });

  it("records nullable-prefix and nullable-suffix reasoning from the grammar", () => {
    const result = generateParser("S -> A B\nA -> @ | a\nB -> @ | b", "a b");
    const firstS = getSetDerivation("FIRST", "S", result.first, result.firstReasons);
    const followA = getSetDerivation("FOLLOW", "A", result.follow, result.followReasons);

    expect(firstS.result).toBe("FIRST(S) = { a, b, ε }");
    expect(firstS.steps.some((step) => step.rule.includes("nullable-prefix") && step.explanation.includes("FIRST(**B**)"))).toBe(true);
    expect(followA.result).toBe("FOLLOW(A) = { $, b }");
    expect(followA.steps.some((step) => step.rule.includes("nullable suffix") && step.explanation.includes("FOLLOW(**S**)"))).toBe(true);
  });

  it("annotates shifted leaves and reduction parents for tree tooltips", () => {
    const result = generateParser("S -> a", "a");

    expect(result.trace[1].forest[0]).toMatchObject({
      id: "shift-1",
      symbol: "a",
      explanation: expect.stringContaining("Shifted terminal a"),
    });
    expect(result.trace[2].forest[0]).toMatchObject({
      id: "reduce-2",
      symbol: "S",
      productionId: 1,
      explanation: expect.stringContaining("children (a) were popped"),
    });
  });

  it("reports SLR conflicts and stops when a conflicting lookahead is reached", () => {
    const result = generateParser("E -> E + E | id", "id + id + id");

    expect(result.table.conflicts.length).toBeGreaterThan(0);
    expect(result.outcome).toBe("conflict");
    expect(result.trace.at(-1)?.kind).toBe("conflict");
  });

  it("rejects invalid input and reports undeclared terminals", () => {
    const malformed = generateParser(DEFAULT_GRAMMAR, "id +");
    const unknown = generateParser(DEFAULT_GRAMMAR, "mystery");

    expect(malformed.outcome).toBe("rejected");
    expect(malformed.trace.at(-1)?.kind).toBe("reject");
    expect(unknown.outcome).toBe("rejected");
    expect(unknown.trace.at(-1)?.detail).toContain("not a terminal");
  });

  it("accepts BNF arrows, comments, alternatives, and quoted terminals", () => {
    const grammar = parseGrammar("S ::= 'if' E 'then' S | id # a comment");

    expect(grammar.start).toBe("S");
    expect(grammar.terminals).toContain("if");
    expect(grammar.terminals).toContain("then");
    expect(grammar.productions).toHaveLength(3);
  });

  it("preserves quoted comment and alternative characters and reserves the end marker", () => {
    const grammar = parseGrammar("S -> '#' | 'a|b'");

    expect(grammar.terminals).toEqual(["#", "a|b"]);
    expect(() => parseGrammar("S -> '$'")).toThrow("reserved as the end-of-input marker");
    expect(generateParser("S -> a", "ε").outcome).toBe("rejected");
  });

  it("handles primed non-terminals, comments, and alternatives together", () => {
    const grammar = "E -> T E'   # start\nE' -> + T E' | @  # tail\nT -> id";
    const result = generateParser(grammar, "id + id + id");

    expect(result.grammar.nonterminals).toEqual(["E", "E'", "T"]);
    expect(result.grammar.productions.map((production) => production.rhs.join(" "))).toEqual(["E", "T E'", "+ T E'", "", "id"]);
    expect(result.grammar.augmentedStart).toBe("E''");
    expect(result.outcome).toBe("accepted");
    expect(generateParser(grammar, "id +").outcome).toBe("rejected");
  });

  it("accepts a leading | on a continuation line", () => {
    const result = generateParser("E -> E + T\n  | T\nT -> id", "id + id");

    expect(result.grammar.productions).toHaveLength(4);
    expect(result.outcome).toBe("accepted");
    expect(() => parseGrammar("| a")).toThrow("no production comes before it");
  });

  it("rejects ambiguous quoting", () => {
    expect(() => parseGrammar("S -> 'ε' a")).toThrow("Write @");
    expect(() => parseGrammar("S -> '' a")).toThrow("empty quoted terminal");
    expect(() => parseGrammar("S -> 'a b")).toThrow("Unclosed quote");
    expect(() => parseGrammar("S -> 'S' a | b")).toThrow("also a non-terminal name");
    expect(() => parseGrammar("S ->")).toThrow("no right-hand side");
  });

  it("treats a repeated alternative as one production instead of a fake conflict", () => {
    const result = generateParser("S -> a | a", "a");

    expect(result.grammar.productions).toHaveLength(2);
    expect(result.table.conflicts).toHaveLength(0);
    expect(result.outcome).toBe("accepted");
  });

  it("never lets the augmented start name collide with a terminal", () => {
    const grammar = parseGrammar("E -> E' a");

    expect(grammar.terminals).toContain("E'");
    expect(grammar.augmentedStart).toBe("E''");
  });

  it("shows partial progress before rejecting an unknown token mid-input", () => {
    const result = generateParser(DEFAULT_GRAMMAR, "id + mystery");
    const last = result.trace.at(-1)!;

    expect(result.outcome).toBe("rejected");
    expect(result.trace.some((entry) => entry.kind === "shift")).toBe(true);
    expect(last.kind).toBe("reject");
    expect(last.detail).toContain("“mystery” is not a terminal");
  });

  it("parses long inputs without hitting the step limit or slowing down", () => {
    const started = performance.now();
    const result = generateParser("S -> S a | a", Array(600).fill("a").join(" "));

    expect(result.outcome).toBe("accepted");
    expect(result.trace.at(-1)?.kind).toBe("accept");
    expect(result.trace.filter((entry) => entry.kind === "reject")).toHaveLength(0);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it("keeps each trace snapshot independent of later steps", () => {
    const result = generateParser("S -> a b", "a b");

    expect(result.trace[1].forest.map((node) => node.symbol)).toEqual(["a"]);
    expect(result.trace[2].forest.map((node) => node.symbol)).toEqual(["a", "b"]);
    expect(result.trace[3].forest.map((node) => node.symbol)).toEqual(["S"]);
  });
});

describe("input and grammar limits", () => {
  it("refuses inputs and grammars large enough to exhaust browser memory", () => {
    expect(() => generateParser("S -> S a | a", Array(2001).fill("a").join(" "))).toThrow("supports up to 2,000");
    expect(generateParser("S -> S a | a", Array(2000).fill("a").join(" ")).outcome).toBe("accepted");
    const huge = "S -> " + Array.from({ length: 301 }, (_, index) => `t${index}`).join(" | ");
    expect(() => generateParser(huge, "t0")).toThrow("supports up to 300");
  });
});

describe("run-together token hint", () => {
  it("suggests a split when an unknown token is several known terminals joined", () => {
    const g = "S -> A a | B a\nA -> x\nB -> x";
    expect(generateParser(g, "xa").trace.at(-1)?.detail).toContain("did you mean “x a”");
    expect(generateParser(g, "xxa").trace.at(-1)?.detail).toContain("did you mean “x x a”");
    expect(generateParser(g, "zzz").trace.at(-1)?.detail).not.toContain("did you mean");
  });
});

describe("grammar notices", () => {
  it("stays silent for well-formed grammars, including a terminal that differs from a non-terminal only by case", () => {
    expect(generateParser(DEFAULT_GRAMMAR, DEFAULT_INPUT).grammar.warnings).toEqual([]);
    expect(parseGrammar("S -> A a\nA -> a").warnings).toEqual([]);
    expect(parseGrammar("S -> a S b | @").warnings).toEqual([]);
  });

  it("flags a probable misspelled non-terminal and suggests the real one", () => {
    const warnings = parseGrammar("S -> Tt\nT -> a").warnings;
    expect(warnings[0]).toContain("“Tt” is used in a rule but never defined");
    expect(warnings[0]).toContain("Did you mean “T”?");
    // ...and the consequence of the typo is reported too: T is now unreachable.
    expect(warnings).toHaveLength(2);
    expect(warnings[1]).toContain("“T” is defined but can never be reached");
    expect(parseGrammar("Expr -> expr + n | n").warnings.join(" ")).toContain("Did you mean “Expr”?");
  });

  it("flags unreachable and unfinishable non-terminals once each", () => {
    const unreachable = parseGrammar("S -> a\nU -> b").warnings;
    expect(unreachable).toEqual([expect.stringContaining("“U” is defined but can never be reached")]);
    const unfinishable = parseGrammar("S -> A | a\nA -> A b").warnings;
    expect(unfinishable).toEqual([expect.stringContaining("“A” can never finish deriving a string")]);
  });

  it("does not warn about quoted terminals", () => {
    expect(parseGrammar("S -> 'Tt' a").warnings).toEqual([]);
  });
});

describe("character mode", () => {
  it("lets run-together letters parse, where normal mode sees one unknown token", () => {
    const grammar = "S -> a S b | @";
    expect(generateParser(grammar, "aabb").outcome).toBe("rejected");
    const result = generateParser(grammar, "aabb", { characterMode: true });
    expect(result.inputTokens).toEqual(["a", "a", "b", "b"]);
    expect(result.outcome).toBe("accepted");
    expect(result.characterMode).toBe(true);
    expect(generateParser(grammar, "aab", { characterMode: true }).outcome).toBe("rejected");
  });

  it("splits undefined words in the grammar but keeps defined non-terminals, quotes and @ whole", () => {
    expect(parseGrammar("S -> ab S | @", { characterMode: true }).terminals).toEqual(["a", "b"]);
    const concatenated = parseGrammar("S -> AB\nA -> a\nB -> b", { characterMode: true });
    expect(concatenated.productions[1].rhs).toEqual(["A", "B"]);
    expect(concatenated.terminals).toEqual(["a", "b"]);
    const named = parseGrammar("S -> Expr + n\nExpr -> n", { characterMode: true });
    expect(named.productions[1].rhs).toEqual(["Expr", "+", "n"]);
    expect(parseGrammar("S -> '==' x | @", { characterMode: true }).terminals).toEqual(["==", "x"]);
    const quotedInput = generateParser("S -> '==' x", "'==' x", { characterMode: true });
    expect(quotedInput.inputTokens).toEqual(["==", "x"]);
    expect(quotedInput.outcome).toBe("accepted");
  });
});

describe("conflict explanations", () => {
  it("explains a reduce/reduce conflict in terms of both rules and their FOLLOW sets", () => {
    const result = generateParser("S -> A a | B a\nA -> x\nB -> x", "x a");
    const explained = describeConflict(result, result.table.conflicts[0]);
    expect(explained.kind).toBe("reduce/reduce");
    expect(explained.options).toHaveLength(2);
    expect(explained.options[0]).toContain("Reduce by A → x");
    expect(explained.options[1]).toContain("FOLLOW(B) = { a }");
  });

  it("explains a shift/reduce conflict by naming the item that wants the shift", () => {
    const result = generateParser("S -> if E then S | if E then S else S | a\nE -> b", "a");
    const explained = describeConflict(result, result.table.conflicts[0]);
    expect(explained.kind).toBe("shift/reduce");
    expect(explained.options.some((option) => option.startsWith("Shift “else”") && option.includes("S → if E then S • else S"))).toBe(true);
    expect(explained.options.some((option) => option.startsWith("Reduce by S → if E then S"))).toBe(true);
  });
});

describe("lazy remaining input", () => {
  it("derives each entry's remaining input from its own position", () => {
    const result = generateParser("S -> a b", "a b");
    expect(result.trace.map((entry) => entry.remaining)).toEqual([["a", "b", "$"], ["b", "$"], ["$"], ["$"], ["$"]]);
    expect(result.trace[0].remaining).not.toBe(result.trace[0].remaining); // a fresh copy, never shared mutable state
  });
});

describe("table size limit", () => {
  it("refuses a grammar whose SLR table would be too large to draw, and accepts one just under it", () => {
    const chain = (count: number) => Array.from({ length: count }, (_, i) => `N${i} -> N${(i + 1) % count} t${i} | t${i}`).join("\n");
    expect(() => generateParser(chain(100), "t0")).toThrow("table columns");
    expect(() => generateParser(chain(100), "t0")).toThrow("up to 15,000 cells");
    expect(generateParser(chain(40), "t0").outcome).toBeDefined();
  });
});

describe("@ as the standard empty production", () => {
  it("parses @ as the empty right-hand side", () => {
    const grammar = parseGrammar("S -> a S b | @");
    expect(grammar.productions.map((production) => production.rhs)).toEqual([["S"], ["a", "S", "b"], []]);
    expect(grammar.terminals).toEqual(["a", "b"]);
    expect(grammar.warnings).toEqual([]);
  });

  it("treats ε as an error and the word epsilon as an ordinary name", () => {
    for (const grammar of ["S -> a S b | ε", "S -> ε", "S -> 'ε' a", "S -> a ε"]) {
      expect(() => parseGrammar(grammar), grammar).toThrow("Write @ for an empty production");
    }
    expect(() => parseGrammar("ε -> a")).toThrow("not a valid non-terminal name");

    const word = parseGrammar("S -> a S b | epsilon");
    expect(word.terminals).toEqual(["a", "b", "epsilon"]);
    expect(word.productions.every((production) => production.rhs.length > 0)).toBe(true);
    expect(generateParser("S -> epsilon a", "epsilon a").outcome).toBe("accepted");
    const named = parseGrammar("epsilon -> a");
    expect(named.nonterminals).toEqual(["epsilon"]);
  });

  it("accepts strings, the empty string, and works without spaces around |", () => {
    expect(generateParser("S -> a S b | @", "a a b b").outcome).toBe("accepted");
    expect(generateParser("S -> a S b | @", "a a b").outcome).toBe("rejected");
    expect(generateParser("S -> @", "").outcome).toBe("accepted");
    expect(generateParser("S -> a|@", "").outcome).toBe("accepted");
    expect(generateParser("S -> a S b | @", "a b", { characterMode: true }).outcome).toBe("accepted");
  });

  it("rejects @ mixed with other symbols and says how to get a literal @", () => {
    expect(() => parseGrammar("S -> a @")).toThrow("Use @ on its own");
    expect(() => parseGrammar("S -> a @")).toThrow("quote it: '@'");
    expect(() => parseGrammar("S -> @ @")).toThrow("Use @ on its own");
  });

  it("lets a quoted '@' be an ordinary terminal, e.g. for e-mail style input", () => {
    const result = generateParser("S -> id '@' id", "id @ id");
    expect(result.grammar.terminals).toEqual(["id", "@"]);
    expect(result.outcome).toBe("accepted");
    expect(generateParser("S -> a", "@").trace.at(-1)?.detail).toContain("“@” is not a terminal");
  });

  it("points an empty right-hand side at @", () => {
    expect(() => parseGrammar("S ->")).toThrow("Write @");
  });
});

describe("hostile and accidental huge input is refused quickly", () => {
  const timed = (action: () => unknown) => { const started = performance.now(); let error: Error | undefined; try { action(); } catch (reason) { error = reason as Error; } return { ms: performance.now() - started, error }; };

  it("refuses an 8,000-production grammar in well under a second, before any quadratic analysis", () => {
    // 8,000 short lines stay under the character cap, so this exercises the production cap itself
    const lines = Array.from({ length: 8000 }, (_, index) => `N${index}->a`).join("\n");
    const { ms, error } = timed(() => generateParser(lines, "a"));
    expect(error?.message).toContain("more than 300 productions");
    expect(ms).toBeLessThan(1000);
  });

  it("handles a 100,000-character line with no arrow without backtracking, with a short message", () => {
    const { ms, error } = timed(() => generateParser("S" + " ".repeat(99990) + "a", "a"));
    expect(error?.message).toContain("Could not read this production");
    expect(error!.message.length).toBeLessThan(200);
    expect(ms).toBeLessThan(500);
  });

  it("refuses oversized text, oversized right-hand sides, and runaway automata", () => {
    expect(() => parseGrammar("S -> a ".repeat(20000))).toThrow("characters long");
    expect(() => generateParser("S -> a", "a ".repeat(60000))).toThrow("characters long");
    const wide = "S -> " + Array.from({ length: 6001 }, (_, index) => `t${index}`).join(" ");
    expect(() => parseGrammar(wide)).toThrow("more than 6,000 symbols");
    const long = "S -> " + Array.from({ length: 5100 }, (_, index) => `t${index}`).join(" ");
    expect(() => generateParser(long, "t0")).toThrow("more than 5,000 LR(0) states");
  });

  it("keeps echoed text short in every error message", () => {
    for (const grammar of ["x".repeat(500) + "! -> a", "S -> '" + "y".repeat(500), "| " + "z".repeat(500), "w".repeat(500) + " ->"]) {
      let message = "";
      try { parseGrammar(grammar); } catch (reason) { message = (reason as Error).message; }
      expect(message.length, grammar.slice(0, 20)).toBeGreaterThan(0);
      expect(message.length).toBeLessThan(260);
    }
  });
});

