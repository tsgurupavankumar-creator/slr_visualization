#!/usr/bin/env node
// Secret scan for the Groq integration. Run from the project root:
//   node scripts/check-secrets.mjs           scan the working tree (including dist/) for key-shaped strings
//   node scripts/check-secrets.mjs --build   also prove a production build cannot contain the key
// It never prints a secret: matches are reported as file:line plus the first few characters.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, relative } from "node:path";

const ROOT = process.cwd();
// Real keys look like sk-ant-api03-<long random>. Test fixtures in this repo deliberately do not.
const KEY_SHAPE = /(?:gsk_[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{30,}|sk-ant-[a-z]+\d{2}-[A-Za-z0-9_-]{20,})/;
const SKIP_DIRS = new Set(["node_modules", ".git", "test-results", "playwright-report"]);
const SKIP_FILES = new Set([".env", "package-lock.json"]); // .env is the one place a key belongs, and it is git-ignored
const BINARY = new Set([".png", ".jpg", ".jpeg", ".gif", ".ico", ".woff", ".woff2", ".ttf", ".zip", ".gz", ".br"]);

const failures = [];
const note = (message) => failures.push(message);

function* files(directory) {
  for (const name of readdirSync(directory)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(directory, name);
    const info = statSync(path);
    if (info.isDirectory()) yield* files(path);
    else if (!SKIP_FILES.has(name) && !BINARY.has(extname(name))) yield path;
  }
}

function scanTree(directory, label) {
  let scanned = 0;
  for (const path of files(directory)) {
    scanned += 1;
    readFileSync(path, "utf8").split("\n").forEach((line, index) => {
      const match = KEY_SHAPE.exec(line);
      if (match) note(`${label}: key-shaped string in ${relative(directory, path)}:${index + 1} (${match[0].slice(0, 10)}…)`);
    });
  }
  return scanned;
}

// 1. .env must be impossible to commit by accident, and the template must be committable.
const ignore = existsSync(join(ROOT, ".gitignore")) ? readFileSync(join(ROOT, ".gitignore"), "utf8").split("\n").map((l) => l.trim()) : [];
if (existsSync(join(ROOT, ".gitignore")) || existsSync(join(ROOT, ".git"))) {
  for (const rule of [".env", ".env.*", "!.env.example"]) if (!ignore.includes(rule)) note(`.gitignore is missing the rule "${rule}"`);
}
if (existsSync(join(ROOT, ".git"))) {
  try {
    const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter((f) => /^\.env(\..*)?$/.test(f) && f !== ".env.example");
    for (const file of tracked) note(`${file} is tracked by git. Run: git rm --cached ${file}`);
  } catch { /* git not available: the .gitignore rules above still apply */ }
}

// 2. No real-looking key anywhere in the project, including the built dist/ that gets published.
const scanned = scanTree(ROOT, "tree");
console.log(`scanned ${scanned} files for key-shaped strings`);

// 3. A production build must not contain the key, and the check must be capable of failing.
if (process.argv.includes("--build")) {
  const { build } = await import("vite");
  const { default: react } = await import("@vitejs/plugin-react");
  const sentinel = `AIzaSENTINEL${"0123456789abcdef".repeat(2)}`;
  const previous = process.env.VITE_GROQ_API_KEY;
  process.env.VITE_GROQ_API_KEY = sentinel;
  const containing = async (label, config) => {
    const outDir = mkdtempSync(join(tmpdir(), "slr-build-"));
    try {
      await build({ root: ROOT, logLevel: "silent", ...config, build: { outDir, emptyOutDir: true } });
      return [...files(outDir)].filter((path) => readFileSync(path, "utf8").includes(sentinel)).length;
    } finally { rmSync(outDir, { recursive: true, force: true }); }
  };
  try {
    const real = await containing("project config", {});
    const control = await containing("control", { configFile: false, plugins: [react()] });
    console.log(`production build containing the key: ${real} file(s) (must be 0)`);
    console.log(`control build without the protection containing the key: ${control} file(s) (must be at least 1, proving this check can fail)`);
    if (real !== 0) note("the production build embeds VITE_GROQ_API_KEY. Check the `define` override in vite.config.ts.");
    if (control === 0) note("the control build did not contain the sentinel, so this check cannot detect a leak. Is the key still read via import.meta.env?");
  } finally {
    if (previous === undefined) delete process.env.VITE_GROQ_API_KEY; else process.env.VITE_GROQ_API_KEY = previous;
  }
}

if (failures.length) {
  console.error(`\nSECURITY CHECK FAILED:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
  process.exit(1);
}
console.log("security check passed");
