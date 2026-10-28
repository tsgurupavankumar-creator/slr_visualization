import { useEffect, useMemo, useRef, useState } from "react";
import Tree from "react-d3-tree";
import type { CustomNodeElementProps, RawNodeDatum, TreeLinkDatum } from "react-d3-tree";
import type { Grammar, SetDerivation, TraceEntry, TreeNode } from "../types";
import { EPSILON, formatProduction } from "../parser";

type ParseTreeDatum = RawNodeDatum & {
  attributes: {
    id: string;
    kind: "terminal" | "nonterminal" | "forest";
    explanation: string;
    productionId?: number;
    virtual?: boolean;
    epsilon?: boolean;
  };
  children?: ParseTreeDatum[];
};

type ParseTreeProps = {
  forest: TreeNode[];
  entry: TraceEntry;
  grammar: Grammar;
  explain: (title: string, body: string, derivation?: SetDerivation) => void;
};

function epsilonDatum(parentId: string, parent: string): ParseTreeDatum {
  return {
    name: EPSILON,
    attributes: {
      id: `${parentId}-epsilon`,
      kind: "terminal",
      epsilon: true,
      explanation: `${parent} was reduced by an empty rule, so it matched no input. ε marks that empty match.`,
    },
  };
}

function toTreeDatum(node: TreeNode, grammar: Grammar): ParseTreeDatum {
  // A reduction by an empty rule has no children, so draw ε beneath it as textbooks do.
  const emptyReduction = node.productionId !== undefined && node.children.length === 0;
  const children = emptyReduction
    ? [epsilonDatum(node.id ?? node.symbol, node.symbol)]
    : node.children.map((child) => toTreeDatum(child, grammar));
  return {
    name: node.symbol,
    attributes: {
      id: node.id ?? node.symbol,
      kind: grammar.nonterminals.includes(node.symbol) ? "nonterminal" : "terminal",
      explanation: node.explanation ?? `Shifted terminal ${node.symbol} from the input buffer onto the parser stack.`,
      ...(node.productionId === undefined ? {} : { productionId: node.productionId }),
    },
    ...(children.length ? { children } : {}),
  };
}

function renderParseNode(
  { nodeDatum, onNodeClick }: CustomNodeElementProps,
  explain: ParseTreeProps["explain"],
  grammar: Grammar,
) {
  if (nodeDatum.attributes?.virtual) return <g aria-hidden="true" />;

  const isNonterminal = nodeDatum.attributes?.kind === "nonterminal";
  const explanation = String(nodeDatum.attributes?.explanation ?? nodeDatum.name);
  const rawProductionId = nodeDatum.attributes?.productionId;
  const productionId = typeof rawProductionId === "number" ? rawProductionId : undefined;
  const production = productionId === undefined ? undefined : grammar.productions[productionId];
  const childSymbols = nodeDatum.children?.map((child) => child.name) ?? [];
  const isEpsilon = nodeDatum.attributes?.epsilon === true;
  const derivation: SetDerivation = isEpsilon
    ? {
      steps: [{ rule: "Step 1 · Empty match", explanation: explanation }],
      result: "ε is the empty string: no input was consumed",
    }
    : isNonterminal && production
    ? {
      steps: [
        {
          rule: "Step 1 · Match the handle",
          explanation: childSymbols.length
            ? `The children **${childSymbols.join(" ")}** match the right-hand side of **${formatProduction(production)}**.`
            : `**${formatProduction(production)}** has an empty right-hand side, so it matches without consuming any input or popping any symbols.`,
        },
        {
          rule: "Step 2 · Reduce",
          explanation: `The parser groups those children under **${production.lhs}** using rule **${production.id}**.`,
        },
      ],
      result: `${production.lhs} built from ${childSymbols.join(" ") || EPSILON}`,
    }
    : {
      steps: [{
        rule: "Step 1 · Shift",
        explanation: `The input token **${nodeDatum.name}** was read and added to the parser stack as a leaf.`,
      }],
      result: `Terminal leaf: ${nodeDatum.name}`,
    };
  const rx = Math.max(19, nodeDatum.name.length * 4.2 + 10);
  const ry = 17;

  return (
    <g
      className={`academic-tree-node ${isNonterminal ? "academic-nonterminal" : "academic-terminal"}`}
      role="button"
      tabIndex={0}
      aria-label={`${nodeDatum.name}. ${explanation}`}
      onClick={(event) => {
        event.stopPropagation();
        explain(isEpsilon ? "What ε means here" : isNonterminal ? `How ${nodeDatum.name} was reduced` : `How terminal ${nodeDatum.name} was shifted`, explanation, derivation);
        onNodeClick(event);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          explain(isEpsilon ? "What ε means here" : isNonterminal ? `How ${nodeDatum.name} was reduced` : `How terminal ${nodeDatum.name} was shifted`, explanation, derivation);
          onNodeClick(event);
        }
      }}
    >
      <title>{explanation}</title>
      <ellipse cx={0} cy={0} rx={rx} ry={ry} />
      <text textAnchor="middle" dominantBaseline="central">{nodeDatum.name}</text>
    </g>
  );
}

