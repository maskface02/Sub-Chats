import { test, expect } from "@playwright/test";

test("NVIDIA preset saves an encrypted custom provider without exposing its key", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel(/^email/i).fill(`nvidia-${Date.now()}@example.com`);
  await page.getByLabel(/^password$/i).fill("verysecret123");
  await page.getByLabel(/confirm password/i).fill("verysecret123");
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL("/");
  await page.goto("/settings/providers");
  await page.getByRole("button", { name: /^add provider$/i }).click();
  await page.getByRole("radio", { name: "NVIDIA NIM", exact: true }).click();
  await expect(page.getByRole("radio", { name: "NVIDIA NIM", exact: true })).toBeChecked();
  await expect(page.getByLabel("Base URL", { exact: true })).toHaveValue("https://integrate.api.nvidia.com/v1");
  await expect(page.getByLabel(/model id/i)).toHaveValue("meta/muse-glimmer-30b");
  const fakeKey = "nvapi-test-placeholder-only-1234";
  await page.getByLabel("API key", { exact: true }).fill(fakeKey);
  // Clicking the selected provider again must not discard the entered key.
  await page.getByRole("radio", { name: "NVIDIA NIM", exact: true }).click();
  await expect(page.getByLabel("API key", { exact: true })).toHaveValue(fakeKey);
  await page.getByRole("button", { name: /^add provider$/i }).click();
  await expect(page.getByTestId("provider-row")).toHaveCount(1);
  const response = await page.request.get("/api/providers");
  const body = await response.text();
  expect(body).not.toContain(fakeKey);
  const saved = JSON.parse(body).items[0];
  expect(saved.type).toBe("custom");
  expect(saved.defaultModel).toBe("meta/muse-glimmer-30b");
  expect(saved.isDefault).toBe(true);
  await page.reload();
  await expect(page.getByText(/model: meta\/muse-glimmer-30b/)).toBeVisible();
  await page.getByRole("button", { name: "Edit custom provider", exact: true }).click();
  await page.route("**/api/providers/*", route => route.fulfill({
    status: 401,
    contentType: "application/json",
    body: JSON.stringify({ error: { code: "UNAUTHENTICATED" } }),
  }));
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByTestId("provider-form").getByRole("alert")).toContainText("Your session has expired");
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
});
