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

    const noProvider = page.getByText(/no ai provider configured/i);
    const hasNoProvider = await noProvider.isVisible();

    // send message
    const composer = page.getByLabel(/message input/i);
    await composer.fill(PROMPT_TEXT);
    await page.getByRole("button", { name: /send message/i }).click();

    if (hasNoProvider) {
      // An immediately rejected send is not persisted; the draft stays editable.
      await expect(composer).toHaveValue(PROMPT_TEXT, { timeout: 10_000 });
      await expect(composer).toBeEnabled();
    } else {
      await expect(page.getByText(PROMPT_TEXT).first()).toBeVisible();
      const assistant = page.locator('article[aria-label="Assistant message"]');
      await expect(assistant.first()).toBeVisible({ timeout: 30_000 });
      // With a provider, completed messages remain after reload.
      await page.reload();
      await expect(page.getByText(PROMPT_TEXT).first()).toBeVisible({ timeout: 5000 });
      await expect(assistant.first()).toBeVisible();
    }
  });
});
