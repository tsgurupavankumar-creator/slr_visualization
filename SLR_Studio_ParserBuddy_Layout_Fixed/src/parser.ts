import type {
  ActionCell,
  Grammar,
  LRItem,
  LRState,
  ParseAction,
  ParserResult,
  Production,
  SetDerivation,
  SetDerivationStep,
  SLRTable,
  TraceEntry,
  TreeNode,
} from "./types";

export const DEFAULT_GRAMMAR = `E -> E + T | T
T -> T * F | F
F -> ( E ) | id`;
export const DEFAULT_INPUT = "id + id * id";
export const EPSILON = "ε";
const END = "$";

// Each trace entry keeps its own copy of the stacks, so memory grows with input length and, for
// deeply right-recursive grammars, quadratically (about 100 MB at 2,000 tokens, 585 MB at 5,000).
// The trace table is not readable at that size anyway.
export const MAX_INPUT_TOKENS = 2000;
export const MAX_PRODUCTIONS = 300;
// The SLR table draws one button per cell. 90,000 cells (a 300-production grammar) took about 17 s
// to render, so the table size is capped, not just the production count.
export const MAX_TABLE_CELLS = 15000;
// Cheap guards that run before any expensive work, so hostile or accidental huge input is refused
// in milliseconds instead of freezing the tab (a 20,000-line grammar once took two minutes).
export const MAX_GRAMMAR_CHARS = 100_000;
export const MAX_INPUT_CHARS = 100_000;
export const MAX_GRAMMAR_SYMBOLS = 6000;
export const MAX_STATES = 5000; // the LR(0) automaton can grow exponentially for contrived grammars

const preview = (text: string) => (text.length > 80 ? `${text.slice(0, 77)}…` : text);

type Token = { text: string; quoted: boolean; index: number };

// One tokenizer is shared by comment stripping, "|" splitting, grammar symbols and
// the input string, so they can never disagree about what is quoted. A "'" that
// follows an identifier character is part of the name (E', E''), not a quote.
const TOKEN_PATTERN = /'[^']*'|"[^"]*"|[A-Za-z_][A-Za-z0-9_']*|[0-9]+|[^\s]/gu;

function tokenize(source: string): Token[] {
  return Array.from(source.matchAll(TOKEN_PATTERN), (match) => {
    const raw = match[0];
    const quoted = raw.length >= 2 && (raw[0] === "'" || raw[0] === '"') && raw[raw.length - 1] === raw[0];
    return { text: quoted ? raw.slice(1, -1) : raw, quoted, index: match.index ?? 0 };
  });
}

const isWord = (text: string) => /^[\p{L}\p{N}_']+$/u.test(text);

// In character mode every character of an unquoted word is its own token ("aabb" -> a a b b).
// Quoted tokens and single symbols such as + or ( are unchanged.
function lexInput(source: string, characterMode = false): string[] {
  return tokenize(source)
    .flatMap((token) => (characterMode && !token.quoted && isWord(token.text) ? Array.from(token.text) : [token.text]))
    .filter((text) => text !== "");
}

function stripComment(line: string): string {
  const hash = tokenize(line).find((token) => !token.quoted && token.text === "#");
  return hash ? line.slice(0, hash.index) : line;
}

function splitAlternatives(source: string): Token[][] {
  const alternatives: Token[][] = [[]];
  for (const token of tokenize(source)) {
    if (!token.quoted && token.text === "|") alternatives.push([]);
    else alternatives[alternatives.length - 1].push(token);
  }
  return alternatives;
}

// "@" is the only way to write an empty production. The app displays the empty string as ε, and
// ε is also the marker FIRST sets use for "nullable", so a grammar symbol named ε would be
// ambiguous: typing it is an error. The word "epsilon" has no special meaning.
export const EMPTY_SYMBOL = "@";
const isEpsilonToken = (token: Token) => !token.quoted && token.text === EMPTY_SYMBOL;

function editDistance(left: string, right: string): number {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const saved = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (left[i - 1] === right[j - 1] ? 0 : 1));
      previous = saved;
    }
  }
  return row[right.length];
}

