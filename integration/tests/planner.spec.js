const { test, expect } = require("@playwright/test");
const { loginFast, apiContext, noteContent, isoWeekStr } = require("./helpers");

test.beforeEach(async ({ page, baseURL }) => {
  await loginFast(page, baseURL, "admin");
});

async function openThisWeek(page) {
  await page.click("[data-new-menu]");
  await page.click('[data-new-kind="planner"]');
  await expect(page.locator("[data-planner-pane]")).toBeVisible();
}

test("planner shows seven day cards for the week", async ({ page }) => {
  await openThisWeek(page);
  await expect(page.locator(".planner-day")).toHaveCount(7);
  await expect(page.locator(".planner-day-name").first()).toHaveText("Monday");
  await expect(page.getByText("Team standup")).toBeVisible(); // seeded task
});

test("checking a task persists as [x] in git", async ({ page, baseURL }) => {
  const path = `planner/${isoWeekStr()}.md`;
  await openThisWeek(page);
  const row = page.locator(".planner-task", { hasText: "Plan the week" });
  await row.locator(".planner-check").click();
  await page.click("[data-save]");

  const { ctx } = await apiContext(baseURL, "admin");
  await expect
    .poll(async () => await noteContent(ctx, path), { timeout: 10_000 })
    .toMatch(/- \[x\][^\n]*Plan the week/);
  await ctx.dispose();
});

test("adding a task to a day persists", async ({ page, baseURL }) => {
  const path = `planner/${isoWeekStr()}.md`;
  const task = "itest planner task " + Date.now();
  await openThisWeek(page);
  const monday = page.locator(".planner-day", { hasText: "Monday" }).first();
  await monday.locator(".planner-add input").fill(task);
  await monday.locator(".planner-add button").click();
  await page.click("[data-save]");

  const { ctx } = await apiContext(baseURL, "admin");
  await expect
    .poll(async () => await noteContent(ctx, path), { timeout: 10_000 })
    .toContain(task);
  await ctx.dispose();
});
