import { defineConfig } from "@playwright/test";

// Locally: `npx playwright install chromium` once, then `npm run e2e`.
// To use a Chromium you already have, set CHROMIUM_PATH (and optionally CHROMIUM_ARGS).
//
// Two servers, because the Groq key only ever exists in development:
//   - preview (4173): the production build, which must NOT contain the key (app.spec.ts)
//   - dev (4174): a dev server given a FAKE key, with the Groq API intercepted (chat.spec.ts)
export const E2E_FAKE_KEY = "groq-e2e-fake-key";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  workers: 1,
  reporter: "list",
  use: {
    viewport: { width: 1440, height: 1000 },
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: process.env.CHROMIUM_ARGS ? process.env.CHROMIUM_ARGS.split(" ") : undefined,
    },
  },
  projects: [
    { name: "preview", testMatch: /app\.spec\.ts/, use: { baseURL: "http://localhost:4173" } },
    { name: "dev-chat", testMatch: /chat\.spec\.ts/, use: { baseURL: "http://localhost:4174" } },
  ],
  webServer: [
    {
      command: "npm run build && npx vite preview --port 4173 --strictPort",
      url: "http://localhost:4173",
      reuseExistingServer: true,
      timeout: 180_000,
    },
    {
      command: "npx vite --port 4174 --strictPort",
      url: "http://localhost:4174",
      reuseExistingServer: true,
      timeout: 60_000,
      env: { VITE_GROQ_API_KEY: E2E_FAKE_KEY },
    },
  ],
});
