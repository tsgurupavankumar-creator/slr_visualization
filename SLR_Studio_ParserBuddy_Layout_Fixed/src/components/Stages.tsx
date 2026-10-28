import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ArrowDownRight, ArrowRight, Check, CircleHelp, Download, GitBranch, Layers3, Sparkles, Table2, WandSparkles } from "lucide-react";
import type { LRItem, ParserResult, Production, SetDerivation, TraceEntry } from "../types";
import { describeConflict, formatActionCell, formatItem, formatProduction, getSetDerivation } from "../parser";
import { downloadText, tableToCsv, traceToCsv } from "../exportUtils";
import type { StageId } from "../store";
import ParseTree from "./ParseTree";

type Explain = (title: string, body: string, derivation?: SetDerivation, trace?: {
  step: number;
  stack: string[];
  resultingStack: string[];
  input: string[];
  resultingInput: string[];
  tableCell: string;
  action: string;
}) => void;

// Long traces draw only the rows near the viewport; spacer rows keep the scrollbar honest.
const TRACE_WINDOW_THRESHOLD = 200;
const TRACE_ROW_HEIGHT = 37;
const TRACE_HEADER_HEIGHT = 32;
const TRACE_VIEWPORT_HEIGHT = 600; // keep in sync with .trace-table-scroll { max-height } in index.css
const TRACE_OVERSCAN = 15;

const setText = (items: Set<string> | undefined) => `{ ${[...(items ?? [])].sort().join(", ") || "∅"} }`;

function derivation(steps: string[], result: string): SetDerivation {
  return {
    steps: steps.map((explanation, index) => ({
      rule: `Step ${index + 1}`,
      explanation,
    })),
    result,
  };
}

function itemDerivation(stateId: number, item: LRItem, result: ParserResult): SetDerivation {
  const incoming = stateId === 0
    ? undefined
    : [...result.transitions].flatMap(([from, edges]) =>
      [...edges].filter(([, target]) => target === stateId).map(([symbol]) => ({ from, symbol })),
    )[0];
  const seeds = incoming
    ? (result.states.find((state) => state.id === incoming.from)?.items ?? [])
      .filter((sourceItem) => result.grammar.productions[sourceItem.productionId].rhs[sourceItem.dot] === incoming.symbol)
      .map((sourceItem) => ({ productionId: sourceItem.productionId, dot: sourceItem.dot + 1 }))
    : [{ productionId: 0, dot: 0 }];
  const known = new Map<string, LRItem>();
  const parent = new Map<string, LRItem | null>();
  const key = (candidate: LRItem) => `${candidate.productionId}:${candidate.dot}`;
  const pending: LRItem[] = [];
  for (const seed of seeds) {
    if (!known.has(key(seed))) {
      known.set(key(seed), seed);
      parent.set(key(seed), null);
      pending.push(seed);
    }
  }
  while (pending.length) {
    const current = pending.shift()!;
    const next = result.grammar.productions[current.productionId].rhs[current.dot];
    if (!next || !result.grammar.nonterminals.includes(next)) continue;
    for (const production of result.grammar.productions.filter((candidate) => candidate.lhs === next)) {
      const child = { productionId: production.id, dot: 0 };
      if (known.has(key(child))) continue;
      known.set(key(child), child);
      parent.set(key(child), current);
      pending.push(child);
    }
  }

  const chain: LRItem[] = [];
  let current: LRItem | undefined = known.get(key(item));
  while (current) {
    chain.unshift(current);
    current = parent.get(key(current)) ?? undefined;
  }
  const steps: string[] = [];
  if (incoming) {
    steps.push(`From **I${incoming.from}**, follow the transition labeled **${incoming.symbol}**. Moving the dot past **${incoming.symbol}** seeds **I${stateId}**.`);
  } else {
    steps.push(`Start with the augmented rule **${formatProduction(result.grammar.productions[0])}** and place the dot at the beginning: **${formatItem({ productionId: 0, dot: 0 }, result.grammar)}**.`);
  }
  chain.forEach((candidate, index) => {
    if (index === 0 && incoming) {
      steps.push(`Moving the dot in **${formatItem({ productionId: candidate.productionId, dot: candidate.dot - 1 }, result.grammar)}** gives **${formatItem(candidate, result.grammar)}**.`);
      return;
    }
    if (index === 0) return;
    const source = chain[index - 1];
    const expected = result.grammar.productions[source.productionId].rhs[source.dot];
    steps.push(`In **${formatItem(source, result.grammar)}**, the dot is before **${expected}**. Add every rule for **${expected}**, including **${formatItem(candidate, result.grammar)}**.`);
  });
  if (!chain.length) {
    steps.push(`This item is included in the completed closure for **I${stateId}**: **${formatItem(item, result.grammar)}**.`);
  }
  return derivation(steps, `Item in I${stateId}: ${formatItem(item, result.grammar)}`);
}

