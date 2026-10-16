import { test, expect } from "@playwright/test";

test("home composer recognizes a saved provider and recovers a rejected first prompt", async ({
  page,
}) => {
  await page.goto("/signup");
  await page.getByLabel(/^email/i).fill(`e2e-home-${Date.now()}@example.com`);
  await page.getByLabel(/^password$/i).fill("verysecret123");
  await page.getByLabel(/confirm password/i).fill("verysecret123");
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL("/");
  const provider = await page.request.post("/api/providers", {
    data: { type: "openai", apiKey: "sk-local-ui-test-only" },
  });
  expect(provider.ok()).toBe(true);
  await page.reload();
  await expect(page.getByText("Ready to chat", { exact: true })).toBeVisible();
  await page.route("**/api/chats/*/messages", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "NO_PROVIDER",
          message: "Provider unavailable for this test",
        },
      }),
    });
  });
  await page
    .getByLabel("Start a conversation")
    .fill("Keep this first question safe");
  await page.getByRole("button", { name: "Send message" }).click();
  await page.waitForURL(/\/c\//);
  await expect(page.getByLabel("Message input")).toHaveValue(
    "Keep this first question safe",
  );
  await expect(page.getByLabel("Message input")).toBeEnabled();
  await expect(
    page.getByRole("alert").filter({ hasText: "Provider unavailable" }),
  ).toBeVisible();
});

test("new chats use client navigation without hydration warnings", async ({
  page,
}) => {
  const errors: string[] = [];
  const creationRequests: string[] = [];
  const serverActionRequests: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/chats")) {
      creationRequests.push(request.url());
    }
    if (request.headers()["next-action"])
      serverActionRequests.push(request.url());
  });

  await page.goto("/signup");
  await page
    .getByLabel(/^email/i)
    .fill(`e2e-hydration-${Date.now()}@example.com`);
  await page.getByLabel(/^password$/i).fill("verysecret123");
  await page.getByLabel(/confirm password/i).fill("verysecret123");
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL("/");
  serverActionRequests.length = 0;
  await page.getByTestId("workspace-sidebar").evaluate((el) => {
    (el as HTMLElement).dataset.persisted = "yes";
  });
  await page.getByRole("button", { name: "Untangle an idea" }).click();
  await expect(page.getByLabel("Start a conversation")).toHaveValue(
    /Help me think/,
  );
  await page.screenshot({ path: "/tmp/subchats-home-desktop.png" });

  await page.evaluate(
    () =>
      ((window as unknown as { __testMarker?: boolean }).__testMarker = true),
  );
  await page.getByRole("button", { name: "New chat" }).first().click();
  await page.waitForURL(/\/c\//);
  await expect(page.getByRole("heading", { name: "New chat" })).toBeVisible();
  const firstChatUrl = page.url();
  await expect(page.getByTestId("workspace-sidebar")).toHaveAttribute(
    "data-persisted",
    "yes",
  );
  await page.screenshot({ path: "/tmp/subchats-chat-desktop.png" });
  expect(
    await page.evaluate(
      () => (window as unknown as { __testMarker?: boolean }).__testMarker,
    ),
  ).toBe(true);
  expect(creationRequests).toHaveLength(1);

  await page.reload();
  await expect(page.getByRole("heading", { name: "New chat" })).toBeVisible();

  await page.evaluate(
    () =>
      ((window as unknown as { __testMarker?: boolean }).__testMarker = true),
  );
  await page.getByRole("button", { name: "New chat" }).first().click();
  await expect(page).not.toHaveURL(firstChatUrl);
  await expect(page.getByRole("heading", { name: "New chat" })).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { __testMarker?: boolean }).__testMarker,
    ),
  ).toBe(true);
  expect(creationRequests).toHaveLength(2);
  await expect(
    page.locator('aside[aria-label="Conversations"] nav a'),
  ).toHaveCount(0);

  const secondChatUrl = page.url();
  await page.keyboard.press("Control+k");
  await expect(page).not.toHaveURL(secondChatUrl);
  await expect(
    page.locator('aside[aria-label="Conversations"] nav a'),
  ).toHaveCount(0);
  expect(creationRequests).toHaveLength(3);
  expect(serverActionRequests).toHaveLength(0);
  expect(
    errors.filter((message) => /hydrat|getServerSnapshot/i.test(message)),
  ).toEqual([]);
  await page.getByRole("button", { name: "Branch map" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open chats sidebar" }).click();
  await expect(
    page.getByRole("dialog", { name: "Conversations", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "New chat", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Conversations", exact: true }),
  ).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "New chat" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "/tmp/subchats-chat-mobile.png" });
});
