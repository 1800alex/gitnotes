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
  const cases = [
    ["Send design doc due:2026-08-03 @sam", { text: "Send design doc", due: "2026-08-03", owners: ["sam"], important: false }],
    ["Wire rollup due:2026-08-05 @alex !", { text: "Wire rollup", due: "2026-08-05", owners: ["alex"], important: true }],
    ["Buy milk!", { text: "Buy milk!", due: "", owners: [], important: false }],
    ["just text", { text: "just text", due: "", owners: [], important: false }],
    ["multi @a @b due:2030-01-01", { text: "multi", due: "2030-01-01", owners: ["a", "b"], important: false }],
    ["due:2026-12-31 leading date @me", { text: "leading date", due: "2026-12-31", owners: ["me"], important: false }],
    ["!", { text: "", due: "", owners: [], important: true }],
  ];
  for (const [input, want] of cases) {
    assert.deepEqual(Core.parseAction(input), want, input);
  }
});

test("serializeAction round-trips through parseAction", () => {
  const items = [
    { checked: false, text: "task", due: "2026-08-10", owners: ["alex"], important: true },
    { checked: true, text: "done", due: "", owners: [], important: false },
    { checked: false, text: "two owners", due: "2026-01-01", owners: ["a", "b"], important: false },
  ];
  for (const it of items) {
    const line = Core.serializeAction(it);
    const body = line.replace(/^- \[[ x]\]\s+/, "");
    const parsed = Core.parseAction(body);
    assert.equal(parsed.text, it.text);
    assert.equal(parsed.due, it.due);
    assert.deepEqual(parsed.owners, it.owners);
    assert.equal(parsed.important, it.important);
  }
});
