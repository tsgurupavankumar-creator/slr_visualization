# SLR Studio — Groq setup (local course demonstration)

1. Get your own API key at https://console.groq.com/keys
2. Copy `.env.example` to `.env` in the SAME folder as `package.json`.
3. Add `VITE_GROQ_API_KEY` with your own new key. Do not share or commit it.
4. Run `npm install`, then `npm run dev`. Open the localhost URL.
5. Ask `What is SLR parsing?` and then `Explain the current grammar`.

Default model: `llama-3.3-70b-versatile`. If your account does not have that model, use an available Groq model such as `llama-3.1-8b-instant` by changing `VITE_GROQ_MODEL`, then restart.

This is for localhost testing only. Vite browser keys are public to site visitors; do not deploy this version with a key. A deployed app needs a secure backend proxy.

Existing Gemini `.env` entries do not configure Groq. Remove them from your new `.env`.

The project has not been live-tested with a private Groq API key.
