# SLR Studio — Course Project Review Guide

## First-time setup (local PC)
1. Install Node.js **22.22.2 or newer in the Node 22 line**, or an up-to-date Node 24 version.
2. Extract the project. Open a terminal in the `slr_visualization-main` folder.
3. Run `npm install` (internet connection required).
4. Visit https://aistudio.google.com/api-keys and create your own key.
5. Copy `.env.example` to `.env`. In `.env`, replace `your_groq_api_key_here` with your key. **Do not share the .env file or upload it to GitHub.**
6. Run `npm run dev` and open the local URL shown by Vite.
7. Before the review, send a test question to Ask AI. Groq availability depends on your key, account, network, and quota.

## Suggested 5-minute faculty demo
- **0:00–0:40 — Problem:** Explain that manually building canonical LR(0) item sets and SLR tables is time-consuming and error-prone.
- **0:40–1:30 — Grammar:** Enter `S -> C C` and `C -> c C | d` (adapt spacing to the app's accepted format) and explain augmentation, FIRST and FOLLOW.
- **1:30–2:40 — Automaton:** Navigate LR(0) item states; show closure, transitions and the relationship between an item and a table entry.
- **2:40–3:30 — Parsing:** Parse `c d d` (or the input-token format indicated by the UI), showing stack, input and each action.
- **3:30–4:20 — Conflicts:** Enter `E -> E + E | E * E | id`; explain a shift/reduce conflict and why the grammar is not SLR(1).
- **4:20–5:00 — AI Tutor:** With your original grammar loaded, ask "Explain why the initial LR(0) item set contains these items" and compare the reply to the displayed states.

## Essential correctness checklist
- Valid grammar generates LR(0) states, FIRST/FOLLOW and ACTION/GOTO.
- A valid input is accepted; an invalid input is rejected.
- The shift/reduce trace agrees with ACTION/GOTO entries.
- Ambiguous grammar shows the conflict instead of incorrectly claiming SLR(1).
- Chatbot gives a response without showing an API configuration error.
- `npm run check` and `npm run e2e` pass on the review computer.

## If the AI is temporarily unavailable
Demonstrate the SLR parser and visualization first; the parser is independent of Groq. Don't claim an AI-generated answer was algorithmically verified. Explain that the optional tutor sends the active grammar context to Groq for educational explanations.

## Current verification limitation
The project was statically edited and its secret scanner was run successfully, but npm installation, TypeScript build, Vitest and Playwright could **not** be run inside the preparation environment because npm packages were not available and the registry was unreachable. Execute all checks on your own computer before the faculty review.
