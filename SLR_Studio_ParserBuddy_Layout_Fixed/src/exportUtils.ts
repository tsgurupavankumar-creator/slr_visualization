import { formatActionCell } from "./parser";
import type { ParserResult } from "./types";

// Spreadsheets treat a cell that starts with = @ (or + - followed by more text) as a formula.
// Grammar symbols can come from a shared link, so neutralize those cells.
function csvCell(value: string): string {
  const risky = /^[=@\t\r]/.test(value) || (value.length > 1 && /^[+-]/.test(value));
  const safe = risky ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function tableToCsv(result: ParserResult): string {
  const terminals = [...result.grammar.terminals, "$"];
  const nonterminals = result.grammar.nonterminals;
  const rows: string[][] = [["State", ...terminals.map((symbol) => `ACTION ${symbol}`), ...nonterminals.map((symbol) => `GOTO ${symbol}`)]];
  for (const state of result.states) {
    rows.push([
      `I${state.id}`,
      ...terminals.map((symbol) => {
        const cell = result.table.action.get(state.id)?.get(symbol);
        return cell ? formatActionCell(cell) : "";
      }),
      ...nonterminals.map((symbol) => {
        const target = result.table.goto.get(state.id)?.get(symbol);
        return target === undefined ? "" : String(target);
      }),
    ]);
  }
  return toCsv(rows);
}

export function traceToCsv(result: ParserResult): string {
  const rows: string[][] = [["Step", "Stack", "Input", "Action", "Detail"]];
  for (const entry of result.trace) {
    // Textbook order: state, symbol, state, symbol, ..., state (the same order the app shows).
    const stack = [entry.states[0], ...entry.symbols.flatMap((symbol, index) => [symbol, entry.states[index + 1]])].join(" ");
    rows.push([String(entry.step), stack, entry.remaining.join(" "), entry.action, entry.detail]);
  }
  return toCsv(rows);
}

export function downloadText(filename: string, text: string, mime = "text/csv;charset=utf-8"): void {
  // The BOM makes Excel read ε, → and • as UTF-8.
  const blob = new Blob(["\uFEFF", text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
