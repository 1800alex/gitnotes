// Deleting a note removes it from the list and commits the removal to git.
const { test, expect } = require("@playwright/test");
const { loginFast, apiContext, noteContent, saveNote } = require("./helpers");

test("deleting a note removes it from the list and from git", async ({ page, baseURL }) => {
  const path = `notes/delete-me-${Date.now()}.md`;
  const { ctx } = await apiContext(baseURL, "admin");
  await saveNote(ctx, path, "# Delete me\n\ntemporary\n", "");

  await loginFast(page, baseURL, "admin");
  const item = page.locator(`.note-item[data-path="${path}"]`);
  await expect(item).toBeVisible();
  await item.click();

  page.once("dialog", (d) => d.accept()); // the "Delete …? This commits" confirm
  await page.click("[data-delete]");

  await expect(item).toHaveCount(0, { timeout: 8_000 });
  expect(await noteContent(ctx, path)).toBeNull(); // gone from the repo too
  await ctx.dispose();
});
