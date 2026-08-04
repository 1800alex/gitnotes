const { test, expect } = require("@playwright/test");
const { loginUI } = require("./helpers");

test.describe("auth", () => {
  test("rejects bad credentials", async ({ page }) => {
    await page.goto("/login/");
    await page.fill("#username", "admin");
    await page.fill("#password", "definitely-wrong");
    await page.click("[data-submit]");
    await expect(page.locator("[data-error]")).toBeVisible();
    expect(page.url()).toContain("/login");
  });

  test("logs in as admin and lists notes", async ({ page }) => {
    await loginUI(page, "admin");
    await expect(page.locator('.note-item[data-path="welcome.md"]')).toBeVisible();
    expect(page.url()).not.toContain("/login");
  });

  test("a second account (user/user) can also sign in", async ({ page }) => {
    await loginUI(page, "user");
    await expect(page.locator("[data-note-list] .note-item").first()).toBeAttached();
  });

  test("session persists across reload", async ({ page }) => {
    await loginUI(page, "admin");
    await page.reload();
    await expect(page.locator("[data-note-list] .note-item").first()).toBeAttached();
    expect(page.url()).not.toContain("/login");
  });

  test("sign out returns to the login page", async ({ page }) => {
    await loginUI(page, "admin");
    await page.click("[data-logout]");
    await page.waitForURL(/\/login\//);
    await expect(page.locator("[data-login-form]")).toBeVisible();
  });
});
