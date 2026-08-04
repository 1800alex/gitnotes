// Exercises the backend's 3-way merge on save (notes.go): when a note changed on
// disk since the client loaded it, the server merges using the loaded copy as the
// common ancestor — non-overlapping edits merge cleanly, overlapping ones are
// surfaced as a conflict. Driven purely through the API for determinism.
const { test, expect } = require("@playwright/test");
const { apiContext, saveNote, noteContent } = require("./helpers");

const PATH = "notes/merge-test.md";
const BASE = "# Merge test\n\nline one\nline two\nline three\n";

let ctx;
test.beforeAll(async ({ baseURL }) => {
  ({ ctx } = await apiContext(baseURL, "admin"));
  await saveNote(ctx, PATH, BASE, ""); // create the scratch note
});
test.afterAll(async () => {
  await ctx?.dispose();
});

test("non-overlapping concurrent edits merge cleanly", async () => {
  const base = await noteContent(ctx, PATH);

  // "Device B" appends at the bottom (base matches disk → straight write).
  const bWrite = await saveNote(ctx, PATH, base + "bottom-edit-B\n", base);
  expect(bWrite.status).toBe(200);

  // "Device A" prepends at the top using the *stale* base → server 3-way merges.
  const aTop = "top-edit-A\n" + base;
  const aWrite = await saveNote(ctx, PATH, aTop, base);
  expect(aWrite.status).toBe(200);
  expect(aWrite.body.merged).toBe(true);
  expect(aWrite.body.overlap).toBe(false);
  expect(aWrite.body.content).toContain("top-edit-A");
  expect(aWrite.body.content).toContain("bottom-edit-B"); // B's edit was kept
});

test("overlapping edits are surfaced as a conflict", async () => {
  const base = await noteContent(ctx, PATH);

  // B changes a specific line (straight write).
  const bVer = base.replace("line two", "line two — CHANGED BY B");
  expect((await saveNote(ctx, PATH, bVer, base)).status).toBe(200);

  // A changes the *same* line with a stale base → overlapping edit. The backend
  // union-merges: both sides' lines are kept (no conflict markers, nothing
  // dropped) and it flags `overlap` so the UI can prompt a tidy-up.
  const aVer = base.replace("line two", "line two — CHANGED BY A");
  const aWrite = await saveNote(ctx, PATH, aVer, base);
  expect(aWrite.status).toBe(200);
  expect(aWrite.body.merged).toBe(true);
  expect(aWrite.body.overlap).toBe(true);
  expect(aWrite.body.content).toContain("line two — CHANGED BY A");
  expect(aWrite.body.content).toContain("line two — CHANGED BY B"); // both kept
  expect(aWrite.body.content).not.toContain("<<<<<<<"); // union → no markers
});
