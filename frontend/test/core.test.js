// Unit tests for the pure helpers in core.js. Run with: node --test frontend/test
// The parseAction cases mirror backend/agenda_test.go to guard client/server parity.
// (frontend/package.json is type:module, so this runs as ESM; core.js is a classic
// script that publishes NotesCore onto globalThis when imported for side-effect.)
import test from "node:test";
import assert from "node:assert/strict";
import "../src/assets/js/core.js";
const Core = globalThis.NotesCore;

test("isoWeek matches known dates", () => {
  const cases = [
    ["2026-08-03", 2026, 32],
    ["2026-01-01", 2026, 1],
    ["2025-12-29", 2026, 1],
    ["2021-01-01", 2020, 53],
    ["2026-12-31", 2026, 53],
  ];
  for (const [s, year, week] of cases) {
    const w = Core.isoWeek(new Date(s + "T12:00:00Z"));
    assert.deepEqual(w, { year, week }, s);
  }
});

test("mondayOfISOWeek round-trips through isoWeek and lands on a Monday", () => {
  for (let wk = 1; wk <= 52; wk++) {
    const mon = Core.mondayOfISOWeek(2026, wk);
    assert.equal(mon.getUTCDay(), 1, `week ${wk} not a Monday`);
    assert.deepEqual(Core.isoWeek(mon), { year: 2026, week: wk });
  }
});

test("addDays / normalizeTime", () => {
  const d = Core.addDays(new Date(Date.UTC(2026, 0, 31)), 1);
  assert.equal(d.getUTCMonth(), 1); // Feb
  assert.equal(d.getUTCDate(), 1);
  assert.equal(Core.normalizeTime("9:05"), "09:05");
  assert.equal(Core.normalizeTime("23:59"), "23:59");
  assert.equal(Core.normalizeTime("nope"), "");
});

test("parseAction extracts tokens (parity with Go parseActionTokens)", () => {
  const base = { every: "", since: "" };
  const cases = [
    ["Send design doc due:2026-08-03 @sam", { text: "Send design doc", due: "2026-08-03", owners: ["sam"], important: false, ...base }],
    ["Wire rollup due:2026-08-05 @alex !", { text: "Wire rollup", due: "2026-08-05", owners: ["alex"], important: true, ...base }],
    ["Buy milk!", { text: "Buy milk!", due: "", owners: [], important: false, ...base }],
    ["just text", { text: "just text", due: "", owners: [], important: false, ...base }],
    ["multi @a @b due:2030-01-01", { text: "multi", due: "2030-01-01", owners: ["a", "b"], important: false, ...base }],
    ["due:2026-12-31 leading date @me", { text: "leading date", due: "2026-12-31", owners: ["me"], important: false, ...base }],
    ["!", { text: "", due: "", owners: [], important: true, ...base }],
    ["Take out trash every:tue", { text: "Take out trash", due: "", owners: [], important: false, every: "tue", since: "" }],
    ["Salt softener every:6w since:2026-07-01 !", { text: "Salt softener", due: "", owners: [], important: true, every: "6w", since: "2026-07-01" }],
    ["Water plants every:weekly", { text: "Water plants", due: "", owners: [], important: false, every: "1w", since: "" }],
    ["not a rule every:sometimes", { text: "not a rule every:sometimes", due: "", owners: [], important: false, every: "", since: "" }],
  ];
  for (const [input, want] of cases) {
    assert.deepEqual(Core.parseAction(input), want, input);
  }
});

test("parseRecurrence normalizes specs and rejects junk", () => {
  const ok = [
    ["tue", { kind: "weekday", dow: 2 }],
    ["Monday", { kind: "weekday", dow: 1 }],
    ["sun", { kind: "weekday", dow: 0 }],
    ["6w", { kind: "interval", n: 6, unit: "w" }],
    ["1d", { kind: "interval", n: 1, unit: "d" }],
    ["weekly", { kind: "interval", n: 1, unit: "w" }],
    ["biweekly", { kind: "interval", n: 2, unit: "w" }],
    ["quarterly", { kind: "interval", n: 3, unit: "m" }],
  ];
  for (const [s, want] of ok) assert.deepEqual(Core.parseRecurrence(s), want, s);
  for (const s of ["", "sometimes", "0w", "3x", "every"]) {
    assert.equal(Core.parseRecurrence(s), null, s);
  }
  // canonical round-trips
  assert.equal(Core.recurrenceCanonical(Core.parseRecurrence("Monday")), "mon");
  assert.equal(Core.recurrenceCanonical(Core.parseRecurrence("biweekly")), "2w");
});

test("nextOccurrence resolves on/after today (parity with Go)", () => {
  const today = new Date(Date.UTC(2026, 7, 4)); // 2026-08-04, a Tuesday
  const cases = [
    ["tue", "", "2026-08-04"],
    ["mon", "", "2026-08-10"],
    ["sun", "", "2026-08-09"],
    ["1d", "", "2026-08-04"],
    ["6w", "2026-07-01", "2026-08-12"],
    ["2w", "2026-08-20", "2026-08-20"],
    ["1m", "2026-01-31", "2026-08-31"], // clamp must not compound
    ["1y", "2020-08-04", "2026-08-04"],
  ];
  for (const [spec, since, want] of cases) {
    const got = Core.nextOccurrence(Core.parseRecurrence(spec), since, today);
    assert.equal(got, want, `${spec} since:${since}`);
  }
});

test("serializeAction round-trips through parseAction", () => {
  const items = [
    { checked: false, text: "task", due: "2026-08-10", owners: ["alex"], important: true, every: "", since: "" },
    { checked: true, text: "done", due: "", owners: [], important: false, every: "", since: "" },
    { checked: false, text: "two owners", due: "2026-01-01", owners: ["a", "b"], important: false, every: "", since: "" },
    { checked: false, text: "trash", due: "", owners: [], important: false, every: "tue", since: "" },
    { checked: false, text: "softener salt", due: "", owners: [], important: true, every: "6w", since: "2026-07-01" },
  ];
  for (const it of items) {
    const line = Core.serializeAction(it);
    const body = line.replace(/^- \[[ x]\]\s+/, "");
    const parsed = Core.parseAction(body);
    assert.equal(parsed.text, it.text);
    assert.equal(parsed.due, it.due);
    assert.equal(parsed.every, it.every);
    assert.equal(parsed.since, it.since);
    assert.deepEqual(parsed.owners, it.owners);
    assert.equal(parsed.important, it.important);
  }
});
