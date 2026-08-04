// Creating notes from the header "New" menu: typed scaffolds open in their view
// and persist. Covers the prompt-driven kinds (recipe, note) and meeting.
const { test, expect } = require("@playwright/test");
const { loginFast, apiContext, noteContent, todayStr } = require("./helpers");

test.beforeEach(async ({ page, baseURL }) => {
  await loginFast(page, baseURL, "admin");
});

test("New → Recipe scaffolds a recipe note and persists", async ({ page, baseURL }) => {
  page.once("dialog", (d) => d.accept("Test Recipe"));
  await page.click("[data-new-menu]");
  await page.click('[data-new-kind="recipe"]');
  await expect(page.locator("[data-recipe-pane]")).toBeVisible();
  await expect(page.locator(".recipe-title")).toContainText("Test Recipe");
  await page.click("[data-save]");

  const { ctx } = await apiContext(baseURL, "admin");
  await expect
    .poll(() => noteContent(ctx, "recipes/test-recipe.md"), { timeout: 8_000 })
    .toContain("type: recipe");
  await ctx.dispose();
});

test("New → Meeting scaffolds today's meeting and persists on edit", async ({ page, baseURL }) => {
  await page.click("[data-new-menu]");
  await page.click('[data-new-kind="meeting"]');
  await expect(page.locator("[data-meeting-pane]")).toBeVisible();
  // A freshly-scaffolded planner/meeting isn't saved until edited — add an action.
  await page.locator(".mtg-add input").fill("Kickoff task");
  await page.locator(".mtg-add button").click();
  await page.click("[data-save]");

  const path = `meetings/${todayStr()}-meeting.md`;
  const { ctx } = await apiContext(baseURL, "admin");
  await expect.poll(() => noteContent(ctx, path), { timeout: 8_000 }).toContain("Kickoff task");
  await ctx.dispose();
});

test("New → Note prompts for a path and opens the editor", async ({ page }) => {
  page.once("dialog", (d) => d.accept("notes/from-menu.md"));
  await page.click("[data-new-menu]");
  await page.click('[data-new-kind="note"]');
  await expect(page.locator("[data-editor-pane]")).toBeVisible();
  await expect(page.locator("[data-current-path]")).toContainText("notes/from-menu.md");
});
