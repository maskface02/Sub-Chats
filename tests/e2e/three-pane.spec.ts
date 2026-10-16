import { test, expect, type Page } from "@playwright/test";

test("three-pane branch path slides back and forward without losing drafts", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel(/^email/i).fill(`three-pane-${Date.now()}@example.com`);
  await page.getByLabel(/^password$/i).fill("verysecret123");
  await page.getByLabel(/confirm password/i).fill("verysecret123");
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL("/");
  const chats = [];
  for (let i = 0; i < 4; i++) chats.push(await (await page.request.post("/api/chats", { data: {} })).json());
  const root = await (await page.request.get(`/api/chats/${chats[0].id}`)).json();
  let branchIndex = 1;
  await page.route("**/api/chats/*", async route => {
    const id = route.request().url().split("/").pop();
    const index = chats.findIndex(chat => chat.id === id);
    if (index < 1 || route.request().method() !== "GET") return route.continue();
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...root, id, title: `Level ${index}`, depth: index, parentId: chats[index - 1].id, rootConversationId: chats[0].id, messages: [] }) });
  });
  await page.route("**/api/chats/*/branch", async route => {
    const child = chats[branchIndex++];
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(child) });
  });
  await page.route("**/api/chats/*/messages", route => route.fulfill({
    headers: { "content-type": "text/plain", "x-vercel-ai-data-stream": "v1", "X-Assistant-Message-Id": crypto.randomUUID() },
    body: `0:${JSON.stringify("Branchable answer\n\n" + "Long paragraph for independent scrolling.\n\n".repeat(35))}\ne:{"finishReason":"stop"}\nd:{"finishReason":"stop"}\n`,
  }));
  await page.goto(`/c/${chats[0].id}`);
  await page.getByLabel("Message input", { exact: true }).fill("Start");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByText("Branchable answer", { exact: true })).toBeVisible();
  await page.getByLabel("Message input", { exact: true }).fill("Keep root draft");
  for (let pane = 1; pane <= 3; pane++) {
    await branchFrom(page, pane);
    await expect(page.getByRole("region", { name: /^Chat pane/ })).toHaveCount(Math.min(3, pane + 1));
    if (pane === 1) await expect(page.getByTestId("workspace-sidebar")).toHaveAttribute("aria-hidden", "true");
  }
  await expect(page.getByRole("button", { name: "Parent", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Parent", exact: true }).click();
  await expect(page.locator('[data-chat-pane="1"]').getByLabel("Message input", { exact: true })).toHaveValue("Keep root draft");
  await page.getByRole("button", { name: "Child", exact: true }).click();
  await expect(page.getByRole("region", { name: /^Chat pane/ })).toHaveCount(3);
  for (const pane of await page.getByRole("region", { name: /^Chat pane/ }).all()) {
    const box = await pane.boundingBox();
    expect(box!.height).toBeGreaterThan(page.viewportSize()!.height * 0.7);
  }
  await expect.poll(async () => {
    const contextBox = await page.locator('[data-chat-pane="1"]').boundingBox();
    const branchBox = await page.locator('[data-chat-pane="2"]').boundingBox();
    return branchBox!.x - contextBox!.x;
  }).toBeGreaterThan(300);
  for (const pane of [1, 2, 3]) {
    const scroll = page.locator(`[data-chat-pane="${pane}"]`).getByTestId("chat-scroll-area");
    await expect.poll(() => scroll.evaluate(el => el.scrollHeight > el.clientHeight && el.clientHeight > 40)).toBe(true);
    await scroll.evaluate(el => { el.scrollTop = 100; });
    await expect.poll(() => scroll.evaluate(el => el.scrollTop)).toBe(100);
  }
  await expect(page.getByTestId("workspace-sidebar")).toHaveAttribute("aria-hidden", "true");
  await page.getByRole("button", { name: "Open chats sidebar", exact: true }).click();
  await expect(page.getByTestId("workspace-sidebar")).not.toHaveAttribute("aria-hidden", "true");
  await expect(page.getByTestId("workspace-sidebar").getByRole("button", { name: "Branch map" })).toBeVisible();
  await expect(page.locator("[data-chat-pane]").getByRole("button", { name: "Branch map" })).toHaveCount(0);
  await page.getByRole("button", { name: "Close chats sidebar", exact: true }).click();
  await expect(page.getByTestId("workspace-sidebar")).toHaveAttribute("aria-hidden", "true");
  await expect.poll(() => page.getByTestId("workspace-sidebar").evaluate(el => el.getBoundingClientRect().width)).toBeLessThan(1);
  await page.screenshot({ path: "/tmp/subchats-three-pane.png" });
  await page.setViewportSize({ width: 900, height: 720 });
  await expect.poll(() => page.locator(".branch-workspace").evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  for (const pane of await page.getByRole("region", { name: /^Chat pane/ }).all()) {
    const box = await pane.boundingBox();
    expect(box!.height).toBeGreaterThan(500);
  }
  await page.getByRole("button", { name: "Parent", exact: true }).click();
  await page.locator('[data-chat-pane="3"]').getByRole("button", { name: /^Close pane:/ }).click();
  await expect(page.getByRole("region", { name: /^Chat pane/ })).toHaveCount(2);
  await page.locator('[data-chat-pane="2"]').getByRole("button", { name: /^Close pane:/ }).click();
  await expect(page.getByRole("region", { name: /^Chat pane/ })).toHaveCount(1);
});

async function branchFrom(page: Page, index: number) {
  const pane = page.getByRole("region", { name: `Chat pane ${index}`, exact: true });
  await pane.getByTestId("chat-scroll-area").evaluate(el => { el.scrollTop = 0; });
  await expect(pane.getByText("Branchable answer", { exact: true })).toBeVisible();
  await pane.getByText("Branchable answer", { exact: true }).scrollIntoViewIfNeeded();
  await pane.locator('[data-source-start]').first().evaluate(el => {
    const range = document.createRange();
    range.selectNodeContents(el);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page.getByRole("button", { name: /Ask about this/ }).click();
  await page.getByLabel("Your question for the sub-chat").fill("Tell me more");
  await page.getByLabel("Your question for the sub-chat").press("Enter");
}
