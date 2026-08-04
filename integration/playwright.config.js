// Playwright runs on the host against the dockerized app (managed by run.sh).
// BASE_URL is injected by run.sh; it defaults to the compose port for a manual
// `npx playwright test` against an already-running stack.
const { defineConfig, devices } = require("@playwright/test");

const PORT = process.env.ITEST_PORT || "8091";

module.exports = defineConfig({
  testDir: "./tests",
  // One backend + one shared git working tree → serialize so concurrent saves
  // don't race on commits.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.BASE_URL || `http://localhost:${PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  // Most specs target a desktop viewport; mobile.spec.js overrides to a phone.
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
