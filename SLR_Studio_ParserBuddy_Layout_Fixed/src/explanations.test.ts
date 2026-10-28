import { expect, it } from "vitest";
import { generateParser } from "./parser";
function mulberry32(seed: number) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function gen(random: () => number) {
  const nts = ["S", "A", "B", "C"].slice(0, 1 + Math.floor(random() * 4));
  const ts = ["a", "b", "c"].slice(0, 1 + Math.floor(random() * 3));
  const pool = [...nts, ...ts]; const seen = new Set<string>(); const lines: string[] = [];
  for (const lhs of nts) { const alts: string[] = []; for (let i = 0, n = 1 + Math.floor(random() * 3); i < n; i++) { const rhs = Array.from({ length: Math.floor(random() * 4) }, () => pool[Math.floor(random() * pool.length)]); const k = lhs + rhs.join(" "); if (seen.has(k)) continue; seen.add(k); alts.push(rhs.join(" ") || "@"); } lines.push(`${lhs} -> ${alts.join(" | ")}`); }
  return lines.join("\n");
}
it("every FIRST/FOLLOW explanation cites a production and position that really yields the symbol", () => {
  const bad = new Map<string, string>(); let checked = 0;
  const note = (k: string, d: string) => { if (!bad.has(k)) bad.set(k, d); };
  for (let seed = 1; seed <= 1500; seed++) {
    const text = gen(mulberry32(seed));
    const r = generateParser(text, "");
    const P = r.grammar.productions; const nt = new Set(r.grammar.nonterminals);
    const nullable = (s: string) => nt.has(s) && r.first.get(s)!.has("ε");
    const firstOf = (s: string) => nt.has(s) ? new Set([...r.first.get(s)!].filter((x) => x !== "ε")) : new Set([s]);
    const suffixFirst = (seq: string[]) => { const out = new Set<string>(); let all = true; for (const s of seq) { firstOf(s).forEach((x) => out.add(x)); if (!nullable(s)) { all = false; break; } } return { out, all }; };
    for (const A of r.grammar.nonterminals) {
      for (const x of r.first.get(A)!) {
        checked++;
        const steps = r.firstReasons.get(A)!.get(x) ?? [];
        if (steps.length !== 1) { note("FIRST: member without exactly one reason", `${A}:${x} steps=${steps.length}\n${text}`); continue; }
        const st = steps[0]; const p = st.productionId === undefined ? undefined : P[st.productionId];
        if (!p || p.lhs !== A) { note("FIRST: reason production missing/wrong lhs", `${A}:${x} ${JSON.stringify(st)}\n${text}`); continue; }
        if (x === "ε") { if (!p.rhs.every(nullable)) note("FIRST: ε reason but rhs not all nullable", `${A} ${JSON.stringify(st)}\n${text}`); }
        else {
          const pos = st.position ?? -1; const prefix = p.rhs.slice(0, pos); const sym = p.rhs[pos];
          if (sym === undefined || !prefix.every(nullable) || !firstOf(sym).has(x)) note("FIRST: reason does not yield member", `${A}:${x} ${JSON.stringify(st)} rule=${p.lhs}->${p.rhs.join(" ")}\n${text}`);
        }
        if (!st.explanation.includes(x === "ε" ? "ε" : x)) note("FIRST: explanation never mentions the member", `${A}:${x} "${st.explanation.slice(0, 120)}"`);
      }
      for (const x of r.follow.get(A)!) {
        checked++;
        const steps = r.followReasons.get(A)!.get(x) ?? [];
        if (steps.length !== 1) { note("FOLLOW: member without exactly one reason", `${A}:${x} steps=${steps.length}\n${text}`); continue; }
        const st = steps[0];
        if (x === "$" && A === r.grammar.start && st.productionId === undefined) continue;
        const p = st.productionId === undefined ? undefined : P[st.productionId]; const pos = st.position ?? -1;
        if (!p || p.rhs[pos] !== A) { note("FOLLOW: reason position is not the symbol", `${A}:${x} ${JSON.stringify(st)}\n${text}`); continue; }
        const { out, all } = suffixFirst(p.rhs.slice(pos + 1));
        const ok = out.has(x) || (all && r.follow.get(p.lhs)!.has(x));
        if (!ok) note("FOLLOW: reason does not yield member", `${A}:${x} rule=${p.lhs}->${p.rhs.join(" ")} pos=${pos}\n${text}`);
        if (!st.explanation.includes(x)) note("FOLLOW: explanation never mentions the member", `${A}:${x} "${st.explanation.slice(0, 120)}"`);
      }
    }
  }
  expect(checked).toBeGreaterThan(5000);
  expect([...bad.entries()].map(([k, d]) => `${k} → ${d.slice(0, 200)}`)).toEqual([]);
});
