import { expect, test } from "@playwright/test";

// Offline-friendly browser test: intercept Groq calls, no real API key or quota needed.
test("Groq tutor answers a grammar question using the active screen context", async ({ page }) => {
  const seen: unknown[] = [];
  await page.route("https://api.groq.com/**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: {
        "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS"
      }});
      return;
    }
    seen.push(JSON.parse(route.request().postData() ?? "{}"));
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ choices: [{ message: { content: "**I0** is the initial LR(0) item set." }, finish_reason: "stop" }] }) });
  });
  await page.goto("/");
  await page.locator(".header-actions").getByRole("button", { name: "Ask AI" }).click();
  await page.getByRole("textbox", { name: "Message SLR Tutor" }).fill("Explain I0");
  await page.getByRole("textbox", { name: "Message SLR Tutor" }).press("Enter");
  await expect(page.locator(".chat-message-assistant .chat-message-bubble").last()).toContainText("initial LR(0)");
  expect(seen.length).toBe(1);
  expect(JSON.stringify(seen[0])).toContain("Explain I0");
});
