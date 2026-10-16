import { test, expect } from "@playwright/test";

test("theme selection applies across settings and chats and survives refresh", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/signup");
  await page.getByLabel(/^email/i).fill(`theme-${Date.now()}@example.com`);
  await page.getByLabel(/^password$/i).fill("verysecret123");
  await page.getByLabel(/confirm password/i).fill("verysecret123");
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL("/");
  const lightSidebar = await page.getByTestId("workspace-sidebar").evaluate(el => getComputedStyle(el).backgroundColor);

  await page.goto("/settings/providers");
  await expect(page.getByRole("radio", { name: /System/ })).toBeChecked();
  const lightBackground = await page.locator("body").evaluate(el => getComputedStyle(el).backgroundColor);

  await page.getByRole("radio", { name: /Dark/ }).check();
  await expect(page.locator("html")).toHaveClass(/dark/);
  const darkBackground = await page.locator("body").evaluate(el => getComputedStyle(el).backgroundColor);
  expect(darkBackground).not.toBe(lightBackground);
  const themeLabelColor = await page.getByText("Dark", { exact: true }).evaluate(el => getComputedStyle(el).color);
  const pageTextColor = await page.locator("body").evaluate(el => getComputedStyle(el).color);
  expect(themeLabelColor).toBe(pageTextColor);
  await page.screenshot({ path: "/tmp/subchats-themes-dark.png" });

  await page.reload();
  await expect(page.getByRole("radio", { name: /Dark/ })).toBeChecked();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("link", { name: "Back to chats" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect.poll(() => page.getByTestId("workspace-sidebar").evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(lightSidebar);
  await page.screenshot({ path: "/tmp/subchats-dark-sidebar.png" });

  await page.goto("/settings/providers");
  await page.getByRole("radio", { name: /System/ }).check();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("radio", { name: /Light/ }).check();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
});
