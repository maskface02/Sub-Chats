import { test, expect, type Page } from "@playwright/test";

const PASSWORD = "verysecret123";

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

async function sendAndWaitForAssistant(
  page: Page,
  prompt: string,
  expectedReply: string,
) {
  const composer = page.getByLabel(/message input/i);
  await composer.fill(prompt);
  await page.getByRole("button", { name: /send message/i }).click();

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

  if (await noProvider.isVisible().catch(() => false)) {
    return false;
  }

  await expect
    .poll(async () => (await assistant.last().innerText()).includes(expectedReply), {
      timeout: 30_000,
      intervals: [500, 1000, 2000],
    })
    .toBe(true);
  return true;
}

test.describe("sub-chat branching", () => {
  test("user can branch from assistant text and sees banner + breadcrumb", async ({
    page,
    context,
  }) => {
    const email = `e2e-branch-${Date.now()}@example.com`;
    await signUp(page, email);
    const rootUrl = await createNewChat(page);
    const rootId = rootUrl.split("/c/")[1]!;

    const aiReady = await sendAndWaitForAssistant(
      page,
      "Explain in one sentence what a vector database is, then stop.",
      "vector",
    );

    test.skip(!aiReady, "no AI provider configured — skipping branch flow");

    // Find the assistant message and select a non-empty span inside it
    const assistant = page.locator('article[aria-label="Assistant message"]').last();
    const target = assistant.locator("div", { hasText: /vector/i }).first();
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    // Programmatically select the word "vector" inside the bubble via DOM API
    await page.evaluate(() => {
      const article = document.querySelector(
        'article[aria-label="Assistant message"]',
      );
      if (!article) throw new Error("no assistant article");
      const bubble = article.querySelector("div") as HTMLElement | null;
      if (!bubble) throw new Error("no bubble");
      const walker = document.createTreeWalker(bubble, NodeFilter.SHOW_TEXT, null);
      let node = walker.nextNode() as Text | null;
      while (node) {
        const idx = node.data.toLowerCase().indexOf("vector");
        if (idx !== -1) {
          const range = document.createRange();
          range.setStart(node, idx);
          range.setEnd(node, idx + "vector".length);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
          bubble.dispatchEvent(
            new MouseEvent("mouseup", { bubbles: true }),
          );
          return;
        }
        node = walker.nextNode() as Text | null;
      }
      throw new Error("text not found in bubble");
    });

    // Pill should appear
    const pill = page.getByRole("button", { name: /ask about this/i });
    await expect(pill).toBeVisible({ timeout: 3000 });
    await pill.click();

    // Navigate to the new sub-chat
    await page.waitForURL(/\/c\/[a-z0-9-]+/i, { timeout: 5000 });
    const subUrl = page.url();
    const subId = subUrl.split("/c/")[1]!;
    expect(subId).not.toEqual(rootId);

    // Banner with the highlight is visible
    const banner = page.getByTestId("parent-context-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/vector/i);

    // Breadcrumb has 3 levels (Home / Root / Sub)
    const breadcrumb = page.getByTestId("breadcrumb");
    await expect(breadcrumb).toBeVisible();
    const crumbCount = await breadcrumb.locator("li").count();
    expect(crumbCount).toBeGreaterThanOrEqual(3);

    // Composer placeholder is the sub-chat variant
    const composer = page.getByLabel(/message input/i);
    await expect(composer).toHaveAttribute(
      "placeholder",
      /Ask about.*vector.*…/i,
    );

    // Send a message in the sub-chat
    const subAiReady = await sendAndWaitForAssistant(
      page,
      "What about FAISS?",
      "FAISS",
    );
    test.skip(!subAiReady, "no AI provider configured — skipping sub-chat reply");

    // The sub-chat has at least one user + one assistant message
    const userMsgs = page.locator('article[aria-label="User message"]');
    const assistantMsgs = page.locator('article[aria-label="Assistant message"]');
    expect(await userMsgs.count()).toBeGreaterThanOrEqual(1);
    expect(await assistantMsgs.count()).toBeGreaterThanOrEqual(1);

    // Reload the root and confirm the sub-chat reply did NOT land on the parent
    await page.goto(`/c/${rootId}`);
    const rootAssistant = page.locator(
      'article[aria-label="Assistant message"]',
    );
    const rootAssistantTexts = await rootAssistant.allInnerTexts();
    for (const t of rootAssistantTexts) {
      expect(t).not.toContain("FAISS");
    }
    await context.close();
  });

  test("cross-user 404 on a sub-chat", async ({ browser }) => {
    const ownerCtx = await browser.newContext();
    const owner = await ownerCtx.newPage();
    const ownerEmail = `e2e-owner-${Date.now()}@example.com`;
    await signUp(owner, ownerEmail);
    const rootUrl = await createNewChat(owner);
    const rootId = rootUrl.split("/c/")[1]!;
    const aiReady = await sendAndWaitForAssistant(
      owner,
      "Say exactly the word PONG.",
      "PONG",
    );
    test.skip(!aiReady, "no AI provider configured — skipping cross-user 404 test");

    // Programmatic branch via the public API using a manual fetch from the
    // owner context, then sign in as a different user in another context.
    const branchJson = await owner.evaluate(async (root: string) => {
      const article = document.querySelector(
        'article[aria-label="Assistant message"]',
      );
      const bubble = article?.querySelector("div");
      if (!bubble) throw new Error("no bubble");
      let messageId = "";
      let charStart = 0;
      let charEnd = 0;
      let selectedText = "PONG";
      const walker = document.createTreeWalker(bubble, NodeFilter.SHOW_TEXT, null);
      let node = walker.nextNode() as Text | null;
      while (node) {
        const idx = node.data.indexOf("PONG");
        if (idx !== -1) {
          messageId =
            (article as HTMLElement).getAttribute("data-message-id") ?? "";
          charStart = idx;
          charEnd = idx + "PONG".length;
          break;
        }
        node = walker.nextNode() as Text | null;
      }
      const res = await fetch(`/api/chats/${root}/branch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messageId, selectedText, charStart, charEnd }),
      });
      if (!res.ok) throw new Error(`branch failed: ${res.status}`);
      return (await res.json()) as { id: string };
    }, rootId);
    const subId = branchJson.id;

    // Sign in as a different user in a fresh context
    const otherCtx = await browser.newContext();
    const other = await otherCtx.newPage();
    const otherEmail = `e2e-other-${Date.now()}@example.com`;
    await signUp(other, otherEmail);
    await other.goto(`/c/${subId}`);
    await expect(other.getByText(/conversation not found/i)).toBeVisible({
      timeout: 10_000,
    });
    await ownerCtx.close();
    await otherCtx.close();
  });
});
