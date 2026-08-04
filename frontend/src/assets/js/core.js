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

  // ---- recurrence (chores / routines) ----
  // A recurring task carries an `every:<spec>` token (and optional `since:`
  // anchor). It never has a fixed date; the Agenda resolves its *next
  // occurrence* on or after today. Weekday specs (mon…sun) recur weekly;
  // interval specs (Nd/Nw/Nm/Ny, plus friendly aliases) recur every N days/
  // weeks/months/years. dow is 0=Sun…6=Sat (matches Date.getUTCDay and Go's
  // time.Weekday). Keep this in lock-step with backend/notes.go.
  const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const WEEKDAY_ALIASES = {
    sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2,
    wed: 3, weds: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4,
    fri: 5, friday: 5, sat: 6, saturday: 6,
  };
  const RECUR_ALIASES = {
    daily: "1d", weekly: "1w", biweekly: "2w", fortnightly: "2w",
    monthly: "1m", quarterly: "3m", yearly: "1y", annually: "1y",
    day: "1d", week: "1w", month: "1m", year: "1y",
  };
  const UNIT_NAMES = { d: "day", w: "week", m: "month", y: "year" };

  // parseRecurrence("tue"|"6w"|"weekly") → {kind:"weekday",dow} |
  // {kind:"interval",n,unit} | null.
  function parseRecurrence(spec) {
    let s = (spec || "").trim().toLowerCase();
    if (!s) return null;
    if (RECUR_ALIASES[s]) s = RECUR_ALIASES[s];
    if (s in WEEKDAY_ALIASES) return { kind: "weekday", dow: WEEKDAY_ALIASES[s] };
    const m = /^(\d+)([dwmy])$/.exec(s);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= 1) return { kind: "interval", n, unit: m[2] };
    }
    return null;
  }

  // Canonical token form: weekday → "tue", interval → "6w".
  function recurrenceCanonical(rec) {
    if (!rec) return "";
    if (rec.kind === "weekday") return WEEKDAYS[rec.dow];
    return rec.n + rec.unit;
  }

  // Human label: "every Tue", "every 6 weeks", "daily".
  function recurrenceLabel(rec) {
    if (!rec) return "";
    if (rec.kind === "weekday") {
      const name = { sun: "Sun", mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat" }[WEEKDAYS[rec.dow]];
      return "every " + name;
    }
    if (rec.n === 1) {
      return { d: "daily", w: "weekly", m: "monthly", y: "yearly" }[rec.unit];
    }
    return "every " + rec.n + " " + UNIT_NAMES[rec.unit] + "s";
  }

  function parseISODate(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
    if (!m) return null;
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  }
  function toISODate(d) {
    return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate());
  }
  function daysInMonth(year, month0) {
    return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  }
  // Add whole months, clamping the day to the target month's length so
  // Jan 31 + 1 month → Feb 28/29 rather than rolling into March.
  function addMonthsClamped(d, months) {
    const total = d.getUTCMonth() + months;
    const year = d.getUTCFullYear() + Math.floor(total / 12);
    const month0 = ((total % 12) + 12) % 12;
    const day = Math.min(d.getUTCDate(), daysInMonth(year, month0));
    return new Date(Date.UTC(year, month0, day));
  }

  // Next occurrence on or after `today` as YYYY-MM-DD. `since` phases interval
  // recurrences (ignored for weekdays); absent since anchors at today.
  function nextOccurrence(rec, since, today) {
    const t = today instanceof Date
      ? new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
      : parseISODate(today);
    if (!rec || !t) return "";
    if (rec.kind === "weekday") {
      const delta = (rec.dow - t.getUTCDay() + 7) % 7;
      return toISODate(addDays(t, delta));
    }
    let anchor = parseISODate(since) || t;
    if (anchor.getTime() >= t.getTime()) return toISODate(anchor);
    if (rec.unit === "d" || rec.unit === "w") {
      const period = rec.n * (rec.unit === "w" ? 7 : 1);
      const diff = Math.round((t.getTime() - anchor.getTime()) / 86400000);
      const k = Math.ceil(diff / period);
      return toISODate(addDays(anchor, k * period));
    }
    // Month/year: compute each candidate from the anchor (not iteratively) so
    // the day-clamp doesn't compound — a Jan-31 monthly chore keeps landing on
    // the 31st rather than sliding to the 28th.
    const step = rec.unit === "y" ? rec.n * 12 : rec.n;
    for (let k = 1; k < 10000; k++) {
      const cur = addMonthsClamped(anchor, k * step);
      if (cur.getTime() >= t.getTime()) return toISODate(cur);
    }
    return toISODate(anchor);
  }

  // Task/action lines share tokens: `text due:YYYY-MM-DD @owner !`. parseAction
  // pulls them out (and strips them from the text); serializeAction re-appends
  // them in a canonical order so lines round-trip stably.
  function parseAction(raw) {
    let text = (raw || "").trim();
    let important = false, due = "", every = "", since = "";
    const owners = [];
    if (/\s!$/.test(text) || text === "!") { important = true; text = text.replace(/\s*!$/, "").trim(); }
    const dm = /(^|\s)due:(\d{4}-\d{2}-\d{2})(?=\s|$)/.exec(text);
    if (dm) { due = dm[2]; text = (text.slice(0, dm.index) + " " + text.slice(dm.index + dm[0].length)).trim(); }
    const sm = /(^|\s)since:(\d{4}-\d{2}-\d{2})(?=\s|$)/.exec(text);
    if (sm) { since = sm[2]; text = (text.slice(0, sm.index) + " " + text.slice(sm.index + sm[0].length)).trim(); }
    // `every:` is only consumed when it names a valid recurrence, so stray
    // "every:other" prose is left untouched.
    const em = /(^|\s)every:([^\s]+)/.exec(text);
    if (em) {
      const rec = parseRecurrence(em[2]);
      if (rec) { every = recurrenceCanonical(rec); text = (text.slice(0, em.index) + " " + text.slice(em.index + em[0].length)).trim(); }
    }
    text = text.replace(/(^|\s)@([^\s]+)/g, (_m, pre, name) => { owners.push(name); return pre; });
    text = text.replace(/\s{2,}/g, " ").trim();
    return { text, due, every, since, owners, important };
  }
  function serializeAction(a) {
    let s = "- [" + (a.checked ? "x" : " ") + "] " + a.text;
    if (a.due) s += " due:" + a.due;
    if (a.every) s += " every:" + a.every;
    if (a.since) s += " since:" + a.since;
    for (const o of a.owners) s += " @" + o;
    if (a.important) s += " !";
    return s;
  }

  return {
    pad2, isoWeek, mondayOfISOWeek, addDays, normalizeTime, parseAction, serializeAction,
    parseRecurrence, recurrenceCanonical, recurrenceLabel, nextOccurrence, WEEKDAYS,
  };
});
