// Checklist ("todo") mode over a nested markdown checklist: rendering, toggling,
// adding, and the compact preference.
const { test, expect } = require("@playwright/test");
const { loginFast, apiContext, noteContent } = require("./helpers");

const NOTE = "checklists/groceries.md";

test.beforeEach(async ({ page, baseURL }) => {
  await loginFast(page, baseURL, "admin");
});

async function openInTodo(page) {
  await page.click(`.note-item[data-path="${NOTE}"]`);
  await page.click('[data-mode="todo"]');
  await expect(page.locator("[data-todo-pane]")).toBeVisible();
}

test("checklist mode renders parents and nested children", async ({ page }) => {
  await openInTodo(page);
  await expect(page.locator(".todo-item").first()).toBeVisible();
  await expect(page.locator(".todo-parent", { hasText: "Produce" })).toBeVisible();
  await expect(page.locator(".todo-child", { hasText: "Spinach" })).toBeVisible();
});

test("checking an item persists as [x]", async ({ page, baseURL }) => {
  await openInTodo(page);
  await page.locator(".todo-item", { hasText: "Spinach" }).locator(".todo-check").click();
  await page.click("[data-save]");
  const { ctx } = await apiContext(baseURL, "admin");
  await expect
    .poll(() => noteContent(ctx, NOTE), { timeout: 8_000 })
    .toMatch(/\[x\][^\n]*Spinach/);
  await ctx.dispose();
});

test("adding a checklist item persists", async ({ page, baseURL }) => {
  await openInTodo(page);
  const item = "todo-item-" + Date.now();
  await page.locator("[data-todo-input]").fill(item);
  await page.locator("[data-todo-add] button[type=submit]").click();
  await page.click("[data-save]");
  const { ctx } = await apiContext(baseURL, "admin");
  await expect.poll(() => noteContent(ctx, NOTE), { timeout: 8_000 }).toContain(item);
  await ctx.dispose();
});

test("compact toggle is remembered as a preference", async ({ page }) => {
  await openInTodo(page);
  await page.click("[data-todo-compact]");
  expect(await page.evaluate(() => localStorage.getItem("notes.todoCompact"))).toBe("1");
});