function traceExplanation(row: TraceEntry, result: ParserResult) {
  const before = result.trace.find((entry) => entry.step === row.step - 1) ?? row;
  const state = before.states.at(-1) ?? 0;
  const lookahead = before.lookahead;
  const cell = result.table.action.get(state)?.get(lookahead);
  const cellText = formatActionCell(cell);
  const steps: string[] = [];
  if (row.kind === "shift") {
    steps.push(`The top state is **I${state}**, and the next input token is **${lookahead}**.`);
    steps.push(`Look up **ACTION[${state}, ${lookahead}]**. It says **${cellText}**, so shift **${lookahead}** and enter **I${row.states.at(-1)}**.`);
    steps.push(`The stack gains the token **${lookahead}** and state **I${row.states.at(-1)}**. The input pointer moves to the next token.`);
  } else if (row.kind === "reduce") {
    const reduceAction = cell?.actions.find((action) => action.kind === "reduce");
    const production = reduceAction?.kind === "reduce" ? result.grammar.productions[reduceAction.productionId] : undefined;
    if (production) {
      const count = production.rhs.length;
      const poppedSymbols = count ? before.symbols.slice(-count) : [];
      const poppedStates = count ? before.states.slice(-count) : [];
      const baseState = count ? before.states[before.states.length - count - 1] : state;
      const destination = row.states.at(-1);
      steps.push(`The top state is **I${state}** and the lookahead is **${lookahead}**. **ACTION[${state}, ${lookahead}] = ${cellText}** selects **${formatProduction(production)}**.`);
      steps.push(`Pop **${count || "no"}** grammar symbol${count === 1 ? "" : "s"}${poppedSymbols.length ? ` (**${poppedSymbols.join(" ")}**)` : ""} and the matching ${count || "no"} state${count === 1 ? "" : "s"}${poppedStates.length ? ` (**${poppedStates.map((value) => `I${value}`).join(" ")}**)` : ""}. Keep the exposed state **I${baseState}**.`);
      steps.push(`Push **${production.lhs}**, then look up **GOTO[${baseState}, ${production.lhs}] = I${destination}** and push **I${destination}**. The input token **${lookahead}** stays where it is.`);
      steps.push(`This reduce entry is allowed because **${lookahead}** is in **FOLLOW(${production.lhs}) = ${setText(result.follow.get(production.lhs))}**.`);
    }
  } else if (row.kind === "accept") {
    steps.push(`The stack has recognized the start symbol **${result.grammar.start}**, and the next input token is the end marker **$**.`);
    steps.push(`State **I${state}** contains the completed augmented rule **${result.grammar.augmentedStart} → ${result.grammar.start} •**. **ACTION[${state}, $] = acc**.`);
    steps.push(`The whole input is accepted. The augmented rule is a signal for acceptance; it is not another ordinary reduction.`);
  } else if (row.kind === "conflict") {
    steps.push(`The top state is **I${state}**, and the lookahead is **${lookahead}**.`);
    steps.push(`**ACTION[${state}, ${lookahead}]** contains more than one action (**${cellText}**), so the parser cannot choose a single move.`);
    const conflict = result.table.conflicts.find((candidate) => candidate.state === state && candidate.symbol === lookahead);
    if (conflict) {
      const explained = describeConflict(result, conflict);
      steps.push(...explained.options, explained.why);
    }
  } else if (row.kind === "reject") {
    steps.push(`The top state is **I${state}**, and the next input token is **${lookahead}**.`);
    steps.push(cell ? `The cell contains **${cellText}**, but parsing stopped: ${row.detail}` : `There is no action in **ACTION[${state}, ${lookahead}]**. ${row.detail}`);
  } else {
    steps.push(`The parser begins in **I0** with input **${before.remaining.join(" ") || "$"}**.`);
  }
  return {
    derivation: derivation(steps, row.kind === "accept" ? "The input is accepted." : row.detail),
    trace: {
      step: row.step,
      stack: before.states.map((value, index) => `${value}${before.symbols[index] ? ` · ${before.symbols[index]}` : ""}`),
      resultingStack: row.states.map((value, index) => `${value}${row.symbols[index] ? ` · ${row.symbols[index]}` : ""}`),
      input: before.remaining,
      resultingInput: row.remaining,
      tableCell: `ACTION[${state}, ${lookahead}] = ${cellText}`,
      action: row.action,
    },
  };
}

