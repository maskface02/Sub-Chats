import { test, expect } from "@playwright/test";

test("unused chats never clutter history and remain recoverable by URL", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel(/^email/i).fill(`empty-chat-${Date.now()}@example.com`);
  await page.getByLabel(/^password$/i).fill("verysecret123");
  await page.getByLabel(/confirm password/i).fill("verysecret123");
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL("/");
  await page.getByRole("button", { name: "New chat", exact: true }).first().click();
  await page.waitForURL(/\/c\//);
  const draftUrl = page.url();
  await expect(page.getByLabel("Message input", { exact: true })).toBeVisible();
  await page.goto("/");
  const response = await page.request.get("/api/chats");
  expect((await response.json()).items).toEqual([]);
  await expect(page.getByTestId("workspace-sidebar").locator('a[href*="/c/"]')).toHaveCount(0);
  await page.goto(draftUrl);
  await expect(page.getByLabel("Message input", { exact: true })).toBeVisible();
});
