import { BookOpen, Bot, Braces, Check, Link2, RotateCcw, Sparkles, TriangleAlert } from "lucide-react";
import { DEFAULT_GRAMMAR, DEFAULT_INPUT, MAX_INPUT_TOKENS, MAX_PRODUCTIONS, MAX_TABLE_CELLS } from "../parser";

type Props = {
  grammar: string;
  input: string;
  error: string;
  warnings: string[];
  characterMode: boolean;
  linkCopied: boolean;
  onGrammarChange: (value: string) => void;
  onInputChange: (value: string) => void;
  onCharacterModeChange: (value: boolean) => void;
  onGenerate: () => void;
  onReset: () => void;
  onCopyLink: () => void;
  onAskAI: () => void;
};

export default function GrammarInput({
  grammar,
  input,
  error,
  warnings,
  characterMode,
  linkCopied,
  onGrammarChange,
  onInputChange,
  onCharacterModeChange,
  onGenerate,
  onReset,
  onCopyLink,
  onAskAI,
}: Props) {
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand-row">
            <div className="brand-mark"><Braces size={22} strokeWidth={2.4} /></div>
            <div className="brand-copy">
              <div className="brand-name">SLR<span>studio</span></div>
              <div className="brand-caption">A hands-on parsing playground</div>
            </div>
            <div className="topbar-divider" />
            <div className="learning-note"><BookOpen size={15} /> Learn parsing, one state at a time</div>
          </div>
          <div className="input-grid">
            <label className="field grammar-field">
              <span className="field-label"><span>YOUR GRAMMAR</span><span className="field-hint">one production per line · start a line with | to continue</span></span>
              <textarea
                value={grammar}
                onChange={(event) => onGrammarChange(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) onGenerate(); }}
                spellCheck={false}
                aria-label="Context-free grammar"
                placeholder={DEFAULT_GRAMMAR}
              />
            </label>
            <div className="input-side">
              <label className="field">
                <span className="field-label"><span>INPUT STRING</span><span className="field-hint">tokens to parse</span></span>
                <input
                  value={input}
                  onChange={(event) => onInputChange(event.target.value)}
                  spellCheck={false}
                  aria-label="Input string to parse"
                  placeholder={DEFAULT_INPUT}
                  onKeyDown={(event) => { if (event.key === "Enter") onGenerate(); }}
                />
              </label>
              <label className="mode-toggle">
                <input type="checkbox" checked={characterMode} onChange={(event) => onCharacterModeChange(event.target.checked)} />
                <span><b>Character mode</b>: every letter or digit is its own token, so <code>aabb</code> means <code>a a b b</code></span>
              </label>
              <div className="header-actions">
                <button className="button button-secondary" onClick={onAskAI} type="button">
                  <Bot size={15} /> Ask ParserBuddy
                </button>
                <button className="button button-secondary reset-button" onClick={onReset} type="button">
                  <RotateCcw size={15} /> Reset
                </button>
                <button className="button button-secondary link-button" onClick={onCopyLink} type="button" aria-live="polite">
                  {linkCopied ? <Check size={15} /> : <Link2 size={15} />} {linkCopied ? "Link copied" : "Copy link"}
                </button>
                <button className="button button-primary generate-button" onClick={onGenerate} type="button">
                  <Sparkles size={16} /> Generate parser
                </button>
              </div>
            </div>
          </div>
          {error && <div className="input-error" role="alert">{error}</div>}
        </div>
      </header>
      <section aria-label="Grammar notes and input rules">
      {warnings.length > 0 && (
        <div className="notices-wrap">
          <div className="notices" role="status" aria-label="Grammar notices">
            <div className="notices-title"><TriangleAlert size={14} /> {warnings.length === 1 ? "1 notice about this grammar" : `${warnings.length} notices about this grammar`}<span>not errors: the parser still ran</span></div>
            <ul>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
          </div>
        </div>
      )}
      <div className="rules-wrap">
        <details className="input-rules">
          <summary>Input rules: read this if you get a surprising error</summary>
          <div className="input-rules-body">
            <section>
              <h3>Grammar</h3>
              <ul>
                <li>One production per line: <code>A -&gt; x y | z</code>. The arrow can be <code>-&gt;</code>, <code>→</code> or <code>::=</code>. A line starting with <code>|</code> continues the line above.</li>
                <li>The left side of the <b>first</b> line is the start symbol.</li>
                <li>Anything that appears on a left side is a non-terminal. <b>Every other symbol is a terminal.</b> A name that looks like a misspelled or missing non-terminal gets a yellow notice, but the grammar still runs.</li>
                <li>Names are case-sensitive. Start with a letter or <code>_</code>, then letters, digits, <code>_</code> or <code>'</code> (so <code>E'</code> is fine). Non-English letters such as <code>α</code> work as terminals only.</li>
                <li><code>@</code> on its own is the only way to write the empty string: <code>A -&gt; a A | @</code>. Do not mix it with other symbols. Typing <code>ε</code> in a grammar is an error, and the word <code>epsilon</code> is just an ordinary name. To use a real @ as a terminal, quote it: <code>'@'</code>. <code>#</code> starts a comment. <code>$</code> is reserved.</li>
                <li>Notices also appear for non-terminals that can never be reached from the start symbol, or that can never finish deriving a string.</li>
              </ul>
            </section>
            <section>
              <h3>Spaces and tokens (grammar and input)</h3>
              <ul>
                <li>Letters, digits and <code>_</code> in a row form <b>one token</b>: <code>ab</code> is one token, <code>a b</code> is two. <code>x1</code> is one token, but <code>1x</code> is two.</li>
                <li>Every other character (<code>+ * ( ) = ,</code>) is its own token, so <code>id+id</code> works without spaces.</li>
                <li><b>Safest habit: put a space between every token.</b> Or tick <b>Character mode</b> for grammars of single-letter terminals.</li>
                <li><b>Character mode</b> splits every unquoted word into single characters, in the input and in the grammar. A word in the grammar that is a defined non-terminal stays whole, so <code>Expr</code> works if you define it, but write multi-letter non-terminals with spaces around them. In this mode <code>S -&gt; AB</code> means <code>A B</code> when both are defined, otherwise two terminals.</li>
                <li><code>==</code> is two tokens (<code>=</code> <code>=</code>). To make it one terminal, quote it in both the grammar and the input: <code>'=='</code>. Quoted text is never split, even in character mode.</li>
                <li>Quotes (<code>'if'</code> or <code>"if"</code>) keep the text exactly, including spaces, <code>|</code>, <code>#</code> and <code>-&gt;</code>. A quoted terminal cannot be empty or share a name with a non-terminal.</li>
              </ul>
            </section>
            <section>
              <h3>Input string, sharing and limits</h3>
              <ul>
                <li>Every token must be a terminal from your grammar, spelled the same (<code>ID</code> is not <code>id</code>).</li>
                <li>An empty box means the empty string, which is what an <code>@</code> grammar expects. Typing <code>@</code> is not the same thing: it is a token.</li>
                <li><b>Copy link</b> puts the grammar, input and character mode in a link you can send. Opening it fills in the boxes.</li>
                <li>The SLR table and the parse trace can be downloaded as CSV from their tabs.</li>
                <li>Limits: {MAX_INPUT_TOKENS.toLocaleString("en-US")} input tokens, {MAX_PRODUCTIONS} productions, and an SLR table of {MAX_TABLE_CELLS.toLocaleString("en-US")} cells (states × symbols; a grammar of about 50 non-terminals and 50 terminals reaches it).</li>
              </ul>
            </section>
          </div>
        </details>
      </div>
      </section>
    </>
  );
}
