/* Notes app controller: file list, editor, preview, git sync. */
(function () {
  "use strict";
  const { Auth, Api } = window.NotesApp;
  if (!Auth.requireLogin()) return;

  // ---- element refs ----
  const $ = (sel) => document.querySelector(sel);
  const listEl = $("[data-note-list]");
  const listEmptyEl = $("[data-list-empty]");
  const filterEl = $("[data-filter]");
  const editorPane = $("[data-editor-pane]");
  const emptyState = $("[data-empty-state]");
  const textarea = $("[data-textarea]");
  const preview = $("[data-preview]");
  const modeContainer = $("[data-mode-container]");
  const currentPathEl = $("[data-current-path]");
  const dirtyDot = $("[data-dirty]");
  const saveBtn = $("[data-save]");
  const statusText = $("[data-status-text]");
  const statusPill = $("[data-status]");
  const toasts = $("[data-toasts]");
  const sidebarToggle = $("[data-sidebar-toggle]");
  const sidebarBackdrop = $("[data-sidebar-backdrop]");
  const insertMenuBtn = $("[data-insert-menu]");
  const insertDropdown = $("[data-insert-dropdown]");
  const todoPane = $("[data-todo-pane]");
  const todoScrollEl = $(".todo-scroll");
  const todoListEl = $("[data-todo-list]");
  const todoEmptyEl = $("[data-todo-empty]");
  const todoForm = $("[data-todo-add]");
  const todoInput = $("[data-todo-input]");
  const todoCountEl = $("[data-todo-count]");
  const todoCompactBtn = $("[data-todo-compact]");
  const todoCollapseAllBtn = $("[data-todo-collapse-all]");
  const undoBtn = $("[data-undo]");
  const redoBtn = $("[data-redo]");
  const repoWrap = $("[data-repo-wrap]");
  const repoSelect = $("[data-repo-select]");
  const syncPill = $("[data-sync]");

  // ---- state ----
  let repos = [];
  let currentRepo = null; // active repo id
  let notes = [];
  let current = null; // { path, content }
  let dirty = false;
  const MODES = ["edit", "split", "preview", "todo"];
  let mode = MODES.includes(localStorage.getItem("notes.mode"))
    ? localStorage.getItem("notes.mode")
    : "edit";

  // marked: render markdown but keep it reasonably safe-ish for personal use.
  if (window.marked) {
    window.marked.setOptions({ breaks: true, gfm: true });
  }

  // ---- toasts ----
  function toast(message, kind = "info", detail = "") {
    const el = document.createElement("div");
    el.className = "toast toast-" + kind;
    const icons = { info: "fa-circle-info", success: "fa-circle-check", error: "fa-triangle-exclamation", warn: "fa-triangle-exclamation" };
    el.innerHTML =
      '<i class="fa-solid ' + (icons[kind] || icons.info) + '"></i>' +
      '<div class="toast-body"><p></p>' + (detail ? '<pre></pre>' : "") + "</div>" +
      '<button class="toast-close" aria-label="Dismiss">&times;</button>';
    el.querySelector("p").textContent = message;
    if (detail) el.querySelector("pre").textContent = detail;
    el.querySelector(".toast-close").addEventListener("click", () => el.remove());
    toasts.appendChild(el);
    // Errors and conflicts stick around; transient messages auto-dismiss.
    if (kind === "success" || kind === "info") {
      setTimeout(() => el.remove(), 4000);
    }
    return el;
  }

  // ---- note list ----
  function renderList() {
    const q = filterEl.value.trim().toLowerCase();
    const visible = notes.filter((n) => !q || n.path.toLowerCase().includes(q));
    listEl.querySelectorAll(".note-item").forEach((el) => el.remove());

    if (!notes.length) {
      listEmptyEl.textContent = "No notes yet. Create one with “New”.";
      listEmptyEl.hidden = false;
      return;
    }
    if (!visible.length) {
      listEmptyEl.textContent = "No notes match your filter.";
      listEmptyEl.hidden = false;
      return;
    }
    listEmptyEl.hidden = true;

    for (const n of visible) {
      const a = document.createElement("button");
      a.type = "button";
      a.className = "note-item" + (current && current.path === n.path ? " is-active" : "");
      a.dataset.path = n.path;
      const dir = n.dir && n.dir !== "." ? n.dir + "/" : "";
      a.innerHTML =
        '<span class="note-name"></span>' +
        (dir ? '<span class="note-dir"></span>' : "");
      a.querySelector(".note-name").textContent = n.name.replace(/\.md$/i, "");
      if (dir) a.querySelector(".note-dir").textContent = dir;
      a.addEventListener("click", () => openNote(n.path));
      listEl.appendChild(a);
    }
  }

  // ---- repos ----
  function lastNoteKey() {
    return "notes.lastNote:" + (currentRepo || "");
  }

  async function loadRepos() {
    try {
      const res = await Api.repos();
      repos = res.repos || [];
    } catch (err) {
      repos = [];
      toast("Could not load repositories: " + err.message, "error");
    }
    renderRepoSelector();
    const saved = localStorage.getItem("notes.repo");
    const pick = repos.find((r) => r.id === saved) || repos[0];
    if (pick) {
      selectRepo(pick.id, true);
    } else {
      listEmptyEl.textContent = "No repositories are configured for your account.";
      listEmptyEl.hidden = false;
    }
  }

  function renderRepoSelector() {
    if (!repoSelect) return;
    repoSelect.innerHTML = "";
    for (const r of repos) {
      const opt = document.createElement("option");
      opt.value = r.id;
      opt.textContent = r.name || r.id;
      repoSelect.appendChild(opt);
    }
    // Only worth showing when there's an actual choice.
    if (repoWrap) repoWrap.hidden = repos.length < 2;
  }

  function selectRepo(id, initial) {
    if (id === currentRepo && !initial) return;
    currentRepo = id;
    localStorage.setItem("notes.repo", id);
    if (repoSelect) repoSelect.value = id;
    // Reset the editor when switching repos.
    current = null;
    setDirty(false);
    textarea.value = "";
    editorPane.hidden = true;
    emptyState.hidden = false;
    filterEl.value = "";
    loadList(localStorage.getItem(lastNoteKey()) || undefined);
    refreshStatus();
  }

  async function loadList(selectPath) {
    if (!currentRepo) return;
    try {
      const res = await Api.listNotes(currentRepo);
      notes = res.notes || [];
      renderList();
      if (selectPath) {
        if (notes.some((n) => n.path === selectPath)) openNote(selectPath);
        // Requested note is gone — drop the stale pointer and stay on the empty state.
        else localStorage.removeItem(lastNoteKey());
      }
    } catch (err) {
      toast("Could not load notes: " + err.message, "error");
    }
  }

  // ---- editor ----
  let saving = false;
  let autosaveTimer = 0;
  const AUTOSAVE_MS = 1500;

  function scheduleAutosave() {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      if (dirty && current && !saving) save({ auto: true });
    }, AUTOSAVE_MS);
  }

  // Sync status indicator (visible on mobile so you know your work is safe).
  function setSyncState(state) {
    if (!syncPill) return;
    const map = {
      idle: { icon: "fa-cloud", text: "" },
      saved: { icon: "fa-circle-check", text: "Saved" },
      dirty: { icon: "fa-cloud-arrow-up", text: "Unsaved" },
      saving: { icon: "fa-circle-notch fa-spin", text: "Syncing…" },
      error: { icon: "fa-triangle-exclamation", text: "Sync failed" },
    };
    const s = map[state] || map.idle;
    syncPill.hidden = state === "idle";
    syncPill.className = "sync-pill sync-" + state;
    syncPill.title = s.text || "Sync status";
    syncPill.innerHTML =
      '<i class="fa-solid ' + s.icon + '"></i>' +
      '<span class="btn-label"> ' + s.text + "</span>";
  }

  function setDirty(v) {
    dirty = v;
    dirtyDot.hidden = !v;
    saveBtn.disabled = !v || !current;
    // Debounced auto-save so changes survive a tab close (esp. on mobile).
    if (v) scheduleAutosave();
    else clearTimeout(autosaveTimer);
    // Reflect status (unless a save is mid-flight, which sets 'saving' itself).
    if (!saving) setSyncState(!current ? "idle" : v ? "dirty" : "saved");
  }

  let imgObjectUrls = [];

  function renderPreview() {
    // Release object URLs from the previous render to avoid leaks.
    imgObjectUrls.forEach(URL.revokeObjectURL);
    imgObjectUrls = [];
    if (!window.marked) {
      preview.textContent = textarea.value;
      return;
    }
    preview.innerHTML = window.marked.parse(textarea.value || "");
    hydrateImages();
  }

  // Resolve a repo-relative image src against the current note's directory.
  function resolveRelPath(notePath, src) {
    let parts;
    if (src.startsWith("/")) {
      parts = src.split("/");
    } else {
      const dir = notePath.includes("/") ? notePath.slice(0, notePath.lastIndexOf("/")) : "";
      parts = (dir ? dir.split("/") : []).concat(src.split("/"));
    }
    const out = [];
    for (const p of parts) {
      if (p === "" || p === ".") continue;
      if (p === "..") out.pop();
      else out.push(p);
    }
    return out.join("/");
  }

  // Load images referenced by repo-relative paths through the authenticated raw
  // endpoint (external http(s)/data/blob URLs load natively and are left alone).
  function hydrateImages() {
    if (!current || !currentRepo) return;
    preview.querySelectorAll("img").forEach(async (img) => {
      const src = img.getAttribute("src") || "";
      if (!src || /^(https?:|data:|blob:)/i.test(src)) return;
      try {
        const url = await Api.rawObjectUrl(currentRepo, resolveRelPath(current.path, src));
        imgObjectUrls.push(url);
        img.src = url;
      } catch (_) {
        img.replaceWith(Object.assign(document.createElement("span"), {
          className: "img-missing",
          textContent: "🖼️ " + (img.getAttribute("alt") || src) + " (not found)",
        }));
      }
    });
  }

  function setMode(next) {
    mode = next;
    localStorage.setItem("notes.mode", next);
    const isTodo = next === "todo";
    modeContainer.hidden = isTodo;
    todoPane.hidden = !isTodo;
    if (!isTodo) modeContainer.dataset.view = next;
    document.querySelectorAll(".mode-btn").forEach((b) =>
      b.classList.toggle("is-active", b.dataset.mode === next)
    );
    refreshModeView();
  }

  // Update whichever secondary view the current mode shows.
  function refreshModeView() {
    if (mode === "split" || mode === "preview") renderPreview();
    else if (mode === "todo") renderTodos();
  }

  function showEditor() {
    emptyState.hidden = true;
    editorPane.hidden = false;
  }

  // Called after any edit to the textarea (typed or programmatic).
  function markEdited() {
    setDirty(true);
    if (mode === "split" || mode === "preview") renderPreview();
  }

  // ---- undo / redo ----
  // A single app-level history of full textarea snapshots, shared across all
  // modes (typing, inserts, and todo operations). Typing is coalesced so each
  // pause is one step. Applies are flagged so they don't record themselves.
  const history = { stack: [], index: -1, applying: false };
  let recordTimer = 0;

  function updateHistoryButtons() {
    undoBtn.disabled = history.index <= 0;
    redoBtn.disabled = history.index >= history.stack.length - 1;
  }
  function resetHistory() {
    clearTimeout(recordTimer);
    recordTimer = 0;
    history.stack = [textarea.value];
    history.index = 0;
    updateHistoryButtons();
  }
  function recordHistory() {
    clearTimeout(recordTimer);
    recordTimer = 0;
    if (history.applying) return;
    if (history.index >= 0 && history.stack[history.index] === textarea.value) return;
    history.stack = history.stack.slice(0, history.index + 1);
    history.stack.push(textarea.value);
    if (history.stack.length > 200) history.stack.shift();
    history.index = history.stack.length - 1;
    updateHistoryButtons();
  }
  function scheduleRecord() {
    clearTimeout(recordTimer);
    recordTimer = setTimeout(recordHistory, 450);
  }
  function applyHistory() {
    history.applying = true;
    textarea.value = history.stack[history.index];
    setDirty(!current || textarea.value !== current.content);
    refreshModeView();
    history.applying = false;
    updateHistoryButtons();
  }
  function undo() {
    recordHistory(); // capture any pending typed state first
    if (history.index > 0) {
      history.index--;
      applyHistory();
    }
  }
  function redo() {
    if (history.index < history.stack.length - 1) {
      history.index++;
      applyHistory();
    }
  }

  // ---- mobile sidebar drawer ----
  function openSidebar() { document.body.classList.add("sidebar-open"); }
  function closeSidebar() { document.body.classList.remove("sidebar-open"); }
  function toggleSidebar() { document.body.classList.toggle("sidebar-open"); }

  // ---- markdown insert helpers ----
  // Replace the current selection with `str`, then place the caret/selection
  // using offsets relative to the start of the inserted text.
  function replaceSelection(str, selStart, selEnd) {
    textarea.focus();
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    textarea.value = textarea.value.slice(0, start) + str + textarea.value.slice(end);
    const base = start + (selStart == null ? str.length : selStart);
    const tail = selEnd == null ? base : start + selEnd;
    textarea.setSelectionRange(base, tail);
    textarea.focus();
    markEdited();
    recordHistory();
  }

  // Wrap the selection (or a placeholder) with before/after markers.
  function wrap(before, after, placeholder) {
    const sel = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
    const mid = sel || placeholder;
    replaceSelection(before + mid + after, before.length, before.length + mid.length);
  }

  // Insert a block on its own line(s), keeping blank-line separation tidy.
  function insertBlock(block) {
    textarea.focus();
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const pre = textarea.value.slice(0, start);
    const post = textarea.value.slice(end);
    const lead = pre.length && !pre.endsWith("\n") ? "\n" : "";
    const trail = post.length && !post.startsWith("\n") ? "\n" : "";
    const insert = lead + block + trail;
    textarea.value = pre + insert + post;
    const caret = (pre + lead + block).length;
    textarea.setSelectionRange(caret, caret);
    textarea.focus();
    markEdited();
    recordHistory();
  }

  // Prefix every line touched by the selection (for lists, quotes, headings).
  function prefixLines(prefixFn) {
    const value = textarea.value;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    let lineEnd = value.indexOf("\n", end);
    if (lineEnd === -1) lineEnd = value.length;
    const newBlock = value
      .slice(lineStart, lineEnd)
      .split("\n")
      .map((line, i) => prefixFn(line, i))
      .join("\n");
    textarea.value = value.slice(0, lineStart) + newBlock + value.slice(lineEnd);
    textarea.setSelectionRange(lineStart, lineStart + newBlock.length);
    textarea.focus();
    markEdited();
    recordHistory();
  }

  function insertLink(image) {
    const sel = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
    const url = prompt(image ? "Image URL:" : "Link URL:", "https://");
    if (url === null) return;
    const label = prompt(image ? "Alt text:" : "Link text:", sel || "");
    if (label === null) return;
    const text = label || (image ? "image" : url);
    replaceSelection((image ? "!" : "") + "[" + text + "](" + url + ")");
  }

  function insertTable() {
    const cols = parseInt(prompt("Number of columns:", "3"), 10);
    if (!cols || cols < 1) return;
    let rows = parseInt(prompt("Number of data rows:", "2"), 10);
    if (isNaN(rows) || rows < 0) rows = 2;
    const row = (cells) => "| " + cells.join(" | ") + " |";
    const header = row(Array.from({ length: cols }, (_, i) => "Column " + (i + 1)));
    const sep = row(Array.from({ length: cols }, () => "---"));
    const body = Array.from({ length: rows }, () =>
      row(Array.from({ length: cols }, () => "   "))
    ).join("\n");
    insertBlock([header, sep, body].filter(Boolean).join("\n"));
  }

  function insertCodeBlock() {
    const lang = prompt("Language (optional):", "") || "";
    const sel = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
    insertBlock("```" + lang + "\n" + (sel || "") + "\n```");
  }

  const inserters = {
    link: () => insertLink(false),
    image: () => insertLink(true),
    table: insertTable,
    code: insertCodeBlock,
    bold: () => wrap("**", "**", "bold text"),
    italic: () => wrap("*", "*", "italic text"),
    heading: () => prefixLines((l) => "## " + l.replace(/^#+\s*/, "")),
    ul: () => prefixLines((l) => "- " + l.replace(/^[-*]\s*/, "")),
    task: () => prefixLines((l) => "- [ ] " + l.replace(/^(- \[[ x]\]\s*|[-*]\s*)/, "")),
    quote: () => prefixLines((l) => "> " + l.replace(/^>\s*/, "")),
  };

  function setInsertMenu(open) {
    insertDropdown.hidden = !open;
    insertMenuBtn.setAttribute("aria-expanded", String(open));
  }

  // ---- todo (checklist) mode ----
  // The textarea markdown is the single source of truth. We parse bullet lines
  // into a checklist; every change rewrites the markdown and re-renders. A
  // "todo" is any bullet line; one level of nesting is supported (Google
  // Keep-style), expressed as indentation:
  //   - [ ] Store A          (parent / top level, depth 0)
  //     - [ ] Milk           (child, depth 1)
  //     - [x] Eggs
  const TODO_RE = /^(\s*)([-*+])\s+(?:\[([ xX])\]\s+)?(.*)$/;
  const CHILD_INDENT = "  "; // 2 spaces == one nesting level
  const INDENT_PX = 26; // visual indent of a child row
  const INDENT_GRAB = 24; // horizontal drag distance to nest/un-nest
  let todoModel = { lines: [], items: [] };

  // Collapsed parents are tracked by their text, persisted per note. Compact
  // density is a global preference. completedExpanded tracks which groups have
  // their "N completed items" overflow opened (in-memory, transient).
  const CHECKED_PREVIEW = 5; // checked children shown before collapsing the rest
  let collapsed = new Set();
  let completedExpanded = new Set();
  let compact = localStorage.getItem("notes.todoCompact") === "1";

  function collapsedKey() {
    return "notes.todoCollapsed:" + (currentRepo || "") + ":" + ((current && current.path) || "");
  }
  function loadCollapsed() {
    completedExpanded = new Set();
    try {
      collapsed = new Set(JSON.parse(localStorage.getItem(collapsedKey()) || "[]"));
    } catch (_) {
      collapsed = new Set();
    }
  }
  function saveCollapsed() {
    try {
      localStorage.setItem(collapsedKey(), JSON.stringify([...collapsed]));
    } catch (_) { /* ignore quota/availability errors */ }
  }
  function applyCompact() {
    todoPane.classList.toggle("compact", compact);
    todoCompactBtn.setAttribute("aria-pressed", String(compact));
  }

  function depthOf(indent) {
    return indent.replace(/\t/g, "  ").length >= 2 ? 1 : 0; // clamp to one level
  }

  function parseTodos(text) {
    const lines = text.split("\n");
    const items = [];
    let inFence = false;
    lines.forEach((line, i) => {
      if (/^\s*```/.test(line)) { inFence = !inFence; return; }
      if (inFence) return;
      const m = line.match(TODO_RE);
      if (!m) return;
      items.push({
        pos: i,
        marker: m[2],
        hasCheckbox: m[3] !== undefined,
        checked: (m[3] || "").toLowerCase() === "x",
        text: m[4],
        depth: depthOf(m[1]),
      });
    });
    return { lines, items };
  }

  // Render an item back to its markdown line (indentation from its depth).
  function serializeItem(it) {
    const prefix = (it.depth ? CHILD_INDENT : "") + it.marker + " ";
    if (it.hasCheckbox || it.checked) {
      return prefix + "[" + (it.checked ? "x" : " ") + "] " + it.text;
    }
    return prefix + it.text;
  }

  // Group items into [{ head, children }] by depth, normalising stray children
  // (a depth-1 line with no parent above) up to top level.
  function groupsOf(items) {
    const groups = [];
    for (const it of items) {
      if (it.depth === 0 || groups.length === 0) {
        it.depth = 0;
        groups.push({ head: it, children: [] });
      } else {
        it.depth = 1;
        groups[groups.length - 1].children.push(it);
      }
    }
    return groups;
  }

  // Flatten groups back to an item list, sorting each parent's children so
  // unchecked come before checked (stable). Top-level order is left to the user.
  function sortGroups(items) {
    const out = [];
    for (const g of groupsOf(items)) {
      out.push(g.head);
      const kids = g.children.slice();
      kids.sort((a, b) => (a.checked === b.checked ? 0 : a.checked ? 1 : -1));
      out.push(...kids);
    }
    return out;
  }

  // Write new markdown to the textarea, mark dirty, and re-render the checklist.
  function commitTodos(newText) {
    textarea.value = newText;
    setDirty(true);
    if (mode === "split" || mode === "preview") renderPreview();
    renderTodos();
    recordHistory();
  }

  // Serialize an ordered item list back into the original todo line slots,
  // leaving non-todo lines (headings, prose) exactly where they are.
  function orderedText(ordered) {
    const { lines, items } = todoModel;
    const slots = items.map((it) => it.pos).sort((a, b) => a - b);
    const next = lines.slice();
    ordered.forEach((it, k) => { next[slots[k]] = serializeItem(it); });
    return next.join("\n");
  }

  function setTodoText(idx, text) {
    const { lines, items } = todoModel;
    const it = items[idx];
    if (!it) return;
    it.text = text.replace(/\s+/g, " ").trim();
    lines[it.pos] = serializeItem(it);
    commitTodos(lines.join("\n"));
  }

  // Toggle a checkbox. Toggling a parent cascades to all its children; then
  // children re-sort unchecked-first.
  function toggleTodo(idx) {
    const items = todoModel.items;
    const it = items[idx];
    if (!it) return;
    const grp = groupsOf(items).find((g) => g.head === it);
    const val = !it.checked;
    it.checked = val;
    it.hasCheckbox = true;
    if (grp && grp.children.length) {
      grp.children.forEach((c) => { c.checked = val; c.hasCheckbox = true; });
    }
    commitTodos(orderedText(sortGroups(items)));
  }

  function deleteTodo(idx) {
    const { lines, items } = todoModel;
    const it = items[idx];
    if (!it) return;
    const grp = groupsOf(items).find((g) => g.head === it);
    const kids = grp ? grp.children : [];
    if (kids.length && !confirm('Delete "' + it.text + '" and its ' + kids.length + ' item(s)?')) {
      return;
    }
    // Remove the parent and all its children (descending positions keep indices valid).
    const positions = [it.pos, ...kids.map((c) => c.pos)].sort((a, b) => b - a);
    positions.forEach((p) => lines.splice(p, 1));
    commitTodos(lines.join("\n"));
  }

  function addTodo(text) {
    const clean = text.replace(/\s+/g, " ").trim();
    if (!clean) return;
    const { lines, items } = todoModel;
    const at = items.length ? items[items.length - 1].pos + 1 : lines.length;
    lines.splice(at, 0, "- [ ] " + clean);
    commitTodos(lines.join("\n"));
  }

  // Build one checklist row.
  function makeRow(it, idx, opts) {
    const isParent = !!opts.isParent;
    const li = document.createElement("li");
    li.className =
      "todo-item" +
      (it.checked ? " checked" : "") +
      (it.depth ? " todo-child" : "") +
      (isParent ? " todo-parent" : "") +
      (opts.hidden ? " is-hidden" : "");
    li.dataset.idx = idx;

    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = "todo-drag";
    handle.setAttribute("aria-label", "Drag to reorder or nest");
    handle.innerHTML = '<i class="fa-solid fa-grip-vertical"></i>';
    handle.addEventListener("pointerdown", (e) => startDrag(e, li));

    const check = document.createElement("button");
    check.type = "button";
    check.className = "todo-check";
    check.setAttribute("role", "checkbox");
    check.setAttribute("aria-checked", String(it.checked));
    check.innerHTML = '<i class="fa-solid fa-check"></i>';
    check.addEventListener("click", () => toggleTodo(idx));

    const text = document.createElement("span");
    text.className = "todo-text";
    text.contentEditable = "true";
    text.spellcheck = true;
    text.textContent = it.text;
    text.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); text.blur(); }
    });
    text.addEventListener("blur", () => {
      const v = text.textContent;
      if (v !== it.text) setTodoText(idx, v);
    });

    li.append(handle, check, text);

    if (isParent) {
      const kids = opts.kids || [];
      if (opts.isCollapsed) {
        const left = kids.filter((c) => !c.checked).length;
        const badge = document.createElement("span");
        badge.className = "todo-badge" + (left ? "" : " done");
        badge.textContent = left ? String(left) : "✓";
        badge.title = left + " of " + kids.length + " remaining";
        li.append(badge);
      }
      const caret = document.createElement("button");
      caret.type = "button";
      caret.className = "todo-collapse" + (opts.isCollapsed ? " collapsed" : "");
      caret.setAttribute("aria-label", opts.isCollapsed ? "Expand group" : "Collapse group");
      caret.setAttribute("aria-expanded", String(!opts.isCollapsed));
      caret.innerHTML = '<i class="fa-solid fa-chevron-down"></i>';
      li.append(caret);

      // Clicking anywhere on a parent row toggles collapse — except the text
      // (which you click to edit) and the other controls (their own actions).
      li.addEventListener("click", (e) => {
        if (e.target.closest(".todo-text, .todo-check, .todo-drag, .todo-del")) return;
        toggleCollapse(it.text);
      });
    }

    const del = document.createElement("button");
    del.type = "button";
    del.className = "todo-del";
    del.setAttribute("aria-label", "Delete task");
    del.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    del.addEventListener("click", () => deleteTodo(idx));
    li.append(del);

    return li;
  }

  function makeSummary(parentText, count, expanded) {
    const li = document.createElement("li");
    li.className = "todo-summary" + (expanded ? " expanded" : "");
    li.innerHTML = '<i class="fa-solid fa-chevron-down"></i>';
    const label = document.createElement("span");
    label.textContent = count + " completed item" + (count === 1 ? "" : "s");
    li.append(label);
    li.addEventListener("click", () => toggleCompleted(parentText));
    return li;
  }

  // Render groups in display order (children sorted unchecked-first). All items
  // stay in the DOM; rows that are collapsed or beyond the completed preview get
  // .is-hidden so drag/serialisation still see them.
  function renderTodos() {
    todoModel = parseTodos(textarea.value);
    todoListEl.textContent = "";
    todoEmptyEl.hidden = todoModel.items.length > 0;
    applyCompact();

    const idxOf = new Map(todoModel.items.map((it, i) => [it, i]));
    const groups = groupsOf(todoModel.items);
    const total = todoModel.items.length;
    const done = todoModel.items.filter((it) => it.checked).length;
    todoCountEl.textContent = total ? done + " / " + total + " done" : "";

    for (const g of groups) {
      const isParent = g.children.length > 0;
      const parentCollapsed = isParent && collapsed.has(g.head.text);
      todoListEl.appendChild(
        makeRow(g.head, idxOf.get(g.head), {
          isParent,
          isCollapsed: parentCollapsed,
          kids: g.children,
        })
      );

      const unchecked = g.children.filter((c) => !c.checked);
      const checkedKids = g.children.filter((c) => c.checked);

      for (const c of unchecked) {
        todoListEl.appendChild(makeRow(c, idxOf.get(c), { hidden: parentCollapsed }));
      }

      const showAll = completedExpanded.has(g.head.text);
      checkedKids.forEach((c, i) => {
        const overflow = i >= CHECKED_PREVIEW;
        const hidden = parentCollapsed || (overflow && !showAll);
        todoListEl.appendChild(makeRow(c, idxOf.get(c), { hidden }));
      });

      // "N completed items" toggle when a group has more checked than the preview.
      if (!parentCollapsed && checkedKids.length > CHECKED_PREVIEW) {
        todoListEl.appendChild(makeSummary(g.head.text, checkedKids.length, showAll));
      }
    }
  }

  function toggleCompleted(textKey) {
    if (completedExpanded.has(textKey)) completedExpanded.delete(textKey);
    else completedExpanded.add(textKey);
    renderTodos();
  }

  function toggleCollapse(textKey) {
    if (collapsed.has(textKey)) collapsed.delete(textKey);
    else collapsed.add(textKey);
    saveCollapsed();
    renderTodos();
  }

  function setCompact(on) {
    compact = on;
    localStorage.setItem("notes.todoCompact", on ? "1" : "0");
    applyCompact();
  }

  // Collapse every parent, or expand all if any are already collapsed.
  function toggleCollapseAll() {
    const parents = groupsOf(todoModel.items)
      .filter((g) => g.children.length)
      .map((g) => g.head.text);
    const anyCollapsed = parents.some((t) => collapsed.has(t));
    if (anyCollapsed) collapsed = new Set();
    else collapsed = new Set(parents);
    saveCollapsed();
    renderTodos();
  }

  // Pointer-based drag (touch + mouse). The held row (and, for a parent, its
  // children) lifts and follows the finger; other rows glide via FLIP. Dragging
  // a childless row right/left nests/un-nests it under the row above.
  const LIFT = " scale(1.03)";
  let drag = null;

  // The contiguous element(s) that move together: a row, plus its children if
  // it is a parent.
  function blockOf(item) {
    const els = [item];
    const it = todoModel.items[+item.dataset.idx];
    if (it && it.depth === 0) {
      // Gather everything up to the next top-level row: child rows (visible or
      // hidden) and the group's "completed" summary row all move together.
      let el = item.nextElementSibling;
      while (el) {
        const ci = el.classList.contains("todo-item")
          ? todoModel.items[+el.dataset.idx]
          : null;
        if (ci && ci.depth === 0) break;
        els.push(el);
        el = el.nextElementSibling;
      }
    }
    return els;
  }

  function startDrag(e, item) {
    e.preventDefault();
    // Stop iOS from text-selecting the row being dragged: drop any caret/focus
    // and suppress selection on the list for the duration of the drag.
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    const sel = window.getSelection && window.getSelection();
    if (sel && sel.removeAllRanges) sel.removeAllRanges();
    todoListEl.classList.add("dragging-active");

    const block = blockOf(item);
    const it = todoModel.items[+item.dataset.idx];
    drag = {
      item,
      block,
      startX: e.clientX,
      depth: it.depth,
      // Any row may be nested. If a parent is nested under another parent, its
      // children move with it and flatten in alongside (we only allow one level
      // deep), so a row can never get stranded as an un-nestable parent.
      canNest: true,
    };
    lastX = e.clientX;
    lastY = e.clientY;
    block.forEach((el) => el.classList.add("dragging"));
    item.style.transform = LIFT.trim(); // immediate "grabbed" pop
    document.addEventListener("pointermove", onDragMove);
    document.addEventListener("pointerup", endDrag, { once: true });
    document.addEventListener("pointercancel", endDrag, { once: true });
  }

  function dragAfter(y) {
    const others = [
      ...todoListEl.querySelectorAll(".todo-item:not(.dragging):not(.is-hidden)"),
    ];
    return others.reduce(
      (closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) return { offset, el: child };
        return closest;
      },
      { offset: -Infinity, el: null }
    ).el;
  }

  // Reorder the DOM while animating the displaced (non-dragged) rows from their
  // old to their new positions (First-Last-Invert-Play).
  function flipMove(mutate, draggedEls) {
    const set = new Set(draggedEls);
    const others = [...todoListEl.children].filter((el) => !set.has(el));
    const firstTop = new Map(others.map((el) => [el, el.getBoundingClientRect().top]));
    mutate();
    for (const el of others) {
      const dy = firstTop.get(el) - el.getBoundingClientRect().top;
      if (!dy) continue;
      el.style.transition = "none";
      el.style.transform = `translateY(${dy}px)`;
      requestAnimationFrame(() => {
        el.style.transition = "";
        el.style.transform = "";
      });
    }
  }

  function placeBlock(after) {
    for (const el of drag.block) {
      if (after == null) todoListEl.appendChild(el);
      else todoListEl.insertBefore(el, after);
    }
  }

  // Recompute placement + translation from the last known pointer position.
  // Driven by pointermove and by the auto-scroll loop (which moves the list
  // under a stationary finger).
  let lastX = 0;
  let lastY = 0;
  let autoScrollRAF = 0;

  function dragUpdate() {
    if (!drag) return;
    const head = drag.item;
    const after = dragAfter(lastY);
    const lastNext = drag.block[drag.block.length - 1].nextElementSibling;
    if (after !== lastNext) flipMove(() => placeBlock(after), drag.block);

    // Horizontal nesting feedback.
    if (drag.canNest) {
      const dx = lastX - drag.startX;
      drag.depth = dx > INDENT_GRAB && head.previousElementSibling ? 1 : 0;
    }

    // Track the finger: clear transforms to measure the laid-out slot, then
    // translate the whole block so the head sits under the pointer.
    drag.block.forEach((el) => (el.style.transform = ""));
    const rect = head.getBoundingClientRect();
    const dy = lastY - (rect.top + rect.height / 2);
    const tx = drag.canNest ? drag.depth * INDENT_PX : 0;
    head.style.transform = `translate(${tx}px, ${dy}px)` + LIFT;
    for (const el of drag.block) {
      if (el !== head) el.style.transform = `translateY(${dy}px)`;
    }
  }

  // Scroll the list when the finger nears its top/bottom edge, so long lists
  // can be reordered beyond the visible viewport. Self-perpetuates while the
  // finger stays in the edge zone (even if it isn't moving).
  function autoScrollTick() {
    autoScrollRAF = 0;
    if (!drag || !todoScrollEl) return;
    const rect = todoScrollEl.getBoundingClientRect();
    const EDGE = 56;
    const MAX = 16;
    let v = 0;
    if (lastY < rect.top + EDGE) v = -MAX * Math.min(1, (rect.top + EDGE - lastY) / EDGE);
    else if (lastY > rect.bottom - EDGE) v = MAX * Math.min(1, (lastY - (rect.bottom - EDGE)) / EDGE);
    if (v) {
      const before = todoScrollEl.scrollTop;
      todoScrollEl.scrollTop += v;
      if (todoScrollEl.scrollTop !== before) dragUpdate();
      autoScrollRAF = requestAnimationFrame(autoScrollTick);
    }
  }

  function onDragMove(e) {
    if (!drag) return;
    lastX = e.clientX;
    lastY = e.clientY;
    dragUpdate();
    if (!autoScrollRAF) autoScrollTick();
  }

  function endDrag() {
    if (!drag) return;
    const { block } = drag;
    cancelAnimationFrame(autoScrollRAF);
    autoScrollRAF = 0;
    todoListEl.classList.remove("dragging-active");
    document.removeEventListener("pointermove", onDragMove);
    document.removeEventListener("pointerup", endDrag);
    document.removeEventListener("pointercancel", endDrag);
    block.forEach((el) => {
      el.classList.remove("dragging");
      el.style.transition = "";
      el.style.transform = "";
    });

    const items = todoModel.items;
    if (drag.canNest) items[+drag.item.dataset.idx].depth = drag.depth;

    // Every item (including hidden/collapsed ones) is in the DOM, so DOM order
    // is the full order.
    const ordered = [...todoListEl.querySelectorAll(".todo-item")].map(
      (el) => items[+el.dataset.idx]
    );
    drag = null;

    const text = orderedText(sortGroups(ordered));
    if (text !== textarea.value) commitTodos(text);
    else renderTodos(); // resync DOM/model if nothing actually changed
  }

  async function openNote(path) {
    if (dirty && !confirm("Discard unsaved changes?")) return;
    try {
      const res = await Api.getNote(currentRepo, path);
      current = { path: res.path, content: res.content };
      localStorage.setItem(lastNoteKey(), res.path);
      loadCollapsed();
      textarea.value = res.content;
      resetHistory();
      currentPathEl.textContent = res.path;
      setDirty(false);
      showEditor();
      closeSidebar();
      refreshModeView();
      renderList();
      if (mode === "edit") textarea.focus();
    } catch (err) {
      toast("Could not open note: " + err.message, "error");
    }
  }

  function describeGit(git) {
    if (!git) return;
    if (git.pushError) {
      toast(
        "Saved & committed locally, but the push to upstream failed.",
        "error",
        git.pushError + "\n\nTry Refresh to pull remote changes, then save again."
      );
    } else if (git.pushed) {
      toast("Saved, committed & pushed.", "success");
    } else if (git.committed) {
      toast("Saved & committed.", "success");
    } else {
      toast(git.message || "Saved.", "info");
    }
  }

  async function save(opts) {
    const auto = !!(opts && opts.auto);
    if (!current || !dirty || saving) return;
    saving = true;
    clearTimeout(autosaveTimer);
    setSyncState("saving");
    if (!auto) saveBtn.classList.add("is-loading");
    saveBtn.disabled = true;
    try {
      // Send the version we loaded as the merge base; the server 3-way merges
      // if the file changed underneath us.
      const res = await Api.saveNote(currentRepo, current.path, textarea.value, current.content);
      // Adopt the canonical stored content as our new base. If the server merged
      // in another device's edits, reflect them in the editor too.
      if (res.merged) {
        textarea.value = res.content;
        toast(
          res.overlap
            ? "Merged with another device — overlapping edits were both kept; tidy up any duplicates."
            : "Merged with changes from another device & saved.",
          res.overlap ? "warn" : "success"
        );
        refreshModeView();
        recordHistory(); // a merge changed the text — make it an undoable state
      }
      // Saving is independent of edit history: do NOT reset undo/redo here, or an
      // auto-save would erase the user's ability to undo the change they just made.
      current.content = res.content;
      setDirty(false);
      // A local commit that failed to push isn't fully synced — flag it.
      setSyncState(res.git && res.git.pushError ? "error" : "saved");
      // Auto-saves stay quiet on success; only surface push failures/merges.
      if (!auto || (res.git && res.git.pushError)) describeGit(res.git);
      refreshStatus();
      // keep listing fresh (size/mtime) without disrupting selection
      Api.listNotes(currentRepo).then((r) => { notes = r.notes || []; renderList(); }).catch(() => {});
    } catch (err) {
      toast("Save failed: " + err.message, "error");
      setSyncState("error");
    } finally {
      saving = false;
      saveBtn.classList.remove("is-loading");
      saveBtn.disabled = !dirty;
    }
  }

  async function newNote() {
    if (dirty && !confirm("Discard unsaved changes?")) return;
    let name = prompt("New note path (e.g. ideas/today.md):", "");
    if (name === null) return;
    name = name.trim();
    if (!name) return;
    if (!/\.md$/i.test(name)) name += ".md";
    if (notes.some((n) => n.path === name)) {
      toast("A note with that path already exists.", "warn");
      openNote(name);
      return;
    }
    current = { path: name, content: "" };
    loadCollapsed();
    textarea.value = "# " + name.replace(/\.md$/i, "").split("/").pop() + "\n\n";
    resetHistory();
    currentPathEl.textContent = name;
    showEditor();
    closeSidebar();
    setDirty(true);
    setMode("edit");
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }

  async function deleteNote() {
    if (!current) return;
    if (!confirm('Delete "' + current.path + '"? This commits the deletion to git.')) return;
    const path = current.path;
    // A never-saved new note isn't on disk yet — just discard it.
    const exists = notes.some((n) => n.path === path);
    if (!exists) {
      closeNote();
      return;
    }
    try {
      const res = await Api.deleteNote(currentRepo, path);
      describeGit(res.git);
      closeNote();
      loadList();
      refreshStatus();
    } catch (err) {
      toast("Delete failed: " + err.message, "error");
    }
  }

  function closeNote() {
    current = null;
    localStorage.removeItem(lastNoteKey());
    setDirty(false);
    textarea.value = "";
    editorPane.hidden = true;
    emptyState.hidden = false;
    renderList();
  }

  // ---- git status & refresh ----
  async function refreshStatus() {
    if (!currentRepo) {
      statusText.textContent = "";
      return;
    }
    try {
      const s = await Api.status(currentRepo);
      let label = s.branch || "—";
      const bits = [];
      if (s.ahead) bits.push("↑" + s.ahead);
      if (s.behind) bits.push("↓" + s.behind);
      if (bits.length) label += " " + bits.join(" ");
      statusText.textContent = label;
      statusPill.classList.toggle("has-upstream", !!s.hasUpstream);
      statusPill.classList.toggle("behind", s.behind > 0);
      statusPill.title = s.hasUpstream
        ? "Tracking " + s.remote + " · " + (s.lastCommit || "")
        : "No upstream remote configured";
    } catch (err) {
      statusText.textContent = "offline";
    }
  }

  // Reconcile the sidebar and the open note with what's actually on disk.
  // Every device shares one backend, so a note can change underneath us without
  // git reporting anything from the remote (the change is already local). This
  // never silently discards either side: if you have unsaved edits and the note
  // also changed elsewhere, we ask.
  async function reloadOpenNote() {
    await loadList();
    if (!current) return;

    const openPath = current.path;
    const stillExists = notes.some((n) => n.path === openPath);

    // A brand-new, never-saved note isn't on disk yet — leave it untouched.
    if (!stillExists && current.content === "") return;

    if (!stillExists) {
      toast(
        "“" + openPath + "” was deleted on another device.",
        "warn",
        dirty ? "Your text is still here — Save to recreate the note." : ""
      );
      return;
    }

    let disk;
    try {
      disk = (await Api.getNote(currentRepo, openPath)).content;
    } catch (err) {
      toast("Could not reload note: " + err.message, "error");
      return;
    }

    if (disk === current.content) return; // nothing changed upstream

    if (dirty) {
      // You have unsaved edits and the note also changed elsewhere. Don't touch
      // your text or the merge base — when you Save, the server 3-way merges the
      // two and only flags a conflict if they truly overlap.
      toast(
        "“" + openPath + "” also changed on another device.",
        "warn",
        "Your unsaved edits are kept. Saving will merge both versions automatically."
      );
      return;
    }

    current.content = disk;
    textarea.value = disk;
    resetHistory();
    setDirty(false);
    refreshModeView();
    toast("Loaded the latest version of this note.", "info");
  }

  async function doRefresh(btn) {
    btn.classList.add("is-loading");
    btn.disabled = true;
    try {
      const res = await Api.refresh(currentRepo);
      if (res.conflict) {
        toast(res.message, "error", res.detail);
      } else if (res.updated) {
        toast(res.message, "success");
      } else {
        toast(res.message || "Up to date.", "info");
      }
      // Always reconcile with disk, even when git pulled nothing — another
      // device may have written through this same backend.
      await reloadOpenNote();
    } catch (err) {
      toast("Refresh failed: " + err.message, "error");
    } finally {
      btn.classList.remove("is-loading");
      btn.disabled = false;
      refreshStatus();
    }
  }

  // ---- wiring ----
  textarea.addEventListener("input", () => {
    markEdited();
    scheduleRecord();
  });
  undoBtn.addEventListener("click", undo);
  redoBtn.addEventListener("click", redo);

  // Markdown insert menu.
  insertMenuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    setInsertMenu(insertDropdown.hidden);
  });
  insertDropdown.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-insert]");
    if (!btn) return;
    setInsertMenu(false);
    const fn = inserters[btn.dataset.insert];
    if (fn) fn();
  });
  document.addEventListener("click", (e) => {
    if (!insertDropdown.hidden && !e.target.closest(".insert-wrap")) {
      setInsertMenu(false);
    }
  });

  filterEl.addEventListener("input", renderList);
  saveBtn.addEventListener("click", save);
  $("[data-new]").addEventListener("click", newNote);
  $("[data-new-empty]").addEventListener("click", newNote);
  $("[data-delete]").addEventListener("click", deleteNote);
  $("[data-refresh]").addEventListener("click", (e) => doRefresh(e.currentTarget));
  $("[data-logout]").addEventListener("click", () => {
    if (dirty && !confirm("Discard unsaved changes and sign out?")) return;
    Auth.clear();
    window.location.replace("/login/");
  });
  document.querySelectorAll(".mode-btn").forEach((b) =>
    b.addEventListener("click", () => setMode(b.dataset.mode))
  );
  sidebarToggle.addEventListener("click", toggleSidebar);
  sidebarBackdrop.addEventListener("click", closeSidebar);
  todoForm.addEventListener("submit", (e) => {
    e.preventDefault();
    addTodo(todoInput.value);
    todoInput.value = "";
    todoInput.focus();
  });
  todoCompactBtn.addEventListener("click", () => setCompact(!compact));
  todoCollapseAllBtn.addEventListener("click", toggleCollapseAll);
  if (repoSelect) {
    repoSelect.addEventListener("change", () => {
      const id = repoSelect.value;
      if (dirty && !confirm("Discard unsaved changes?")) {
        repoSelect.value = currentRepo;
        return;
      }
      selectRepo(id);
    });
  }

  // Keyboard shortcuts: save, undo/redo, escape.
  document.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "s") {
      e.preventDefault();
      save();
    } else if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
      e.preventDefault();
      redo();
    }
    if (e.key === "Escape") {
      if (!insertDropdown.hidden) setInsertMenu(false);
      if (document.body.classList.contains("sidebar-open")) closeSidebar();
    }
  });

  // Warn before leaving with unsaved changes.
  window.addEventListener("beforeunload", (e) => {
    if (dirty) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  // ---- mobile viewport / keyboard handling ----
  // Lock the document (via html.app-root) so only inner panes scroll, and keep
  // the shell aligned to the *visual* viewport: iOS Safari shifts/shrinks the
  // visible area for the on-screen keyboard and leaves a residual offset after
  // it closes (which clips the header). Sizing the body to the visible height
  // and translating it by the visual viewport's offset tracks that exactly.
  document.documentElement.classList.add("app-root");
  const vv = window.visualViewport;
  function fitToViewport() {
    if (!vv) return;
    document.body.style.height = vv.height + "px";
    document.body.style.transform = vv.offsetTop ? "translateY(" + vv.offsetTop + "px)" : "";
  }
  let fitRaf = 0;
  function scheduleFit() {
    if (fitRaf) return;
    fitRaf = requestAnimationFrame(() => {
      fitRaf = 0;
      fitToViewport();
    });
  }
  if (vv) {
    vv.addEventListener("resize", scheduleFit);
    vv.addEventListener("scroll", scheduleFit);
    fitToViewport();
  }
  window.addEventListener("orientationchange", () => setTimeout(fitToViewport, 300));

  // iOS still touch-pans the fixed shell when a drag starts on non-scrollable
  // chrome (header, toolbar, empty areas). Cancel touchmove unless it began
  // inside a genuine scroll container, so dragging there does nothing.
  const SCROLLABLE = ".note-list, .editor-textarea, .editor-preview, .todo-scroll, .insert-menu, .toast-body pre";
  document.addEventListener(
    "touchmove",
    (e) => {
      if (!e.target.closest(SCROLLABLE)) e.preventDefault();
    },
    { passive: false }
  );

  // ---- init ----
  setMode(mode); // restore the last-used mode
  loadRepos(); // fetch repos, then open the last repo + note
  setInterval(refreshStatus, 60000);
})();
