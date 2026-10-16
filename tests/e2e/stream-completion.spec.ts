import { test, expect } from "@playwright/test";

test("normal finish-step frames do not show an error, but actual errors do", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel(/^email/i).fill(`stream-${Date.now()}@example.com`);
  await page.getByLabel(/^password$/i).fill("verysecret123");
  await page.getByLabel(/confirm password/i).fill("verysecret123");
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL("/");
  await page.getByRole("button", { name: "New chat", exact: true }).first().click();
  await page.waitForURL(/\/c\//);
  let fail = false;
  await page.route("**/api/chats/*/messages", async route => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8", "x-vercel-ai-data-stream": "v1", "X-Assistant-Message-Id": "saved-assistant", "X-User-Message-Id": "saved-user" },
      body: fail
        ? '0:"Partial answer"\n3:"Provider failed"\n'
        : '0:"Completed **answer**"\ne:{"finishReason":"stop","usage":{"promptTokens":4,"completionTokens":2},"isContinued":false}\nd:{"finishReason":"stop","usage":{"promptTokens":4,"completionTokens":2}}\n',
    });
  });
  const input = page.getByLabel("Message input", { exact: true });
  await input.fill("First question");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByText("Completed answer", { exact: true })).toBeVisible();
  await expect(input).toBeEnabled();
  await expect(page.getByText(/AI stopped responding/)).toHaveCount(0);
  await expect(page.locator('[data-message-id="saved-assistant"]')).toContainText("Completed answer");
  await expect(page.locator('[data-message-id="saved-user"]')).toContainText("First question");
  let branchPayload: Record<string, unknown> | undefined;
  await page.route("**/api/chats/*/branch", async route => {
    branchPayload = route.request().postDataJSON();
    await route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ error: { code: "INVALID_SELECTION", fields: { selectedText: "Test validation feedback" } } }) });
  });
  await page.locator('[data-message-id="saved-assistant"] strong').evaluate(el => {
    const range = document.createRange();
    const node = el.querySelector("span")!.firstChild!;
    range.setStart(node, 0);
    range.setEnd(node, node.textContent!.length);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page.getByRole("button", { name: /Ask about this/ }).click();
  await page.getByLabel("Your question for the sub-chat").fill("Explain this");
  await page.getByLabel("Your question for the sub-chat").press("Enter");
  await expect.poll(() => branchPayload).toEqual(expect.objectContaining({ messageId: "saved-assistant", selectedText: "answer", charStart: 12, charEnd: 18 }));
  await expect(page.getByText("Test validation feedback", { exact: true })).toBeVisible();
  let regenerateUrl = "";
  await page.route("**/messages/*/regenerate", async route => {
    regenerateUrl = route.request().url();
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "NOT_FOUND", message: "Message not found" } }) });
  });
  await page.getByRole("button", { name: /regenerate/i }).click();
  await expect(input).toBeEnabled();
  await expect.poll(() => regenerateUrl).toContain("/messages/saved-assistant/regenerate");
  await expect(page.getByText("Completed answer", { exact: true })).toBeVisible();
  fail = true;
  await input.fill("Second question");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByText(/AI stopped responding/)).toBeVisible();
  await expect(page.getByText("Partial answer", { exact: true })).toBeVisible();
});
