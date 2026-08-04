const { test, expect } = require("@playwright/test");
const { loginFast, apiContext, noteContent } = require("./helpers");

test.beforeEach(async ({ page, baseURL }) => {
  await loginFast(page, baseURL, "admin");
});

test("lists all seeded notes", async ({ page }) => {
  // The seed writes 14 note files; other specs may add more to the shared repo,
  // so assert the seeded set is present rather than an exact count.
  await expect(page.locator('.note-item[data-path="welcome.md"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.note-item[data-path="recipes/sheet-pan-chicken.md"]')).toBeVisible();
  await expect(page.locator('.note-item[data-path="checklists/groceries.md"]')).toBeVisible();
  expect(await page.locator("[data-note-list] .note-item").count()).toBeGreaterThanOrEqual(14);
});

test("opens a note and shows its content", async ({ page }) => {
  await page.click('.note-item[data-path="welcome.md"]');
  await expect(page.locator("[data-textarea]")).toHaveValue(/Welcome/);
});

test("edits a note and the change is committed to git", async ({ page, baseURL }) => {
  const marker = "itest-marker-" + Date.now();
  await page.click('.note-item[data-path="notes/reading-list.md"]');
  const ta = page.locator("[data-textarea]");
  await expect(ta).toHaveValue(/Reading list/);
  await ta.fill((await ta.inputValue()) + "\n\n" + marker);
  await page.click("[data-save]");

  const { ctx } = await apiContext(baseURL, "admin");
  await expect
    .poll(async () => await noteContent(ctx, "notes/reading-list.md"), { timeout: 10_000 })
    .toContain(marker);
  await ctx.dispose();
});

test("filtering narrows the note list", async ({ page }) => {
  await page.fill("[data-filter]", "recipes/");
  const items = page.locator("[data-note-list] .note-item");
  // ≥3 seeded recipes (other specs may add more); every visible item is a recipe.
  expect(await items.count()).toBeGreaterThanOrEqual(3);
  const paths = await items.evaluateAll((els) => els.map((e) => e.getAttribute("data-path")));
  expect(paths.every((p) => p.startsWith("recipes/"))).toBe(true);
});
