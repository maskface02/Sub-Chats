import { test, expect } from "@playwright/test";

test("branch navigation, delete cancellation, and split controls remain responsive", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel(/^email/i).fill(`tree-controls-${Date.now()}@example.com`);
  await page.getByLabel(/^password$/i).fill("verysecret123");
  await page.getByLabel(/confirm password/i).fill("verysecret123");
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL("/");
  const first = await (await page.request.post("/api/chats", { data: {} })).json();
  const second = await (await page.request.post("/api/chats", { data: {} })).json();
  await page.route("**/api/chats/*/tree", route => route.fulfill({
    contentType: "application/json", body: JSON.stringify({ currentId: first.id, totalNodes: 4, truncated: false, root: {
      id: first.id, title: "Main idea", depth: 0, highlightText: null, createdAt: new Date().toISOString(), children: [{
        id: second.id, title: "Follow-up", depth: 1, highlightText: "An interesting detail", createdAt: new Date().toISOString(), children: [{ id: "nested-preview", title: "Explore the detail", depth: 2, highlightText: null, createdAt: new Date().toISOString(), children: [] }],
      }, { id: "sibling-preview", title: "Another direction", depth: 1, highlightText: null, createdAt: new Date().toISOString(), children: [] }],
    } }),
  }));
  await page.goto(`/c/${first.id}`);
  await page.getByRole("button", { name: "Branch map", exact: true }).click();
  const map = page.getByRole("dialog", { name: "Branch map", exact: true });
  await expect(map.getByRole("link", { name: /Follow-up/ })).toBeVisible();
  await expect(map.getByTestId("branch-sibling-line")).toHaveCount(3);
  await expect(map.getByTestId("branch-ancestor-line")).toHaveCount(1);
  await expect(map.getByRole("link", { name: /Main idea/ })).toHaveAttribute("aria-current", "page");
  await map.getByRole("button", { name: "Collapse Main idea", exact: true }).click();
  await expect(map.getByRole("link", { name: /Follow-up/ })).toHaveCount(0);
  await map.getByRole("button", { name: "Expand Main idea", exact: true }).click();
  await expect(map.getByRole("link", { name: /Follow-up/ })).toBeVisible();
  await page.screenshot({ path: "/tmp/subchats-branch-map.png" });
  await map.getByRole("button", { name: "Delete Follow-up" }).click();
  const confirmation = page.getByRole("dialog", { name: /^Delete / });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(map).toBeVisible();
  await map.getByRole("button", { name: "Close conversation tree" }).click();
  await expect(map).not.toBeVisible();
  await page.getByRole("button", { name: "Split", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Choose conversation for second pane" });
  await expect(picker.getByRole("option", { name: "Follow-up" })).toBeVisible();
  await expect(picker.getByRole("option")).toHaveCount(2);
  await expect(picker.getByRole("option", { name: "Explore the detail" })).toHaveCount(0);
  await picker.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(picker).not.toBeVisible();
  await page.getByRole("button", { name: "Split", exact: true }).click();
  await picker.getByRole("option", { name: "Follow-up" }).click();
  await expect(page.getByRole("region", { name: /^Chat pane/ })).toHaveCount(2);
  await expect(page.getByLabel("Message input", { exact: true })).toHaveCount(2);
  await page.getByRole("button", { name: /^Close pane:/ }).last().click();
  await expect(page.getByLabel("Message input", { exact: true })).toHaveCount(1);
  await page.goto(`/c/${second.id}`);
  await page.getByRole("button", { name: "Split", exact: true }).click();
  await expect(picker.getByRole("option")).toHaveCount(1);
  await expect(picker.getByRole("option", { name: "Explore the detail" })).toBeVisible();
  await expect(picker.getByRole("option", { name: "Main idea" })).toHaveCount(0);
  await expect(picker.getByRole("option", { name: "Another direction" })).toHaveCount(0);
  await picker.getByRole("button", { name: "Cancel", exact: true }).click();
  const leaf = await (await page.request.post("/api/chats", { data: {} })).json();
  await page.goto(`/c/${leaf.id}`);
  await expect(page.getByLabel("Message input", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Split", exact: true })).toHaveCount(0);
});
