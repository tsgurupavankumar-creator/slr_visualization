export type Production = {
  id: number;
  lhs: string;
  rhs: string[];
};

export type Grammar = {
  start: string;
  augmentedStart: string;
  productions: Production[];
  nonterminals: string[];
  terminals: string[];
  /** Non-blocking notices about the grammar (likely typos, unreachable or unfinishable symbols). */
  warnings: string[];
};

export type LRItem = {
  productionId: number;
  dot: number;
};

export type LRState = {
  id: number;
  items: LRItem[];
};

export type ParseAction =
  | { kind: "shift"; state: number }
  | { kind: "reduce"; productionId: number }
  | { kind: "accept" };

export type ActionCell = {
  actions: ParseAction[];
  conflict: boolean;
};

export type SLRTable = {
  action: Map<number, Map<string, ActionCell>>;
  goto: Map<number, Map<string, number>>;
  conflicts: { state: number; symbol: string; actions: ParseAction[] }[];
};

export type TreeNode = {
  id?: string;
  symbol: string;
  children: TreeNode[];
  productionId?: number;
  explanation?: string;
};

export type TraceEntry = {
  step: number;
  states: number[];
  symbols: string[];
  remaining: string[];
  lookahead: string;
  action: string;
  detail: string;
  kind: "start" | "shift" | "reduce" | "accept" | "reject" | "conflict";
  forest: TreeNode[];
};

export type ParserResult = {
  grammar: Grammar;
  first: Map<string, Set<string>>;
  follow: Map<string, Set<string>>;
  firstReasons: Map<string, Map<string, SetDerivationStep[]>>;
  followReasons: Map<string, Map<string, SetDerivationStep[]>>;
  states: LRState[];
  transitions: Map<number, Map<string, number>>;
  table: SLRTable;
  trace: TraceEntry[];
  outcome: "accepted" | "rejected" | "conflict";
  inputTokens: string[];
  characterMode: boolean;
};

export type SetDerivationStep = {
  rule: string;
  explanation: string;
  productionId?: number;
  position?: number;
};

export type SetDerivation = {
  steps: SetDerivationStep[];
  result: string;
};

export type Explanation = {
  title: string;
  body: string;
  derivation?: SetDerivation;
  trace?: {
    step: number;
    stack: string[];
    resultingStack: string[];
    input: string[];
    resultingInput: string[];
    tableCell: string;
    action: string;
  };
};
