// Refresh / status against a real upstream. run.sh gives the main repo a bare
// remote (with one remote-only commit); these tests confirm the status pill sees
// the upstream and that Refresh pulls the remote change into the working copy.
// If the upstream wasn't configured (env without docker-exec git), they skip.
const { test, expect } = require("@playwright/test");
const { apiContext, loginFast, gitStatus } = require("./helpers");

const EXTERNAL = "notes/external-refresh-check.md";

async function hasUpstream(baseURL) {
  const { ctx } = await apiContext(baseURL, "admin");
  const st = await gitStatus(ctx);
  await ctx.dispose();
  return !!(st && st.hasUpstream);
}

test("git status reports the upstream", async ({ baseURL }) => {
  test.skip(!(await hasUpstream(baseURL)), "no upstream configured for this run");
  const { ctx } = await apiContext(baseURL, "admin");
  const st = await gitStatus(ctx);
  expect(st.hasUpstream).toBe(true);
  expect(st.branch).toBeTruthy();
  await ctx.dispose();
});

test("the status pill shows the tracking branch in the UI", async ({ page, baseURL }) => {
  test.skip(!(await hasUpstream(baseURL)), "no upstream configured for this run");
  await loginFast(page, baseURL, "admin");
  await expect(page.locator("[data-status]")).toHaveClass(/has-upstream/, { timeout: 10_000 });
  await expect(page.locator("[data-status-text]")).not.toBeEmpty();
});

test("Refresh pulls a remote-only note into the working copy", async ({ page, baseURL }) => {
  test.skip(!(await hasUpstream(baseURL)), "no upstream configured for this run");
  await loginFast(page, baseURL, "admin");

  // The external commit lives only on the remote, so it's absent until Refresh.
  await expect(page.locator(`.note-item[data-path="${EXTERNAL}"]`)).toHaveCount(0);

  await page.click("[data-refresh]");

  await expect(page.locator(`.note-item[data-path="${EXTERNAL}"]`)).toBeVisible({ timeout: 15_000 });
});
