const { test, expect, devices } = require("@playwright/test");
const { loginFast } = require("./helpers");

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
