import { describe, expect, it } from "vitest";
import { generateParser } from "./parser";
import type { TreeNode } from "./types";

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

function randomGrammar(random: () => number) {
  const nonterminals = ["S", "A", "B", "C"].slice(0, 1 + Math.floor(random() * 4));
  const terminals = ["a", "b", "c"].slice(0, 1 + Math.floor(random() * 3));
  const pool = [...nonterminals, ...terminals];
  const rules: Rule[] = [];
  const seen = new Set<string>();
  for (const lhs of nonterminals) {
    const count = 1 + Math.floor(random() * 3);
    for (let i = 0; i < count; i += 1) {
      const rhs = Array.from({ length: Math.floor(random() * 4) }, () => pool[Math.floor(random() * pool.length)]);
      const key = `${lhs}->${rhs.join(" ")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rules.push({ lhs, rhs });
    }
  }
  const text = nonterminals
    .map((lhs) => `${lhs} -> ${rules.filter((r) => r.lhs === lhs).map((r) => r.rhs.join(" ") || "@").join(" | ")}`)
    .join("\n");
  return { rules, text, nonterminals, terminals };
}

// Independent LR(0) + SLR construction, keyed by item-set contents (state numbering is irrelevant).
function reference(rules: Rule[], nonterminals: string[], follow: Map<string, Set<string>>) {
  const all: Rule[] = [{ lhs: "S'", rhs: [nonterminals[0]] }, ...rules];
  const nt = new Set(nonterminals);
  const close = (items: Set<string>) => {
    const out = new Set(items);
    for (let changed = true; changed;) {
      changed = false;
      for (const item of [...out]) {
        const [r, d] = item.split(".").map(Number);
        const next = all[r].rhs[d];
        if (next && nt.has(next)) {
          all.forEach((rule, index) => {
            if (rule.lhs === next && !out.has(`${index}.0`)) { out.add(`${index}.0`); changed = true; }
          });
        }
      }
    }
    return out;
  };
  const key = (items: Set<string>) => [...items].sort().join("|");
  const start = close(new Set(["0.0"]));
  const states = new Map<string, Set<string>>([[key(start), start]]);
  const edges = new Set<string>();
  const queue = [start];
  while (queue.length) {
    const state = queue.shift()!;
    const symbols = new Set([...state].map((i) => { const [r, d] = i.split(".").map(Number); return all[r].rhs[d]; }).filter(Boolean));
    for (const symbol of symbols) {
      const moved = new Set([...state].filter((i) => { const [r, d] = i.split(".").map(Number); return all[r].rhs[d] === symbol; })
        .map((i) => { const [r, d] = i.split(".").map(Number); return `${r}.${d + 1}`; }));
      const target = close(moved);
      if (!states.has(key(target))) { states.set(key(target), target); queue.push(target); }
      edges.add(`${key(state)}~${symbol}~${key(target)}`);
    }
  }
  const actions = new Set<string>();
  for (const [stateKey, items] of states) {
    for (const edge of edges) {
      const [from, symbol, to] = edge.split("~");
      if (from === stateKey && !nt.has(symbol)) actions.add(`${stateKey}@${symbol}=s>${to}`);
    }
    for (const item of items) {
      const [r, d] = item.split(".").map(Number);
      if (d !== all[r].rhs.length) continue;
      if (r === 0) actions.add(`${stateKey}@$=acc`);
      else for (const symbol of follow.get(all[r].lhs)!) actions.add(`${stateKey}@${symbol}=r${r}`);
    }
  }
  return { states, edges, actions };
}

function leaves(node: TreeNode): string[] {
  return node.children.length ? node.children.flatMap(leaves) : node.productionId !== undefined ? [] : [node.symbol];
}

describe("structural invariants", () => {
  it("LR(0) automaton and SLR ACTION table equal an independent construction", () => {
    for (let seed = 1; seed <= 600; seed += 1) {
      const { rules, text, nonterminals } = randomGrammar(mulberry32(seed));
      const result = generateParser(text, "");
      const ref = reference(rules, nonterminals, result.follow);
      const keyOf = (id: number) => result.states[id].items.map((i) => `${i.productionId}.${i.dot}`).sort().join("|");

      expect(new Set(result.states.map((s) => keyOf(s.id))), `states — seed ${seed}\n${text}`).toEqual(new Set(ref.states.keys()));
      expect(result.states, `no duplicate states — seed ${seed}`).toHaveLength(ref.states.size);

      const edges = new Set<string>();
      for (const [from, row] of result.transitions) for (const [symbol, to] of row) edges.add(`${keyOf(from)}~${symbol}~${keyOf(to)}`);
      expect(edges, `edges — seed ${seed}\n${text}`).toEqual(ref.edges);

      const actions = new Set<string>();
      for (const [state, row] of result.table.action) {
        for (const [symbol, cell] of row) {
          for (const a of cell.actions) {
            actions.add(`${keyOf(state)}@${symbol}=${a.kind === "shift" ? `s>${keyOf(a.state)}` : a.kind === "reduce" ? `r${a.productionId}` : "acc"}`);
          }
        }
      }
      expect(actions, `ACTION — seed ${seed}\n${text}`).toEqual(ref.actions);
    }
  });

  it("every trace obeys stack, step-numbering, forest and termination invariants", () => {
    for (let seed = 1; seed <= 400; seed += 1) {
      const random = mulberry32(seed + 90_000);
      const { text, terminals } = randomGrammar(random);
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const tokens = Array.from({ length: Math.floor(random() * 7) }, () => terminals[Math.floor(random() * terminals.length)]);
        const result = generateParser(text, tokens.join(" "));
        const ctx = `seed ${seed} input "${tokens.join(" ")}"\n${text}`;

        result.trace.forEach((entry, index) => {
          expect(entry.step, ctx).toBe(index);
          expect(entry.states.length, ctx).toBe(entry.symbols.length + 1);
          expect(entry.forest.length, ctx).toBe(entry.symbols.length);
          expect(entry.forest.map((n) => n.symbol), ctx).toEqual(entry.symbols);
          // consumed input + remaining always reconstructs the original token list
          const consumed = entry.forest.flatMap(leaves);
          expect([...consumed, ...entry.remaining.filter((t) => t !== "$")], ctx).toEqual(tokens);
        });
        const kinds = result.trace.map((e) => e.kind);
        expect(kinds.slice(0, -1).every((k) => k === "start" || k === "shift" || k === "reduce"), ctx).toBe(true);
        expect(["accept", "reject", "conflict"], ctx).toContain(kinds.at(-1));
        expect(result.outcome === "accepted", ctx).toBe(kinds.at(-1) === "accept");
        if (result.outcome === "accepted") {
          const finalForest = result.trace.at(-1)!.forest;
          expect(finalForest.map((n) => n.symbol), ctx).toEqual([result.grammar.start]);
          expect(finalForest.flatMap(leaves), ctx).toEqual(tokens);
          // every reduction node's children spell its production's right-hand side
          const check = (node: TreeNode) => {
            if (node.productionId !== undefined) {
              expect(node.children.map((c) => c.symbol), ctx).toEqual(result.grammar.productions[node.productionId].rhs);
              expect(node.symbol, ctx).toBe(result.grammar.productions[node.productionId].lhs);
            }
            node.children.forEach(check);
          };
          finalForest.forEach(check);
        }
      }
    }
  }, 60_000);
});