function treeMetrics(node: TreeNode): { leaves: number; depth: number } {
  if (!node.children.length) return node.productionId !== undefined ? { leaves: 1, depth: 1 } : { leaves: 1, depth: 0 };
  const children = node.children.map(treeMetrics);
  return {
    leaves: children.reduce((total, child) => total + child.leaves, 0),
    depth: 1 + Math.max(...children.map((child) => child.depth)),
  };
}

// react-d3-tree draws every node as SVG and recurses once per level. Past these sizes the tree is
// unreadable (hundreds of levels, 88px apart) and the browser can run out of stack, so say so instead.
export const MAX_TREE_DEPTH = 120;
export const MAX_TREE_NODES = 600;

/** Iterative on purpose: the trees this guards against are thousands of levels deep. */
export function measureForest(forest: TreeNode[]): { nodes: number; depth: number } {
  let nodes = 0;
  let depth = 0;
  const pending = forest.map((node) => ({ node, level: 1 }));
  while (pending.length) {
    const { node, level } = pending.pop()!;
    nodes += node.productionId !== undefined && node.children.length === 0 ? 2 : 1; // the ε child
    depth = Math.max(depth, level);
    for (const child of node.children) pending.push({ node: child, level: level + 1 });
  }
  return { nodes, depth };
}

export function ParseTree({ forest, entry, grammar, explain }: ParseTreeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 720, height: 370 });
  const depthSpacing = 88;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([size]) => {
      setDimensions({
        width: Math.max(320, size.contentRect.width),
        height: Math.max(250, size.contentRect.height),
      });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const size = useMemo(() => measureForest(forest), [forest]);
  const tooLarge = size.depth > MAX_TREE_DEPTH || size.nodes > MAX_TREE_NODES;

  const data = useMemo<ParseTreeDatum>(() => ({
    name: "parse forest",
    attributes: {
      id: "parse-forest",
      kind: "forest",
      explanation: "",
      virtual: true,
    },
    children: tooLarge ? [] : forest.map((node) => toTreeDatum(node, grammar)),
  }), [forest, grammar, tooLarge]);
  const translate = { x: dimensions.width / 2, y: 36 - depthSpacing };
  const metrics = tooLarge ? [] : forest.map(treeMetrics);
  const leafCount = metrics.reduce((total, tree) => total + tree.leaves, 0);
  const maxDepth = metrics.reduce((depth, tree) => Math.max(depth, tree.depth), 0);
  const zoom = Math.max(.35, Math.min(
    .9,
    dimensions.width / Math.max(1, leafCount * 96 * 1.35),
    dimensions.height / Math.max(1, (maxDepth + 1) * depthSpacing + 56),
  ));

  const nodeRenderer = (props: CustomNodeElementProps) => renderParseNode(props, explain, grammar);
  const linkClass = (link: TreeLinkDatum) =>
    link.source.data.attributes?.virtual ? "parse-tree-hidden-root-link" : "parse-tree-academic-link";

  return (
    <section className="panel parse-tree-panel">
      <div className="panel-title">
        <div><span className="panel-kicker">BUILT AS WE REDUCE</span><h2>Parse tree</h2></div>
        <span className="tree-interaction-hint">Drag to pan · scroll to zoom</span>
      </div>
      <div className="parse-tree-legend" aria-label="Parse tree node legend">
        <span><i className="legend-nonterminal-node" /> Non-terminal</span>
        <span><i className="legend-terminal-node" /> Terminal</span>
        <span className="tree-action-label">{entry.kind === "shift" ? "Leaf shifted" : entry.kind === "reduce" ? `Reduced to ${forest.at(-1)?.symbol ?? "—"}` : `Step ${entry.step}`}</span>
      </div>
      <div className="tree-canvas" ref={containerRef}>
        {!tooLarge && <Tree
          data={data}
          orientation="vertical"
          pathFunc="straight"
          pathClassFunc={linkClass}
          renderCustomNodeElement={nodeRenderer}
          rootNodeClassName="academic-tree-root"
          branchNodeClassName="academic-tree-branch"
          leafNodeClassName="academic-tree-leaf"
          nodeSize={{ x: 96, y: depthSpacing }}
          separation={{ siblings: 1.35, nonSiblings: 1.7 }}
          translate={translate}
          dimensions={dimensions}
          zoom={zoom}
          zoomable
          draggable
          scaleExtent={{ min: 0.35, max: 2.2 }}
          enableLegacyTransitions
          transitionDuration={320}
        />}
        {tooLarge && <div className="tree-empty"><p>This parse tree is too large to draw ({size.nodes.toLocaleString("en-US")} nodes, {size.depth.toLocaleString("en-US")} levels deep).</p><span>The trace table beside it still lists every step.</span></div>}
        {!forest.length && <div className="tree-empty"><p>The grammar tree grows here as terminals are shifted and productions are reduced.</p><span>Step forward to begin</span></div>}
      </div>
      <div className="tree-caption">Each reduction groups the popped children under its production’s left-hand symbol.</div>
    </section>
  );
}

export default ParseTree;