export function StageTabs({ stage, setStage }: { stage: StageId; setStage: (stage: StageId) => void }) {
  const tabs: { id: StageId; label: string; number: string; icon: typeof WandSparkles }[] = [
    { id: "grammar", label: "Augmented grammar", number: "01", icon: WandSparkles },
    { id: "sets", label: "FIRST & FOLLOW", number: "02", icon: Layers3 },
    { id: "states", label: "LR(0) states", number: "03", icon: GitBranch },
    { id: "table", label: "SLR table", number: "04", icon: Table2 },
    { id: "trace", label: "Parse trace", number: "05", icon: ArrowRight },
  ];
  return (
    <nav className="stage-tabs" aria-label="Parser stages">
      {tabs.map(({ id, label, number, icon: Icon }) => (
        <button
          key={id}
          type="button"
          className={`stage-tab ${stage === id ? "active" : ""}`}
          onClick={() => setStage(id)}
          aria-current={stage === id ? "step" : undefined}
        >
          <span className="tab-number">{number}</span><Icon size={15} /><span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

function StageHeading({ eyebrow, title, subtitle, badge }: { eyebrow: string; title: string; subtitle: string; badge?: string }) {
  return (
    <div className="stage-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {badge && <span className="heading-badge">{badge}</span>}
    </div>
  );
}

function ProductionRow({ production, grammar, follow, index, explain, augmented = false }: {
  production: Production;
  grammar: ParserResult["grammar"];
  follow: ParserResult["follow"];
  index: number;
  explain: Explain;
  augmented?: boolean;
}) {
  return (
    <button
      type="button"
      className={`production-row ${augmented ? "augmented-row" : ""}`}
      onClick={() => explain(
        augmented ? "The augmented start rule" : `Production ${index}`,
        augmented
          ? `Let’s build the parser’s starting point from your grammar.`
          : `Here is how the parser uses your rule **${formatProduction(production)}**.`,
        derivation(augmented
          ? [
            `Your grammar starts with **${grammar.start}**, so we added **${production.lhs} → ${grammar.start}** at the top.`,
            `This gives the parser one unique starting item: **${production.lhs} → • ${grammar.start}**.`,
            `When that dot reaches the end and the lookahead is **$**, the parser accepts the input.`,
          ]
          : [
            `This is rule **${production.id}**: **${formatProduction(production)}**.`,
            `When the dot reaches the end of this rule, the parser can reduce the matching symbols on its stack to **${production.lhs}**.`,
            `It places that reduction only under tokens in **FOLLOW(${production.lhs}) = ${setText(follow.get(production.lhs))}**.`,
          ],
        augmented ? `${production.lhs} → ${grammar.start} is the parser’s unique start rule.` : `Rule ${production.id}: ${formatProduction(production)}`),
      )}
    >
      <span className="production-index">{augmented ? "★" : String(index).padStart(2, "0")}</span>
      <code>{production.lhs}<span className="grammar-arrow">→</span>{production.rhs.length ? production.rhs.join(" ") : "ε"}</code>
      {augmented && <span className="new-rule-pill"><Sparkles size={12} /> NEW START RULE</span>}
      <CircleHelp className="row-help" size={15} />
    </button>
  );
}

function GrammarStage({ result, explain }: { result: ParserResult; explain: Explain }) {
  const [augmented, ...original] = result.grammar.productions;
  return (
    <>
      <StageHeading eyebrow="Stage 01 · Set up" title="Start with the grammar" subtitle="SLR adds one fresh start rule before building the parser. Click any production to learn what it does." badge={`${result.grammar.productions.length - 1} productions`} />
      <div className="grammar-layout">
        <section className="panel production-panel">
          <div className="panel-title"><div><span className="panel-kicker">THE GRAMMAR</span><h2>Production rules</h2></div><span className="panel-icon"><WandSparkles size={17} /></span></div>
          <div className="production-list">
            <ProductionRow production={augmented} grammar={result.grammar} follow={result.follow} index={0} explain={explain} augmented />
            <div className="grammar-separator"><span /> ORIGINAL PRODUCTIONS <span /></div>
            {original.map((production, index) => <ProductionRow key={production.id} production={production} grammar={result.grammar} follow={result.follow} index={index + 1} explain={explain} />)}
          </div>
        </section>
        <aside className="side-card">
          <div className="side-card-icon"><span>i</span></div>
          <div className="eyebrow">THE BIG IDEA</div>
          <h3>Why augment?</h3>
          <p>We added <code>{augmented.lhs} → {augmented.rhs[0]}</code> at the top. When its dot reaches the end with <code>$</code> next, the parser knows your input is accepted.</p>
          <div className="mini-equation"><span>before</span><code>{result.grammar.start}</code><ArrowRight size={15} /><span>after</span><code>{augmented.lhs}</code></div>
          <button className="text-link" type="button" onClick={() => explain("How we augmented your grammar", "We added a new start rule using your actual start symbol.", derivation([
            `Your first grammar rule begins with **${result.grammar.start}**, so we added **${augmented.lhs} → ${result.grammar.start}** above it.`,
            `The parser starts with **${augmented.lhs} → • ${result.grammar.start}**.`,
            `After recognizing **${result.grammar.start}**, it accepts only when the next token is **$**.`,
          ], `${augmented.lhs} → ${result.grammar.start}`))}>Trace the new start rule <ArrowRight size={14} /></button>
        </aside>
      </div>
    </>
  );
}

function SetsStage({ result, explain }: { result: ParserResult; explain: Explain }) {
  return (
    <>
      <StageHeading eyebrow="Stage 02 · Look ahead" title="FIRST & FOLLOW sets" subtitle="These sets tell the parser which terminals can begin a phrase—and which may follow a non-terminal." badge={`${result.grammar.nonterminals.length} non-terminals`} />
      <section className="panel sets-panel">
        <div className="sets-grid-header"><div>NON-TERMINAL</div><div>FIRST · what can begin?</div><div>FOLLOW · what can come next?</div></div>
        {result.grammar.nonterminals.map((symbol, index) => (
          <motion.div className="sets-row" key={symbol} initial={{ opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.045 }}>
            <button type="button" className="symbol-token" onClick={() => {
              const first = getSetDerivation("FIRST", symbol, result.first, result.firstReasons);
              const follow = getSetDerivation("FOLLOW", symbol, result.follow, result.followReasons);
              explain(`How we got the sets for ${symbol}`, `Here are the exact rules from your grammar that contribute to this non-terminal's sets.`,
                derivation([
                  ...first.steps.map((step) => step.explanation),
                  ...follow.steps.map((step) => step.explanation),
                ], `${first.result}; ${follow.result}`));
            }}>{symbol}<span>NT</span></button>
            <button type="button" className="set-cell first-cell" onClick={() => explain(
              `How FIRST(${symbol}) is calculated`,
              `Follow the production-by-production derivation from the grammar you entered.`,
              getSetDerivation("FIRST", symbol, result.first, result.firstReasons),
            )}>{setText(result.first.get(symbol))}<CircleHelp size={13} /></button>
            <button type="button" className="set-cell follow-cell" onClick={() => explain(
              `How FOLLOW(${symbol}) is calculated`,
              `Trace each lookahead and nullable-suffix rule that contributes to this set.`,
              getSetDerivation("FOLLOW", symbol, result.follow, result.followReasons),
            )}>{setText(result.follow.get(symbol))}<CircleHelp size={13} /></button>
          </motion.div>
        ))}
        <div className="sets-footnote"><span className="footnote-dot" /> The end marker <code>$</code> belongs to FOLLOW({result.grammar.start}), because the start symbol is followed by the end of input.</div>
      </section>
    </>
  );
}

function StatesStage({ result, explain }: { result: ParserResult; explain: Explain }) {
  const edgeEntries = [...result.transitions].flatMap(([from, edges]) => [...edges].map(([symbol, to]) => ({ from, symbol, to })));
  return (
    <>
      <StageHeading eyebrow="Stage 03 · Build states" title="Canonical LR(0) collection" subtitle="Each state is a set of dotted items. Follow an arrow to see how reading a symbol moves the parser." badge={`${result.states.length} states`} />
      <div className="states-summary"><span><i className="legend-terminal" /> terminal transition <i className="legend-nonterminal" /> non-terminal transition</span><span>Click an item to inspect the dot</span></div>
      <div className="state-grid">
        {result.states.map((state, index) => (
          <motion.section className="state-card" key={state.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index * 0.025, 0.3) }}>
            <div className="state-card-head"><div className="state-name"><span className="state-dot" /> I<sub>{state.id}</sub></div><span className="item-count">{state.items.length} {state.items.length === 1 ? "item" : "items"}</span></div>
            <div className="item-list">
              {state.items.map((item) => {
                const production = result.grammar.productions[item.productionId];
                const text = formatItem(item, result.grammar);
                return (
                  <button className={`item-line ${item.dot === production.rhs.length ? "item-complete" : ""}`} type="button" key={`${item.productionId}-${item.dot}`}
                    onClick={() => explain(`How this item entered I${state.id}`, `Let’s trace this item back to the exact rule and closure step.`, itemDerivation(state.id, item, result))}>
                    <span className="item-dot-marker">{item.dot === production.rhs.length ? <Check size={12} /> : "·"}</span>
                    <code>{text}</code>
                  </button>
                );
              })}
            </div>
          </motion.section>
        ))}
      </div>
      <section className="panel transition-panel">
        <div className="panel-title"><div><span className="panel-kicker">GOTO GRAPH</span><h2>State transitions</h2></div><span className="panel-icon"><GitBranch size={17} /></span></div>
        <div className="transition-list">
          {edgeEntries.length ? edgeEntries.map(({ from, symbol, to }) => (
            <button className="transition-chip" type="button" key={`${from}-${symbol}-${to}`}
              onClick={() => {
                const source = result.states.find((state) => state.id === from)!;
                const moved = source.items.filter((item) => result.grammar.productions[item.productionId].rhs[item.dot] === symbol)
                  .map((item) => ({ productionId: item.productionId, dot: item.dot + 1 }));
                const target = result.states.find((state) => state.id === to)!;
                const steps = [
                  `In **I${from}**, find each rule whose dot is immediately before **${symbol}**.`,
                  ...moved.map((item) => `Move the dot in **${formatItem({ ...item, dot: item.dot - 1 }, result.grammar)}** to get **${formatItem(item, result.grammar)}**.`),
                  `These moved items form the seed. Then add the closure items required by the non-terminals after their dots to make **I${to}**.`,
                  ...target.items.filter((item) => !moved.some((seed) => seed.productionId === item.productionId && seed.dot === item.dot))
                    .map((item) => `Closure adds **${formatItem(item, result.grammar)}**.`),
                ];
                explain(`How GOTO(I${from}, ${symbol}) becomes I${to}`, `We moved the dot across **${symbol}**, then completed the destination state's closure.`, derivation(steps, `GOTO(I${from}, ${symbol}) = I${to}`));
              }}>
              <span>I<sub>{from}</sub></span><ArrowRight size={14} /><code>{symbol}</code><ArrowRight size={14} /><span>I<sub>{to}</sub></span>
            </button>
          )) : <p className="empty-note">No transitions are available for this grammar.</p>}
        </div>
      </section>
    </>
  );
}

function actionTone(kind: string) {
  if (kind === "shift") return "action-shift";
  if (kind === "reduce") return "action-reduce";
  if (kind === "accept") return "action-accept";
  return "";
}

function TableStage({ result, explain }: { result: ParserResult; explain: Explain }) {
  const terminals = [...result.grammar.terminals, "$"];
  const nonterminals = result.grammar.nonterminals;
  return (
    <>
      <StageHeading eyebrow="Stage 04 · Make decisions" title="The SLR parsing table" subtitle="ACTION decides whether to shift, reduce, or accept. GOTO chooses a state after each reduction." badge={result.table.conflicts.length ? `${result.table.conflicts.length} conflict${result.table.conflicts.length === 1 ? "" : "s"}` : "Conflict-free"} />
      {result.table.conflicts.length > 0 && (
        <div className="conflict-banner" role="alert"><span className="conflict-mark">!</span><div><strong>SLR conflicts detected</strong><p>This grammar is not SLR(1). Conflicting cells are highlighted below; the parser pauses if it reaches one.</p>
          <ul className="conflict-list">
            {result.table.conflicts.slice(0, 6).map((conflict) => {
              const explained = describeConflict(result, conflict);
              return (
                <li key={`${conflict.state}-${conflict.symbol}`}>
                  <b>{explained.headline}</b>
                  <ul>{explained.options.map((option) => <li key={option}>{option}</li>)}</ul>
                  <span>{explained.why}</span>
                </li>
              );
            })}
          </ul>
          {result.table.conflicts.length > 6 && <p>…and {result.table.conflicts.length - 6} more. Click any highlighted cell to see its explanation.</p>}
        </div></div>
      )}
      <section className="panel table-panel">
        <div className="panel-title table-title"><div><span className="panel-kicker">DECISION LOOKUP</span><h2>State × symbol</h2></div>
          <div className="table-legend"><span className="legend-pill shift-key">Shift</span><span className="legend-pill reduce-key">Reduce</span><span className="legend-pill accept-key">Accept</span><button type="button" className="export-button" onClick={() => downloadText("slr-table.csv", tableToCsv(result))}><Download size={13} /> Download CSV</button></div>
        </div>
        <div className="table-scroll">
          <table className="slr-table">
            <thead>
              <tr><th rowSpan={2}>STATE</th><th className="group-action" colSpan={terminals.length}>ACTION</th><th className="group-goto" colSpan={nonterminals.length}>GOTO</th></tr>
              <tr>{terminals.map((symbol) => <th key={`a-${symbol}`} className="symbol-heading">{symbol}</th>)}{nonterminals.map((symbol) => <th key={`g-${symbol}`} className="symbol-heading">{symbol}</th>)}</tr>
            </thead>
            <tbody>
              {result.states.map((state) => (
                <tr key={state.id}><th className="state-table-head">I<sub>{state.id}</sub></th>
                  {terminals.map((symbol) => {
                    const cell = result.table.action.get(state.id)?.get(symbol);
                    const kind = cell?.conflict ? "conflict" : cell?.actions[0]?.kind;
                    const text = formatActionCell(cell);
                    return <td key={`${state.id}-${symbol}`}><button className={`table-cell ${kind ? actionTone(kind) : ""} ${cell?.conflict ? "action-conflict" : ""} ${!cell ? "empty-table-cell" : ""}`} type="button" aria-label={`ACTION, state ${state.id}, ${symbol}: ${cell ? text : "error"}`}
                      onClick={() => {
                        if (!cell) {
                          explain(`Why ACTION[${state.id}, ${symbol}] is empty`, `No item in **I${state.id}** asks for **${symbol}** next, and no completed production here can reduce on this token. If the parser reaches this cell, this input cannot continue.`);
                          return;
                        }
                        const steps = cell.actions.flatMap((action) => {
                          if (action.kind === "shift") {
                            const matching = state.items.filter((item) => result.grammar.productions[item.productionId].rhs[item.dot] === symbol);
                            return [
                              `In **I${state.id}**, inspect the dot positions. These items have **${symbol}** immediately after the dot: ${matching.map((item) => `**${formatItem(item, result.grammar)}**`).join(", ") || "none"}.`,
                              `So **ACTION[${state.id}, ${symbol}] = s${action.state}**. Shift the token **${symbol}** and enter **I${action.state}**.`,
                            ];
                          }
                          if (action.kind === "reduce") {
                            const production = result.grammar.productions[action.productionId];
                            const complete = state.items.find((item) => item.productionId === production.id && item.dot === production.rhs.length);
                            return [
                              `State **I${state.id}** contains the completed item **${complete ? formatItem(complete, result.grammar) : `${formatProduction(production)} •`}**.`,
                              `That means the symbols for **${formatProduction(production)}** have been recognized, so this state can reduce by rule **${production.id}**.`,
                              `**${symbol}** is in **FOLLOW(${production.lhs}) = ${setText(result.follow.get(production.lhs))}**, so put **r${production.id}** in **ACTION[${state.id}, ${symbol}]**.`,
                            ];
                          }
                          return [
                            `State **I${state.id}** contains the completed augmented item **${result.grammar.augmentedStart} → ${result.grammar.start} •**.`,
                            `The lookahead is the end marker **$**, so **ACTION[${state.id}, $] = acc** and the complete input is accepted.`,
                          ];
                        });
                        if (cell.conflict) {
                          const explained = describeConflict(result, { state: state.id, symbol, actions: cell.actions });
                          steps.push(`This cell has an SLR ${explained.kind} conflict. The parser could do either of these:`, ...explained.options, explained.why);
                        }
                        explain(`How ACTION[${state.id}, ${symbol}] was filled`, `Here is the exact item or FOLLOW-set reason for this table entry.`, derivation(steps, `ACTION[${state.id}, ${symbol}] = ${text}`));
                      }}>{text}</button></td>;
                  })}
                  {nonterminals.map((symbol) => {
                    const target = result.table.goto.get(state.id)?.get(symbol);
                    return <td key={`${state.id}-g-${symbol}`}><button className={`table-cell goto-cell ${target === undefined ? "empty-table-cell" : ""}`} type="button" aria-label={`GOTO, state ${state.id}, ${symbol}: ${target === undefined ? "error" : target}`} onClick={() => {
                      if (target === undefined) {
                        explain(`Why GOTO[${state.id}, ${symbol}] is empty`, `No item in **I${state.id}** has the dot immediately before **${symbol}**, so there is no transition to follow for this non-terminal.`);
                        return;
                      }
                      const matching = state.items.filter((item) => result.grammar.productions[item.productionId].rhs[item.dot] === symbol);
                      explain(`How GOTO[${state.id}, ${symbol}] was filled`, `After a reduction produces **${symbol}**, the parser uses this transition from its exposed state.`, derivation([
                        `In **I${state.id}**, the dot is before **${symbol}** in ${matching.map((item) => `**${formatItem(item, result.grammar)}**`).join(", ")}.`,
                        `Move each matching dot past **${symbol}**, then take closure. The resulting item set is **I${target}**.`,
                        `After reducing to **${symbol}** with **I${state.id}** exposed, push **${symbol}** and enter **I${target}**.`,
                      ], `GOTO[${state.id}, ${symbol}] = I${target}`));
                    }}>{target === undefined ? "—" : target}</button></td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-footnote"><span><b>sN</b> = shift to state N</span><span><b>rN</b> = reduce by production N</span><span><b>acc</b> = accept</span><span><b>—</b> = error</span></div>
      </section>
    </>
  );
}

export default function StageContent({ result, stage, explain, activeStep, setStep }: {
  result: ParserResult;
  stage: StageId;
  explain: Explain;
  activeStep: number;
  setStep: (step: number) => void;
}) {
  return (
    <motion.div className="stage-content" key={stage} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}>
      {stage === "grammar" && <GrammarStage result={result} explain={explain} />}
      {stage === "sets" && <SetsStage result={result} explain={explain} />}
      {stage === "states" && <StatesStage result={result} explain={explain} />}
      {stage === "table" && <TableStage result={result} explain={explain} />}
      {stage === "trace" && <TraceStage result={result} explain={explain} activeStep={activeStep} setStep={setStep} />}
    </motion.div>
  );
}

export function TraceStage({ result, explain, activeStep, setStep }: { result: ParserResult; explain: Explain; activeStep: number; setStep: (step: number) => void }) {
  const entry = result.trace[Math.min(activeStep, result.trace.length - 1)];
  const last = result.trace[result.trace.length - 1];
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const total = result.trace.length;
  const windowed = total > TRACE_WINDOW_THRESHOLD;
  const firstVisible = Math.floor(scrollTop / TRACE_ROW_HEIGHT);
  const windowStart = windowed ? Math.max(0, firstVisible - TRACE_OVERSCAN) : 0;
  const windowEnd = windowed ? Math.min(total, firstVisible + Math.ceil(TRACE_VIEWPORT_HEIGHT / TRACE_ROW_HEIGHT) + TRACE_OVERSCAN) : total;

  // Keep the active row in view whenever the step (or the whole trace) changes.
  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    const top = entry.step * TRACE_ROW_HEIGHT;
    const bottom = top + TRACE_ROW_HEIGHT + TRACE_HEADER_HEIGHT;
    if (top < box.scrollTop) box.scrollTop = top;
    else if (bottom > box.scrollTop + box.clientHeight) box.scrollTop = bottom - box.clientHeight;
  }, [entry.step, result]);

  const outcome = result.outcome === "accepted" ? "ACCEPTED" : result.outcome === "conflict" ? "CONFLICT" : "REJECTED";
  const explainTrace = (row: TraceEntry, title = `Step ${row.step}: ${row.action}`) => {
    const detail = traceExplanation(row, result);
    setStep(row.step);
    explain(title, row.detail, detail.derivation, detail.trace);
  };
  return (
    <>
      <StageHeading eyebrow="Stage 05 · Watch it parse" title="Shift–reduce trace" subtitle="Step through the parser’s decisions. Click a trace row to see why that action was chosen." badge={`${result.trace.length - 1} actions`} />
      <div className={`outcome-banner outcome-${result.outcome}`}>
        <span className="outcome-icon">{result.outcome === "accepted" ? <Check size={16} /> : "!"}</span>
        <div><strong>{outcome}</strong><span>{result.outcome === "accepted" ? `“${result.inputTokens.join(" ") || "ε"}” belongs to the grammar.` : result.outcome === "conflict" ? "A conflicting table cell was reached; parsing stopped." : `“${result.inputTokens.join(" ") || "ε"}” could not be parsed.`}</span></div>
        <span className="trace-progress">STEP {String(entry.step).padStart(2, "0")} / {String(last.step).padStart(2, "0")}</span>
      </div>
      <section className="panel machine-panel">
            <div className="panel-title"><div><span className="panel-kicker">LIVE PARSER</span><h2>Stack & input</h2></div><span className="live-indicator"><i />{entry.kind === "accept" ? "finished" : entry.kind === "reject" || entry.kind === "conflict" ? "stopped" : "ready"}</span></div>
            <div className="machine-row">
              <div className="machine-part"><div className="machine-label">PARSER STACK <span>states + symbols</span></div>
                <div className="stack-box">
                  {entry.states.map((state, index) => (
                    <span className="stack-pair" key={`stack-${index}`}>
                      <span className="stack-state">I{state}</span>
                      {entry.symbols[index] && <span className="stack-symbol">{entry.symbols[index]}</span>}
                    </span>
                  ))}
                </div>
              </div>
              <div className="machine-arrow"><ArrowDownRight size={20} /></div>
              <div className="machine-part input-part"><div className="machine-label">INPUT BUFFER <span>lookahead highlighted</span></div>
                <div className="buffer-box">{entry.remaining.map((token, index) => (
                  <span key={`${token}-${index}`} className={`buffer-token ${index === 0 ? "lookahead-token" : ""} ${token === "$" ? "end-token" : ""}`}>{token}</span>
                ))}</div>
              </div>
            </div>
            <button className={`current-action action-row-${entry.kind}`} type="button" onClick={() => explainTrace(entry)}>
              <span className="current-step">STEP {String(entry.step).padStart(2, "0")}</span><span className="current-action-text">{entry.action}</span><span className="action-explain">Why? <CircleHelp size={14} /></span>
            </button>
      </section>
      <div className="trace-layout">
          <section className="panel trace-table-panel">
            <div className="panel-title"><div><span className="panel-kicker">EXECUTION HISTORY</span><h2>Every parsing move</h2></div><button type="button" className="export-button" onClick={() => downloadText("parse-trace.csv", traceToCsv(result))}><Download size={13} /> Download CSV</button></div>
            <div className="trace-table-scroll" ref={scrollRef} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
              <table className="trace-table">
                <thead><tr><th>#</th><th>STACK</th><th>INPUT</th><th>ACTION</th></tr></thead>
                <tbody>
                {windowStart > 0 && <tr className="trace-spacer" aria-hidden="true"><td colSpan={4} style={{ height: windowStart * TRACE_ROW_HEIGHT }} /></tr>}
                {result.trace.slice(windowStart, windowEnd).map((row) => (
                  <tr key={row.step} className={row.step === entry.step ? "active-trace-row" : ""}>
                    <td><button type="button" className="trace-step-button" onClick={() => explainTrace(row)}>{String(row.step).padStart(2, "0")}</button></td>
                    <td><button className="trace-cell-button mono" type="button" onClick={() => explainTrace(row, `Stack used at step ${row.step}`)}>{row.states.map((state, index) => `${state}${row.symbols[index] ? ` ${row.symbols[index]}` : ""}`).join("  ")}</button></td>
                    <td><button className="trace-cell-button mono" type="button" onClick={() => explainTrace(row, `Input examined at step ${row.step}`)}>{row.remaining.join(" ")}</button></td>
                    <td><button type="button" className={`trace-action-pill action-row-${row.kind}`} onClick={() => explainTrace(row)}>{row.action}</button></td>
                  </tr>
                ))}
                {windowEnd < total && <tr className="trace-spacer" aria-hidden="true"><td colSpan={4} style={{ height: (total - windowEnd) * TRACE_ROW_HEIGHT }} /></tr>}
              </tbody>
              </table>
            </div>
          </section>
          <ParseTree forest={entry.forest} entry={entry} grammar={result.grammar} explain={explain} />
      </div>
    </>
  );
}
