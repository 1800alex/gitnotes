const { test, expect } = require("@playwright/test");
const { loginFast, apiContext, noteContent, isoWeekStr } = require("./helpers");

test.beforeEach(async ({ page, baseURL }) => {
  await loginFast(page, baseURL, "admin");
});

test("recipe view shows meta chips and ingredients", async ({ page }) => {
  await page.click('.note-item[data-path="recipes/sheet-pan-chicken.md"]');
  await expect(page.locator("[data-recipe-pane]")).toBeVisible();
  await expect(page.locator(".recipe-title")).toContainText("Sheet-pan chicken");
  await expect(page.locator(".recipe-chip", { hasText: "servings" })).toBeVisible();
  await expect(page.getByText("4 chicken thighs")).toBeVisible();
});

test("ticking an ingredient persists", async ({ page, baseURL }) => {
  await page.click('.note-item[data-path="recipes/sheet-pan-chicken.md"]');
  await expect(page.locator("[data-recipe-pane]")).toBeVisible();
  await page.locator(".recipe-ing", { hasText: "chicken thighs" }).locator(".recipe-check").click();
  await page.click("[data-save]");

  const { ctx } = await apiContext(baseURL, "admin");
  await expect
    .poll(async () => await noteContent(ctx, "recipes/sheet-pan-chicken.md"), { timeout: 10_000 })
    .toMatch(/- \[x\][^\n]*chicken thighs/);
  await ctx.dispose();
});

test("meal plan renders day cards and links recipes", async ({ page }) => {
  const week = isoWeekStr();
  await page.click(`.note-item[data-path="meal-plans/${week}.md"]`);
  await expect(page.locator("[data-mealplan-pane]")).toBeVisible();
  await expect(page.locator(".mp-day").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Sheet-pan chicken" }).first()).toBeVisible();
});

test("shopping list is generated from the linked recipes", async ({ page, baseURL }) => {
  const week = isoWeekStr();
  await page.click(`.note-item[data-path="meal-plans/${week}.md"]`);
  await expect(page.locator("[data-mealplan-pane]")).toBeVisible();
  await page.click("[data-mealplan-shop]");

  const { ctx } = await apiContext(baseURL, "admin");
  const shopPath = `meal-plans/${week}-shopping.md`;
  await expect
    .poll(async () => await noteContent(ctx, shopPath), { timeout: 15_000 })
    .toMatch(/- \[ \] .+/); // at least one aggregated ingredient
  const body = await noteContent(ctx, shopPath);
  expect(body).toContain("Shopping list");
  await ctx.dispose();
});

test("the cell picker assigns a recipe to a meal slot", async ({ page, baseURL }) => {
  const week = isoWeekStr();
  await page.click(`.note-item[data-path="meal-plans/${week}.md"]`);
  await expect(page.locator("[data-mealplan-pane]")).toBeVisible();

  // Use Monday (top card) so the fixed picker opens within the viewport. Its
  // breakfast is Overnight oats in the seed → switch it to Veggie Chili.
  const monday = page.locator(".mp-day", { hasText: "Monday" });
  await monday.locator(".mp-slot").first().locator(".mp-edit").click();
  await expect(page.locator(".cell-picker")).toBeVisible();
  await page.locator(".cell-picker-list button", { hasText: "Veggie Chili" }).click();
  await page.click("[data-save]");

  const { ctx } = await apiContext(baseURL, "admin");
  await expect
    .poll(() => noteContent(ctx, `meal-plans/${week}.md`), { timeout: 8_000 })
    .toMatch(/\|\s*Monday\s*\|[^\n]*veggie-chili\.md/);
  await ctx.dispose();
});
