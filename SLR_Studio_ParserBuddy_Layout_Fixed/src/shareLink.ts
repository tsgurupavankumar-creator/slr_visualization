export type ShareState = { grammar: string; input: string; characterMode: boolean };

const MAX_SHARED_LENGTH = 20000;

export function encodeShareState(state: ShareState): string {
  const params = new URLSearchParams();
  params.set("g", state.grammar);
  params.set("i", state.input);
  if (state.characterMode) params.set("c", "1");
  return params.toString();
}

/** Reads a location hash such as "#g=...&i=...". Returns null for anything missing or oversized. */
export function decodeShareState(hash: string): ShareState | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw || raw.length > MAX_SHARED_LENGTH * 3) return null;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(raw);
  } catch {
    return null;
  }
  const grammar = params.get("g");
  if (grammar === null || grammar.length > MAX_SHARED_LENGTH) return null;
  const input = params.get("i") ?? "";
  if (input.length > MAX_SHARED_LENGTH) return null;
  return { grammar, input, characterMode: params.get("c") === "1" };
}

export function buildShareUrl(state: ShareState, base: string): string {
  return `${base.split("#")[0]}#${encodeShareState(state)}`;
}
