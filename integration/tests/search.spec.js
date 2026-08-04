// Full-text search: the server greps the working tree and the UI shows matching
// notes/lines; clicking a line opens the note at that line. Searches stable seed
// content (recipes/veggie-chili.md) that no other spec mutates.
const { test, expect } = require("@playwright/test");
const { loginFast } = require("./helpers");

test.beforeEach(async ({ page, baseURL }) => {
  await loginFast(page, baseURL, "admin");
});

test("searching finds notes by content and lists matching lines", async ({ page }) => {
  await page.click("[data-search-open]");
  await expect(page.locator("[data-search-pane]")).toBeVisible();

  await page.fill("[data-search-input]", "chili");
  // veggie-chili.md matches by path (title) and by content.
  const note = page.locator(".search-note", { hasText: "recipes/veggie-chili.md" });
  await expect(note).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".search-line").first()).toBeVisible();
  await expect(page.locator(".search-snippet mark").first()).toBeVisible(); // match highlighted
  await expect(page.locator("[data-search-sub]")).toContainText("note");
});

test("a one-character query does not run", async ({ page }) => {
  await page.click("[data-search-open]");
  await page.fill("[data-search-input]", "c");
  await expect(page.locator("[data-search-sub]")).toContainText("Keep typing");
  await expect(page.locator(".search-note")).toHaveCount(0);
});

test("a non-matching query reports no matches", async ({ page }) => {
  await page.click("[data-search-open]");
  await page.fill("[data-search-input]", "zznomatchzz");
  await expect(page.locator("[data-search-results]")).toContainText("Nothing matched", { timeout: 10_000 });
});

test("clicking a result opens the note at that line in Edit mode", async ({ page }) => {
  await page.click("[data-search-open]");
  await page.fill("[data-search-input]", "chili");
  await page.locator(".search-note", { hasText: "recipes/veggie-chili.md" }).waitFor();
  await page.locator(".search-line").first().click();

  // Lands in the editor (Edit mode forced) with the matching content loaded.
  await expect(page.locator("[data-search-pane]")).toBeHidden();
  const ta = page.locator("[data-textarea]");
  await expect(ta).toBeVisible();
  await expect(ta).toHaveValue(/chili/i);
});
