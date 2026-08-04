// Multi-repo access control: a user may only reach repos listed in their own
// config, repos can be shared, and the repo switcher only appears with >1 repo.
// Fixture: admin → [default, work]; user → [default] (shared with admin).
const { test, expect } = require("@playwright/test");
const { apiContext, loginFast, saveNote, noteContent, WORK } = require("./helpers");

test("a user cannot reach a repo not in their config (404)", async ({ baseURL }) => {
  const { ctx } = await apiContext(baseURL, "user");
  const res = await ctx.get(`/api/notes?repo=${WORK}`);
  expect(res.status()).toBe(404); // "unknown or inaccessible repo"
  await ctx.dispose();
});

test("admin can reach the second repo", async ({ baseURL }) => {
  const { ctx } = await apiContext(baseURL, "admin");
  const res = await ctx.get(`/api/notes?repo=${WORK}`);
  expect(res.status()).toBe(200);
  const names = (await res.json()).notes.map((n) => n.path);
  expect(names).toContain("work-note.md");
  await ctx.dispose();
});

test("/api/repos reflects each user's own repo list", async ({ baseURL }) => {
  const admin = await apiContext(baseURL, "admin");
  const user = await apiContext(baseURL, "user");
  const adminRepos = (await (await admin.ctx.get("/api/repos")).json()).repos.map((r) => r.id);
  const userRepos = (await (await user.ctx.get("/api/repos")).json()).repos.map((r) => r.id);
  expect(adminRepos.sort()).toEqual(["default", "work"]);
  expect(userRepos).toEqual(["default"]);
  await admin.ctx.dispose();
  await user.ctx.dispose();
});

test("the repo switcher shows for admin (2 repos) and hides for user (1)", async ({ page, baseURL }) => {
  await loginFast(page, baseURL, "admin");
  await expect(page.locator("[data-repo-wrap]")).toBeVisible();
  await expect(page.locator("[data-repo-select] option")).toHaveCount(2);

  await page.context().clearCookies();
  await loginFast(page, baseURL, "user");
  await expect(page.locator("[data-repo-wrap]")).toBeHidden();
});

test("a shared repo is visible to both users", async ({ baseURL }) => {
  const marker = "shared-" + Date.now() + ".md";
  const admin = await apiContext(baseURL, "admin");
  const user = await apiContext(baseURL, "user");
  // admin writes into the shared default repo…
  const w = await saveNote(admin.ctx, `notes/${marker}`, "# Shared\n\nhello from admin\n", "");
  expect(w.status).toBe(200);
  // …and user, who shares default, can read it back.
  await expect
    .poll(async () => await noteContent(user.ctx, `notes/${marker}`))
    .toContain("hello from admin");
  await admin.ctx.dispose();
  await user.ctx.dispose();
});
