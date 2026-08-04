// Local draft buffer: unsaved edits are mirrored to localStorage (independent of
// auto-sync) and restored on reopen, so a failed/skipped save survives a reload
// or tab close. Auto-sync is forced OFF so the draft isn't quietly saved away.
const { test, expect } = require("@playwright/test");
const { loginFast, apiContext, noteContent } = require("./helpers");

const NOTE = "notes/reading-list.md";

test.beforeEach(async ({ page, baseURL }) => {
  await page.addInitScript(() => localStorage.setItem("notes.autosync", "off"));
  await loginFast(page, baseURL, "admin");
});

// Wait until a draft holding the marker has been written to localStorage.
async function draftPersisted(page, marker) {
  await page.waitForFunction((m) => {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("notes.draft:") && (localStorage.getItem(k) || "").includes(m)) return true;
    }
    return false;
  }, marker, { timeout: 5000 });
}

test("an unsaved edit is restored after a reload", async ({ page, baseURL }) => {
  const marker = "draft-marker-" + Date.now();
  await page.click(`.note-item[data-path="${NOTE}"]`);
  const ta = page.locator("[data-textarea]");
  await expect(ta).toHaveValue(/Reading list/);
  await ta.fill((await ta.inputValue()) + "\n" + marker);
  await draftPersisted(page, marker);

  await page.reload(); // token + autosync=off survive via addInitScript/localStorage
  // App reopens the last note and restores the draft.
  await expect(page.locator("[data-draft-banner]")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("[data-textarea]")).toHaveValue(new RegExp(marker));

  // The draft was never committed — the server copy is unchanged.
  const { ctx } = await apiContext(baseURL, "admin");
  expect(await noteContent(ctx, NOTE)).not.toContain(marker);
  await ctx.dispose();
});

test("discarding a restored draft reverts to the saved copy", async ({ page }) => {
  const marker = "draft-discard-" + Date.now();
  await page.click(`.note-item[data-path="${NOTE}"]`);
  const ta = page.locator("[data-textarea]");
  await expect(ta).toHaveValue(/Reading list/);
  await ta.fill((await ta.inputValue()) + "\n" + marker);
  await draftPersisted(page, marker);
  await page.reload();
  await expect(page.locator("[data-draft-banner]")).toBeVisible({ timeout: 15_000 });

  await page.click("[data-draft-discard]");
  await expect(page.locator("[data-draft-banner]")).toBeHidden();
  await expect(page.locator("[data-textarea]")).not.toHaveValue(new RegExp(marker));
});

test("saving clears the draft (no banner on the next reload)", async ({ page }) => {
  const marker = "draft-saved-" + Date.now();
  await page.click(`.note-item[data-path="${NOTE}"]`);
  const ta = page.locator("[data-textarea]");
  await expect(ta).toHaveValue(/Reading list/);
  await ta.fill((await ta.inputValue()) + "\n" + marker);
  await draftPersisted(page, marker);
  await page.click("[data-save]");
  // give the save a moment, then reload
  await expect(page.locator("[data-dirty]")).toBeHidden();

  await page.reload();
  await page.locator(`.note-item[data-path="${NOTE}"]`).waitFor();
  await expect(page.locator("[data-draft-banner]")).toBeHidden();
});
