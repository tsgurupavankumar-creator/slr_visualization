import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const errorsByPage = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  errorsByPage.set(page, errors);
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    // Google Fonts are not reachable from every test machine; that is not an app error.
    if (message.type() === "error" && !/fonts\.(googleapis|gstatic)|ERR_|Failed to load resource/.test(message.text())) {
      errors.push(`console: ${message.text()}`);
    }
  });
  await page.goto("/");
  await page.waitForSelector(".app-shell");
});

test.afterEach(({ page }) => {
  expect(errorsByPage.get(page), "no uncaught errors or console errors").toEqual([]);
});

const INPUT = "input[aria-label='Input string to parse']";
const generate = (page: Page, grammar: string, input: string) => async () => {
  await page.fill("textarea", grammar);
  await page.fill(INPUT, input);
  await page.click(".generate-button");
};
const openStage = (page: Page, number: number) => page.click(`.stage-tab:nth-child(${number})`);

test("walks the default grammar through all five stages and accepts the input", async ({ page }) => {
  for (let stage = 1; stage <= 5; stage += 1) {
    await openStage(page, stage);
    await expect(page.locator(".stage-heading h1")).toBeVisible();
  }
  await expect(page.locator(".outcome-banner")).toContainText("ACCEPTED");
  await page.click("button[aria-label='Skip forward']");
  await expect(page.locator(".active-trace-row")).toContainText("Accept");
});

test("input rules show real bullets and sit outside the pinned header", async ({ page }) => {
  await page.click("details.input-rules summary");
  const listStyle = await page.locator(".input-rules-body ul").first().evaluate((el) => getComputedStyle(el).listStyleType);
  expect(listStyle).toBe("disc");
  const marker = await page.locator(".input-rules-body li").first().evaluate((el) => getComputedStyle(el).display);
  expect(marker).toBe("list-item");
  const inHeader = await page.locator("details.input-rules").evaluate((el) => !!el.closest("header"));
  expect(inHeader).toBe(false);
});

test("the header is pinned on tall desktops and scrolls away on phones and short screens", async ({ page }) => {
  const position = () => page.locator(".topbar").evaluate((el) => getComputedStyle(el).position);
  expect(await position()).toBe("sticky");
  await page.setViewportSize({ width: 1440, height: 760 });
  expect(await position()).toBe("static");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await position()).toBe("static");
});

test("nothing overflows horizontally on a phone, on any stage", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click("details.input-rules summary");
  for (let stage = 1; stage <= 5; stage += 1) {
    await openStage(page, stage);
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `stage ${stage} horizontal overflow in px`).toBeLessThanOrEqual(0);
  }
});

async function audit(page: Page): Promise<{ key: string; detail: string }[]> {
  return page.evaluate(() => {
    const parse = (value: string) => {
      const match = value.match(/rgba?\(([^)]+)\)/);
      if (!match) return null;
      const [r, g, b, a = 1] = match[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return { r, g, b, a };
    };
    const channel = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
    const luminance = (c: { r: number; g: number; b: number }) => 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
    const backgroundOf = (element: Element) => {
      for (let node: Element | null = element; node; node = node.parentElement) {
        const colour = parse(getComputedStyle(node).backgroundColor);
        if (colour && colour.a > 0.5) return colour;
      }
      return { r: 255, g: 255, b: 255, a: 1 };
    };
    const out: { key: string; detail: string }[] = [];
    for (const element of Array.from(document.body.querySelectorAll("*"))) {
      const ownText = Array.from(element.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent ?? "").join("").trim();
      if (!ownText || element.closest("[aria-hidden='true'], script, style, title")) continue;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (rect.width === 0 || rect.height === 0 || style.visibility === "hidden" || style.display === "none") continue;
      const size = parseFloat(style.fontSize);
      const fg = parse(style.color);
      if (!fg) continue;
      const bg = backgroundOf(element);
      const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
      const ratio = (hi + 0.05) / (lo + 0.05);
      const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
      const selector = `${element.tagName.toLowerCase()}.${(element.getAttribute("class") ?? "").split(" ")[0]}`;
      if (size < 10.5) out.push({ key: `${selector}|size`, detail: `${size}px "${ownText.slice(0, 24)}"` });
      if (ratio < (large ? 3 : 4.5)) out.push({ key: `${selector}|contrast`, detail: `${ratio.toFixed(2)}:1 ${style.color} on rgb(${bg.r},${bg.g},${bg.b}) "${ownText.slice(0, 24)}"` });
    }
    return out;
  });
}

