const { test, expect, devices } = require("@playwright/test");
const { loginFast, isoWeekStr } = require("./helpers");

// Run this file's tests at a phone viewport — the app is mobile-first and the
// sidebar becomes an off-canvas drawer.
test.use({ ...devices["Pixel 5"] });

test.beforeEach(async ({ page, baseURL }) => {
  await loginFast(page, baseURL, "admin");
});

test("sidebar is a drawer that opens, then closes on note open", async ({ page }) => {
  const body = page.locator("body");
  await expect(body).not.toHaveClass(/sidebar-open/);

  await page.click("[data-sidebar-toggle]");
  await expect(body).toHaveClass(/sidebar-open/);

  await page.click('.note-item[data-path="welcome.md"]');
  await expect(body).not.toHaveClass(/sidebar-open/); // opening a note closes the drawer
  await expect(page.locator("[data-textarea]")).toHaveValue(/Welcome/);
});

test("planner is usable on a phone viewport", async ({ page }) => {
  await page.click("[data-new-menu]");
  await page.click('[data-new-kind="planner"]');
  await expect(page.locator("[data-planner-pane]")).toBeVisible();
  await expect(page.locator(".planner-day")).toHaveCount(7);
});

// --- mobile layout regressions ---

test("every header action fits within the viewport (Save is reachable)", async ({ page }) => {
  const vw = page.viewportSize().width;
  const buttons = page.locator(".app-header-actions .button:visible");
  const n = await buttons.count();
  expect(n).toBeGreaterThan(3);
  for (let i = 0; i < n; i++) {
    const box = await buttons.nth(i).boundingBox();
    expect(box, `button ${i} has a box`).not.toBeNull();
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width, `button ${i} right edge on-screen`).toBeLessThanOrEqual(vw + 1);
  }
  const save = await page.locator("[data-save]").boundingBox();
  expect(save.x + save.width).toBeLessThanOrEqual(vw + 1);
});

test("a content-rich view stays on-screen and scrolls internally (Agenda)", async ({ page }) => {
  const vh = page.viewportSize().height;
  await page.click("[data-agenda-open]");
  const scroll = page.locator("[data-agenda-list]");
  await expect(page.locator(".agenda-item").first()).toBeVisible({ timeout: 10_000 });

  const box = await scroll.boundingBox();
  expect(box.y + box.height, "agenda scroll bottom within viewport").toBeLessThanOrEqual(vh + 1);
  // If content overflows, the container must actually scroll (the bug: it didn't).
  const info = await scroll.evaluate((el) => {
    el.scrollTop = 99999;
    return { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
  });
  if (info.scrollHeight > info.clientHeight + 1) expect(info.scrollTop).toBeGreaterThan(0);
});

test("the meal-plan view scrolls and its toolbox menu opens on-screen", async ({ page }) => {
  const vw = page.viewportSize().width;
  const vh = page.viewportSize().height;
  await page.click("[data-sidebar-toggle]");
  await page.click(`.note-item[data-path="meal-plans/${isoWeekStr()}.md"]`);
  await expect(page.locator("[data-mealplan-pane]")).toBeVisible();

  const scroll = page.locator("[data-mealplan-grid]");
  const box = await scroll.boundingBox();
  expect(box.y + box.height, "meal-plan scroll bottom within viewport").toBeLessThanOrEqual(vh + 1);

  // The toolbox pop-out must not run off the edge (the reported bug).
  await page.click("[data-insert-menu]");
  const menu = page.locator("[data-insert-dropdown]");
  await expect(menu).toBeVisible();
  const mb = await menu.boundingBox();
  expect(mb.x, "menu left on-screen").toBeGreaterThanOrEqual(-1);
  expect(mb.x + mb.width, "menu right on-screen").toBeLessThanOrEqual(vw + 1);
});
