// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = resolve("scripts/check-secrets.mjs");
const run = (cwd: string, ...args: string[]) => spawnSync("node", [SCRIPT, ...args], { cwd, encoding: "utf8", timeout: 110_000 });
const GOOD_IGNORE = ".env\n.env.*\n!.env.example\n";
// Assembled at runtime so this file itself contains no key-shaped literal.
const planted = "AIza" + "PLANTEDPLANTEDPLANTEDPLANTEDPLANTED";

describe("secret protection", () => {
  it("the project passes its own scan (no key-shaped strings, .env cannot be committed)", () => {
    const result = run(resolve("."));
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it("detects a planted key, names the file and line, and never prints the key", () => {
    const dir = mkdtempSync(join(tmpdir(), "slr-secret-"));
    try {
      writeFileSync(join(dir, ".gitignore"), GOOD_IGNORE);
      writeFileSync(join(dir, "notes.txt"), `line one\nkey = ${planted}\n`);
      const result = run(dir);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("notes.txt:2");
      expect(result.stdout + result.stderr).not.toContain("PLANTEDPLANTED");
      writeFileSync(join(dir, "notes.txt"), "all clear\n");
      expect(run(dir).status).toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("flags a .gitignore that would let .env be committed", () => {
    const dir = mkdtempSync(join(tmpdir(), "slr-secret-"));
    try {
      writeFileSync(join(dir, ".gitignore"), "node_modules/\n");
      const result = run(dir);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('missing the rule ".env"');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("a production build never contains VITE_GROQ_API_KEY (and the check can detect it when unprotected)", () => {
    const result = run(resolve("."), "--build");
    expect(result.stdout).toContain("production build containing the key: 0 file(s)");
    expect(result.stdout).toMatch(/control build without the protection containing the key: [1-9]\d* file\(s\)/);
    expect(result.status).toBe(0);
  }, 120_000);
});
