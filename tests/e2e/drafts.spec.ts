import { test, expect } from "@playwright/test";

test("unsent drafts survive chat switches and reloads without leaking to another chat", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel(/^email/i).fill(`draft-${Date.now()}@example.com`);
  await page.getByLabel(/^password$/i).fill("verysecret123");
  await page.getByLabel(/confirm password/i).fill("verysecret123");
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL("/");
  await page.getByRole("button", { name: "New chat", exact: true }).first().click();
  await page.waitForURL(/\/c\//);
  const first = page.url();
  const input = page.getByLabel("Message input", { exact: true });
  await input.fill("Keep this unfinished thought");
  await page.getByRole("button", { name: "New chat", exact: true }).first().click();
  await expect(page).not.toHaveURL(first);
  await expect(input).toHaveValue("");
  await input.fill("A different thought");
  await page.goBack();
  await expect(input).toHaveValue("Keep this unfinished thought");
  await page.reload();
  await expect(input).toHaveValue("Keep this unfinished thought");
  await input.fill("");
  await page.reload();
  await expect(input).toHaveValue("");
});
