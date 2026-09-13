import { test, expect } from "@playwright/test";

const TEST_EMAIL = `e2e-auth-${Date.now()}@example.com`;
const TEST_PASSWORD = "verysecret123";

test.describe("auth — sign up, sign in, sign out", () => {
  test("full happy path", async ({ page }) => {
    // 1. signup
    await page.goto("/signup");
    await expect(page.getByRole("heading", { name: /create your account/i })).toBeVisible();

    await page.getByLabel(/^name/i).fill("E2E Tester");
    await page.getByLabel(/^email/i).fill(TEST_EMAIL);
    await page.getByLabel(/^password$/i).fill(TEST_PASSWORD);
    await page.getByLabel(/confirm password/i).fill(TEST_PASSWORD);

    await page.getByRole("button", { name: /create account/i }).click();
    await page.waitForURL("/", { timeout: 5000 });
    await expect(page).toHaveURL("/");
    await expect(page.getByText(TEST_EMAIL)).toBeVisible();

    // 2. sign out
    await page.getByRole("button", { name: /sign out/i }).click();
    await page.waitForURL(/\/signin/, { timeout: 5000 });

    // 3. sign in
    await page.getByLabel(/^email/i).fill(TEST_EMAIL);
    await page.getByLabel(/^password/i).fill(TEST_PASSWORD);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await page.waitForURL("/", { timeout: 5000 });
    await expect(page.getByText(TEST_EMAIL)).toBeVisible();

    // 4. visiting /signin while signed in redirects back to /
    await page.goto("/signin");
    await page.waitForURL("/", { timeout: 5000 });
  });

  test("shows per-field errors on bad signup", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel(/^email/i).fill("not-an-email");
    await page.getByLabel(/^password$/i).fill("short");
    await page.getByLabel(/confirm password/i).fill("different");
    await page.getByRole("button", { name: /create account/i }).click();

    await expect(page.getByText(/enter a valid email/i)).toBeVisible();
    await expect(page.getByText(/at least 8 characters/i)).toBeVisible();
    await expect(page.getByText(/passwords do not match/i)).toBeVisible();
  });

  test("signin shows generic error on wrong password", async ({ page }) => {
    await page.goto("/signin");
    await page.getByLabel(/^email/i).fill("nobody@example.com");
    await page.getByLabel(/^password/i).fill("wrongpassword1");
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(page.getByText(/invalid email or password/i)).toBeVisible();
  });
});