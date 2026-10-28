import type { Page } from "@playwright/test";

/** Finds text smaller than 10.5px or below WCAG AA contrast, measured on the rendered page. */
export async function auditText(page: Page): Promise<{ key: string; detail: string }[]> {
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
