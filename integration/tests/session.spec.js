// Session / auth-boundary behavior: an invalid or no-longer-valid token must
// produce a 401 that the client turns into "clear token + redirect to login",
// so a stale session never leaves you silently stuck. (The removed-account case
// the middleware guards against shares this exact 401 → redirect path.)
const { test, expect } = require("@playwright/test");
const { request } = require("@playwright/test");

test("an invalid token bounces the browser back to login and clears itself", async ({ page }) => {
  await page.goto("/login/"); // establish the origin so localStorage is writable
  await page.evaluate(() => {
    localStorage.setItem("notes.token", "not.a.valid.token");
    localStorage.setItem("notes.user", "admin");
  });
  await page.goto("/");
  await page.waitForURL(/\/login\//);
  await expect(page.locator("[data-login-form]")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("notes.token"))).toBeNull();
});

test("the API rejects a bad bearer token with 401", async ({ baseURL }) => {
  const ctx = await request.newContext({
    baseURL,
    extraHTTPHeaders: { Authorization: "Bearer garbage" },
  });
  const res = await ctx.get("/api/repos");
  expect(res.status()).toBe(401);
  await ctx.dispose();
});

test("protected endpoints require a token at all", async ({ baseURL }) => {
  const ctx = await request.newContext({ baseURL });
  const res = await ctx.get("/api/notes?repo=default");
  expect(res.status()).toBe(401);
  await ctx.dispose();
});
