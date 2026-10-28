# SLR Studio

An interactive learning tool for exploring how a Simple LR (SLR(1)) parser is built and how it parses a string. The app runs entirely in the browser; no account, API key, or server-side parser is required.

## Run locally

Requires **Node.js 20 or newer** (the test runner does not support Node 18).

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. For a production build, run `npm run build`, then `npm run preview`.

| Command | What it does |
|---|---|
| `npm test` | Unit, property, and DOM tests (vitest) |
| `npm run lint` | ESLint, with zero warnings allowed |
| `npm run e2e` | Real-browser tests (Playwright); run `npx playwright install chromium` once first |
| `npm run check:secrets` | Scans the project and `dist/` for key-shaped strings and verifies `.env` cannot be committed |
| `npm run check:build-leak` | Builds with a sentinel key and proves it is absent from the production bundle |
| `npm run check` | Lint, build, secrets scan, then tests |

## Using the studio

1. Enter a context-free grammar, with one production per line. Use `->`, `→`, or `::=` and `|` to separate alternatives. A line that starts with `|` continues the production above it.
2. Enter an input string. Separate tokens with spaces when terminals are multi-character, or tick **Character mode** to make every letter or digit its own token (`aabb` means `a a b b`).
3. Select **Generate parser** and explore the five stages: augmented grammar, FIRST/FOLLOW, LR(0) states, SLR table, and parse trace.
4. Click productions, sets, items, transitions, table cells, or trace actions to open a contextual explanation.
5. Use the fixed transport controls, slider, or left/right arrow and space-bar keyboard shortcuts to step through the parse. Escape closes the explanation drawer.
6. **Copy link** puts the grammar, input, and character mode in a URL; opening it fills in the boxes. **Download CSV** on the SLR table and trace tabs exports them (cells that could be read as spreadsheet formulas are prefixed with an apostrophe).

Yellow **notices** appear under the header for a grammar that runs but looks suspicious: a name that is probably a misspelled non-terminal (with a suggestion), non-terminals unreachable from the start symbol, and non-terminals that can never finish deriving a string. Conflicting table cells are explained in plain language: which two moves are possible, which item or FOLLOW set allows each, and why the parser cannot choose.

The default grammar is the classic expression grammar:

```text
E -> E + T | T
T -> T * F | F
F -> ( E ) | id
```

Empty productions are written with `@` on its own (`A -> a A | @`). It is the only spelling: typing `ε` in a grammar is an error, and the word `epsilon` is just an ordinary name. To use a real @ as a terminal, quote it: `'@'`. The app displays the empty string as ε in its tables and explanations. Lines may include comments after `#`. Terminals can be quoted, for example `S -> 'if' E 'then' S`; quote a word such as `'epsilon'` to use it as an ordinary terminal. Non-terminal names may contain primes (`E'`, `E''`), so classic left-recursion-eliminated grammars work as written:

```text
E  -> T E'
E' -> + T E' | @
T  -> id
```

A repeated alternative is treated as one rule. Unclosed quotes, empty quoted terminals, a quoted terminal that shares a name with a non-terminal, and a bare `A ->` with nothing after the arrow are reported as errors instead of being guessed at.

## Implementation

- `src/parser.ts` parses productions and computes FIRST/FOLLOW with per-symbol, production-specific derivation logs, canonical LR(0) item sets, GOTO transitions, SLR ACTION/GOTO entries, conflicts, and the shift/reduce trace.
- `src/components/ParseTree.tsx` renders the trace's evolving parse forest as an animated, zoomable SVG using `react-d3-tree`; shifted leaves and reduced parent nodes retain explanations, and an empty reduction shows an ε child. Trees deeper than 120 levels or larger than 600 nodes are not drawn (the library recurses per level and can overflow the stack); a message says so.
- The trace table scrolls inside a fixed-height box and, for traces over 200 rows, renders only the rows near the viewport.
- `src/exportUtils.ts` builds the CSV files, `src/shareLink.ts` encodes and safely decodes share links, and `src/components/ErrorBoundary.tsx` keeps a view that fails to draw from blanking the page.
- `src/components/` contains the grammar editor, stage visualizations, and on-demand explanation panel.
- `src/store.ts` holds navigation, playback, speed, and explanation UI state with Zustand.
- `src/parser.test.ts` covers grammar syntax, nullable and conflicting grammars, and rejected input. `src/parser.differential.test.ts` checks FIRST/FOLLOW and accept/reject decisions on 1,000 random grammars against independent reference algorithms (a naive fixpoint and an Earley recognizer). `src/parser.invariants.test.ts` rebuilds the LR(0) automaton and SLR table independently and checks trace invariants. `src/ui.smoke.test.tsx` renders every stage and trace step for awkward grammars, and `src/app.interaction.test.tsx` drives the DOM in jsdom (drawer focus, keyboard shortcuts, share links, character mode, error messages). `src/explanations.test.ts` checks that the production and position cited for every FIRST/FOLLOW member really yield that symbol (about 10,000 memberships over random grammars), and the trace-explanation test in `app.interaction.test.tsx` checks every shift and reduce "Why?" against the table and stacks. `src/services/groqService.test.ts`, `src/store/useChatStore.test.ts`, `src/components/ChatbotDrawer.test.tsx`, and `src/security.test.ts` cover the tutor, and `e2e/chat.spec.ts` covers mocked API calls in a real browser. `e2e/app.spec.ts` runs in real Chromium, including an axe-core scan (WCAG 2.2 AA plus best practices) of every stage and state: layout on phone and desktop, a measured WCAG AA contrast and minimum-font-size audit of every stage, the 2,000-token stress case, downloads, and clipboard.
- React and TypeScript are bundled by Vite, with Tailwind CSS integrated through its Vite plugin. A responsive component stylesheet provides the visual system, and Tailwind utilities are available for future iterations.

## Groq tutor (SLR Tutor)

The **Ask AI** tutor now uses **Google Groq**, not Claude. See [GROQ_SETUP.md](GROQ_SETUP.md) for local setup and public-deployment instructions.

Groq-specific service, store, and UI tests validate the active chatbot integration using mocked requests.