test("text is never smaller than 10.5px and meets WCAG AA contrast on every stage, notice and dialog", async ({ page }) => {
  const failures = new Map<string, string>();
  const collect = async (where: string) => {
    for (const item of await audit(page)) if (!failures.has(item.key)) failures.set(item.key, `${where}: ${item.detail}`);
  };

  await generate(page, "S -> A a | B a\nA -> x\nB -> x", "x a")();
  await page.click("details.input-rules summary");
  for (let stage = 1; stage <= 5; stage += 1) {
    await openStage(page, stage);
    await page.waitForTimeout(400);
    await collect(`stage ${stage}`);
  }

  await generate(page, "S -> if E then S | if E then S else S | a\nE -> b", "if b then a")();
  await openStage(page, 4);
  await collect("shift/reduce conflict table");

  await generate(page, "S -> Tt\nT -> a\nU -> b", "a")();
  await openStage(page, 1);
  await page.waitForTimeout(300);
  await collect("grammar notices");
  await page.locator(".production-row").first().click();
  await page.waitForTimeout(500);
  await collect("explanation drawer");

  expect([...failures.entries()].map(([key, detail]) => `${key} → ${detail}`)).toEqual([]);
});

test("a 2,000-token parse stays responsive: the table is windowed and the huge tree is not drawn", async ({ page }) => {
  await generate(page, "S -> S a | a", Array(2000).fill("a").join(" "))();
  await openStage(page, 5);
  await page.click("button[aria-label='Skip forward']");
  await expect(page.locator(".outcome-banner")).toContainText("ACCEPTED");
  expect(await page.locator(".trace-table tbody tr").count()).toBeLessThan(100);
  await expect(page.locator(".active-trace-row")).toContainText("Accept"); // followed to the last row
  await expect(page.locator(".tree-empty")).toContainText("too large to draw");
  await expect(page.locator(".view-error")).toHaveCount(0);

  // Scrolling by hand must never leave blank rows.
  await page.evaluate(() => { document.querySelector(".trace-table-scroll")!.scrollTop = 37 * 1500; });
  await expect(page.locator(".trace-table tbody tr:not(.trace-spacer) .trace-step-button").first()).toHaveText(/^14[89]\d$|^15\d\d$/);
});

test("empty reductions draw an ε node under them", async ({ page }) => {
  await generate(page, "S -> ( S ) S | @", "( )")();
  await openStage(page, 5);
  await page.click("button[aria-label='Skip forward']");
  await expect(page.locator(".academic-terminal text", { hasText: "ε" })).toHaveCount(2);
  await page.locator(".academic-terminal", { hasText: "ε" }).first().click();
  await expect(page.locator("[role=dialog] h2")).toHaveText("What ε means here");
});

test("the explanation drawer takes focus, traps Tab, closes on Escape and returns focus", async ({ page }) => {
  const row = page.locator(".production-row").first();
  await row.focus();
  await row.click();
  await expect(page.locator("[role=dialog] button[aria-label=Close]")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator("[role=dialog]").locator(":focus")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator("[role=dialog]")).toHaveCount(0);
  await expect(row).toBeFocused();
});

test("character mode parses run-together input", async ({ page }) => {
  await generate(page, "S -> a S b | @", "aabb")();
  await openStage(page, 5);
  await expect(page.locator(".outcome-banner")).toContainText("REJECTED");
  await page.check(".mode-toggle input");
  await page.click(".generate-button");
  await expect(page.locator(".outcome-banner")).toContainText("ACCEPTED");
});

test("shared links fill in the boxes, and a broken link degrades gracefully", async ({ page }) => {
  await page.goto("/#g=S+-%3E+a+S+b+%7C+%40&i=a+b&c=1");
  await page.reload();
  await expect(page.locator("textarea")).toHaveValue("S -> a S b | @");
  await expect(page.locator(INPUT)).toHaveValue("a b");
  await expect(page.locator(".mode-toggle input")).toBeChecked();

  await page.goto("/#g=S+-%3E+%27oops&i=a");
  await page.reload();
  await expect(page.locator("[role=alert]")).toContainText("The shared link could not be loaded");
  await expect(page.locator("textarea")).toHaveValue("S -> 'oops");
});

test("Copy link puts a working link on the clipboard", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await generate(page, "S -> a", "a")();
  await page.click(".link-button");
  await expect(page.locator(".link-button")).toContainText("Link copied");
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toContain("#g=S+-%3E+a");
  await page.goto(link);
  await page.reload();
  await expect(page.locator("textarea")).toHaveValue("S -> a");
});

test("CSV downloads contain the table and the trace", async ({ page }) => {
  await openStage(page, 4);
  const [tableDownload] = await Promise.all([page.waitForEvent("download"), page.click(".export-button")]);
  expect(tableDownload.suggestedFilename()).toBe("slr-table.csv");
  const tablePath = await tableDownload.path();
  const { readFileSync } = await import("node:fs");
  const tableCsv = readFileSync(tablePath, "utf-8");
  expect(tableCsv).toContain("State,ACTION +,ACTION *,ACTION (,ACTION ),ACTION id,ACTION $,GOTO E,GOTO T,GOTO F");

  await openStage(page, 5);
  const [traceDownload] = await Promise.all([page.waitForEvent("download"), page.click(".export-button")]);
  expect(traceDownload.suggestedFilename()).toBe("parse-trace.csv");
  expect(readFileSync(await traceDownload.path(), "utf-8")).toContain("Step,Stack,Input,Action,Detail");
});

