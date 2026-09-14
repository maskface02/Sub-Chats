import { test, expect } from "@playwright/test";

const TEST_EMAIL = `e2e-prov-${Date.now()}@example.com`;
const TEST_PASSWORD = "verysecret123";

test.describe("provider settings — full lifecycle", () => {
  test("add openai → masked key → set default → edit model → delete confirm → empty", async ({
    page,
  }) => {
    await page.goto("/signup");
    await page.getByLabel(/^email/i).fill(TEST_EMAIL);
    await page.getByLabel(/^password$/i).fill(TEST_PASSWORD);
    await page.getByLabel(/confirm password/i).fill(TEST_PASSWORD);
    await page.getByRole("button", { name: /create account/i }).click();
    await page.waitForURL("/", { timeout: 5000 });

    // settings via user menu link
    await page.getByRole("link", { name: /settings/i }).click();
    await page.waitForURL(/\/settings\/providers/, { timeout: 5000 });

    // empty state
    await expect(
      page.getByText(/no custom providers\. you're using the server default/i),
    ).toBeVisible();
    await expect(page.getByTestId("env-default-indicator")).toBeVisible();

    // add an openai provider with a fake key
    await page.getByRole("button", { name: /add provider/i }).click();
    await page.getByLabel(/^type$/i).selectOption("openai");
    await page.getByLabel(/^api key$/i).fill("sk-test-fake-key-123abc1");
    await page.getByRole("button", { name: /^add provider$/i }).click();

    // row appears with masked hint (= last 4 chars) and is the auto default
    await expect(page.getByTestId("provider-row")).toHaveCount(1);
    await expect(page.getByText("key: …abc1")).toBeVisible();
    await expect(page.getByText(/provider saved/i)).toBeVisible();
    await expect(page.locator('input[name="defaultProvider"]').first()).toBeChecked();

    // edit the model
    await page.getByRole("button", { name: /edit openai provider/i }).click();
    await page.getByLabel(/model id/i).fill("gpt-4o-mini");
    await page.getByLabel(/^api key/i).fill(""); // empty = keep existing
    await page.getByRole("button", { name: /save changes/i }).click();
    await expect(page.getByText(/model: gpt-4o-mini/)).toBeVisible();
    await expect(page.getByText("key: …abc1")).toBeVisible();

    // set-default radio stays checked (PUT isDefault is a no-op here)
    await page
      .locator('input[name="defaultProvider"]')
      .first()
      .check({ force: true });

    // delete with confirm
    await page.getByRole("button", { name: /delete openai provider/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(
      page.getByText(
        /^delete provider openai\? chats will fall back to the server default\.$/i,
      ),
    ).toBeVisible();
    await page.getByRole("button", { name: /delete/i, exact: true }).click();

    // gone, no stale default, empty state back
    await expect(page.getByTestId("provider-row")).toHaveCount(0);
    await expect(page.getByTestId("env-default-indicator")).toBeVisible();
    await expect(
      page.getByText(/no custom providers\. you're using the server default/i),
    ).toBeVisible();
  });

  test("unauthenticated visit redirects to signin with callbackUrl", async ({
    page,
  }) => {
    await page.goto("/settings/providers");
    await expect(page).toHaveURL(/\/signin\?callbackUrl=%2Fsettings%2Fproviders$/, {
      // redirect is server-side; allow one hop
      timeout: 5000,
    });
  });
});