// Notices only: nothing here changes how the grammar is parsed.
function collectWarnings(
  start: string,
  nonterminals: string[],
  rules: { lhs: string; rhs: string[] }[],
  usedTokens: Token[],
): string[] {
  const warnings: string[] = [];
  const defined = new Set(nonterminals);

  // 1. Undefined names that look like non-terminals: they silently become terminals.
  const examined = new Set<string>(); // each distinct name is judged once, however often it appears
  for (const token of usedTokens) {
    const name = token.text;
    if (token.quoted || examined.has(name) || defined.has(name) || isEpsilonToken(token)) continue;
    examined.add(name);
    if (!/^[A-Za-z_][A-Za-z0-9_']*$/.test(name)) continue;
    const upper = /^[A-Z]/.test(name);
    const close = nonterminals.find((candidate) =>
      editDistance(candidate.toLowerCase(), name.toLowerCase()) <= 1 && ((candidate.length >= 2 && name.length >= 2) || upper));
    if (!close && !upper) continue;
    warnings.push(
      `“${name}” is used in a rule but never defined on a left-hand side, so it is treated as a terminal.${close ? ` Did you mean “${close}”?` : ""} If it really is a terminal, you can ignore this.`,
    );
  }

  // 2. Defined but unreachable from the start symbol.
  const reachable = new Set([start]);
  for (let changed = true; changed;) {
    changed = false;
    for (const rule of rules) {
      if (!reachable.has(rule.lhs)) continue;
      for (const symbol of rule.rhs) {
        if (defined.has(symbol) && !reachable.has(symbol)) { reachable.add(symbol); changed = true; }
      }
    }
  }
  for (const name of nonterminals) {
    if (!reachable.has(name)) warnings.push(`Non-terminal “${name}” is defined but can never be reached from the start symbol “${start}”, so it has no effect.`);
  }

  // 3. Reachable but unable to derive any finished string.
  const productive = new Set<string>();
  for (let changed = true; changed;) {
    changed = false;
    for (const rule of rules) {
      if (!productive.has(rule.lhs) && rule.rhs.every((symbol) => !defined.has(symbol) || productive.has(symbol))) {
        productive.add(rule.lhs);
        changed = true;
      }
    }
  }
  for (const name of nonterminals) {
    if (reachable.has(name) && !productive.has(name)) {
      warnings.push(`“${name}” can never finish deriving a string: every rule for it needs “${name}” or another unfinished symbol again. Inputs that need it will always be rejected.`);
    }
  }
  return warnings;
}

export function parseGrammar(source: string, options: { characterMode?: boolean } = {}): Grammar {
  if (source.length > MAX_GRAMMAR_CHARS) {
    throw new Error(`The grammar is ${source.length.toLocaleString("en-US")} characters long; the studio supports up to ${MAX_GRAMMAR_CHARS.toLocaleString("en-US")}.`);
  }
  const lines = source.split(/\r?\n/).map((line) => stripComment(line).trim()).filter(Boolean);
  if (lines.length === 0) throw new Error("Enter at least one production to generate a parser.");

  const entries: { lhs: string; alternatives: Token[][] }[] = [];
  for (const line of lines) {
    if (tokenize(line).some((token) => !token.quoted && (token.text === "'" || token.text === '"'))) {
      throw new Error(`Unclosed quote in “${preview(line)}”. Close the quote, or remove it if it is not a quoted terminal.`);
    }
    if (line.startsWith("|")) {
      const previous = entries[entries.length - 1];
      if (!previous) throw new Error(`“${preview(line)}” continues a production, but no production comes before it.`);
      previous.alternatives.push(...splitAlternatives(line.slice(1)));
      continue;
    }
    // The first arrow splits the line. (A regex with a lazy prefix here backtracked quadratically.)
    const arrow = /->|→|::=/.exec(line);
    const lhs = arrow ? line.slice(0, arrow.index).trim() : "";
    if (!arrow || !lhs) throw new Error(`Could not read this production: “${preview(line)}”. Use A -> α | β.`);
    if (!/^[A-Za-z_][A-Za-z0-9_']*$/.test(lhs)) {
      throw new Error(`“${preview(lhs)}” is not a valid non-terminal name.`);
    }
    const rhsText = line.slice(arrow.index + arrow[0].length);
    if (!rhsText.trim()) {
      throw new Error(`“${preview(line)}” has no right-hand side. Write @ for an empty production.`);
    }
    entries.push({ lhs, alternatives: splitAlternatives(rhsText) });
  }

  const nonterminals = [...new Set(entries.map(({ lhs }) => lhs))];
  const nonterminalSet = new Set(nonterminals);
  const start = entries[0].lhs;

  // Character mode: a word that is not a defined non-terminal is split into one terminal per
  // character, so "S -> ab S" means a b S and "S -> AB" means A B when A and B are defined.
  const splitWord = (token: Token): Token[] =>
    !options.characterMode || token.quoted || isEpsilonToken(token) || nonterminalSet.has(token.text) || !isWord(token.text)
      ? [token]
      : Array.from(token.text, (character) => ({ text: character, quoted: false, index: token.index }));

  const rawProductions: { lhs: string; rhs: string[] }[] = [];
  const usedTokens: Token[] = [];
  let totalSymbols = 0;
  const seenProductions = new Set<string>();
  for (const { lhs, alternatives } of entries) {
    for (const original of alternatives) {
      const alternative = original.flatMap(splitWord);
      usedTokens.push(...alternative);
      const isEpsilon = alternative.length === 0 || (alternative.length === 1 && isEpsilonToken(alternative[0]));
      if (!isEpsilon && alternative.some(isEpsilonToken)) {
        throw new Error(`Use @ on its own for an empty production (${lhs}). To use a real @ as a terminal, quote it: '@'.`);
      }
      for (const token of alternative) {
        if (token.text === EPSILON) {
          throw new Error(`“ε” cannot be typed in a grammar (${lhs}). Write @ for an empty production.`);
        }
        if (!token.quoted) continue;
        if (token.text === "") throw new Error(`An empty quoted terminal appears in ${lhs}. Use @ on its own for an empty production.`);
        if (nonterminalSet.has(token.text)) {
          throw new Error(`“${token.text}” is quoted as a terminal in ${lhs}, but it is also a non-terminal name. Rename one of them.`);
        }
      }
      const rhs = isEpsilon ? [] : alternative.map((token) => token.text);
      const key = [lhs, ...rhs].join("\u0000");
      if (seenProductions.has(key)) continue; // a repeated alternative is the same rule, not a second one
      seenProductions.add(key);
      rawProductions.push({ lhs, rhs });
      totalSymbols += rhs.length;
      if (rawProductions.length > MAX_PRODUCTIONS) {
        throw new Error(`This grammar has more than ${MAX_PRODUCTIONS} productions; the studio supports up to ${MAX_PRODUCTIONS} so the states and tables stay readable.`);
      }
      if (totalSymbols > MAX_GRAMMAR_SYMBOLS) {
        throw new Error(`The right-hand sides contain more than ${MAX_GRAMMAR_SYMBOLS.toLocaleString("en-US")} symbols in total; the studio supports up to ${MAX_GRAMMAR_SYMBOLS.toLocaleString("en-US")}.`);
      }
    }
  }

  const terminals = [...new Set(rawProductions.flatMap((production) =>
    production.rhs.filter((symbol) => !nonterminalSet.has(symbol)),
  ))];
  if (terminals.includes(END)) throw new Error(`“${END}” is reserved as the end-of-input marker.`);

  // The augmented start symbol must not collide with any non-terminal or terminal name.
  const usedNames = new Set([...nonterminals, ...terminals]);
  let augmentedStart = `${start}'`;
  while (usedNames.has(augmentedStart)) augmentedStart += "'";

  const productions: Production[] = [
    { id: 0, lhs: augmentedStart, rhs: [start] },
    ...rawProductions.map((production, index) => ({ id: index + 1, ...production })),
  ];
  const warnings = collectWarnings(start, nonterminals, rawProductions, usedTokens);
  return { start, augmentedStart, productions, nonterminals, terminals, warnings };
}

type SetComputation = {
  values: Map<string, Set<string>>;
  reasons: Map<string, Map<string, SetDerivationStep[]>>;
};

function createSetComputation(nonterminals: string[]): SetComputation {
  return {
    values: new Map(nonterminals.map((symbol) => [symbol, new Set<string>()])),
    reasons: new Map(nonterminals.map((symbol) => [symbol, new Map<string, SetDerivationStep[]>()])),
  };
}

function addSetValue(
  computation: SetComputation,
  nonterminal: string,
  value: string,
  reason: SetDerivationStep,
): boolean {
  const values = computation.values.get(nonterminal)!;
  if (values.has(value)) return false;
  values.add(value);
  computation.reasons.get(nonterminal)!.set(value, [reason]);
  return true;
}

function productionText(production: Production): string {
  return `${production.lhs} → ${production.rhs.join(" ") || EPSILON}`;
}

function computeFirst(grammar: Grammar): SetComputation {
  const result = createSetComputation(grammar.nonterminals);
  let changed = true;
  while (changed) {
    changed = false;
    for (const production of grammar.productions.slice(1)) {
      if (production.rhs.length === 0) {
        changed = addSetValue(result, production.lhs, EPSILON, {
          rule: "Rule 4 · nullable production",
          productionId: production.id,
          explanation: `Production **${productionText(production)}** has an empty right-hand side, so **ε** is added to FIRST(**${production.lhs}**).`,
        }) || changed;
        continue;
      }

      const nullablePrefix: string[] = [];
      for (let position = 0; position < production.rhs.length; position += 1) {
        const symbol = production.rhs[position];
        const source = result.values.get(symbol);
        const additions = source ? [...source].filter((item) => item !== EPSILON) : [symbol];
        for (const item of additions) {
          const cascaded = nullablePrefix.length > 0;
          changed = addSetValue(result, production.lhs, item, {
            rule: cascaded ? "Rule 3 · nullable-prefix cascade" : source ? "Rule 2 · FIRST transfer" : "Rule 1 · direct terminal",
            productionId: production.id,
            position,
            explanation: cascaded
              ? `At right-hand position ${position + 1} in **${productionText(production)}**, **${nullablePrefix.join(" ")}** can derive **ε**, so look farther right. ${source ? `**${item}** is in FIRST(**${symbol}**)` : `the next terminal is **${item}**`}; therefore **${item}** is added to FIRST(**${production.lhs}**).`
              : source
                ? `At right-hand position ${position + 1} in **${productionText(production)}**, the first non-terminal is **${symbol}**. Since **${item}** is in FIRST(**${symbol}**), add **${item}** to FIRST(**${production.lhs}**).`
                : `The first symbol, at right-hand position ${position + 1} in **${productionText(production)}**, is terminal **${item}**, so **${item}** is added to FIRST(**${production.lhs}**).`,
          }) || changed;
        }

        if (!source?.has(EPSILON)) break;
        nullablePrefix.push(symbol);
      }

      if (nullablePrefix.length === production.rhs.length) {
        changed = addSetValue(result, production.lhs, EPSILON, {
          rule: "Rule 4 · nullable production",
          productionId: production.id,
          explanation: `Every symbol in **${productionText(production)}** can derive **ε**, so the entire right-hand side is nullable and **ε** is added to FIRST(**${production.lhs}**).`,
        }) || changed;
      }
    }
  }
  return result;
}

function computeFollow(grammar: Grammar, first: Map<string, Set<string>>): SetComputation {
  const result = createSetComputation(grammar.nonterminals);
  addSetValue(result, grammar.start, END, {
    rule: "Rule 1 · start symbol",
    explanation: `**${grammar.start}** is the start symbol, so the end marker **$** is placed in FOLLOW(**${grammar.start}**).`,
  });
  let changed = true;
  while (changed) {
    changed = false;
    for (const production of grammar.productions.slice(1)) {
      for (let index = 0; index < production.rhs.length; index += 1) {
        const symbol = production.rhs[index];
        if (!result.values.has(symbol)) continue;
        const suffix = production.rhs.slice(index + 1);
        const nullablePrefix: string[] = [];
        let suffixNullable = true;
        for (const next of suffix) {
          const nextFirst = first.get(next);
          const additions = nextFirst ? [...nextFirst].filter((item) => item !== EPSILON) : [next];
          for (const item of additions) {
            const cascaded = nullablePrefix.length > 0;
            changed = addSetValue(result, symbol, item, {
              rule: cascaded ? "Rule 4 · nullable-suffix cascade" : "Rule 2 · direct lookahead",
              productionId: production.id,
              position: index,
              explanation: cascaded
                ? `In **${productionText(production)}**, the occurrence of **${symbol}** at right-hand position ${index + 1} is followed by nullable **${nullablePrefix.join(" ")}** and then **${next}**. Since **${nullablePrefix.join(" ")}** can derive **ε** and ${nextFirst ? `**${item}** is in FIRST(**${next}**)` : `the next terminal is **${item}**`}, add **${item}** to FOLLOW(**${symbol}**).`
                : `In **${productionText(production)}**, the occurrence of **${symbol}** at right-hand position ${index + 1} is followed by **${suffix.join(" ")}**. FIRST of that suffix contributes **${item}**, so add **${item}** to FOLLOW(**${symbol}**).`,
            }) || changed;
          }
          if (!nextFirst?.has(EPSILON)) {
            suffixNullable = false;
            break;
          }
          nullablePrefix.push(next);
        }
        if (suffixNullable) {
          for (const item of result.values.get(production.lhs)!) {
            changed = addSetValue(result, symbol, item, {
              rule: suffix.length ? "Rule 4 · nullable suffix" : "Rule 3 · end of production",
              productionId: production.id,
              position: index,
              explanation: suffix.length
                ? `In **${productionText(production)}**, the suffix after **${symbol}** at right-hand position ${index + 1} can derive **ε**. Therefore every symbol in FOLLOW(**${production.lhs}**), including **${item}**, is added to FOLLOW(**${symbol}**).`
                : `In **${productionText(production)}**, **${symbol}** at right-hand position ${index + 1} is at the end of the production. Therefore every symbol in FOLLOW(**${production.lhs}**), including **${item}**, is added to FOLLOW(**${symbol}**).`,
            }) || changed;
          }
        }
      }
    }
  }
  return result;
}

export function getSetDerivation(
  setName: "FIRST" | "FOLLOW",
  nonterminal: string,
  values: Map<string, Set<string>>,
  reasons: Map<string, Map<string, SetDerivationStep[]>>,
): SetDerivation {
  const orderedSymbols = [...(values.get(nonterminal) ?? [])].sort();
  const steps = orderedSymbols
    .flatMap((symbol) => reasons.get(nonterminal)?.get(symbol) ?? [])
    .sort((left, right) => (left.productionId ?? -1) - (right.productionId ?? -1) || (left.position ?? -1) - (right.position ?? -1));
  return {
    steps,
    result: `${setName}(${nonterminal}) = { ${orderedSymbols.join(", ") || "∅"} }`,
  };
}

function itemKey(item: LRItem): string {
  return `${item.productionId}:${item.dot}`;
}

function closure(items: LRItem[], grammar: Grammar, byLhs: Map<string, Production[]>): LRItem[] {
  const result = new Map(items.map((item) => [itemKey(item), item]));
  const pending = [...items];
  while (pending.length) {
    const item = pending.pop()!;
    const next = grammar.productions[item.productionId].rhs[item.dot];
    if (!next || !byLhs.has(next)) continue;
    for (const production of byLhs.get(next)!) {
      const child = { productionId: production.id, dot: 0 };
      if (!result.has(itemKey(child))) {
        result.set(itemKey(child), child);
        pending.push(child);
      }
    }
  }
  return [...result.values()].sort((a, b) => a.productionId - b.productionId || a.dot - b.dot);
}

function canonicalCollection(grammar: Grammar): {
  states: LRState[];
  transitions: Map<number, Map<string, number>>;
} {
  const byLhs = new Map<string, Production[]>();
  for (const production of grammar.productions) {
    const list = byLhs.get(production.lhs) ?? [];
    list.push(production);
    byLhs.set(production.lhs, list);
  }
  const states: LRState[] = [{ id: 0, items: closure([{ productionId: 0, dot: 0 }], grammar, byLhs) }];
  const transitions = new Map<number, Map<string, number>>();
  const stateIds = new Map([[states[0].items.map(itemKey).join(","), 0]]);

  for (let index = 0; index < states.length; index += 1) {
    const state = states[index];
    const symbols = [...new Set(state.items.map((item) =>
      grammar.productions[item.productionId].rhs[item.dot],
    ).filter((symbol): symbol is string => Boolean(symbol)))];
    const edges = new Map<string, number>();
    for (const symbol of symbols) {
      const moved = state.items
        .filter((item) => grammar.productions[item.productionId].rhs[item.dot] === symbol)
        .map((item) => ({ productionId: item.productionId, dot: item.dot + 1 }));
      const targetItems = closure(moved, grammar, byLhs);
      const key = targetItems.map(itemKey).join(",");
      let target = stateIds.get(key);
      if (target === undefined) {
        target = states.length;
        stateIds.set(key, target);
        states.push({ id: target, items: targetItems });
        if (states.length > MAX_STATES) {
          throw new Error(`This grammar builds more than ${MAX_STATES.toLocaleString("en-US")} LR(0) states; the studio draws tables of up to ${MAX_TABLE_CELLS.toLocaleString("en-US")} cells so it stays responsive.`);
        }
      }
      edges.set(symbol, target);
    }
    transitions.set(state.id, edges);
  }
  return { states, transitions };
}

function sameAction(left: ParseAction, right: ParseAction): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "shift" && right.kind === "shift") return left.state === right.state;
  if (left.kind === "reduce" && right.kind === "reduce") return left.productionId === right.productionId;
  return true;
}

function buildTable(
  grammar: Grammar,
  states: LRState[],
  transitions: Map<number, Map<string, number>>,
  follow: Map<string, Set<string>>,
): SLRTable {
  const action = new Map<number, Map<string, ActionCell>>();
  const goto = new Map<number, Map<string, number>>();
  const conflicts: SLRTable["conflicts"] = [];
  const addAction = (state: number, symbol: string, next: ParseAction) => {
    const row = action.get(state) ?? new Map<string, ActionCell>();
    const cell = row.get(symbol) ?? { actions: [], conflict: false };
    if (!cell.actions.some((item) => sameAction(item, next))) cell.actions.push(next);
    cell.conflict = cell.actions.length > 1;
    row.set(symbol, cell);
    action.set(state, row);
  };

  for (const state of states) {
    for (const [symbol, target] of transitions.get(state.id) ?? []) {
      if (grammar.terminals.includes(symbol)) addAction(state.id, symbol, { kind: "shift", state: target });
      else if (grammar.nonterminals.includes(symbol)) {
        const row = goto.get(state.id) ?? new Map<string, number>();
        row.set(symbol, target);
        goto.set(state.id, row);
      }
    }
    for (const item of state.items) {
      const production = grammar.productions[item.productionId];
      if (item.dot !== production.rhs.length) continue;
      if (production.id === 0) addAction(state.id, END, { kind: "accept" });
      else {
        for (const symbol of follow.get(production.lhs)!) {
          addAction(state.id, symbol, { kind: "reduce", productionId: production.id });
        }
      }
    }
  }
  for (const [state, row] of action) {
    for (const [symbol, cell] of row) {
      if (cell.conflict) conflicts.push({ state, symbol, actions: cell.actions });
    }
  }
  return { action, goto, conflicts };
}

function getActionName(action: ParseAction, grammar: Grammar): string {
  if (action.kind === "shift") return `Shift to I${action.state}`;
  if (action.kind === "accept") return "Accept";
  return `Reduce by ${grammar.productions[action.productionId].lhs} → ${
    grammar.productions[action.productionId].rhs.join(" ") || EPSILON
  }`;
}

// If an unknown token is really several known terminals run together ("xa" for "x a"),
// return that split so the error can suggest it.
function suggestSplit(token: string, terminals: string[]): string[] | undefined {
  const known = terminals.filter((terminal) => terminal !== "");
  const best: (string[] | undefined)[] = Array(token.length + 1).fill(undefined);
  best[0] = [];
  for (let end = 1; end <= token.length; end += 1) {
    for (const terminal of known) {
      const start = end - terminal.length;
      const before = start >= 0 ? best[start] : undefined;
      if (before && token.startsWith(terminal, start) && !best[end]) best[end] = [...before, terminal];
    }
  }
  const split = best[token.length];
  return split && split.length > 1 ? split : undefined;
}

function buildTrace(grammar: Grammar, table: SLRTable, inputTokens: string[]): {
  trace: TraceEntry[];
  outcome: ParserResult["outcome"];
} {
  const tokens = [...inputTokens, END];
  const states = [0];
  const symbols: string[] = [];
  const forest: TreeNode[] = [];
  const trace: TraceEntry[] = [];
  const snapshot = (
    action: string,
    detail: string,
    kind: TraceEntry["kind"],
    step: number,
  ): TraceEntry => {
    const position = cursor;
    return {
      step,
      states: [...states],
      symbols: [...symbols],
      // Computed on demand: storing a copy of the remaining input in every entry made memory
      // grow quadratically with input length.
      get remaining() { return tokens.slice(position); },
      lookahead: tokens[position] ?? END,
      action,
      detail,
      kind,
      // Nodes are never mutated after they are created, so each snapshot only needs its own
      // copy of the array; deep-cloning every step made long inputs quadratically slow.
      forest: [...forest],
    };
  };
  let cursor = 0;
  trace.push(snapshot("Ready", "The parser starts in state I0 with the complete input.", "start", 0));
  const seen = new Set<string>();
  let outcome: ParserResult["outcome"] = "rejected";

  // Legitimate parses take a number of steps proportional to the input; the repeated-
  // configuration check below catches true infinite loops, so this cap is only a backstop.
  const maxSteps = Math.max(1000, tokens.length * 20);
  for (let step = 1; step <= maxSteps; step += 1) {
    const signature = `${states.join(",")}|${symbols.join(",")}|${cursor}`;
    if (seen.has(signature)) {
      trace.push(snapshot("Reject", "A parser configuration repeated; stopping to avoid an infinite loop.", "reject", step));
      break;
    }
    seen.add(signature);

    const state = states[states.length - 1];
    const lookahead = tokens[cursor] ?? END;
    const cell = table.action.get(state)?.get(lookahead);
    if (cell?.conflict) {
      trace.push(snapshot("Conflict", `I${state} has multiple actions on “${lookahead}”. Resolve the SLR conflict before parsing.`, "conflict", step));
      outcome = "conflict";
      break;
    }
    const chosen = cell?.actions[0];
    if (!chosen) {
      const unknownToken = lookahead !== END && !grammar.terminals.includes(lookahead);
      trace.push(snapshot(
        "Reject",
        unknownToken
          ? `“${lookahead}” is not a terminal in this grammar.${(() => {
            const split = suggestSplit(lookahead, grammar.terminals);
            return split ? ` It looks like several tokens run together; did you mean “${split.join(" ")}”? Separate tokens with spaces.` : "";
          })()}`
          : `No ACTION entry exists for state I${state} and lookahead “${lookahead}”.`,
        "reject",
        step,
      ));
      break;
    }
    if (chosen.kind === "shift") {
      if (lookahead === END) {
        trace.push(snapshot("Reject", "The end marker cannot be shifted; no valid action is available.", "reject", step));
        break;
      }
      symbols.push(lookahead);
      forest.push({
        id: `shift-${step}`,
        symbol: lookahead,
        children: [],
        explanation: `Shifted terminal ${lookahead} into the parser stack at step ${step}.`,
      });
      states.push(chosen.state);
      cursor += 1;
      seen.clear(); // a repeated configuration can only happen between shifts
      trace.push(snapshot(getActionName(chosen, grammar), `Consume “${lookahead}” and enter state I${chosen.state}.`, "shift", step));
      continue;
    }
    if (chosen.kind === "reduce") {
      const production = grammar.productions[chosen.productionId];
      const childCount = production.rhs.length;
      const children = childCount ? forest.splice(forest.length - childCount, childCount) : [];
      if (childCount) {
        symbols.splice(symbols.length - childCount, childCount);
        states.splice(states.length - childCount, childCount);
      }
      const target = table.goto.get(states[states.length - 1])?.get(production.lhs);
      if (target === undefined) {
        trace.push(snapshot("Reject", `No GOTO entry exists for ${production.lhs} after the reduction.`, "reject", step));
        break;
      }
      symbols.push(production.lhs);
      forest.push({
        id: `reduce-${step}`,
        symbol: production.lhs,
        children,
        productionId: production.id,
        explanation: `Reduced using production ${productionText(production)}. The children (${children.map((child) => child.symbol).join(", ") || "ε"}) were popped from the stack, and the parent (${production.lhs}) was pushed.`,
      });
      states.push(target);
      trace.push(snapshot(
        getActionName(chosen, grammar),
        `The lookahead “${lookahead}” is in FOLLOW(${production.lhs}), so reduce by this production and enter I${target}.`,
        "reduce",
        step,
      ));
      continue;
    }
    trace.push(snapshot("Accept", "The augmented start production is complete and the input is consumed.", "accept", step));
    outcome = "accepted";
    break;
  }
  const lastKind = trace[trace.length - 1].kind;
  if (lastKind !== "accept" && lastKind !== "reject" && lastKind !== "conflict") {
    trace.push(snapshot("Reject", `Stopped after ${maxSteps.toLocaleString("en-US")} parser steps. The grammar may contain a cycle.`, "reject", maxSteps + 1));
  }
  return { trace, outcome };
}

export function generateParser(
  grammarSource: string,
  input: string,
  options: { characterMode?: boolean } = {},
): ParserResult {
  const characterMode = options.characterMode ?? false;
  const grammar = parseGrammar(grammarSource, { characterMode });
  if (grammar.productions.length - 1 > MAX_PRODUCTIONS) {
    throw new Error(`This grammar has ${grammar.productions.length - 1} productions; the studio supports up to ${MAX_PRODUCTIONS} so the states and tables stay readable.`);
  }
  const firstComputation = computeFirst(grammar);
  const first = firstComputation.values;
  const followComputation = computeFollow(grammar, first);
  const follow = followComputation.values;
  const { states, transitions } = canonicalCollection(grammar);
  const columns = grammar.terminals.length + 1 + grammar.nonterminals.length;
  if (states.length * columns > MAX_TABLE_CELLS) {
    throw new Error(`This grammar builds ${states.length} states and ${columns} table columns (${(states.length * columns).toLocaleString("en-US")} cells); the studio draws tables of up to ${MAX_TABLE_CELLS.toLocaleString("en-US")} cells so it stays responsive.`);
  }
  const table = buildTable(grammar, states, transitions, follow);
  if (input.length > MAX_INPUT_CHARS) {
    throw new Error(`The input is ${input.length.toLocaleString("en-US")} characters long; the studio supports up to ${MAX_INPUT_CHARS.toLocaleString("en-US")}.`);
  }
  const inputTokens = lexInput(input, characterMode);
  if (inputTokens.length > MAX_INPUT_TOKENS) {
    throw new Error(`The input has ${inputTokens.length.toLocaleString("en-US")} tokens; the studio supports up to ${MAX_INPUT_TOKENS.toLocaleString("en-US")} so the trace stays responsive.`);
  }
  const parsed = buildTrace(grammar, table, inputTokens);
  return {
    grammar,
    first,
    follow,
    firstReasons: firstComputation.reasons,
    followReasons: followComputation.reasons,
    states,
    transitions,
    table,
    ...parsed,
    inputTokens,
    characterMode,
  };
}

export function formatProduction(production: Production): string {
  return `${production.lhs} → ${production.rhs.length ? production.rhs.join(" ") : EPSILON}`;
}

export function formatItem(item: LRItem, grammar: Grammar): string {
  const production = grammar.productions[item.productionId];
  const rhs = [...production.rhs];
  rhs.splice(item.dot, 0, "•");
  return `${production.lhs} → ${rhs.join(" ")}`;
}

export function formatActionCell(cell: ActionCell | undefined): string {
  if (!cell) return "—";
  return cell.actions.map((action) => {
    if (action.kind === "shift") return `s${action.state}`;
    if (action.kind === "accept") return "acc";
    return `r${action.productionId}`;
  }).join(" / ");
}

export function actionDescription(action: ParseAction, grammar: Grammar): string {
  return getActionName(action, grammar);
}

export function treeText(node: TreeNode): string {
  return node.symbol;
}

export type ConflictExplanation = {
  kind: "shift/reduce" | "reduce/reduce" | "accept/reduce";
  headline: string;
  options: string[];
  why: string;
};

/** Explains in words why one ACTION cell holds more than one move. */
export function describeConflict(
  result: Pick<ParserResult, "grammar" | "states" | "follow">,
  conflict: SLRTable["conflicts"][number],
): ConflictExplanation {
  const { grammar, states, follow } = result;
  const state = states.find((candidate) => candidate.id === conflict.state);
  const symbol = conflict.symbol;
  const options = conflict.actions.map((action) => {
    if (action.kind === "shift") {
      const items = (state?.items ?? [])
        .filter((item) => grammar.productions[item.productionId].rhs[item.dot] === symbol)
        .map((item) => formatItem(item, grammar));
      return `Shift “${symbol}” and enter I${action.state}, because the dot is before “${symbol}” in ${items.join(" and ")}.`;
    }
    if (action.kind === "reduce") {
      const production = grammar.productions[action.productionId];
      const complete = formatItem({ productionId: production.id, dot: production.rhs.length }, grammar);
      const followSet = [...(follow.get(production.lhs) ?? [])].sort().join(", ");
      return `Reduce by ${productionText(production)}, because ${complete} is complete and “${symbol}” is in FOLLOW(${production.lhs}) = { ${followSet} }.`;
    }
    return `Accept, because ${formatItem({ productionId: 0, dot: 1 }, grammar)} is complete and the next token is $.`;
  });
  const kinds = new Set(conflict.actions.map((action) => action.kind));
  const kind = kinds.has("shift") && kinds.has("reduce")
    ? "shift/reduce"
    : kinds.has("accept") ? "accept/reduce" : "reduce/reduce";
  const why = kind === "shift/reduce"
    ? "The parser cannot tell whether to keep reading (shift) or to stop and reduce. This usually means the grammar is ambiguous, as with a dangling else or operators without precedence, or that SLR’s FOLLOW sets are too coarse for this grammar."
    : kind === "reduce/reduce"
      ? `Two different rules finish at the same point and both allow “${symbol}” to come next, so the parser cannot tell which rule the input matches.`
      : "The parser could finish here or reduce first, and the next token allows both.";
  return {
    kind,
    headline: `${kind} conflict in I${conflict.state} on “${symbol}”`,
    options,
    why,
  };
}
