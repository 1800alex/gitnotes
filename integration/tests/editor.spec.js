// Editor essentials: the markdown insert menu and the Ctrl+S save shortcut.
const { test, expect } = require("@playwright/test");
const { loginFast, apiContext, noteContent } = require("./helpers");

test.beforeEach(async ({ page, baseURL }) => {
  await loginFast(page, baseURL, "admin");
});

test("insert menu wraps the selection in bold", async ({ page }) => {
  await page.click('.note-item[data-path="welcome.md"]');
  const ta = page.locator("[data-textarea]");
  await ta.fill("hello"); // in-memory only (not saved) — leaves the file intact
  await ta.selectText();
  await page.click("[data-insert-menu]");
  await page.click('[data-insert="bold"]');
  await expect(ta).toHaveValue(/\*\*hello\*\*/);
});

test("Ctrl+S saves the current note", async ({ page, baseURL }) => {
  await page.click('.note-item[data-path="notes/reading-list.md"]');
  const marker = "ctrl-s-" + Date.now();
  const ta = page.locator("[data-textarea]");
  await expect(ta).toHaveValue(/Reading list/); // wait for the note to load before appending
  await ta.fill((await ta.inputValue()) + "\n" + marker);
  await page.keyboard.press("Control+s");
  const { ctx } = await apiContext(baseURL, "admin");
  await expect
    .poll(() => noteContent(ctx, "notes/reading-list.md"), { timeout: 8_000 })
    .toContain(marker);
  await ctx.dispose();
});
