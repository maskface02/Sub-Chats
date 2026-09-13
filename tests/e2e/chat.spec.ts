import { test, expect } from "@playwright/test";

const TEST_EMAIL = `e2e-chat-${Date.now()}@example.com`;
const TEST_PASSWORD = "verysecret123";
const PROMPT_TEXT = "Hello from e2e — please reply with the word PONG";

test.describe("chat — create, send, reload, see messages", () => {
  test("happy path", async ({ page }) => {
    // sign up
    await page.goto("/signup");
    await page.getByLabel(/^email/i).fill(TEST_EMAIL);
    await page.getByLabel(/^password$/i).fill(TEST_PASSWORD);
    await page.getByLabel(/confirm password/i).fill(TEST_PASSWORD);
    await page.getByRole("button", { name: /create account/i }).click();
    await page.waitForURL("/", { timeout: 5000 });

    // open empty home → see "New chat" CTA
    await expect(page.getByRole("button", { name: /new chat/i }).first()).toBeVisible();

    // create a chat
    await page.getByRole("button", { name: /new chat/i }).first().click();
    await page.waitForURL(/\/c\//, { timeout: 5000 });
    const chatUrl = page.url();
    expect(chatUrl).toMatch(/\/c\/[a-z0-9-]+/i);

    // empty state visible
    await expect(page.getByText(/send a message to get started/i)).toBeVisible();

    // send message
    const composer = page.getByLabel(/message input/i);
    await composer.fill(PROMPT_TEXT);
    await page.getByRole("button", { name: /send message/i }).click();

    // user message appears
    await expect(page.getByText(PROMPT_TEXT).first()).toBeVisible();

    // assistant message eventually appears (or no-provider banner) — wait for at least one assistant article
    // We give the AI up to 30s, but if no provider is configured the UI shows an error banner instead.
    const assistant = page.locator('article[aria-label="Assistant message"]');
    const noProvider = page.getByText(/no ai provider configured/i);

    await expect
      .poll(
        async () => {
          const aCount = await assistant.count();
          const npVisible = await noProvider.isVisible().catch(() => false);
          return aCount > 0 || npVisible;
        },
        { timeout: 30_000, intervals: [500, 1000, 2000] },
      )
      .toBe(true);

    // capture how many assistant messages exist before reload
    const beforeCount = await assistant.count();

    // reload — messages should still be there
    await page.reload();
    await expect(page.getByText(PROMPT_TEXT).first()).toBeVisible({ timeout: 5000 });
    if (beforeCount > 0) {
      await expect(assistant.first()).toBeVisible();
    }
  });
});