// Auto-sync *behavior* (not just the setting): with it on, edits persist on their
// own after the idle delay; with it off, nothing is written until you press Save.
const { test, expect } = require("@playwright/test");
const { loginFast, apiContext, noteContent } = require("./helpers");

const NOTE = "notes/project-ideas.md";

async function loginWithSync(page, baseURL, { enabled, secs }) {
  await page.addInitScript(
    ([en, s]) => {
      localStorage.setItem("notes.autosync", en ? "on" : "off");
      if (s) localStorage.setItem("notes.autosyncSecs", String(s));
    },
    [enabled, secs]
  );
  await loginFast(page, baseURL, "admin");
}

test("with auto-sync on, edits persist without pressing Save", async ({ page, baseURL }) => {
  await loginWithSync(page, baseURL, { enabled: true, secs: 3 });
  const marker = "autosave-on-" + Date.now();
  await page.click(`.note-item[data-path="${NOTE}"]`);
  const ta = page.locator("[data-textarea]");
  await expect(ta).not.toHaveValue("");
  await ta.fill((await ta.inputValue()) + "\n" + marker);
  // No Save click — the debounced autosave should fire after ~3s.
  const { ctx } = await apiContext(baseURL, "admin");
  await expect.poll(() => noteContent(ctx, NOTE), { timeout: 9_000 }).toContain(marker);
  await ctx.dispose();
});

test("with auto-sync off, edits are held until Save", async ({ page, baseURL }) => {
  await loginWithSync(page, baseURL, { enabled: false });
  const marker = "autosave-off-" + Date.now();
  await page.click(`.note-item[data-path="${NOTE}"]`);
  const ta = page.locator("[data-textarea]");
  await ta.fill((await ta.inputValue()) + "\n" + marker);

  const { ctx } = await apiContext(baseURL, "admin");
  // Give an autosave every chance to (wrongly) fire — it must not.
  await page.waitForTimeout(4_000);
  expect(await noteContent(ctx, NOTE)).not.toContain(marker);

  // Manual save persists it.
  await page.click("[data-save]");
  await expect.poll(() => noteContent(ctx, NOTE), { timeout: 8_000 }).toContain(marker);
  await ctx.dispose();
});
