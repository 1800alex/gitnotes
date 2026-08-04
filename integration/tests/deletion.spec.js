// Deleting a note requires typing its exact path to confirm (GitHub-style), then
// removes it from the list and commits the removal to git.
const { test, expect } = require("@playwright/test");
const { loginFast, apiContext, noteContent, saveNote } = require("./helpers");

async function seedNote(baseURL, path) {
  const { ctx } = await apiContext(baseURL, "admin");
  await saveNote(ctx, path, "# Delete me\n\ntemporary\n", "");
  return ctx;
}

test("typing the exact path confirms the delete (removed from list + git)", async ({ page, baseURL }) => {
  const path = `notes/delete-me-${Date.now()}.md`;
  const ctx = await seedNote(baseURL, path);

  await loginFast(page, baseURL, "admin");
  const item = page.locator(`.note-item[data-path="${path}"]`);
  await expect(item).toBeVisible();
  await item.click();

  await page.click("[data-delete]");
  const modal = page.locator(".delete-modal");
  await expect(modal).toBeVisible();
  // The confirm button is locked until the typed name matches exactly.
  const del = modal.locator(".button-danger");
  await expect(del).toBeDisabled();
  await modal.locator(".modal-input").fill(path);
  await expect(del).toBeEnabled();
  await del.click();

  await expect(item).toHaveCount(0, { timeout: 8_000 });
  expect(await noteContent(ctx, path)).toBeNull(); // gone from the repo too
  await ctx.dispose();
});

test("a wrong name keeps the delete button disabled", async ({ page, baseURL }) => {
  const path = `notes/keep-me-${Date.now()}.md`;
  const ctx = await seedNote(baseURL, path);

  await loginFast(page, baseURL, "admin");
  const item = page.locator(`.note-item[data-path="${path}"]`);
  await expect(item).toBeVisible();
  await item.click();

  await page.click("[data-delete]");
  const modal = page.locator(".delete-modal");
  await modal.locator(".modal-input").fill("notes/wrong-name.md");
  await expect(modal.locator(".button-danger")).toBeDisabled();

  // Cancel leaves the note untouched.
  await modal.getByRole("button", { name: "Cancel" }).click();
  await expect(modal).toBeHidden();
  await expect(item).toBeVisible();
  expect(await noteContent(ctx, path)).not.toBeNull();
  await ctx.dispose();
});

test("Escape cancels the delete modal", async ({ page, baseURL }) => {
  const path = `notes/esc-me-${Date.now()}.md`;
  const ctx = await seedNote(baseURL, path);

  await loginFast(page, baseURL, "admin");
  const item = page.locator(`.note-item[data-path="${path}"]`);
  await item.click();
  await page.click("[data-delete]");
  await expect(page.locator(".delete-modal")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".delete-modal")).toBeHidden();
  expect(await noteContent(ctx, path)).not.toBeNull();
  await ctx.dispose();
});
