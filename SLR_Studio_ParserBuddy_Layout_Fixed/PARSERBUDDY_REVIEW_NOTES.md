# ParserBuddy — Course Review Edition

- Ask ParserBuddy opens the Groq-powered tutor.
- New Chat starts a separate thread. History switches between previous conversations and Delete removes one.
- Up to 20 conversations and 100 messages per conversation are saved in **this browser only** using localStorage. Browser storage may be cleared; private/incognito windows may not persist data.
- History is local, not uploaded to a database. The current question, recent turns and grammar context are sent to Groq for answers.
- Switching old conversations clears the currently selected grammar context; use Ask ParserBuddy from a visualization panel to attach fresh grammar context.
- The project deliberately excludes `.env` and `node_modules`. Copy `.env.example` to `.env`, add your own Groq key, then run `npm install` and `npm run dev`.
- Before demonstrating, verify grammar tables and parser traces with known examples.
