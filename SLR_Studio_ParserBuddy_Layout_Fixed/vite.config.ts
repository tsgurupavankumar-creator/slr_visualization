import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import type { Plugin } from "vite";
function csp(): Plugin {
  const policy = ["default-src 'self'", "script-src 'self'", "style-src 'self' https://fonts.googleapis.com", "style-src-attr 'unsafe-inline'", "font-src https://fonts.gstatic.com", "img-src 'self' data:", "connect-src 'self' https://api.groq.com", "object-src 'none'", "base-uri 'self'", "form-action 'self'"].join("; ");
  return { name: "slr-csp", apply: "build", transformIndexHtml: () => [{ tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: policy }, injectTo: "head-prepend" }] };
}
export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss(), ...(command === "build" ? [csp()] : [])],
  // Never bundle a development-only API key in production output.
  define: command === "build" ? { "import.meta.env.VITE_GROQ_API_KEY": JSON.stringify("") } : {},
  test: { include: ["src/**/*.test.{ts,tsx}"] },
}));
