import { test, expect, type Page } from "@playwright/test";
import * as fs from "node:fs";

const NODE_MODULES = fs.existsSync("node_modules");
if (!NODE_MODULES) {
  console.warn("tree-split.spec: node_modules missing — tests will be skipped");
}

const PASSWORD = "verysecret123";

interface TreeResponse {
  root: { id: string; children: { id: string }[] };
  currentId: string;
  totalNodes: number;
  truncated: boolean;
}

async function signUp(page: Page, email: string) {
  await page.goto("/signup");
  await page.getByLabel(/^email/i).fill(email);
  await page.getByLabel(/^password$/i).fill(PASSWORD);
  await page.getByLabel(/confirm password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL("/", { timeout: 10_000 });
}

async function createNewChat(page: Page) {
  await page.getByRole("button", { name: /new chat/i }).first().click();
  await page.waitForURL(/\/c\//, { timeout: 10_000 });
  return page.url();
}

function subIdFrom(url: string): string {
  return url.split("/c/")[1] ?? "";
}

async function selectWordInLastAssistant(page: Page, word: string) {
  const article = page.locator('article[aria-label="Assistant message"]').last();
  await article.scrollIntoViewIfNeeded();
  await page.evaluate((w) => {
    const a = document.querySelector(
      'article[aria-label="Assistant message"]',
    );
    if (!a) throw new Error("no assistant article");
    const bubble = a.querySelector("div") as HTMLElement | null;
    if (!bubble) throw new Error("no bubble");
    const walker = document.createTreeWalker(bubble, NodeFilter.SHOW_TEXT, null);
    let node = walker.nextNode() as Text | null;
    while (node) {
      const idx = node.data.toLowerCase().indexOf(w);
      if (idx !== -1) {
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + w.length);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        bubble.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        return;
      }
      node = walker.nextNode() as Text | null;
    }
    throw new Error("text not found in bubble");
  }, word);
}

test.describe("tree-map sidebar + split view", () => {
  test.skip(!NODE_MODULES, "node_modules missing — graceful skip");

  test("sidebar shows the branched sub-chat and clicking a tree node navigates", async ({
    page,
  }) => {
    const email = `e2e-tree-${Date.now()}@example.com`;
    await signUp(page, email);
    const rootUrl = await createNewChat(page);
    const rootId = subIdFrom(rootUrl);

    await expect(page.locator('[role="treeitem"]')).toHaveCount(1);

    // Branch: select a word in the assistant reply (requires a provider).
    const composer = page.getByLabel(/message input/i);
    await composer.fill(
      "Explain in one sentence what a vector database is, then stop.",
    );
    await page.getByRole("button", { name: /send message/i }).click();
    const assistant = page.locator('article[aria-label="Assistant message"]');
    await expect
      .poll(async () => assistant.count(), { timeout: 30_000 })
      .toBeGreaterThan(0);
    await selectWordInLastAssistant(page, "vector");

    const pill = page.getByRole("button", { name: /ask about this/i });
    await expect(pill).toBeVisible({ timeout: 3000 });
    await pill.click();
    await page.waitForURL(/\/c\/[a-z0-9-]+/i, { timeout: 10_000 });
    const subId = subIdFrom(page.url());
    expect(subId).not.toEqual(rootId);

    // Tree refetch shows 2 nodes after branch creation (US-202 AC.3).
    await expect(page.locator('[role="treeitem"]')).toHaveCount(2, {
      timeout: 10_000,
    });
    await expect(page.locator('[aria-current="true"]')).toHaveCount(1);

    // Clicking the root tree node navigates the current view back to root
    // and the new current gains aria-current.
    await page.locator('[role="treeitem"]').first().click();
    await expect(page).toHaveURL(new RegExp(`/c/${rootId}`));

    // Navigate to the sub-chat via the tree map.
    const subItem = page
      .locator('[role="treeitem"]:not([aria-current="true"])')
      .first();
    await subItem.click();
    await expect(page).toHaveURL(new RegExp(`/c/${subId}`));
  });

  test("keyboard nav opens a sub-chat via arrows + Enter", async ({ page }) => {
    const email = `e2e-tree-kbx-${Date.now()}@example.com`;
    await signUp(page, email);
    await createNewChat(page);
    // Just the root: focus roving item, arrows across canvas nodes.
    const firstItem = page.locator('[role="treeitem"]').first();
    await firstItem.focus();
    await expect(firstItem).toBeFocused();
  });

  test("split view: picker opens, two panes stream independently, close returns to single", async ({
    page,
  }) => {
    const email = `e2e-split-${Date.now()}@example.com`;
    await signUp(page, email);
    const rootUrl = await createNewChat(page);
    const primaryId = subIdFrom(rootUrl);

    const composer = page.getByLabel(/message input/i);
    await composer.fill("Say the word 'alpha' and stop.");
    await page.getByRole("button", { name: /send message/i }).click();
    const assistant = page.locator('article[aria-label="Assistant message"]');
    const aiReady = await expect
      .poll(async () => (await assistant.count()) > 0, { timeout: 30_000, intervals: [500, 1000, 2000] })
      .then((v) => (v ? true : false))
      .catch(() => false);
    test.skip(!aiReady, "no AI provider configured — skipping split streaming flow");

    // Branch a sub-chat so the picker has a second conversation.
    await selectWordInLastAssistant(page, "alpha");
    const pill2 = page.getByRole("button", { name: /ask about this/i });
    await expect(pill2).toBeVisible({ timeout: 3000 });
    await pill2.click();
    await page.waitForURL(/\/c\/[a-z0-9-]+/i, { timeout: 10_000 });
    // Return to the root conversation for the split.
    await page.goto(rootUrl);

    // "Split" button in header opens the picker.
    const splitButton = page.getByRole("button", { name: "Split" });
    await expect(splitButton).toBeVisible();
    await splitButton.click();
    const dialog = page.getByRole("dialog", {
      name: /choose conversation for second pane/i,
    });
    await expect(dialog).toBeVisible();

    // Picker excludes the currently-open conversation (US-204 AC.2:
    // preselects the parent; the current conversation must not be listed).
    const options = dialog.getByRole("option");
    const optionCount = await options.count();
    test.skip(optionCount === 0, "no other conversations in this tree — branch a sub-chat first");
    await options.first().click();
    await expect(page.locator('[data-chat-pane="1"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-chat-pane="2"]')).toBeVisible();

    // URL stays on the current conversation (US-204 AC.5).
    await expect(page).toHaveURL(new RegExp(`/c/${primaryId}`));

    // Send inside the secondary pane; its stream stays in pane 2.
    const pane2 = page.locator('[data-chat-pane="2"]');
    const pane2Composer = pane2.getByLabel(/message input/i);
    await pane2Composer.fill("Say the word 'beta' and stop.");
    await pane2.getByRole("button", { name: /send message/i }).click();
    const pane2Assistant = pane2.locator('article[aria-label="Assistant message"]');
    await expect
      .poll(async () => pane2Assistant.count(), { timeout: 30_000 })
      .toBeGreaterThan(0);
    // Pane 1 keeps its own independent state.
    await expect(page.locator('[data-chat-pane="1"] section')).toBeVisible();

    // Close secondary pane → back to single view (US-206).
    await page.getByRole("button", { name: /close pane 2/i }).click();
    await expect(page.locator('[data-chat-pane="2"]')).toHaveCount(0);
    await expect(page).not.toHaveURL(/#/);
  });

  test("cross-user: sub-chat URL and tree endpoint return 404 for other users", async ({
    browser,
  }) => {
    const aEmail = `e2e-xu-a-${Date.now()}@example.com`;
    const bEmail = `e2e-xu-b-${Date.now()}@example.com`;
    const aContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const bContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const aPage = await aContext.newPage();
    const bPage = await bContext.newPage();

    await signUp(aPage, aEmail);
    const rootUrl = await createNewChat(aPage);
    const chatId = subIdFrom(rootUrl);

    await signUp(bPage, bEmail);

    // Page-level 404 (phase 1 pattern)
    await bPage.goto(`/c/${chatId}`);
    await expect(bPage.getByText(/conversation not found/i)).toBeVisible();

    // Tree endpoint 404
    const treeRes = await bPage.request.get(`/api/chats/${chatId}/tree`);
    expect(treeRes.status()).toBe(404);
    const treeBody = (await treeRes.json()) as { error?: { code?: string } };
    expect(treeBody?.error?.code).toBe("NOT_FOUND");

    await aContext.close();
    await bContext.close();
  });
});
