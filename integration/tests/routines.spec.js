// Routines (recurring chores): the typed view + its round-trips to git, and the
// Agenda surfacing recurring items resolved to their next occurrence.
// The seed anchors interval chores with `since:<today>` so due dates are stable.
const { test, expect } = require("@playwright/test");
const { loginFast, apiContext, noteContent } = require("./helpers");

const HOME = "routines/home.md";

test.beforeEach(async ({ page, baseURL }) => {
  await loginFast(page, baseURL, "admin");
});

test("routines note opens in Routines mode with chores + schedules", async ({ page }) => {
  await page.click(`.note-item[data-path="${HOME}"]`);
  await expect(page.locator("[data-routines-pane]")).toBeVisible();
  expect(await page.locator(".routine-item").count()).toBeGreaterThanOrEqual(5);

  // The weekday chore shows a human recurrence label…
  const trash = page.locator(".routine-item", { hasText: "Take out the trash" });
  await expect(trash.locator(".routine-rec")).toContainText("every Tue");
  // …and the 6-week chore, anchored at today, is due today.
  const softener = page.locator(".routine-item", { hasText: "water softener" });
  await expect(softener.locator(".routine-meta")).toContainText("today");
});

test("agenda surfaces recurring chores with a repeat badge", async ({ page }) => {
  await page.click("[data-agenda-open]");
  await expect(page.locator("[data-agenda-pane]")).toBeVisible();
  await expect(page.locator(".agenda-item").first()).toBeVisible({ timeout: 10_000 });

  // The water-softener chore (every 6 weeks, anchored today → due today) appears
  // as a recurring row with the ↻ badge and its rule in the meta line.
  const row = page.locator(".agenda-item.recurring", { hasText: "water softener" });
  await expect(row).toBeVisible();
  await expect(row.locator(".agenda-recur")).toBeVisible();
  await expect(row).toContainText("every 6 weeks");
});

test("adding a chore via the picker persists an every: token", async ({ page, baseURL }) => {
  const name = "itest chore " + Date.now();
  await page.click(`.note-item[data-path="${HOME}"]`);
  await expect(page.locator("[data-routines-pane]")).toBeVisible();

  await page.fill("[data-routines-input]", name);
  await page.locator("[data-routines-picker] .rec-preset").selectOption("fri");
  await page.locator(".routines-add button[type=submit]").click();
  await page.click("[data-save]");

  const { ctx } = await apiContext(baseURL, "admin");
  await expect
    .poll(() => noteContent(ctx, HOME), { timeout: 10_000 })
    .toMatch(new RegExp("- \\[ \\] " + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " every:fri"));
  await ctx.dispose();
});

test("renaming a chore keeps its recurrence and paused state", async ({ page, baseURL }) => {
  const name = "Rotate wheels " + Date.now();
  await page.click(`.note-item[data-path="${HOME}"]`);
  await expect(page.locator("[data-routines-pane]")).toBeVisible();

  // The seeded paused chore is the only .paused row.
  const row = page.locator(".routine-item.paused");
  await row.locator(".routine-text").click();
  await row.locator(".routine-edit").fill(name);
  await row.locator(".routine-edit").press("Enter");
  await page.click("[data-save]");

  const { ctx } = await apiContext(baseURL, "admin");
  await expect
    .poll(() => noteContent(ctx, HOME), { timeout: 10_000 })
    .toMatch(new RegExp("- \\[x\\] " + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " every:6m"));
  await ctx.dispose();
});

test("changing a chore's schedule persists the new rule", async ({ page, baseURL }) => {
  await page.click(`.note-item[data-path="${HOME}"]`);
  await expect(page.locator("[data-routines-pane]")).toBeVisible();

  const row = page.locator(".routine-item", { hasText: "Take out the trash" });
  await row.locator(".routine-rec").click();
  await row.locator(".routine-rec-edit .rec-preset").selectOption("2w");
  await row.getByRole("button", { name: "Save" }).click();
  await page.click("[data-save]");

  const { ctx } = await apiContext(baseURL, "admin");
  await expect
    .poll(() => noteContent(ctx, HOME), { timeout: 10_000 })
    .toMatch(/- \[ \] Take out the trash every:2w/);
  await ctx.dispose();
});

test("pausing a chore checks it off (and drops it from the Agenda)", async ({ page, baseURL }) => {
  await page.click(`.note-item[data-path="${HOME}"]`);
  await expect(page.locator("[data-routines-pane]")).toBeVisible();

  const row = page.locator(".routine-item", { hasText: "Water the plants" });
  await row.locator(".routine-pause").click();
  await expect(row).toHaveClass(/paused/);
  await page.click("[data-save]");

  const { ctx } = await apiContext(baseURL, "admin");
  await expect
    .poll(() => noteContent(ctx, HOME), { timeout: 10_000 })
    .toMatch(/- \[x\][^\n]*Water the plants every:/);
  await ctx.dispose();
});

test("deleting a chore removes its line from git", async ({ page, baseURL }) => {
  page.on("dialog", (d) => d.accept()); // confirm() on delete
  await page.click(`.note-item[data-path="${HOME}"]`);
  await expect(page.locator("[data-routines-pane]")).toBeVisible();

  const row = page.locator(".routine-item", { hasText: "Replace the HVAC filter" });
  await row.locator(".routine-del").click();
  await expect(page.locator(".routine-item", { hasText: "Replace the HVAC filter" })).toHaveCount(0);
  await page.click("[data-save]");

  const { ctx } = await apiContext(baseURL, "admin");
  await expect
    .poll(() => noteContent(ctx, HOME), { timeout: 10_000 })
    .not.toContain("Replace the HVAC filter");
  await ctx.dispose();
});
