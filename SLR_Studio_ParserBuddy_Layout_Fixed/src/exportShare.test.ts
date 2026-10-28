import { describe, expect, it } from "vitest";
import { tableToCsv, toCsv, traceToCsv } from "./exportUtils";
import { DEFAULT_GRAMMAR, DEFAULT_INPUT, generateParser } from "./parser";
import { buildShareUrl, decodeShareState, encodeShareState } from "./shareLink";

describe("CSV export", () => {
  it("writes the SLR table with one row per state and the right cells", () => {
    const result = generateParser("E ::= E + T | T\nT ::= id", "id + id");
    const lines = tableToCsv(result).trim().split("\r\n");
    expect(lines[0]).toBe("State,ACTION +,ACTION id,ACTION $,GOTO E,GOTO T");
    expect(lines).toHaveLength(1 + result.states.length);
    expect(lines[1]).toBe("I0,,s3,,1,2");
    expect(lines[2]).toBe("I1,s4,,acc,,");
  });

  it("writes one trace row per step, with the stack as states and symbols", () => {
    const result = generateParser(DEFAULT_GRAMMAR, DEFAULT_INPUT);
    const lines = traceToCsv(result).trim().split("\r\n");
    expect(lines).toHaveLength(result.trace.length + 1);
    expect(lines[1]).toContain("Ready");
    expect(lines[2]).toContain("0 id 5");
  });

  it("quotes commas and quotes, and defuses spreadsheet formulas", () => {
    expect(toCsv([["a,b", 'say "hi"', "=cmd|x", "@SUM(A1)", "+1+1", "+", "-", "plain"]]))
      .toBe('"a,b","say ""hi""",\'=cmd|x,\'@SUM(A1),\'+1+1,+,-,plain\r\n');
  });
});

describe("share links", () => {
  it("round-trips awkward text exactly", () => {
    const state = { grammar: "S -> a # c & d = e\nS -> 'ε' | “x”\n| %41", input: "a + b ✓", characterMode: true };
    expect(decodeShareState("#" + encodeShareState(state))).toEqual(state);
    expect(decodeShareState(buildShareUrl(state, "https://example.com/app?x=1#old").split("#").slice(1).join("#"))).toEqual(state);
    expect(buildShareUrl(state, "https://example.com/app?x=1#old").startsWith("https://example.com/app?x=1#g=")).toBe(true);
  });

  it("rejects missing, empty, and oversized payloads instead of throwing", () => {
    expect(decodeShareState("")).toBeNull();
    expect(decodeShareState("#")).toBeNull();
    expect(decodeShareState("#i=only-input")).toBeNull();
    expect(decodeShareState("#g=" + "a".repeat(20001))).toBeNull();
    expect(decodeShareState("#" + "x".repeat(70000))).toBeNull();
    expect(decodeShareState("#g=S+-%3E+a")).toEqual({ grammar: "S -> a", input: "", characterMode: false });
  });
});
