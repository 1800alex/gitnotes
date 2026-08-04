/* Pure, DOM-free helpers shared by the app and unit-tested in Node.
 * Loaded as a classic script in the browser (exposes window.NotesCore) and as a
 * CommonJS module in tests (module.exports). Keep this free of DOM/browser APIs.
 *
 * NOTE: the action-item grammar here (parseAction/serializeAction) must stay in
 * lock-step with the Go parseActionTokens (backend/notes.go) — the Agenda relies
 * on both agreeing. See backend/agenda_test.go + frontend/test/core.test.js. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api; // CJS
  if (root) root.NotesCore = api; // browser (window) or ESM/Node (globalThis)
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : null), function () {
  "use strict";

  function pad2(n) { return String(n).padStart(2, "0"); }

  // ISO-8601 week number + week-year for a Date (evaluated in UTC).
  function isoWeek(date) {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const dayNum = (d.getUTCDay() + 6) % 7;            // Mon=0 … Sun=6
    d.setUTCDate(d.getUTCDate() - dayNum + 3);         // Thursday decides the year
    const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    const firstDayNum = (firstThu.getUTCDay() + 6) % 7;
    firstThu.setUTCDate(firstThu.getUTCDate() - firstDayNum + 3);
    const week = 1 + Math.round((d - firstThu) / (7 * 86400000));
    return { year: d.getUTCFullYear(), week };
  }

  // Monday (UTC) of a given ISO week — Jan 4 is always in week 1.
  function mondayOfISOWeek(year, week) {
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const dayNum = (jan4.getUTCDay() + 6) % 7;
    const monday = new Date(jan4);
    monday.setUTCDate(jan4.getUTCDate() - dayNum + (week - 1) * 7);
    return monday;
  }

  function addDays(date, n) {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() + n);
    return d;
  }

  function normalizeTime(t) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(t);
    if (!m) return "";
    let h = Math.min(23, +m[1]);
    return pad2(h) + ":" + m[2];
  }

  // Task/action lines share tokens: `text due:YYYY-MM-DD @owner !`. parseAction
  // pulls them out (and strips them from the text); serializeAction re-appends
  // them in a canonical order so lines round-trip stably.
  function parseAction(raw) {
    let text = (raw || "").trim();
    let important = false, due = "";
    const owners = [];
    if (/\s!$/.test(text) || text === "!") { important = true; text = text.replace(/\s*!$/, "").trim(); }
    const dm = /(^|\s)due:(\d{4}-\d{2}-\d{2})(?=\s|$)/.exec(text);
    if (dm) { due = dm[2]; text = (text.slice(0, dm.index) + " " + text.slice(dm.index + dm[0].length)).trim(); }
    text = text.replace(/(^|\s)@([^\s]+)/g, (_m, pre, name) => { owners.push(name); return pre; });
    text = text.replace(/\s{2,}/g, " ").trim();
    return { text, due, owners, important };
  }
  function serializeAction(a) {
    let s = "- [" + (a.checked ? "x" : " ") + "] " + a.text;
    if (a.due) s += " due:" + a.due;
    for (const o of a.owners) s += " @" + o;
    if (a.important) s += " !";
    return s;
  }

  return { pad2, isoWeek, mondayOfISOWeek, addDays, normalizeTime, parseAction, serializeAction };
});
