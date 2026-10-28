import { describe, expect, it } from "vitest";
import { generateParser } from "./parser";

// Deterministic PRNG so any failure is reproducible from the printed seed.
function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rule = { lhs: string; rhs: string[] };

function randomGrammar(random: () => number): { rules: Rule[]; text: string; nonterminals: string[]; terminals: string[] } {
  const nonterminals = ["S", "A", "B", "C"].slice(0, 1 + Math.floor(random() * 4));
  const terminals = ["a", "b", "c"].slice(0, 1 + Math.floor(random() * 3));
  const pool = [...nonterminals, ...terminals];
  const rules: Rule[] = [];
  const seen = new Set<string>();
  for (const lhs of nonterminals) {
    const count = 1 + Math.floor(random() * 3);
    for (let alternative = 0; alternative < count; alternative += 1) {
      const length = Math.floor(random() * 4);
      const rhs = Array.from({ length }, () => pool[Math.floor(random() * pool.length)]);
      const key = `${lhs}->${rhs.join(" ")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rules.push({ lhs, rhs });
    }
  }
  const text = nonterminals
    .map((lhs) => `${lhs} -> ${rules.filter((rule) => rule.lhs === lhs).map((rule) => rule.rhs.join(" ") || "@").join(" | ")}`)
    .join("\n");
  return { rules, text, nonterminals, terminals };
}

function referenceSets(rules: Rule[], nonterminals: string[], start: string) {
  const isNonterminal = (symbol: string) => nonterminals.includes(symbol);
  const nullable = new Set<string>();
  const first = new Map(nonterminals.map((symbol) => [symbol, new Set<string>()]));
  const follow = new Map(nonterminals.map((symbol) => [symbol, new Set<string>()]));
  const firstOfSequence = (sequence: string[]) => {
    const result = new Set<string>();
    let allNullable = true;
    for (const symbol of sequence) {
      if (isNonterminal(symbol)) {
        first.get(symbol)!.forEach((item) => result.add(item));
        if (!nullable.has(symbol)) { allNullable = false; break; }
      } else {
        result.add(symbol);
        allNullable = false;
        break;
      }
    }
    return { result, allNullable };
  };

  for (let changed = true; changed;) {
    changed = false;
    for (const { lhs, rhs } of rules) {
      const { result, allNullable } = firstOfSequence(rhs);
      for (const item of result) {
        if (!first.get(lhs)!.has(item)) { first.get(lhs)!.add(item); changed = true; }
      }
      if (allNullable && !nullable.has(lhs)) { nullable.add(lhs); changed = true; }
    }
  }

  follow.get(start)!.add("$");
  for (let changed = true; changed;) {
    changed = false;
    for (const { lhs, rhs } of rules) {
      rhs.forEach((symbol, index) => {
        if (!isNonterminal(symbol)) return;
        const { result, allNullable } = firstOfSequence(rhs.slice(index + 1));
        const additions = allNullable ? [...result, ...follow.get(lhs)!] : [...result];
        for (const item of additions) {
          if (!follow.get(symbol)!.has(item)) { follow.get(symbol)!.add(item); changed = true; }
        }
      });
    }
  }
  return { nullable, first, follow };
}

// Independent recognizer (Earley, with the nullable fix) used as ground truth for membership.
function earleyAccepts(rules: Rule[], nonterminals: string[], start: string, nullable: Set<string>, tokens: string[]): boolean {
  const all: Rule[] = [{ lhs: "$start", rhs: [start] }, ...rules];
  const chart: Set<string>[] = Array.from({ length: tokens.length + 1 }, () => new Set());
  const queues: [number, number, number][][] = Array.from({ length: tokens.length + 1 }, () => []);
  const add = (position: number, rule: number, dot: number, origin: number) => {
    const key = `${rule}:${dot}:${origin}`;
    if (chart[position].has(key)) return;
    chart[position].add(key);
    queues[position].push([rule, dot, origin]);
  };
  add(0, 0, 0, 0);
  for (let position = 0; position <= tokens.length; position += 1) {
    for (let cursor = 0; cursor < queues[position].length; cursor += 1) {
      const [ruleIndex, dot, origin] = queues[position][cursor];
      const rule = all[ruleIndex];
      if (dot === rule.rhs.length) {
        for (const [otherRule, otherDot, otherOrigin] of [...queues[origin]]) {
          if (all[otherRule].rhs[otherDot] === rule.lhs) add(position, otherRule, otherDot + 1, otherOrigin);
        }
        continue;
      }
      const symbol = rule.rhs[dot];
      if (nonterminals.includes(symbol)) {
        all.forEach((candidate, candidateIndex) => {
          if (candidate.lhs === symbol) add(position, candidateIndex, 0, position);
        });
        if (nullable.has(symbol)) add(position, ruleIndex, dot + 1, origin);
      } else if (position < tokens.length && tokens[position] === symbol) {
        add(position + 1, ruleIndex, dot + 1, origin);
      }
    }
  }
  return chart[tokens.length].has(`0:1:0`);
}

describe("differential check against reference algorithms", () => {
  it("matches reference FIRST/FOLLOW and reference membership on random grammars", () => {
    let checkedMembership = 0;
    let conflictFree = 0;
    let acceptedStrings = 0;
    for (let seed = 1; seed <= 1000; seed += 1) {
      const random = mulberry32(seed);
      const { rules, text, nonterminals, terminals } = randomGrammar(random);
      const context = `seed ${seed}\n${text}`;
      const start = nonterminals[0];
      const reference = referenceSets(rules, nonterminals, start);
      const result = generateParser(text, "");

      for (const symbol of nonterminals) {
        const expectedFirst = [...reference.first.get(symbol)!, ...(reference.nullable.has(symbol) ? ["ε"] : [])].sort();
        expect([...result.first.get(symbol)!].sort(), `FIRST(${symbol}) — ${context}`).toEqual(expectedFirst);
        expect([...result.follow.get(symbol)!].sort(), `FOLLOW(${symbol}) — ${context}`).toEqual([...reference.follow.get(symbol)!].sort());
      }

      if (result.table.conflicts.length > 0) continue;
      conflictFree += 1;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const length = Math.floor(random() * 7);
        const tokens = Array.from({ length }, () => terminals[Math.floor(random() * terminals.length)]);
        const expected = earleyAccepts(rules, nonterminals, start, reference.nullable, tokens);
        const actual = generateParser(text, tokens.join(" "));
        expect(actual.outcome, `input "${tokens.join(" ")}" — ${context}`).toBe(expected ? "accepted" : "rejected");
        checkedMembership += 1;
        if (expected) acceptedStrings += 1;
      }
    }
    // Make sure the sample really exercised both accepted and rejected strings.
    expect(conflictFree).toBeGreaterThan(100);
    expect(checkedMembership).toBeGreaterThan(1000);
    expect(acceptedStrings).toBeGreaterThan(100);
  }, 60_000);
});
