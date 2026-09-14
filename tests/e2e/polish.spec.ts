import { test, expect, type Page } from "@playwright/test";

const TEST_PASSWORD = "verysecret123";

let counter = 0;
function uniqueEmail(): string {
  counter += 1;
  return `e2e-polish-${Date.now()}-${counter}@example.com`;
}

async function signUpAndCreateChat(page: Page, email: string): Promise<void> {
  await page.goto("/signup");
  await page.getByLabel(/^email/i).fill(email);
  await page.getByLabel(/^password$/i).fill(TEST_PASSWORD);
  await page.getByLabel(/confirm password/i).fill(TEST_PASSWORD);
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL("/", { timeout: 10000 });
  await page.getByRole("button", { name: /new chat/i }).first().click();
  await page.waitForURL(/\/c\//, { timeout: 10000 });
}

test.describe("phase 4 polish", () => {
  test("delete with undo restores the chat; delete without undo removes it", async ({
    page,
  }) => {
    await signUpAndCreateChat(page, uniqueEmail());

    // delete via header overflow menu → confirm
    await page.getByRole("button", { name: "Conversation menu" }).click();
    await page.getByRole("menuitem", { name: "Delete conversation" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("This can be undone for a few seconds");
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();

    // root deleted → navigates home; undo toast appears
    await page.waitForURL((u) => !u.pathname.startsWith("/c/"), {
      timeout: 5000,
    });
    const toast = page.locator('[data-testid="toast"]');
    await expect(toast).toContainText("Chat deleted");

    // undo → the conversation is restored to the list
    await toast.getByRole("button", { name: "Undo" }).click();
    await expect(
      page.getByRole("link", { name: /new chat/i }).first(),
    ).toBeVisible({ timeout: 5000 });

    // delete again and let the undo window lapse
    await page.getByRole("link", { name: /new chat/i }).first().click();
    await page.waitForURL(/\/c\//);
    await page.getByRole("button", { name: "Conversation menu" }).click();
    await page.getByRole("menuitem", { name: "Delete conversation" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Delete", exact: true })
      .click();
    await page.waitForURL((u) => !u.pathname.startsWith("/c/"), {
      timeout: 5000,
    });

    // toast flips to "Deleted" (disabled undo) and dismisses
    await expect(toast).toContainText("Deleted", { timeout: 6000 });
    await expect(toast).toHaveCount(0, { timeout: 9000 });
    await expect(page.getByRole("link", { name: /new chat/i })).toHaveCount(0);
  });

  test("export as markdown downloads a file", async ({ page }) => {
    await signUpAndCreateChat(page, uniqueEmail());

    await page.getByRole("button", { name: "Conversation menu" }).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: "Export as Markdown" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.md$/);
  });

  test("stop button appears while streaming and leaves a Stopped chip", async ({
    page,
  }) => {
    await signUpAndCreateChat(page, uniqueEmail());

    await page.getByLabel("Message input").fill("Count slowly to ten");
    await page.getByRole("button", { name: "Send message" }).click();

    const stop = page.getByRole("button", { name: "Stop generating" });
    const noProvider = page.getByText(/no ai provider configured/i);

    let streaming = false;
    try {
      await stop.waitFor({ state: "visible", timeout: 8000 });
      // Wait for the streaming caret so the abort happens mid-stream and the
      // partial content (and chip) is guaranteed to exist.
      await page.locator(".streaming-caret").first().waitFor({
        state: "visible",
        timeout: 10000,
      });
      streaming = true;
    } catch {
      if (await noProvider.isVisible().catch(() => false)) {
        test.skip(true, "AI provider unavailable — stop flow skipped");
        return;
      }
      throw new Error("Neither streaming nor the no-provider banner appeared");
    }

    await stop.click();
    // Partial content stays and the ephemeral Stopped chip appears; the
    // composer returns to ready with the Send button.
    await expect(page.getByText("Stopped", { exact: true })).toBeVisible({
      timeout: 5000,
    });
    await expect(
      page.getByRole("button", { name: "Send message" }),
    ).toBeVisible();
  });

  test("shortcut overlay opens with ? and closes with Esc", async ({
    page,
  }) => {
    await signUpAndCreateChat(page, uniqueEmail());

    await page.keyboard.press("?");
    const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("kbd").first()).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("/ focuses tree search, filters, Esc clears", async ({ page }) => {
    await signUpAndCreateChat(page, uniqueEmail());

    // desktop sidebar is visible at the default 1280x720 viewport
    const search = page.getByRole("searchbox", { name: "Search tree" });
    await expect(search).toBeVisible();

    await page.keyboard.press("/");
    await expect(search).toBeFocused();

    await search.fill("zzz-no-match-zzz");
    await expect(page.getByText(/no conversations match/i)).toBeVisible({
      timeout: 3000,
    });
    await expect(
      page.getByRole("button", { name: "Clear search" }),
    ).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(search).toHaveValue("");
    await expect(page.getByText(/no conversations match/i)).toHaveCount(0);
  });
});
