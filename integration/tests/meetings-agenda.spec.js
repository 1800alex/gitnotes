const { test, expect } = require("@playwright/test");
const { loginFast, apiContext, noteContent, todayStr } = require("./helpers");

test.beforeEach(async ({ page, baseURL }) => {
  await loginFast(page, baseURL, "admin");
});

// The seed dates the standup at seed-time "today"; run.sh reseeds immediately
// before the suite, so todayStr() matches.
const standupPath = () => `meetings/${todayStr()}-team-standup.md`;

test("meeting view shows action items with due dates", async ({ page }) => {
  await page.click(`.note-item[data-path="${standupPath()}"]`);
  await expect(page.locator("[data-meeting-pane]")).toBeVisible();
  await expect(page.locator(".mtg-action").first()).toBeVisible();
  await expect(page.getByText("Draft Agenda spec")).toBeVisible();
  // at least one action carries a due date in its date input
  const withDue = await page.locator(".mtg-due").evaluateAll((els) =>
    els.some((e) => e.value && /^\d{4}-\d{2}-\d{2}$/.test(e.value))
  );
  expect(withDue).toBe(true);
});

test("adding an action item persists with its due date", async ({ page, baseURL }) => {
  const path = standupPath();
  const text = "itest follow-up " + Date.now();
  await page.click(`.note-item[data-path="${path}"]`);
  await expect(page.locator("[data-meeting-pane]")).toBeVisible();
  await page.locator(".mtg-add input").fill(`${text} due:2099-01-15 @alex !`);
  await page.locator(".mtg-add button").click();
  await page.click("[data-save]");

  const { ctx } = await apiContext(baseURL, "admin");
  await expect
    .poll(async () => await noteContent(ctx, path), { timeout: 10_000 })
    .toContain(`${text} due:2099-01-15 @alex !`);
  await ctx.dispose();
});

test("changing an action's due date persists", async ({ page, baseURL }) => {
  const path = standupPath();
  await page.click(`.note-item[data-path="${path}"]`);
  await expect(page.locator("[data-meeting-pane]")).toBeVisible();
  const row = page.locator(".mtg-action", { hasText: "Draft Agenda spec" });
  await row.locator(".mtg-due").fill("2099-12-25");
  await page.click("[data-save]");

  const { ctx } = await apiContext(baseURL, "admin");
  await expect
    .poll(() => noteContent(ctx, path), { timeout: 8_000 })
    .toContain("Draft Agenda spec due:2099-12-25");
  await ctx.dispose();
});

test("agenda aggregates due items and opens the source note", async ({ page }) => {
  await page.click("[data-agenda-open]");
  await expect(page.locator("[data-agenda-pane]")).toBeVisible();
  await expect(page.locator(".agenda-item").first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".agenda-group").first()).toBeVisible();
  await expect(page.locator("[data-agenda-sub]")).toContainText("due");

  const item = page.locator(".agenda-item", { hasText: "Draft Agenda spec" }).first();
  await expect(item).toBeVisible();
  await item.click();
  // clicking an agenda row opens its note (a meeting → meeting view)
  await expect(page.locator("[data-meeting-pane]")).toBeVisible();
});

test("agenda separates overdue from upcoming items", async ({ page }) => {
  await page.click("[data-agenda-open]");
  await expect(page.locator("[data-agenda-pane]")).toBeVisible();
  await expect(page.locator(".agenda-item").first()).toBeVisible({ timeout: 10_000 });
  // The seed has prior-week follow-ups (overdue) and future ones → ≥2 groups,
  // and an explicit Overdue group.
  expect(await page.locator(".agenda-group").count()).toBeGreaterThanOrEqual(2);
  await expect(page.locator(".agenda-group-overdue")).toBeVisible();
});
