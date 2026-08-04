// Shared helpers: auth (UI + fast token injection), an authenticated API client
// for asserting persisted git state, and date math matching the app + seed.
const { request } = require("@playwright/test");

const REPO = "default"; // the main seeded repo (admin + user both have it)
const WORK = "work"; // second repo, admin-only
const PASS = { admin: "admin", user: "user" };

const pad2 = (n) => String(n).padStart(2, "0");

// ISO-8601 week (matches app.js isoWeek) — the seed places the planner/meal-plan
// on the current ISO week, so tests compute the same path.
function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((d - firstThu) / (7 * 86400000));
  return { year: d.getUTCFullYear(), week };
}
function isoWeekStr(d = new Date()) {
  const w = isoWeek(d);
  return w.year + "-W" + pad2(w.week);
}
function todayStr(d = new Date()) {
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}

async function apiLogin(baseURL, username = "admin") {
  const ctx = await request.newContext({ baseURL });
  const res = await ctx.post("/api/login", { data: { username, password: PASS[username] } });
  if (!res.ok()) throw new Error(`login ${username} failed: ${res.status()}`);
  const token = (await res.json()).token;
  await ctx.dispose();
  return token;
}

// An authenticated APIRequestContext for reading back what the UI persisted.
async function apiContext(baseURL, username = "admin") {
  const token = await apiLogin(baseURL, username);
  const ctx = await request.newContext({
    baseURL,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
  return { ctx, token };
}

async function noteContent(ctx, path, repo = REPO) {
  const res = await ctx.get(`/api/note?repo=${repo}&path=${encodeURIComponent(path)}`);
  return res.ok() ? (await res.json()).content : null;
}

// Save a note through the API (returns the parsed body incl. merge flags).
async function saveNote(ctx, path, content, base, repo = REPO) {
  const res = await ctx.put("/api/note", { data: { repo, path, content, base } });
  return { status: res.status(), body: res.ok() ? await res.json() : null };
}

async function gitStatus(ctx, repo = REPO) {
  const res = await ctx.get(`/api/status?repo=${repo}`);
  return res.ok() ? await res.json() : null;
}

// Real UI sign-in (for the auth spec).
async function loginUI(page, username = "admin") {
  await page.goto("/login/");
  await page.fill("#username", username);
  await page.fill("#password", PASS[username]);
  await page.click("[data-submit]");
  await page.waitForSelector("[data-note-list] .note-item", { state: "attached", timeout: 15_000 });
}

// Fast sign-in: mint a token via the API and inject it, skipping the login form.
async function loginFast(page, baseURL, username = "admin") {
  const token = await apiLogin(baseURL, username);
  await page.addInitScript(
    ([t, u]) => {
      localStorage.setItem("notes.token", t);
      localStorage.setItem("notes.user", u);
    },
    [token, username]
  );
  await page.goto("/");
  await page.waitForSelector("[data-note-list] .note-item", { state: "attached", timeout: 15_000 });
}

module.exports = {
  REPO, WORK, PASS,
  isoWeekStr, todayStr,
  apiLogin, apiContext, noteContent, saveNote, gitStatus,
  loginUI, loginFast,
};
