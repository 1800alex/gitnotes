const { test, expect } = require("@playwright/test");
const { loginFast } = require("./helpers");

test.beforeEach(async ({ page, baseURL }) => {
  await loginFast(page, baseURL, "admin");
});

test("auto-sync can be disabled and the delay changed (persisted)", async ({ page }) => {
  await page.click("[data-settings]");
  const pop = page.locator(".settings-pop");
  await expect(pop).toBeVisible();

  // Turn auto-sync off.
  await pop.locator(".settings-toggle input").uncheck();
  expect(await page.evaluate(() => localStorage.getItem("notes.autosync"))).toBe("off");

  // Re-enable and change the idle delay.
  await pop.locator(".settings-toggle input").check();
  expect(await page.evaluate(() => localStorage.getItem("notes.autosync"))).toBe("on");
  await pop.locator(".settings-secs").fill("30");
  await pop.locator(".settings-secs").blur();
  expect(await page.evaluate(() => localStorage.getItem("notes.autosyncSecs"))).toBe("30");
});

test("the setting survives a reload", async ({ page }) => {
  await page.click("[data-settings]");
  await page.locator(".settings-pop .settings-toggle input").uncheck();
  await page.reload();
  await page.waitForSelector("[data-note-list] .note-item", { state: "attached" });
  await page.click("[data-settings]");
  await expect(page.locator(".settings-pop .settings-toggle input")).not.toBeChecked();
});