test("conflicts are explained in words, and notices appear for likely typos", async ({ page }) => {
  await generate(page, "S -> if E then S | if E then S else S | a\nE -> b", "if b then a")();
  await openStage(page, 4);
  await expect(page.locator(".conflict-list")).toContainText("shift/reduce conflict in I7 on “else”");
  await expect(page.locator(".conflict-list")).toContainText("Shift “else”");

  await generate(page, "S -> Tt\nT -> a", "a")();
  await expect(page.locator(".notices")).toContainText("Did you mean “T”?");
});

test("@ writes an empty production, and a quoted '@' is a real terminal", async ({ page }) => {
  await generate(page, "S -> a S b | @", "a a b b")();
  await openStage(page, 5);
  await expect(page.locator(".outcome-banner")).toContainText("ACCEPTED");
  await page.click("button[aria-label='Skip forward']");
  await expect(page.locator(".academic-terminal text", { hasText: "ε" })).toHaveCount(1); // shown as ε

  await generate(page, "S -> id '@' id", "id @ id")();
  await expect(page.locator(".outcome-banner")).toContainText("ACCEPTED");

  await generate(page, "S -> a @", "a")();
  await expect(page.locator("[role=alert]")).toContainText("Use @ on its own");

  await generate(page, "S -> a S b | ε", "a b")();
  await expect(page.locator("[role=alert]")).toContainText("Write @ for an empty production");
});

test("axe-core finds no WCAG 2.2 AA or best-practice violations in any stage or state", async ({ page }) => {
  const scan = async (where: string) => {
    await page.waitForTimeout(1500); // let entrance animations finish, or axe measures half-faded text
    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
      .analyze();
    return violations.map((v) => `${where}: [${v.impact}] ${v.id} — ${v.help} (${v.nodes.length}× e.g. ${v.nodes[0].target.join(" ")})`);
  };
  const found: string[] = [];
  await page.click("details.input-rules summary");
  for (let stage = 1; stage <= 5; stage += 1) {
    await openStage(page, stage);
    if (stage === 5) await page.click("button[aria-label='Skip forward']");
    found.push(...await scan(`stage ${stage}`));
  }
  await generate(page, "S -> if E then S | if E then S else S | a\nE -> b", "if b then a")();
  await openStage(page, 4);
  found.push(...await scan("conflict table"));
  await generate(page, "S -> Tt\nT -> a", "a")();
  await openStage(page, 1);
  found.push(...await scan("grammar notices"));
  await page.locator(".production-row").first().click();
  found.push(...await scan("explanation drawer"));
  expect(found).toEqual([]);
});

test("opening a shared link in an already-open tab updates the page without a reload", async ({ page }) => {
  await page.evaluate(() => { window.location.hash = "#g=S+-%3E+x+y&i=x+y"; });
  await expect(page.locator("textarea")).toHaveValue("S -> x y");
  await expect(page.locator(INPUT)).toHaveValue("x y");
  await openStage(page, 5);
  await expect(page.locator(".outcome-banner")).toContainText("ACCEPTED");

  await page.evaluate(() => { window.location.hash = "#g=S+-%3E+%27oops&i=a"; });
  await expect(page.locator("[role=alert]")).toContainText("The shared link could not be loaded");
  // our own replaceState on Generate must not re-trigger the handler or flicker the page
  await page.fill("textarea", "S -> a");
  await page.fill(INPUT, "a");
  await page.click(".generate-button");
  await expect(page.locator("[role=alert]")).toHaveCount(0);
  await expect(page.locator("textarea")).toHaveValue("S -> a");
});


test("the production build has a CSP, contains no key, and loads the chat code only when it is opened", async ({ page }) => {
  const raw = await (await page.request.get("/")).text();
  const html = raw.replaceAll("&#39;", "'"); // the attribute is HTML-escaped; browsers decode it the same way
  expect(html).toContain('http-equiv="Content-Security-Policy"');
  expect(html).toMatch(/connect-src 'self' https:\/\/api\.anthropic\.com;/);
  expect(html).toContain("object-src 'none'");
  expect(html).toMatch(/script-src 'self';/);
  expect(html).not.toMatch(/script-src[^;]*unsafe-inline/);

  // Nothing the browser can download from the build looks like an API key.
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((match) => match[1]);
  expect(assets.length).toBeGreaterThan(1);
  for (const asset of assets) expect(await (await page.request.get(asset)).text(), asset).not.toMatch(/sk-ant-[a-z]+\d{2}-/);

  // The Groq client and the Markdown renderer are not part of the first page load...
  const scripts: string[] = [];
  const toAnthropic: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "script") scripts.push(request.url());
    if (request.url().includes("api.anthropic.com")) toAnthropic.push(request.url());
  });
  await page.goto("/");
  await page.waitForSelector(".app-shell");
  await page.waitForTimeout(500);
  const atStart = scripts.length;

  // ...they arrive when the tutor is first opened, and with no key configured nothing is sent to Groq.
  await page.locator(".header-actions").getByRole("button", { name: "Ask AI" }).click();
  await page.fill("textarea[aria-label='Message SLR Tutor']", "hello");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "not configured" })).toBeVisible();
  expect(scripts.length).toBeGreaterThan(atStart);
  expect(toAnthropic).toEqual([]);
});
