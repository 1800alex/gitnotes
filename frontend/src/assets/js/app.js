/* Notes app controller: file list, editor, preview, git sync. */
(function () {
  "use strict";
  const { Auth, Api } = window.NotesApp;
  if (!Auth.requireLogin()) return;

  // Pure, unit-tested helpers (dates + the shared action grammar) live in core.js
  // so they can be tested in Node and kept parity with the Go backend.
  const {
    pad2, isoWeek, mondayOfISOWeek, addDays, normalizeTime, parseAction, serializeAction,
    parseRecurrence, recurrenceCanonical, recurrenceLabel, nextOccurrence, WEEKDAYS,
  } = window.NotesCore;

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
  const plannerPane = $("[data-planner-pane]");
  const plannerDaysEl = $("[data-planner-days]");
  const plannerWeekEl = $("[data-planner-week]");
  const plannerRangeEl = $("[data-planner-range]");
  const plannerModeBtn = $("[data-planner-mode-btn]");
  const recipePane = $("[data-recipe-pane]");
  const recipeBodyEl = $("[data-recipe-body]");
  const recipeModeBtn = $("[data-recipe-mode-btn]");
  const mealplanPane = $("[data-mealplan-pane]");
  const mealplanGridEl = $("[data-mealplan-grid]");
  const mealplanWeekEl = $("[data-mealplan-week]");
  const mealplanModeBtn = $("[data-mealplan-mode-btn]");
  const meetingPane = $("[data-meeting-pane]");
  const meetingBodyEl = $("[data-meeting-body]");
  const meetingModeBtn = $("[data-meeting-mode-btn]");
  const routinesPane = $("[data-routines-pane]");
  const routinesListEl = $("[data-routines-list]");
  const routinesEmptyEl = $("[data-routines-empty]");
  const routinesCountEl = $("[data-routines-count]");
  const routinesForm = $("[data-routines-add]");
  const routinesInput = $("[data-routines-input]");
  const routinesPickerMount = $("[data-routines-picker]");
  const routinesModeBtn = $("[data-routines-mode-btn]");
  const agendaPane = $("[data-agenda-pane]");
  const agendaListEl = $("[data-agenda-list]");
  const agendaSubEl = $("[data-agenda-sub]");
  const searchPane = $("[data-search-pane]");
  const searchForm = $("[data-search-form]");
  const searchInput = $("[data-search-input]");
  const searchResultsEl = $("[data-search-results]");
  const searchSubEl = $("[data-search-sub]");
  const draftBanner = $("[data-draft-banner]");
  const newMenuBtn = $("[data-new-menu]");
  const newDropdown = $("[data-new-dropdown]");

  // ---- state ----
  let repos = [];
  let currentRepo = null; // active repo id
  let notes = [];
  let current = null; // { path, content }
  let dirty = false;
  const MODES = ["edit", "split", "preview", "todo", "planner", "recipe", "mealplan", "meeting", "routines"];
  // Views tied to a note's type — selected when such a note opens, not sticky.
  const TYPED_MODES = ["planner", "recipe", "mealplan", "meeting", "routines"];
  let mode = MODES.includes(localStorage.getItem("notes.mode"))
    ? localStorage.getItem("notes.mode")
    : "edit";
  // Typed views are per-note, not a sticky default: never boot into one (the
  // matching note re-selects it on open).
  if (TYPED_MODES.includes(mode)) mode = "edit";

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
  let draftTimer = 0;

  // Auto-sync (debounced autosave) is user-configurable: on/off + the idle delay
  // before a save fires. Defaults to a relaxed 12s; off means save manually.
  const AUTOSYNC_DEFAULT_SECS = 12;
  const AUTOSYNC_MIN = 3;
  const AUTOSYNC_MAX = 300;
  let autosyncEnabled = localStorage.getItem("notes.autosync") !== "off";
  let autosyncSecs = (() => {
    const n = parseInt(localStorage.getItem("notes.autosyncSecs") || "", 10);
    return Number.isFinite(n) ? Math.min(AUTOSYNC_MAX, Math.max(AUTOSYNC_MIN, n)) : AUTOSYNC_DEFAULT_SECS;
  })();

  function scheduleAutosave() {
    clearTimeout(autosaveTimer);
    if (!autosyncEnabled) return; // manual-save mode
    autosaveTimer = setTimeout(() => {
      if (dirty && current && !saving) save({ auto: true });
    }, autosyncSecs * 1000);
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
    if (v) { scheduleAutosave(); scheduleDraftSave(); }
    else clearTimeout(autosaveTimer);
    // Reflect status (unless a save is mid-flight, which sets 'saving' itself).
    if (!saving) setSyncState(!current ? "idle" : v ? "dirty" : "saved");
  }

  // ---- local draft buffer ----
  // Every edit is mirrored to localStorage (independent of auto-sync, so it works
  // in manual-save mode and when offline). If a save can't reach the server, the
  // work survives a tab close/crash and is restored the next time the note opens.
  function draftKey(path) {
    return "notes.draft:" + (currentRepo || "") + ":" + (path || "");
  }
  function scheduleDraftSave() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(persistDraft, 800);
  }
  function persistDraft() {
    if (!current || !dirty) return;
    try {
      localStorage.setItem(
        draftKey(current.path),
        JSON.stringify({ content: textarea.value, at: Date.now() })
      );
    } catch (_) { /* storage full / unavailable — best effort */ }
  }
  function clearDraft(path) {
    clearTimeout(draftTimer);
    try { localStorage.removeItem(draftKey(path)); } catch (_) { /* ignore */ }
  }
  function readDraft(path) {
    try {
      const raw = localStorage.getItem(draftKey(path));
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }
  function showDraftBanner(on) {
    if (draftBanner) draftBanner.hidden = !on;
  }
  // Called from openNote after the server content is loaded: if a newer local
  // draft exists and differs, restore it (dirty) and flag the banner.
  function maybeRestoreDraft(path, serverContent) {
    const d = readDraft(path);
    if (!d || typeof d.content !== "string" || d.content === serverContent) {
      clearDraft(path);
      showDraftBanner(false);
      return false;
    }
    textarea.value = d.content;
    setDirty(true);
    showDraftBanner(true);
    return true;
  }
  function discardDraft() {
    if (!current) return;
    clearDraft(current.path);
    textarea.value = current.content;
    resetHistory();
    setDirty(false);
    showDraftBanner(false);
    refreshModeView();
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
    enhancePreview();
    hydrateImages();
    scrollToHash();
  }

  // GitHub-ish slug for heading anchors.
  function slugify(s) {
    return (s || "")
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }

  // Give headings stable ids (so #anchor links work) and make external links
  // open in a new tab (so clicking one doesn't navigate away from the app).
  function enhancePreview() {
    const seen = new Map();
    preview.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach((h) => {
      let slug = slugify(h.textContent) || "section";
      const n = seen.get(slug) || 0;
      seen.set(slug, n + 1);
      if (n) slug += "-" + n;
      h.id = slug;
    });
    preview.querySelectorAll("a[href]").forEach((a) => {
      if (/^https?:/i.test(a.getAttribute("href") || "")) {
        a.target = "_blank";
        a.rel = "noopener noreferrer";
      }
    });
    // Syntax-highlight fenced code blocks.
    if (window.hljs) {
      preview.querySelectorAll("pre code").forEach((el) => {
        try {
          window.hljs.highlightElement(el);
        } catch (_) {
          /* unknown language / already highlighted — ignore */
        }
      });
    }
  }

  function findAnchor(id) {
    if (!id) return null;
    const sel = "#" + (window.CSS && CSS.escape ? CSS.escape(id) : id);
    try {
      return preview.querySelector(sel);
    } catch (_) {
      return null;
    }
  }

  // Scroll the preview container (not the window — the app shell is locked) so
  // the element sits near the top.
  function scrollPreviewTo(el) {
    const er = el.getBoundingClientRect();
    const cr = preview.getBoundingClientRect();
    preview.scrollTo({ top: preview.scrollTop + (er.top - cr.top) - 8, behavior: "smooth" });
  }

  function scrollToHash() {
    const el = findAnchor(decodeURIComponent((location.hash || "").slice(1)));
    if (el) scrollPreviewTo(el);
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

  // Secondary views live in their own panes (not the edit/split/preview
  // container). Map each to its pane so setMode can show exactly one.
  const SECONDARY_PANES = {
    todo: () => todoPane,
    planner: () => plannerPane,
    recipe: () => recipePane,
    mealplan: () => mealplanPane,
    meeting: () => meetingPane,
    routines: () => routinesPane,
  };

  function setMode(next) {
    if (typeof closeCellPicker === "function") closeCellPicker();
    mode = next;
    localStorage.setItem("notes.mode", next);
    const isSecondary = !!SECONDARY_PANES[next];
    modeContainer.hidden = isSecondary;
    for (const [name, el] of Object.entries(SECONDARY_PANES)) {
      el().hidden = name !== next;
    }
    if (!isSecondary) modeContainer.dataset.view = next;
    document.querySelectorAll(".mode-btn").forEach((b) =>
      b.classList.toggle("is-active", b.dataset.mode === next)
    );
    refreshModeView();
  }

  // Update whichever secondary view the current mode shows.
  function refreshModeView() {
    if (mode === "split" || mode === "preview") renderPreview();
    else if (mode === "todo") renderTodos();
    else if (mode === "planner") renderPlanner();
    else if (mode === "recipe") renderRecipe();
    else if (mode === "mealplan") renderMealplan();
    else if (mode === "meeting") renderMeeting();
    else if (mode === "routines") renderRoutines();
  }

  function showEditor() {
    if (agendaOpen) closeAgenda();
    if (searchOpen) closeSearch();
    emptyState.hidden = true;
    editorPane.hidden = false;
  }

  // Called after any edit to the textarea (typed or programmatic).
  function markEdited() {
    setDirty(true);
    if (mode === "split" || mode === "preview") renderPreview();
  }

  // ---- planner (weekly) mode ----
  // A planner note is markdown with `## Monday`…`## Sunday` sections, each
  // holding `- [ ] task` lines. Like Checklist mode, the textarea is the single
  // source of truth: we parse it into a model, render seven day cards, and
  // rewrite the markdown on every change. Task lines use the shared grammar —
  // a leading `HH:MM` time and a trailing ` !` importance flag.
  const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const PLANNER_TASK_RE = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/;
  let plannerModel = null;      // { front, intro, days:{name:{tasks,extra}}, tail }
  let plannerWeek = null;       // { year, week }

  // pad2 / isoWeek / mondayOfISOWeek / addDays come from NotesCore (see top).
  function fmtDay(date) { return MONTHS[date.getUTCMonth()] + " " + date.getUTCDate(); }
  function fmtRange(mon, sun) {
    const a = fmtDay(mon);
    const b = sun.getUTCMonth() === mon.getUTCMonth() ? String(sun.getUTCDate()) : fmtDay(sun);
    return a + " – " + b + ", " + sun.getUTCFullYear();
  }

  function plannerPath(year, week) { return "planner/" + year + "-W" + pad2(week) + ".md"; }

  // Pull {year,week} from a `planner/2026-W31.md` path, else null.
  function weekFromPath(p) {
    const m = /(\d{4})-W(\d{2})/.exec(p || "");
    return m ? { year: +m[1], week: +m[2] } : null;
  }

  // normalizeTime comes from NotesCore (see top).

  // Split a task's text into {time, text, important}, honouring the shared grammar.
  function splitTokens(raw) {
    let text = raw.trim();
    let important = false;
    if (/\s!$/.test(text) || text === "!") {
      important = true;
      text = text.replace(/\s*!$/, "").trim();
    }
    let time = "";
    const tm = /^(\d{1,2}:\d{2})\s+(.*)$/.exec(text);
    if (tm) { time = normalizeTime(tm[1]); text = tm[2].trim(); }
    return { time, text, important };
  }

  function serializeTask(t) {
    let s = "- [" + (t.checked ? "x" : " ") + "] ";
    if (t.time) s += t.time + " ";
    s += t.text;
    if (t.important) s += " !";
    return s;
  }

  // Parse the whole note into a planner model. Anything that isn't a day section
  // (front-matter, an intro, stray `## Other` sections) is preserved verbatim so
  // round-tripping never loses hand-written content.
  function parsePlanner(text) {
    const lines = text.split("\n");
    let idx = 0;
    let front = [];
    if (lines[0] !== undefined && lines[0].trim() === "---") {
      front.push(lines[0]);
      idx = 1;
      while (idx < lines.length && lines[idx].trim() !== "---") front.push(lines[idx++]);
      if (idx < lines.length) { front.push(lines[idx]); idx++; } // closing ---
    }

    const days = {};
    DAY_NAMES.forEach((n) => { days[n] = { tasks: [], extra: [] }; });
    const intro = [];
    const tail = [];
    let bucket = intro;              // where non-heading lines land
    let curDay = null;

    for (; idx < lines.length; idx++) {
      const line = lines[idx];
      const hm = /^##\s+(.*)$/.exec(line);
      if (hm) {
        const name = DAY_NAMES.find((n) => n.toLowerCase() === hm[1].trim().toLowerCase());
        if (name) { curDay = name; bucket = null; continue; }
        curDay = null;
        tail.push(line);
        bucket = tail;
        continue;
      }
      if (curDay) {
        const tm = PLANNER_TASK_RE.exec(line);
        if (tm) {
          const parts = splitTokens(tm[2]);
          days[curDay].tasks.push({
            checked: tm[1].toLowerCase() === "x",
            time: parts.time, text: parts.text, important: parts.important,
          });
        } else if (line.trim() !== "") {
          days[curDay].extra.push(line);
        }
        continue;
      }
      bucket.push(line);
    }

    // Week: prefer front-matter `week:`, else the filename.
    let week = null;
    const wl = front.join("\n").match(/week:\s*(\d{4})-W(\d{2})/);
    if (wl) week = { year: +wl[1], week: +wl[2] };
    return { front, intro, days, tail, week };
  }

  function serializePlanner(m) {
    const out = [];
    if (m.front.length) out.push(...m.front);
    // trim leading/trailing blank lines of the intro, keep one blank separator
    const intro = m.intro.join("\n").replace(/^\n+|\n+$/g, "");
    if (intro) { out.push(intro, ""); }
    else if (m.front.length) out.push("");
    for (const name of DAY_NAMES) {
      out.push("## " + name);
      const d = m.days[name];
      const kids = d.tasks.slice().sort((a, b) => (a.checked === b.checked ? 0 : a.checked ? 1 : -1));
      for (const t of kids) out.push(serializeTask(t));
      for (const e of d.extra) out.push(e);
      out.push("");
    }
    if (m.tail.length) out.push(...m.tail);
    return out.join("\n").replace(/\n{3,}/g, "\n\n");
  }

  // Rewrite the textarea from the model, mark dirty, re-render.
  function commitPlanner() {
    textarea.value = serializePlanner(plannerModel);
    setDirty(true);
    if (mode === "split" || mode === "preview") renderPreview();
    renderPlanner();
    recordHistory();
  }

  function plannerScaffold(year, week) {
    const mon = mondayOfISOWeek(year, week);
    const sun = addDays(mon, 6);
    const out = [
      "---", "type: planner", "week: " + year + "-W" + pad2(week), "---", "",
      "# Week " + week + " · " + fmtRange(mon, sun), "",
    ];
    for (const n of DAY_NAMES) { out.push("## " + n, ""); }
    return out.join("\n");
  }

  function buildDayCard(name, dayIdx, mon, todayIdx) {
    const model = plannerModel.days[name];
    const date = addDays(mon, dayIdx);
    const section = document.createElement("section");
    section.className = "planner-day" + (dayIdx === todayIdx ? " is-today" : "");

    const head = document.createElement("div");
    head.className = "planner-day-head";
    const open = model.tasks.filter((t) => !t.checked).length;
    head.innerHTML =
      '<span class="planner-day-name">' + name + "</span>" +
      '<span class="planner-day-date">' + fmtDay(date) + "</span>" +
      '<span class="planner-day-count' + (open ? "" : " empty") + '">' + open + "</span>";
    section.appendChild(head);

    const ul = document.createElement("ul");
    ul.className = "planner-tasks";
    const ordered = model.tasks
      .map((t, i) => ({ t, i }))
      .sort((a, b) => (a.t.checked === b.t.checked ? 0 : a.t.checked ? 1 : -1));
    for (const { t, i } of ordered) ul.appendChild(buildTaskRow(name, t, i));
    section.appendChild(ul);

    const form = document.createElement("form");
    form.className = "planner-add";
    form.innerHTML =
      '<input type="text" placeholder="Add to ' + name + '…" autocomplete="off" aria-label="Add to ' + name + '">' +
      '<button type="submit" aria-label="Add task"><i class="fa-solid fa-plus"></i></button>';
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const input = form.querySelector("input");
      const raw = input.value.trim();
      if (!raw) return;
      const parts = splitTokens(raw);
      if (!parts.text) return;
      plannerModel.days[name].tasks.push({ checked: false, ...parts });
      input.value = "";
      commitPlanner();
    });
    section.appendChild(form);
    return section;
  }

  function buildTaskRow(name, task, i) {
    const li = document.createElement("li");
    li.className = "planner-task" + (task.checked ? " checked" : "") + (task.important ? " important" : "");

    const check = document.createElement("button");
    check.className = "planner-check";
    check.type = "button";
    check.setAttribute("aria-label", task.checked ? "Mark incomplete" : "Mark complete");
    check.innerHTML = '<i class="fa-solid fa-check"></i>';
    check.addEventListener("click", () => { task.checked = !task.checked; commitPlanner(); });

    const time = document.createElement("span");
    time.className = "planner-time" + (task.time ? "" : " empty");
    time.textContent = task.time || "＋time";
    time.title = "Set a time (HH:MM), blank to clear";
    time.addEventListener("click", () => {
      const v = prompt("Time (HH:MM), blank to clear:", task.time || "");
      if (v === null) return;
      task.time = v.trim() ? normalizeTime(v.trim()) : "";
      commitPlanner();
    });

    const text = document.createElement("span");
    text.className = "planner-text";
    text.contentEditable = "true";
    text.spellcheck = false;
    text.textContent = task.text;
    text.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); text.blur(); }
    });
    text.addEventListener("blur", () => {
      const v = text.textContent.trim();
      if (v === task.text) return;
      if (!v) { plannerModel.days[name].tasks.splice(i, 1); commitPlanner(); return; }
      task.text = v;
      commitPlanner();
    });

    const star = document.createElement("button");
    star.className = "planner-star" + (task.important ? " on" : "");
    star.type = "button";
    star.setAttribute("aria-label", task.important ? "Unmark important" : "Mark important");
    star.innerHTML = '<i class="fa-' + (task.important ? "solid" : "regular") + ' fa-star"></i>';
    star.addEventListener("click", () => { task.important = !task.important; commitPlanner(); });

    const del = document.createElement("button");
    del.className = "planner-del";
    del.type = "button";
    del.setAttribute("aria-label", "Delete task");
    del.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    del.addEventListener("click", () => { plannerModel.days[name].tasks.splice(i, 1); commitPlanner(); });

    li.append(check, time, text, star, del);
    return li;
  }

  function renderPlanner() {
    if (!current) return;
    plannerModel = parsePlanner(textarea.value);
    plannerWeek = plannerModel.week || weekFromPath(current.path) || isoWeek(new Date());

    const mon = mondayOfISOWeek(plannerWeek.year, plannerWeek.week);
    const sun = addDays(mon, 6);
    plannerWeekEl.textContent = "Week " + plannerWeek.week;
    plannerRangeEl.textContent = fmtRange(mon, sun);

    const nowIso = isoWeek(new Date());
    const todayIdx = (nowIso.year === plannerWeek.year && nowIso.week === plannerWeek.week)
      ? (new Date().getDay() + 6) % 7
      : -1;

    plannerDaysEl.textContent = "";
    DAY_NAMES.forEach((name, i) => plannerDaysEl.appendChild(buildDayCard(name, i, mon, todayIdx)));
  }

  // Open the planner for an ISO week, creating a scaffold if the file is absent.
  // Browsing to a not-yet-existing week shows the scaffold but doesn't write it
  // until you actually add a task.
  async function openPlannerWeek(year, week) {
    const path = plannerPath(year, week);
    if (notes.some((n) => n.path === path)) { openNote(path); return; }
    if (dirty && !confirm("Discard unsaved changes?")) return;
    current = { path, content: "" };
    localStorage.setItem(lastNoteKey(), path);
    textarea.value = plannerScaffold(year, week);
    resetHistory();
    currentPathEl.textContent = path;
    setNoteChrome("planner");
    showEditor();
    closeSidebar();
    setDirty(false);           // a freshly-browsed week isn't saved until edited
    setMode("planner");
    renderList();
  }

  function gotoWeek(delta) {
    if (!plannerWeek) return;
    const ref = addDays(mondayOfISOWeek(plannerWeek.year, plannerWeek.week), delta * 7);
    const w = isoWeek(ref);
    openPlannerWeek(w.year, w.week);
  }

  // Infer a note's type from front-matter, else its folder.
  function noteType(path, content) {
    const fm = /^---\n([\s\S]*?)\n---/.exec(content || "");
    if (fm) {
      const t = /(^|\n)type:\s*(\w+)/.exec(fm[1]);
      if (t) return t[2];
    }
    const p = path || "";
    if (/^planner\//.test(p)) return "planner";
    if (/^recipes\//.test(p)) return "recipe";
    if (/^meal-plans\//.test(p)) return "mealplan";
    if (/^meetings\//.test(p)) return "meeting";
    if (/^routines\//.test(p)) return "routines";
    return "";
  }

  // Show/hide type-specific toolbar affordances for the open note.
  function setNoteChrome(type) {
    if (plannerModeBtn) plannerModeBtn.hidden = type !== "planner";
    if (recipeModeBtn) recipeModeBtn.hidden = type !== "recipe";
    if (mealplanModeBtn) mealplanModeBtn.hidden = type !== "mealplan";
    if (meetingModeBtn) meetingModeBtn.hidden = type !== "meeting";
    if (routinesModeBtn) routinesModeBtn.hidden = type !== "routines";
  }

  // Pick the right view when a note opens: a typed note gets its view; opening a
  // plain note leaves any typed view so it isn't stuck on the wrong note.
  function autoSelectMode(path, content) {
    const t = noteType(path, content);
    setNoteChrome(t);
    if (TYPED_MODES.includes(t)) { setMode(t); return; }
    if (TYPED_MODES.includes(mode)) { setMode("edit"); return; }
    refreshModeView();
  }

  // Pretty title from a file path: "sheet-pan-chicken.md" → "Sheet Pan Chicken".
  function titleFromPath(p) {
    const base = (p || "").split("/").pop().replace(/\.md$/i, "");
    return base.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function renderMd(md) {
    if (window.marked) return window.marked.parse(md || "");
    const pre = document.createElement("pre");
    pre.textContent = md || "";
    return pre.outerHTML;
  }

  // ---- recipe mode ----
  // A recipe note: front-matter (servings/time/tags), a title, optional intro,
  // an "## Ingredients" checklist and a "## Steps" list. The view is a read-
  // optimised card; ticking an ingredient rewrites its markdown line (handy
  // while cooking or shopping). Prose/steps are edited in Edit mode.
  let recipeModel = null;

  function parseRecipe(text) {
    const lines = text.split("\n");
    let i = 0;
    const front = [];
    if (lines[0] !== undefined && lines[0].trim() === "---") {
      front.push(lines[0]); i = 1;
      while (i < lines.length && lines[i].trim() !== "---") front.push(lines[i++]);
      if (i < lines.length) { front.push(lines[i]); i++; }
    }
    const frontText = front.join("\n");
    const field = (k) => {
      const m = new RegExp("(^|\\n)" + k + ":\\s*(.+)").exec(frontText);
      return m ? m[2].trim() : "";
    };
    let tags = field("tags");
    if (/^\[.*\]$/.test(tags)) tags = tags.slice(1, -1);
    const tagList = tags ? tags.split(",").map((s) => s.trim()).filter(Boolean) : [];

    let title = "";
    const intro = [], ingredients = [], steps = [];
    let section = null; // null (pre-title/intro) | "ing" | "steps" | "other"
    for (; i < lines.length; i++) {
      const line = lines[i];
      const h1 = /^#\s+(.*)$/.exec(line);
      const h2 = /^##\s+(.*)$/.exec(line);
      if (h1 && !title) { title = h1[1].trim(); continue; }
      if (h2) {
        const n = h2[1].trim().toLowerCase();
        section = /^ingredient/.test(n) ? "ing"
          : /^(step|method|direction|instruction)/.test(n) ? "steps" : "other";
        continue;
      }
      if (section === "ing") {
        const m = /^\s*[-*+]\s+(?:\[([ xX])\]\s+)?(.*)$/.exec(line);
        if (m) ingredients.push({ pos: i, checked: (m[1] || "").toLowerCase() === "x", text: m[2] });
        continue;
      }
      if (section === "steps") { if (line.trim() !== "") steps.push(line); continue; }
      if (!section) intro.push(line);
    }
    return {
      lines, title, intro, ingredients, steps,
      servings: field("servings"), time: field("time"), tags: tagList,
    };
  }

  function toggleIngredient(pos) {
    const m = /^(\s*[-*+]\s+)(?:\[([ xX])\]\s+)?(.*)$/.exec(recipeModel.lines[pos]);
    if (!m) return;
    const checked = (m[2] || "").toLowerCase() === "x";
    recipeModel.lines[pos] = m[1] + "[" + (checked ? " " : "x") + "] " + m[3];
    textarea.value = recipeModel.lines.join("\n");
    setDirty(true);
    if (mode === "split" || mode === "preview") renderPreview();
    renderRecipe();
    recordHistory();
  }

  function chip(icon, label) {
    const s = document.createElement("span");
    s.className = "recipe-chip";
    const ic = document.createElement("i");
    ic.className = "fa-solid " + icon;
    s.appendChild(ic);
    s.appendChild(document.createTextNode(" " + label));
    return s;
  }

  function renderRecipe() {
    if (!current) return;
    recipeModel = parseRecipe(textarea.value);
    const m = recipeModel;
    recipeBodyEl.textContent = "";
    const card = document.createElement("div");
    card.className = "recipe-card";

    const h = document.createElement("h1");
    h.className = "recipe-title";
    h.textContent = m.title || titleFromPath(current.path);
    card.appendChild(h);

    if (m.servings || m.time || m.tags.length) {
      const meta = document.createElement("div");
      meta.className = "recipe-meta";
      if (m.servings) {
        const s = /[a-z]/i.test(m.servings) ? m.servings : m.servings + " servings";
        meta.appendChild(chip("fa-user-group", s));
      }
      if (m.time) meta.appendChild(chip("fa-clock", m.time));
      m.tags.forEach((t) => meta.appendChild(chip("fa-tag", t)));
      card.appendChild(meta);
    }

    const introMd = m.intro.join("\n").trim();
    if (introMd) {
      const d = document.createElement("div");
      d.className = "recipe-intro markdown-body";
      d.innerHTML = renderMd(introMd);
      card.appendChild(d);
    }

    if (m.ingredients.length) {
      const sec = document.createElement("div");
      sec.className = "recipe-section";
      const sh = document.createElement("h2");
      sh.textContent = "Ingredients";
      sec.appendChild(sh);
      const ul = document.createElement("ul");
      ul.className = "recipe-ings";
      m.ingredients.forEach((ing) => {
        const li = document.createElement("li");
        li.className = "recipe-ing" + (ing.checked ? " checked" : "");
        const b = document.createElement("button");
        b.type = "button";
        b.className = "recipe-check";
        b.innerHTML = '<i class="fa-solid fa-check"></i>';
        b.setAttribute("aria-label", ing.checked ? "Uncheck" : "Check off");
        b.addEventListener("click", () => toggleIngredient(ing.pos));
        const sp = document.createElement("span");
        sp.className = "recipe-ing-text";
        sp.textContent = ing.text;
        li.append(b, sp);
        ul.appendChild(li);
      });
      sec.appendChild(ul);
      card.appendChild(sec);
    }

    const stepsMd = m.steps.join("\n").trim();
    if (stepsMd) {
      const sec = document.createElement("div");
      sec.className = "recipe-section";
      const sh = document.createElement("h2");
      sh.textContent = "Steps";
      sec.appendChild(sh);
      const d = document.createElement("div");
      d.className = "recipe-steps markdown-body";
      d.innerHTML = renderMd(stepsMd);
      sec.appendChild(d);
      card.appendChild(sec);
    }
    recipeBodyEl.appendChild(card);
  }

  function recipeScaffold(title) {
    return [
      "---", "type: recipe", "servings: 4", "time: 30m", "tags: []", "---",
      "# " + title, "", "## Ingredients", "- [ ] ", "", "## Steps", "1. ", "",
    ].join("\n");
  }

  // ---- meal-plan mode ----
  // A meal-plan note: front-matter (week) + a markdown table (Day × meals) whose
  // cells are recipe links or free text. The view renders day cards with tappable
  // meal slots; a picker sets each slot from the recipes/ folder or custom text.
  // "Shopping list" reads the linked recipes' ingredients into a new checklist.
  let mealplanModel = null;

  function parseCell(s) {
    s = (s || "").trim();
    if (!s) return null;
    const m = /\[([^\]]*)\]\(([^)]*)\)/.exec(s);
    if (m) return { label: m[1], path: m[2] };
    return { label: s, path: "" };
  }
  function serializeCell(c) {
    if (!c) return "";
    return c.path ? "[" + c.label + "](" + c.path + ")" : c.label;
  }
  function tableCells(row) {
    return row.trim().replace(/^\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
  }

  function parseMealplan(text) {
    const lines = text.split("\n");
    let i = 0;
    const front = [];
    if (lines[0] !== undefined && lines[0].trim() === "---") {
      front.push(lines[0]); i = 1;
      while (i < lines.length && lines[i].trim() !== "---") front.push(lines[i++]);
      if (i < lines.length) { front.push(lines[i]); i++; }
    }
    let week = null;
    const wl = front.join("\n").match(/week:\s*(\d{4})-W(\d{2})/);
    if (wl) week = { year: +wl[1], week: +wl[2] };

    const intro = [], tail = [];
    let ti = -1;
    for (let j = i; j < lines.length; j++) {
      if (/^\s*\|/.test(lines[j])) { ti = j; break; }
      intro.push(lines[j]);
    }
    if (ti === -1) return { front, intro, meals: [], days: [], tail, week };

    const rows = [];
    let j = ti;
    while (j < lines.length && /^\s*\|/.test(lines[j])) { rows.push(lines[j]); j++; }
    for (; j < lines.length; j++) tail.push(lines[j]);

    const meals = tableCells(rows[0]).slice(1);
    const days = [];
    for (let r = 2; r < rows.length; r++) { // row 1 is the --- separator
      const c = tableCells(rows[r]);
      const name = c[0];
      if (!name && c.every((x) => !x)) continue;
      const cells = {};
      meals.forEach((mn, idx) => { cells[mn] = parseCell(c[idx + 1] || ""); });
      days.push({ name, cells });
    }
    return { front, intro, meals, days, tail, week };
  }

  function serializeMealplan(m) {
    const out = [];
    if (m.front.length) out.push(...m.front);
    const intro = m.intro.join("\n").replace(/^\n+|\n+$/g, "");
    if (intro) { out.push(intro, ""); } else if (m.front.length) out.push("");
    const meals = m.meals.length ? m.meals : ["Breakfast", "Lunch", "Dinner"];
    out.push("| Day | " + meals.join(" | ") + " |");
    out.push("| --- | " + meals.map(() => "---").join(" | ") + " |");
    for (const d of m.days) {
      out.push("| " + d.name + " | " + meals.map((mn) => serializeCell(d.cells[mn])).join(" | ") + " |");
    }
    if (m.tail.length) { out.push("", ...m.tail); }
    return out.join("\n").replace(/\n{3,}/g, "\n\n");
  }

  function commitMealplan() {
    textarea.value = serializeMealplan(mealplanModel);
    setDirty(true);
    if (mode === "split" || mode === "preview") renderPreview();
    renderMealplan();
    recordHistory();
  }

  // Recipes available to link, as {label, rel} where rel is relative to the open
  // meal-plan note (so the stored link resolves back to the recipe).
  function recipeChoices() {
    const dir = current.path.includes("/") ? current.path.slice(0, current.path.lastIndexOf("/")) : "";
    const up = dir ? dir.split("/").length : 0;
    const prefix = "../".repeat(up);
    return notes
      .filter((n) => /^recipes\//.test(n.path))
      .map((n) => ({ label: titleFromPath(n.path), rel: prefix + n.path }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  function setCell(dayName, mealName, val) {
    const d = mealplanModel.days.find((x) => x.name === dayName);
    if (!d) return;
    d.cells[mealName] = val;
    commitMealplan();
  }

  function openLinkedNote(linkPath) {
    openNote(resolveRelPath(current.path, linkPath));
  }

  // --- cell picker popover ---
  let cellPicker = null;
  function closeCellPicker() {
    if (!cellPicker) return;
    cellPicker.remove();
    cellPicker = null;
    document.removeEventListener("click", onPickerDocClick, true);
    document.removeEventListener("keydown", onPickerKey, true);
  }
  function onPickerDocClick(e) { if (cellPicker && !cellPicker.contains(e.target)) closeCellPicker(); }
  function onPickerKey(e) { if (e.key === "Escape") closeCellPicker(); }

  function pickerButton(iconClass, label, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    const ic = document.createElement("i");
    ic.className = iconClass;
    b.appendChild(ic);
    b.appendChild(document.createTextNode(" " + label));
    b.addEventListener("click", onClick);
    return b;
  }

  function openCellPicker(anchor, dayName, mealName) {
    closeCellPicker();
    const cur = (mealplanModel.days.find((d) => d.name === dayName) || {}).cells;
    const pop = document.createElement("div");
    pop.className = "cell-picker";

    const head = document.createElement("div");
    head.className = "cell-picker-head";
    head.textContent = dayName + " · " + mealName;
    pop.appendChild(head);

    const list = document.createElement("div");
    list.className = "cell-picker-list";
    const choices = recipeChoices();
    if (!choices.length) {
      const p = document.createElement("div");
      p.className = "cell-picker-empty";
      p.textContent = "No recipes yet — add notes under recipes/.";
      list.appendChild(p);
    }
    choices.forEach((r) => {
      list.appendChild(pickerButton("fa-solid fa-book-open", r.label, () => {
        setCell(dayName, mealName, { label: r.label, path: r.rel });
        closeCellPicker();
      }));
    });
    pop.appendChild(list);

    const foot = document.createElement("div");
    foot.className = "cell-picker-foot";
    foot.appendChild(pickerButton("fa-solid fa-pen", "Custom text…", () => {
      const existing = cur && cur[mealName] ? cur[mealName].label : "";
      closeCellPicker();
      const v = prompt("Text for " + dayName + " " + mealName + " (e.g. Leftovers):", existing);
      if (v === null) return;
      setCell(dayName, mealName, v.trim() ? { label: v.trim(), path: "" } : null);
    }));
    if (cur && cur[mealName]) {
      foot.appendChild(pickerButton("fa-solid fa-xmark", "Clear", () => {
        setCell(dayName, mealName, null);
        closeCellPicker();
      }));
    }
    pop.appendChild(foot);

    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    const w = Math.min(300, window.innerWidth - 16);
    pop.style.width = w + "px";
    pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + "px";
    pop.style.top = r.bottom + 4 + "px";
    cellPicker = pop;
    setTimeout(() => {
      document.addEventListener("click", onPickerDocClick, true);
      document.addEventListener("keydown", onPickerKey, true);
    }, 0);
  }

  function renderMealplan() {
    if (!current) return;
    closeCellPicker();
    mealplanModel = parseMealplan(textarea.value);
    const wk = mealplanModel.week || weekFromPath(current.path);
    mealplanWeekEl.textContent = wk ? "Meal plan · Week " + wk.week : "Meal plan";
    const meals = mealplanModel.meals.length ? mealplanModel.meals : ["Breakfast", "Lunch", "Dinner"];

    mealplanGridEl.textContent = "";
    if (!mealplanModel.days.length) {
      const p = document.createElement("p");
      p.className = "todo-empty";
      p.textContent = "No days yet — use the Meals button to scaffold a week, or add a table in Edit mode.";
      mealplanGridEl.appendChild(p);
      return;
    }
    mealplanModel.days.forEach((day) => {
      const card = document.createElement("section");
      card.className = "mp-day";
      const head = document.createElement("div");
      head.className = "mp-day-head";
      head.textContent = day.name;
      card.appendChild(head);
      meals.forEach((mn) => {
        const cell = day.cells[mn] || null;
        const slot = document.createElement("div");
        slot.className = "mp-slot";
        const lab = document.createElement("span");
        lab.className = "mp-meal";
        lab.textContent = mn;
        const val = document.createElement("button");
        val.type = "button";
        val.className = "mp-value" + (cell ? "" : " empty");
        if (cell && cell.path) {
          val.classList.add("is-recipe");
          val.textContent = cell.label;
          val.title = "Open " + cell.label;
          val.addEventListener("click", () => openLinkedNote(cell.path));
        } else {
          val.textContent = cell ? cell.label : "+ Add";
          val.addEventListener("click", (e) => openCellPicker(e.currentTarget, day.name, mn));
        }
        const edit = document.createElement("button");
        edit.type = "button";
        edit.className = "mp-edit";
        edit.innerHTML = '<i class="fa-solid fa-chevron-down"></i>';
        edit.setAttribute("aria-label", "Change " + mn);
        edit.addEventListener("click", (e) => openCellPicker(e.currentTarget, day.name, mn));
        slot.append(lab, val, edit);
        card.appendChild(slot);
      });
      mealplanGridEl.appendChild(card);
    });
  }

  function mealplanScaffold(year, week) {
    const out = [
      "---", "type: mealplan", "week: " + year + "-W" + pad2(week), "---", "",
      "# Meal plan · Week " + week, "",
      "| Day | Breakfast | Lunch | Dinner |",
      "| --- | --- | --- | --- |",
    ];
    for (const d of DAY_NAMES) out.push("| " + d + " |  |  |  |");
    return out.join("\n");
  }

  async function openMealplanWeek(year, week) {
    const path = "meal-plans/" + year + "-W" + pad2(week) + ".md";
    if (notes.some((n) => n.path === path)) { openNote(path); return; }
    if (dirty && !confirm("Discard unsaved changes?")) return;
    current = { path, content: "" };
    localStorage.setItem(lastNoteKey(), path);
    textarea.value = mealplanScaffold(year, week);
    resetHistory();
    currentPathEl.textContent = path;
    setNoteChrome("mealplan");
    showEditor();
    closeSidebar();
    setDirty(false);
    setMode("mealplan");
    renderList();
  }

  // Read the "## Ingredients" checklist out of a recipe's markdown, de-duping
  // by normalised text. (Quantities aren't parsed, so they aren't combined.)
  function collectIngredients(content, seen) {
    const lines = (content || "").split("\n");
    let inIng = false;
    for (const line of lines) {
      const h2 = /^##\s+(.*)$/.exec(line);
      if (h2) { inIng = /^ingredient/i.test(h2[1].trim()); continue; }
      if (!inIng) continue;
      const m = /^\s*[-*+]\s+(?:\[[ xX]\]\s+)?(.*)$/.exec(line);
      if (m) {
        const text = m[1].trim();
        if (text && !seen.has(text.toLowerCase())) seen.set(text.toLowerCase(), text);
      }
    }
  }

  async function generateShoppingList() {
    if (!current) return;
    const model = parseMealplan(textarea.value);
    const paths = new Set();
    model.days.forEach((d) =>
      Object.values(d.cells).forEach((c) => {
        if (c && c.path) paths.add(resolveRelPath(current.path, c.path));
      })
    );
    if (!paths.size) { toast("No recipes linked in this meal plan yet.", "warn"); return; }

    toast("Building shopping list…", "info");
    const seen = new Map();
    for (const p of paths) {
      try { collectIngredients((await Api.getNote(currentRepo, p)).content, seen); }
      catch (_) { /* skip a missing/renamed recipe */ }
    }
    const items = [...seen.values()];
    if (!items.length) { toast("Linked recipes have no Ingredients sections.", "warn"); return; }

    const wk = model.week || weekFromPath(current.path);
    const title = wk ? "Shopping list · Week " + wk.week : "Shopping list";
    const body = [
      "# " + title, "",
      "_Generated from this week’s meal plan — quantities are not combined._", "",
      ...items.map((t) => "- [ ] " + t), "",
    ].join("\n");
    const outPath = wk
      ? "meal-plans/" + wk.year + "-W" + pad2(wk.week) + "-shopping.md"
      : current.path.replace(/\.md$/i, "-shopping.md");

    try {
      if (dirty) await save(); // persist the plan so opening the list won't prompt
      await Api.saveNote(currentRepo, outPath, body, "");
      await loadList();
      await openNote(outPath);
      setMode("todo");
      toast("Shopping list ready — " + items.length + " items.", "success");
    } catch (err) {
      toast("Could not save shopping list: " + err.message, "error");
    }
  }

  // Starter content for a brand-new note, by inferred type.
  function defaultScaffold(path) {
    const t = noteType(path, "");
    const now = new Date();
    if (t === "planner") { const w = weekFromPath(path) || isoWeek(now); return plannerScaffold(w.year, w.week); }
    if (t === "mealplan") { const w = weekFromPath(path) || isoWeek(now); return mealplanScaffold(w.year, w.week); }
    if (t === "recipe") return recipeScaffold(titleFromPath(path));
    if (t === "meeting") return meetingScaffold(path);
    if (t === "routines") return routinesScaffold(titleFromPath(path));
    return "# " + path.replace(/\.md$/i, "").split("/").pop() + "\n\n";
  }

  // ---- shared action-item grammar & dates ----
  // parseAction / serializeAction come from NotesCore (see top) — they must stay
  // parity with the Go backend's parseActionTokens.

  function todayStr() {
    const n = new Date();
    return n.getFullYear() + "-" + pad2(n.getMonth() + 1) + "-" + pad2(n.getDate());
  }
  // Sunday (local YYYY-MM-DD) that ends the current ISO week.
  function endOfWeekStr() {
    const n = new Date();
    const sun = new Date(n.getFullYear(), n.getMonth(), n.getDate() + (7 - ((n.getDay() + 6) % 7) - 1));
    return sun.getFullYear() + "-" + pad2(sun.getMonth() + 1) + "-" + pad2(sun.getDate());
  }
  function fmtDue(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
    if (!m) return s || "";
    return MONTHS[+m[2] - 1] + " " + +m[3];
  }
  // "overdue" | "today" | "soon" | "" relative to now (date strings compare
  // chronologically because they're zero-padded ISO).
  function dueBucket(due) {
    if (!due) return "";
    const t = todayStr();
    if (due < t) return "overdue";
    if (due === t) return "today";
    if (due <= endOfWeekStr()) return "soon";
    return "";
  }

  // ---- meeting mode ----
  // A meeting note: front-matter (date/attendees/project), a title, a "## Notes"
  // section (rendered) and an "## Action items" checklist using the shared
  // grammar. Only the action-items section is mutated in-view; everything else
  // (including free-form notes) is preserved verbatim and edited in Edit mode.
  let meetingModel = null;

  function parseMeeting(text) {
    const lines = text.split("\n");
    let i = 0;
    const front = [];
    if (lines[0] !== undefined && lines[0].trim() === "---") {
      front.push(lines[0]); i = 1;
      while (i < lines.length && lines[i].trim() !== "---") front.push(lines[i++]);
      if (i < lines.length) { front.push(lines[i]); i++; }
    }
    const frontText = front.join("\n");
    const field = (k) => {
      const m = new RegExp("(^|\\n)" + k + ":\\s*(.+)").exec(frontText);
      return m ? m[2].trim() : "";
    };
    let att = field("attendees");
    if (/^\[.*\]$/.test(att)) att = att.slice(1, -1);
    const attendees = att ? att.split(",").map((s) => s.trim()).filter(Boolean) : [];

    let title = "";
    const preamble = [];
    const sections = [];
    let cur = null;
    for (; i < lines.length; i++) {
      const line = lines[i];
      const h2 = /^##\s+(.*)$/.exec(line);
      if (h2) { cur = { heading: h2[1].trim(), lines: [] }; sections.push(cur); continue; }
      if (!cur) {
        const h1 = /^#\s+(.*)$/.exec(line);
        if (h1 && !title) title = h1[1].trim();
        preamble.push(line);
      } else cur.lines.push(line);
    }

    let actionsSec = null, notesSec = null;
    for (const s of sections) {
      const n = s.heading.toLowerCase();
      if (!actionsSec && /^(action|follow|task|todo|to-do)/.test(n)) actionsSec = s;
      else if (!notesSec && /^note/.test(n)) notesSec = s;
    }
    const isActionLine = (l) => /^\s*[-*+]\s+\[[ xX]\]/.test(l);
    let actions = [];
    if (actionsSec) {
      actions = actionsSec.lines.filter(isActionLine).map((l) => {
        const m = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(l);
        return { checked: m[1].toLowerCase() === "x", ...parseAction(m[2]) };
      });
      actionsSec._extra = actionsSec.lines.filter((l) => l.trim() !== "" && !isActionLine(l));
    }
    return {
      front, fields: { date: field("date"), project: field("project"), attendees },
      title, preamble, sections, actionsSec, notesSec, actions,
    };
  }

  function serializeMeeting(m) {
    const out = [];
    if (m.front.length) out.push(...m.front);
    out.push(...m.preamble);
    for (const s of m.sections) {
      out.push("## " + s.heading);
      if (s === m.actionsSec) {
        for (const a of m.actions) out.push(serializeAction(a));
        for (const e of (s._extra || [])) out.push(e);
        out.push("");
      } else {
        out.push(...s.lines);
      }
    }
    return out.join("\n").replace(/\n{3,}/g, "\n\n");
  }

  function commitMeeting() {
    textarea.value = serializeMeeting(meetingModel);
    setDirty(true);
    if (mode === "split" || mode === "preview") renderPreview();
    renderMeeting();
    recordHistory();
  }

  // Ensure there's an Action items section to append to (creating one if needed).
  function ensureActionsSection() {
    if (meetingModel.actionsSec) return;
    const sec = { heading: "Action items", lines: [], _extra: [] };
    meetingModel.sections.push(sec);
    meetingModel.actionsSec = sec;
  }

  function buildActionRow(a, idx) {
    const li = document.createElement("li");
    li.className = "mtg-action" + (a.checked ? " checked" : "") + (a.important ? " important" : "");

    const check = document.createElement("button");
    check.type = "button";
    check.className = "planner-check";
    check.innerHTML = '<i class="fa-solid fa-check"></i>';
    check.setAttribute("aria-label", a.checked ? "Mark incomplete" : "Mark complete");
    check.addEventListener("click", () => { meetingModel.actions[idx].checked = !a.checked; commitMeeting(); });

    const text = document.createElement("span");
    text.className = "mtg-action-text";
    text.contentEditable = "true";
    text.spellcheck = false;
    text.textContent = a.text;
    text.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); text.blur(); } });
    text.addEventListener("blur", () => {
      const v = text.textContent.trim();
      if (v === a.text) return;
      if (!v) { meetingModel.actions.splice(idx, 1); commitMeeting(); return; }
      // Re-parse so inline tokens (due:/@/!) typed here are honoured, not literal.
      const p = parseAction(v);
      a.text = p.text;
      if (p.due) a.due = p.due;
      if (p.important) a.important = true;
      if (p.owners.length) a.owners = [...new Set([...a.owners, ...p.owners])];
      commitMeeting();
    });

    const due = document.createElement("input");
    due.type = "date";
    due.className = "mtg-due" + (a.due ? " has " + dueBucket(a.due) : "");
    if (a.due) due.value = a.due;
    due.title = "Due date";
    due.addEventListener("change", () => { a.due = due.value || ""; commitMeeting(); });

    const owners = document.createElement("span");
    owners.className = "mtg-owners";
    a.owners.forEach((o) => {
      const c = document.createElement("span");
      c.className = "mtg-owner";
      c.textContent = "@" + o;
      owners.appendChild(c);
    });

    const star = document.createElement("button");
    star.type = "button";
    star.className = "planner-star" + (a.important ? " on" : "");
    star.innerHTML = '<i class="fa-' + (a.important ? "solid" : "regular") + ' fa-star"></i>';
    star.setAttribute("aria-label", a.important ? "Unmark important" : "Mark important");
    star.addEventListener("click", () => { a.important = !a.important; commitMeeting(); });

    const del = document.createElement("button");
    del.type = "button";
    del.className = "planner-del";
    del.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    del.setAttribute("aria-label", "Delete action item");
    del.addEventListener("click", () => { meetingModel.actions.splice(idx, 1); commitMeeting(); });

    li.append(check, text, owners, due, star, del);
    return li;
  }

  function renderMeeting() {
    if (!current) return;
    meetingModel = parseMeeting(textarea.value);
    const m = meetingModel;
    meetingBodyEl.textContent = "";
    const card = document.createElement("div");
    card.className = "meeting-card";

    const h = document.createElement("h1");
    h.className = "recipe-title";
    h.textContent = m.title || titleFromPath(current.path);
    card.appendChild(h);

    if (m.fields.date || m.fields.project || m.fields.attendees.length) {
      const meta = document.createElement("div");
      meta.className = "recipe-meta";
      if (m.fields.date) meta.appendChild(chip("fa-calendar-day", m.fields.date));
      if (m.fields.project) meta.appendChild(chip("fa-diagram-project", m.fields.project));
      if (m.fields.attendees.length) meta.appendChild(chip("fa-users", m.fields.attendees.join(", ")));
      card.appendChild(meta);
    }

    if (m.notesSec) {
      const sec = document.createElement("div");
      sec.className = "recipe-section";
      const sh = document.createElement("h2");
      sh.textContent = m.notesSec.heading;
      sec.appendChild(sh);
      const d = document.createElement("div");
      d.className = "markdown-body";
      d.innerHTML = renderMd(m.notesSec.lines.join("\n").trim());
      sec.appendChild(d);
      card.appendChild(sec);
    }

    const sec = document.createElement("div");
    sec.className = "recipe-section";
    const sh = document.createElement("h2");
    const open = m.actions.filter((a) => !a.checked).length;
    sh.textContent = "Action items";
    if (m.actions.length) {
      const badge = document.createElement("span");
      badge.className = "mtg-count";
      badge.textContent = open + " open";
      sh.appendChild(document.createTextNode(" "));
      sh.appendChild(badge);
    }
    sec.appendChild(sh);
    const ul = document.createElement("ul");
    ul.className = "mtg-actions";
    m.actions.forEach((a, i) => ul.appendChild(buildActionRow(a, i)));
    sec.appendChild(ul);

    const form = document.createElement("form");
    form.className = "planner-add mtg-add";
    form.innerHTML =
      '<input type="text" placeholder="Add action… (due:YYYY-MM-DD @who !)" autocomplete="off" aria-label="Add action item">' +
      '<button type="submit" aria-label="Add"><i class="fa-solid fa-plus"></i></button>';
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const input = form.querySelector("input");
      const raw = input.value.trim();
      if (!raw) return;
      const p = parseAction(raw);
      if (!p.text) return;
      ensureActionsSection();
      meetingModel.actions.push({ checked: false, ...p });
      input.value = "";
      commitMeeting();
    });
    sec.appendChild(form);
    card.appendChild(sec);
    meetingBodyEl.appendChild(card);
  }

  function meetingScaffold(path) {
    const wm = /(\d{4}-\d{2}-\d{2})/.exec(path || "");
    const date = wm ? wm[1] : todayStr();
    return [
      "---", "type: meeting", "date: " + date, "attendees: []", "project: ", "---",
      "# Meeting — " + date, "", "## Notes", "- ", "", "## Action items", "- [ ] ", "",
    ].join("\n");
  }

  async function openMeetingToday() {
    const path = "meetings/" + todayStr() + "-meeting.md";
    if (notes.some((n) => n.path === path)) { openNote(path); return; }
    if (dirty && !confirm("Discard unsaved changes?")) return;
    current = { path, content: "" };
    localStorage.setItem(lastNoteKey(), path);
    textarea.value = meetingScaffold(path);
    resetHistory();
    currentPathEl.textContent = path;
    setNoteChrome("meeting");
    showEditor();
    closeSidebar();
    setDirty(false);
    setMode("meeting");
    renderList();
  }

  // ---- routines (recurring chores) mode ----
  // A routines note is a checklist whose items carry an `every:` recurrence (and
  // an optional `since:` anchor). This view lists each chore with its rule and
  // next occurrence and lets you add / rename / reschedule / pause / delete —
  // rewriting the markdown so the Agenda (which resolves next occurrences) and
  // Edit mode stay in sync. Recurrence is pure display: chores never "complete";
  // checking one just *pauses* it (hides it from the Agenda until resumed).
  const ROUTINE_RE = /^(\s*)([-*+])\s+\[([ xX])\]\s+(.*)$/;
  const RECUR_PRESETS = [
    ["1d", "Daily"], ["1w", "Weekly"], ["2w", "Every 2 weeks"],
    ["1m", "Monthly"], ["3m", "Every 3 months"], ["1y", "Yearly"],
    ["mon", "Every Monday"], ["tue", "Every Tuesday"], ["wed", "Every Wednesday"],
    ["thu", "Every Thursday"], ["fri", "Every Friday"], ["sat", "Every Saturday"], ["sun", "Every Sunday"],
  ];
  const RECUR_UNITS = [["d", "days"], ["w", "weeks"], ["m", "months"], ["y", "years"]];
  const WEEKDAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  let routinesModel = null; // { lines, items:[{pos, checked, text, every, since, owners, important}] }

  function routinesScaffold(title) {
    return "---\ntype: routines\n---\n\n# " + (title || "Routines") + "\n\n" +
      "- [ ] Take out the trash every:tue\n" +
      "- [ ] Add salt to the water softener every:6w since:" + todayStr() + "\n";
  }

  function parseRoutines(text) {
    const lines = text.split("\n");
    const items = [];
    let inFence = false;
    lines.forEach((line, i) => {
      if (/^\s*```/.test(line)) { inFence = !inFence; return; }
      if (inFence) return;
      const m = ROUTINE_RE.exec(line);
      if (!m) return;
      const a = parseAction(m[4]);
      if (!a.every) return; // only recurring lines belong to this view
      items.push({ pos: i, checked: m[3].toLowerCase() === "x", text: a.text, every: a.every, since: a.since, owners: a.owners, important: a.important });
    });
    return { lines, items };
  }

  function serializeRoutine(it) {
    return serializeAction({ checked: it.checked, text: it.text, every: it.every, since: it.since, owners: it.owners, important: it.important });
  }

  function commitRoutines(newText) {
    textarea.value = newText;
    setDirty(true);
    if (mode === "split" || mode === "preview") renderPreview();
    renderRoutines();
    recordHistory();
  }

  function writeRoutineLine(idx) {
    const it = routinesModel.items[idx];
    if (!it) return;
    routinesModel.lines[it.pos] = serializeRoutine(it);
    commitRoutines(routinesModel.lines.join("\n"));
  }

  function addRoutine(text, canonical) {
    text = (text || "").replace(/\s+/g, " ").trim();
    const rec = parseRecurrence(canonical);
    if (!text || !rec) return;
    // Anchor interval chores at today so "every N …" is phased from creation;
    // weekday chores don't need an anchor.
    const since = rec.kind === "interval" ? " since:" + todayStr() : "";
    const line = "- [ ] " + text + " every:" + canonical + since;
    const { lines, items } = routinesModel;
    const at = items.length ? items[items.length - 1].pos + 1 : lines.length;
    lines.splice(at, 0, line);
    commitRoutines(lines.join("\n"));
  }

  function setRoutineText(idx, text) {
    const it = routinesModel.items[idx];
    const v = (text || "").replace(/\s+/g, " ").trim();
    if (!it || !v) { renderRoutines(); return; }
    it.text = v;
    writeRoutineLine(idx);
  }

  function setRoutineEvery(idx, canonical) {
    const it = routinesModel.items[idx];
    const rec = parseRecurrence(canonical);
    if (!it || !rec) { renderRoutines(); return; }
    it.every = canonical;
    if (rec.kind === "interval") { if (!it.since) it.since = todayStr(); }
    else it.since = ""; // weekday ignores the anchor
    writeRoutineLine(idx);
  }

  function toggleRoutinePause(idx) {
    const it = routinesModel.items[idx];
    if (!it) return;
    it.checked = !it.checked;
    writeRoutineLine(idx);
  }

  function deleteRoutine(idx) {
    const it = routinesModel.items[idx];
    if (!it) return;
    routinesModel.lines.splice(it.pos, 1);
    commitRoutines(routinesModel.lines.join("\n"));
  }

  // A reusable recurrence picker: a preset <select> plus a custom "every N units"
  // row. getValue() returns the canonical spec (e.g. "tue" / "6w").
  function buildRecurrencePicker(current) {
    const wrap = document.createElement("span");
    wrap.className = "rec-picker";
    const sel = document.createElement("select");
    sel.className = "rec-preset";
    sel.setAttribute("aria-label", "Repeat");
    for (const [val, label] of RECUR_PRESETS) {
      const o = document.createElement("option"); o.value = val; o.textContent = label; sel.appendChild(o);
    }
    const customOpt = document.createElement("option");
    customOpt.value = "custom"; customOpt.textContent = "Every N…"; sel.appendChild(customOpt);

    const customWrap = document.createElement("span");
    customWrap.className = "rec-custom";
    const num = document.createElement("input");
    num.type = "number"; num.min = "1"; num.max = "999"; num.value = "6"; num.className = "rec-num"; num.setAttribute("aria-label", "Interval count");
    const unit = document.createElement("select"); unit.className = "rec-unit"; unit.setAttribute("aria-label", "Interval unit");
    for (const [val, label] of RECUR_UNITS) { const o = document.createElement("option"); o.value = val; o.textContent = label; unit.appendChild(o); }
    customWrap.append(document.createTextNode("every "), num, unit);

    const syncCustom = () => { customWrap.hidden = sel.value !== "custom"; };
    sel.addEventListener("change", syncCustom);

    const rec = current && parseRecurrence(current);
    if (rec) {
      const canon = recurrenceCanonical(rec);
      if (RECUR_PRESETS.some(([v]) => v === canon)) sel.value = canon;
      else if (rec.kind === "interval") { sel.value = "custom"; num.value = String(rec.n); unit.value = rec.unit; }
    }
    syncCustom();

    wrap.append(sel, customWrap);
    return {
      el: wrap,
      getValue() {
        if (sel.value !== "custom") return sel.value;
        const n = Math.max(1, Math.min(999, parseInt(num.value, 10) || 1));
        return n + unit.value;
      },
    };
  }

  function fmtNextOccurrence(it, today) {
    const rec = parseRecurrence(it.every);
    if (!rec) return "—";
    const iso = nextOccurrence(rec, it.since, today);
    const d = new Date(iso + "T00:00:00Z");
    const t = todayStr();
    if (iso === t) return "today";
    const tm = addDays(new Date(t + "T00:00:00Z"), 1);
    const tomorrow = tm.getUTCFullYear() + "-" + pad2(tm.getUTCMonth() + 1) + "-" + pad2(tm.getUTCDate());
    if (iso === tomorrow) return "tomorrow";
    return fmtDue(iso) + " (" + WEEKDAY_ABBR[d.getUTCDay()] + ")";
  }

  function renderRoutines() {
    routinesModel = parseRoutines(textarea.value);
    const items = routinesModel.items;
    routinesListEl.textContent = "";
    if (routinesEmptyEl) routinesEmptyEl.hidden = items.length > 0;
    if (routinesCountEl) routinesCountEl.textContent = items.length ? items.length + (items.length === 1 ? " chore" : " chores") : "";

    const today = new Date();
    items.forEach((it, idx) => routinesListEl.appendChild(buildRoutineRow(it, idx, today)));

    // Build the add-form picker once (preserve its selection across re-renders).
    if (routinesPickerMount && !routinesPickerMount._picker) {
      const picker = buildRecurrencePicker("1w");
      routinesPickerMount.textContent = "";
      routinesPickerMount.appendChild(picker.el);
      routinesPickerMount._picker = picker;
    }
  }

  function buildRoutineRow(it, idx, today) {
    const li = document.createElement("li");
    li.className = "routine-item" + (it.checked ? " paused" : "") + (it.important ? " important" : "");

    const pause = document.createElement("button");
    pause.type = "button";
    pause.className = "routine-pause";
    pause.setAttribute("aria-pressed", String(it.checked));
    pause.title = it.checked ? "Paused — tap to resume" : "Active — tap to pause";
    pause.innerHTML = it.checked ? '<i class="fa-solid fa-circle-pause"></i>' : '<i class="fa-solid fa-rotate"></i>';
    pause.addEventListener("click", () => toggleRoutinePause(idx));

    const body = document.createElement("div");
    body.className = "routine-body";
    const text = document.createElement("span");
    text.className = "routine-text";
    text.textContent = it.text;
    text.title = "Tap to rename";
    text.addEventListener("click", () => beginRoutineEdit(text, idx));
    const meta = document.createElement("span");
    meta.className = "routine-meta";
    meta.textContent = it.checked ? "paused" : "next: " + fmtNextOccurrence(it, today);
    body.append(text, meta);

    const rec = parseRecurrence(it.every);
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "routine-rec";
    chip.title = "Change schedule";
    chip.append(document.createTextNode(rec ? recurrenceLabel(rec) : it.every));
    chip.addEventListener("click", () => beginRoutineRecEdit(li, idx, it.every));

    const del = document.createElement("button");
    del.type = "button";
    del.className = "routine-del";
    del.title = "Delete chore";
    del.innerHTML = '<i class="fa-solid fa-trash"></i>';
    del.addEventListener("click", () => { if (confirm("Delete “" + it.text + "”?")) deleteRoutine(idx); });

    li.append(pause, body, chip, del);
    return li;
  }

  function beginRoutineEdit(span, idx) {
    const it = routinesModel.items[idx];
    if (!it) return;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "routine-edit";
    input.value = it.text;
    span.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      if (save) setRoutineText(idx, input.value);
      else renderRoutines();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); finish(true); }
      else if (e.key === "Escape") { e.preventDefault(); finish(false); }
    });
    input.addEventListener("blur", () => finish(true));
  }

  function beginRoutineRecEdit(li, idx, current) {
    if (li.querySelector(".routine-rec-edit")) return; // already editing
    const editor = document.createElement("div");
    editor.className = "routine-rec-edit";
    const picker = buildRecurrencePicker(current);
    const ok = document.createElement("button");
    ok.type = "button"; ok.className = "todo-mini"; ok.textContent = "Save";
    const cancel = document.createElement("button");
    cancel.type = "button"; cancel.className = "todo-mini"; cancel.textContent = "Cancel";
    ok.addEventListener("click", () => setRoutineEvery(idx, picker.getValue()));
    cancel.addEventListener("click", () => renderRoutines());
    editor.append(picker.el, ok, cancel);
    li.appendChild(editor);
    li.classList.add("editing");
  }

  function openRoutines() {
    const path = "routines/home.md";
    if (notes.some((n) => n.path === path)) { openNote(path); return; }
    newTypedNote(path);
  }

  // ---- agenda (passive) ----
  // A read-only dashboard: scan every note in the repo for open `- [ ]` items
  // carrying a `due:` date and group them Overdue / Today / This week / Later.
  let agendaOpen = false;

  function openAgenda() {
    if (!currentRepo) { toast("Pick a repo first.", "warn"); return; }
    if (searchOpen) closeSearch();
    agendaOpen = true;
    closeSidebar();
    editorPane.hidden = true;
    emptyState.hidden = true;
    agendaPane.hidden = false;
    renderAgenda();
  }
  function closeAgenda() {
    agendaOpen = false;
    agendaPane.hidden = true;
    if (current) editorPane.hidden = false;
    else emptyState.hidden = false;
  }

  function scanDueItems(path, content, out) {
    const lines = (content || "").split("\n");
    const today = new Date();
    let inFence = false;
    for (const line of lines) {
      if (/^\s*```/.test(line)) { inFence = !inFence; continue; }
      if (inFence) continue;
      const m = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(line);
      if (!m || m[1].toLowerCase() === "x") continue;
      const a = parseAction(m[2]);
      // Recurring items resolve to their next occurrence; fixed items need a due.
      if (a.every) {
        const rec = parseRecurrence(a.every);
        if (!rec) continue;
        out.push({ path, text: a.text, due: nextOccurrence(rec, a.since, today), owners: a.owners, important: a.important, recurring: true, every: a.every });
      } else if (a.due) {
        out.push({ path, text: a.text, due: a.due, owners: a.owners, important: a.important });
      }
    }
  }

  // Fallback for older backends: fetch every note and scan it in the browser.
  async function scanAgendaClient() {
    agendaSubEl.textContent = "Scanning " + notes.length + " notes…";
    const results = await Promise.all(
      notes.map((n) =>
        Api.getNote(currentRepo, n.path).then((r) => ({ path: n.path, content: r.content })).catch(() => null)
      )
    );
    const items = [];
    results.forEach((r) => { if (r) scanDueItems(r.path, r.content, items); });
    return items;
  }

  async function renderAgenda() {
    agendaListEl.textContent = "";
    agendaSubEl.textContent = "Scanning…";
    let items;
    try {
      // Prefer the server-side scan (one request, fast on large repos).
      items = (await Api.agenda(currentRepo)).items || [];
    } catch (err) {
      if (err && err.status === 404) items = await scanAgendaClient();
      else { agendaSubEl.textContent = "Scan failed"; toast("Agenda scan failed: " + err.message, "error"); return; }
    }
    if (!agendaOpen) return; // user closed it mid-scan
    items.forEach((it) => { if (!Array.isArray(it.owners)) it.owners = []; });
    items.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));

    const t = todayStr(), eow = endOfWeekStr();
    const groups = [
      { key: "overdue", label: "Overdue", items: items.filter((i) => i.due < t) },
      { key: "today", label: "Today", items: items.filter((i) => i.due === t) },
      { key: "soon", label: "This week", items: items.filter((i) => i.due > t && i.due <= eow) },
      { key: "later", label: "Later", items: items.filter((i) => i.due > eow) },
    ].filter((g) => g.items.length);

    agendaSubEl.textContent = items.length ? items.length + " due" : "";
    if (!items.length) {
      const p = document.createElement("p");
      p.className = "agenda-empty";
      p.innerHTML = '<i class="fa-solid fa-mug-hot"></i> Nothing due — you’re all caught up.';
      agendaListEl.appendChild(p);
      return;
    }
    for (const g of groups) {
      const h = document.createElement("div");
      h.className = "agenda-group agenda-group-" + g.key;
      h.innerHTML = '<span>' + g.label + '</span><span class="agenda-group-n">' + g.items.length + "</span>";
      agendaListEl.appendChild(h);
      for (const it of g.items) agendaListEl.appendChild(buildAgendaRow(it));
    }
  }

  function buildAgendaRow(it) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "agenda-item" + (it.important ? " important" : "") + (it.recurring ? " recurring" : "");
    row.title = "Open " + it.path;

    const due = document.createElement("span");
    due.className = "agenda-due " + (dueBucket(it.due) || "later");
    due.textContent = fmtDue(it.due);

    const main = document.createElement("span");
    main.className = "agenda-main";
    const txt = document.createElement("span");
    txt.className = "agenda-text";
    if (it.recurring) {
      const badge = document.createElement("i");
      badge.className = "fa-solid fa-rotate agenda-recur";
      const rec = it.every && parseRecurrence(it.every);
      badge.title = rec ? recurrenceLabel(rec) : "recurring";
      txt.append(badge, document.createTextNode(" " + it.text));
    } else {
      txt.textContent = it.text;
    }
    const meta = document.createElement("span");
    meta.className = "agenda-meta";
    const bits = [];
    if (it.owners.length) bits.push(it.owners.map((o) => "@" + o).join(" "));
    if (it.recurring) { const rec = it.every && parseRecurrence(it.every); if (rec) bits.push(recurrenceLabel(rec)); }
    bits.push(it.path);
    meta.textContent = bits.join(" · ");
    main.append(txt, meta);

    row.append(due, main);
    row.addEventListener("click", () => { closeAgenda(); openNote(it.path); });
    return row;
  }

  // ---- search ----
  // A full-text search over the repo: the server greps the working tree
  // (GET /api/search) and returns notes with matching lines; older backends 404,
  // so we fall back to fetching + scanning notes in the browser. Results group by
  // note; clicking a line opens it at that line.
  let searchOpen = false;
  let searchTimer = 0;
  let searchSeq = 0; // guards against out-of-order responses

  function openSearch() {
    if (!currentRepo) { toast("Pick a repo first.", "warn"); return; }
    if (agendaOpen) closeAgenda();
    searchOpen = true;
    closeSidebar();
    editorPane.hidden = true;
    emptyState.hidden = true;
    searchPane.hidden = false;
    searchInput.focus();
    searchInput.select();
    if (searchInput.value.trim()) runSearch();
  }
  function closeSearch() {
    searchOpen = false;
    searchPane.hidden = true;
    if (current) editorPane.hidden = false;
    else emptyState.hidden = false;
  }

  function scheduleSearch() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 200);
  }

  // Client-side fallback for older backends without /api/search.
  async function searchClient(q) {
    const ql = q.toLowerCase();
    const results = [];
    const loaded = await Promise.all(
      notes.map((n) => Api.getNote(currentRepo, n.path).then((r) => ({ path: n.path, content: r.content })).catch(() => null))
    );
    for (const r of loaded) {
      if (!r) continue;
      const hit = { path: r.path, titleMatch: r.path.toLowerCase().includes(ql), matches: [] };
      r.content.split("\n").forEach((line, i) => {
        if (hit.matches.length < 5 && line.toLowerCase().includes(ql)) {
          hit.matches.push({ line: i + 1, text: line.trim().slice(0, 160) });
        }
      });
      if (hit.titleMatch || hit.matches.length) results.push(hit);
    }
    results.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return results;
  }

  async function runSearch() {
    const q = searchInput.value.trim();
    const seq = ++searchSeq;
    searchResultsEl.textContent = "";
    if (q.length < 2) { searchSubEl.textContent = q ? "Keep typing…" : ""; return; }
    searchSubEl.textContent = "Searching…";
    let results;
    try {
      results = (await Api.search(currentRepo, q)).results || [];
    } catch (err) {
      if (err && err.status === 404) results = await searchClient(q);
      else { searchSubEl.textContent = "Search failed"; toast("Search failed: " + err.message, "error"); return; }
    }
    if (seq !== searchSeq || !searchOpen) return; // superseded or closed
    renderSearch(q, results);
  }

  function renderSearch(q, results) {
    searchResultsEl.textContent = "";
    const noteCount = results.length;
    const lineCount = results.reduce((s, r) => s + r.matches.length, 0);
    searchSubEl.textContent = noteCount
      ? noteCount + (noteCount === 1 ? " note" : " notes") + (lineCount ? " · " + lineCount + " line" + (lineCount === 1 ? "" : "s") : "")
      : "No matches";
    if (!noteCount) {
      const p = document.createElement("p");
      p.className = "agenda-empty";
      p.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Nothing matched “' + escapeHtml(q) + '”.';
      searchResultsEl.appendChild(p);
      return;
    }
    for (const hit of results) {
      const group = document.createElement("div");
      group.className = "search-group";
      const head = document.createElement("button");
      head.type = "button";
      head.className = "search-note" + (hit.titleMatch ? " title-match" : "");
      head.innerHTML = '<i class="fa-solid fa-file-lines"></i> ';
      head.append(document.createTextNode(hit.path));
      head.addEventListener("click", () => { closeSearch(); openNote(hit.path); });
      group.appendChild(head);
      for (const m of hit.matches) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "search-line";
        const ln = document.createElement("span");
        ln.className = "search-lineno";
        ln.textContent = m.line;
        const txt = document.createElement("span");
        txt.className = "search-snippet";
        txt.append(highlightMatch(m.text, q));
        row.append(ln, txt);
        row.addEventListener("click", () => { closeSearch(); openNote(hit.path, { line: m.line }); });
        group.appendChild(row);
      }
      searchResultsEl.appendChild(group);
    }
  }

  // Build a snippet fragment with the matched substring wrapped in <mark>.
  function highlightMatch(text, q) {
    const frag = document.createDocumentFragment();
    const hay = text.toLowerCase();
    const needle = q.toLowerCase();
    let i = 0;
    let idx = hay.indexOf(needle);
    if (!needle || idx < 0) { frag.append(document.createTextNode(text)); return frag; }
    while (idx >= 0) {
      if (idx > i) frag.append(document.createTextNode(text.slice(i, idx)));
      const mk = document.createElement("mark");
      mk.textContent = text.slice(idx, idx + q.length);
      frag.append(mk);
      i = idx + q.length;
      idx = hay.indexOf(needle, i);
    }
    if (i < text.length) frag.append(document.createTextNode(text.slice(i)));
    return frag;
  }

  function escapeHtml(s) {
    return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
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

  // Splice text in at an explicit range (used after an async upload, where the
  // live selection may have moved).
  function insertTextAt(start, end, str) {
    textarea.value = textarea.value.slice(0, start) + str + textarea.value.slice(end);
    const pos = start + str.length;
    textarea.focus();
    textarea.setSelectionRange(pos, pos);
    markEdited();
    recordHistory();
  }

  // Pick an image, ask where to save it (path relative to this note), upload it
  // into the repo, and insert the markdown at the cursor.
  function uploadImage() {
    if (!current || !currentRepo) return;
    const at = { start: textarea.selectionStart, end: textarea.selectionEnd };
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.addEventListener("change", async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const safeName = file.name.replace(/[^\w.\-]+/g, "-");
      let rel = prompt("Save image as (path relative to this note):", "images/" + safeName);
      if (rel === null) return;
      rel = rel.trim().replace(/^\/+/, "");
      if (!rel) return;
      const repoPath = resolveRelPath(current.path, rel);
      const t = toast("Uploading " + file.name + "…", "info");
      try {
        await Api.uploadFile(currentRepo, repoPath, file);
        if (t) t.remove();
        const alt = file.name.replace(/\.[^.]+$/, "");
        insertTextAt(at.start, at.end, "![" + alt + "](" + rel + ")");
        toast("Image uploaded & inserted.", "success");
      } catch (err) {
        if (t) t.remove();
        toast("Upload failed: " + err.message, "error");
      }
    });
    input.click();
  }

  const inserters = {
    link: () => insertLink(false),
    image: () => insertLink(true),
    upload: uploadImage,
    table: insertTable,
    code: insertCodeBlock,
    bold: () => wrap("**", "**", "bold text"),
    italic: () => wrap("*", "*", "italic text"),
    heading: () => prefixLines((l) => "## " + l.replace(/^#+\s*/, "")),
    ul: () => prefixLines((l) => "- " + l.replace(/^[-*]\s*/, "")),
    task: () => prefixLines((l) => "- [ ] " + l.replace(/^(- \[[ x]\]\s*|[-*]\s*)/, "")),
    quote: () => prefixLines((l) => "> " + l.replace(/^>\s*/, "")),
  };

  // Position a pop-out as a viewport-fixed panel just below its button, aligned
  // to the button's right edge but clamped so it never spills off either side.
  // Fixed positioning (vs absolute) keeps it on-screen regardless of how wide or
  // overflowing the toolbar/header is — important on iOS Safari.
  function positionDropdown(btn, dropdown) {
    dropdown.style.position = "fixed";
    dropdown.style.right = "auto"; // override the CSS right:0 (else it stretches)
    dropdown.style.left = "0px";   // let it size to content before measuring
    dropdown.style.top = "0px";
    const r = btn.getBoundingClientRect();
    const margin = 8;
    const w = dropdown.offsetWidth || 200;
    let left = r.right - w;
    left = Math.max(margin, Math.min(left, window.innerWidth - w - margin));
    dropdown.style.left = Math.round(left) + "px";
    dropdown.style.top = Math.round(r.bottom + 4) + "px";
  }

  function setInsertMenu(open) {
    insertDropdown.hidden = !open;
    insertMenuBtn.setAttribute("aria-expanded", String(open));
    if (open) positionDropdown(insertMenuBtn, insertDropdown);
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

  async function openNote(path, opts) {
    opts = opts || {};
    if (dirty && !confirm("Discard unsaved changes?")) return;
    clearTimeout(draftTimer); // don't let a pending draft write land under the old path
    try {
      const res = await Api.getNote(currentRepo, path);
      current = { path: res.path, content: res.content };
      localStorage.setItem(lastNoteKey(), res.path);
      loadCollapsed();
      textarea.value = res.content;
      resetHistory();
      currentPathEl.textContent = res.path;
      setDirty(false);
      // Restore a local draft (unsynced edits) if one is newer than the server copy.
      const restored = maybeRestoreDraft(res.path, res.content);
      showEditor();
      closeSidebar();
      autoSelectMode(res.path, res.content);
      renderList();
      // A search result / link can ask to land on a specific line — force Edit so
      // the raw line is visible, then place the cursor there.
      if (opts.line) { setMode("edit"); jumpToLine(opts.line); }
      else if (mode === "edit") textarea.focus();
      if (restored) toast("Restored an unsaved draft for this note.", "info");
    } catch (err) {
      toast("Could not open note: " + err.message, "error");
    }
  }

  // Move the caret to the start of a 1-based line and scroll it into view.
  function jumpToLine(line) {
    const lines = textarea.value.split("\n");
    const n = Math.max(1, Math.min(line, lines.length));
    let offset = 0;
    for (let i = 0; i < n - 1; i++) offset += lines[i].length + 1;
    textarea.focus();
    textarea.setSelectionRange(offset, offset + (lines[n - 1] || "").length);
    // Approximate scroll: proportional to line position.
    const ratio = (n - 1) / Math.max(1, lines.length);
    textarea.scrollTop = Math.max(0, ratio * textarea.scrollHeight - textarea.clientHeight / 2);
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
      // Synced to the server — the local draft is now redundant.
      clearDraft(current.path);
      showDraftBanner(false);
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
    textarea.value = defaultScaffold(name);
    resetHistory();
    currentPathEl.textContent = name;
    const t = noteType(name, textarea.value);
    setNoteChrome(t);
    showEditor();
    closeSidebar();
    setDirty(true);
    if (TYPED_MODES.includes(t)) {
      setMode(t);
    } else {
      setMode("edit");
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }
  }

  // Create a brand-new note at a known path (no prompt), scaffolded + shown in
  // its type's view. Used by the "New" menu for typed kinds like recipes.
  function newTypedNote(path) {
    if (dirty && !confirm("Discard unsaved changes?")) return;
    current = { path, content: "" };
    loadCollapsed();
    textarea.value = defaultScaffold(path);
    resetHistory();
    currentPathEl.textContent = path;
    const t = noteType(path, textarea.value);
    setNoteChrome(t);
    showEditor();
    closeSidebar();
    setDirty(true);
    if (TYPED_MODES.includes(t)) setMode(t);
    else { setMode("edit"); textarea.focus(); }
    renderList();
  }

  // ---- settings popover (auto-sync) ----
  let settingsPop = null;
  function closeSettings() {
    if (!settingsPop) return;
    settingsPop.remove();
    settingsPop = null;
    document.removeEventListener("click", onSettingsDocClick, true);
    document.removeEventListener("keydown", onSettingsKey, true);
  }
  function onSettingsDocClick(e) { if (settingsPop && !settingsPop.contains(e.target)) closeSettings(); }
  function onSettingsKey(e) { if (e.key === "Escape") closeSettings(); }

  function openSettings(anchor) {
    closeSettings();
    const pop = document.createElement("div");
    pop.className = "settings-pop";
    const head = document.createElement("div");
    head.className = "settings-head";
    head.textContent = "Settings";
    pop.appendChild(head);

    const toggleRow = document.createElement("label");
    toggleRow.className = "settings-row settings-toggle";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = autosyncEnabled;
    toggleRow.append(cb, document.createTextNode(" Auto-sync changes"));
    pop.appendChild(toggleRow);

    const delayRow = document.createElement("div");
    delayRow.className = "settings-row settings-delay";
    delayRow.appendChild(document.createTextNode("Sync after "));
    const num = document.createElement("input");
    num.type = "number";
    num.min = String(AUTOSYNC_MIN);
    num.max = String(AUTOSYNC_MAX);
    num.value = String(autosyncSecs);
    num.className = "settings-secs";
    delayRow.append(num, document.createTextNode(" s of no edits"));
    pop.appendChild(delayRow);

    const note = document.createElement("p");
    note.className = "settings-note";
    note.textContent = "Off = save manually with the Save button (Ctrl+S). Applies on your next edit.";
    pop.appendChild(note);

    const applyEnabled = () => {
      num.disabled = !autosyncEnabled;
      delayRow.classList.toggle("disabled", !autosyncEnabled);
    };
    applyEnabled();
    cb.addEventListener("change", () => {
      autosyncEnabled = cb.checked;
      localStorage.setItem("notes.autosync", autosyncEnabled ? "on" : "off");
      applyEnabled();
      if (autosyncEnabled) { if (dirty) scheduleAutosave(); }
      else clearTimeout(autosaveTimer);
    });
    num.addEventListener("change", () => {
      let v = parseInt(num.value, 10);
      if (!Number.isFinite(v)) v = AUTOSYNC_DEFAULT_SECS;
      v = Math.min(AUTOSYNC_MAX, Math.max(AUTOSYNC_MIN, v));
      autosyncSecs = v;
      num.value = String(v);
      localStorage.setItem("notes.autosyncSecs", String(v));
      if (autosyncEnabled && dirty) scheduleAutosave();
    });

    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    const w = Math.min(280, window.innerWidth - 16);
    pop.style.width = w + "px";
    pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + "px";
    pop.style.bottom = window.innerHeight - r.top + 6 + "px"; // open upward from the footer
    settingsPop = pop;
    setTimeout(() => {
      document.addEventListener("click", onSettingsDocClick, true);
      document.addEventListener("keydown", onSettingsKey, true);
    }, 0);
  }

  // A GitHub-style destructive-action confirm: you must type the note's exact
  // path before the Delete button unlocks. Deleting commits the removal to git,
  // which is easy to fat-finger on a phone — this makes it deliberate. Returns a
  // Promise<boolean>.
  function confirmDeleteNote(path) {
    return new Promise((resolve) => {
      const backdrop = document.createElement("div");
      backdrop.className = "modal-backdrop";
      const modal = document.createElement("div");
      modal.className = "modal delete-modal";
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-modal", "true");
      modal.setAttribute("aria-labelledby", "delmodal-title");

      const h = document.createElement("h2");
      h.id = "delmodal-title";
      h.className = "modal-title danger";
      h.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Delete note';

      const body = document.createElement("p");
      body.className = "modal-body";
      body.append(document.createTextNode("This permanently deletes "));
      const strong = document.createElement("strong");
      strong.textContent = path;
      body.append(strong, document.createTextNode(" and commits the removal to git. This can’t be undone from the app."));

      const label = document.createElement("label");
      label.className = "modal-label";
      label.setAttribute("for", "delmodal-input");
      label.append(document.createTextNode("Type "));
      const code = document.createElement("code");
      code.textContent = path;
      label.append(code, document.createTextNode(" to confirm."));

      const input = document.createElement("input");
      input.type = "text";
      input.id = "delmodal-input";
      input.className = "modal-input";
      input.autocomplete = "off";
      input.spellcheck = false;
      input.setAttribute("autocapitalize", "off");
      input.setAttribute("autocorrect", "off");

      const foot = document.createElement("div");
      foot.className = "modal-foot";
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "button button-ghost";
      cancel.textContent = "Cancel";
      const del = document.createElement("button");
      del.type = "button";
      del.className = "button button-danger";
      del.textContent = "Delete this note";
      del.disabled = true;
      foot.append(cancel, del);

      modal.append(h, body, label, input, foot);
      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);

      let done = false;
      const close = (result) => {
        if (done) return;
        done = true;
        document.removeEventListener("keydown", onKey, true);
        backdrop.remove();
        resolve(result);
      };
      const matches = () => input.value.trim() === path;
      input.addEventListener("input", () => { del.disabled = !matches(); });
      function onKey(e) {
        if (e.key === "Escape") { e.preventDefault(); close(false); }
        else if (e.key === "Enter" && matches()) { e.preventDefault(); close(true); }
      }
      document.addEventListener("keydown", onKey, true);
      backdrop.addEventListener("mousedown", (e) => { if (e.target === backdrop) close(false); });
      cancel.addEventListener("click", () => close(false));
      del.addEventListener("click", () => { if (matches()) close(true); });

      input.focus();
    });
  }

  async function deleteNote() {
    if (!current) return;
    const path = current.path;
    // A never-saved new note isn't on disk yet — a light confirm is enough (and
    // drop any local draft so it doesn't resurrect on reopen).
    const exists = notes.some((n) => n.path === path);
    if (!exists) {
      if (!confirm('Discard this unsaved note “' + path + '”?')) return;
      clearDraft(path);
      closeNote();
      return;
    }
    if (!(await confirmDeleteNote(path))) return;
    try {
      const res = await Api.deleteNote(currentRepo, path);
      clearDraft(path); // a deleted note shouldn't leave a resurrectable draft
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
    setNoteChrome("");
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
    if (!newDropdown.hidden && !e.target.closest(".new-wrap")) {
      setNewMenu(false);
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

  // In-note anchor links (e.g. a table of contents) scroll the preview.
  preview.addEventListener("click", (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    e.preventDefault();
    const id = decodeURIComponent(a.getAttribute("href").slice(1));
    const el = findAnchor(id);
    if (el) {
      scrollPreviewTo(el);
      history.replaceState(null, "", "#" + id); // shareable, no jump
    }
  });
  // URL hash changes (typed or shared link) scroll to the heading.
  window.addEventListener("hashchange", scrollToHash);
  todoForm.addEventListener("submit", (e) => {
    e.preventDefault();
    addTodo(todoInput.value);
    todoInput.value = "";
    todoInput.focus();
  });
  todoCompactBtn.addEventListener("click", () => setCompact(!compact));
  todoCollapseAllBtn.addEventListener("click", toggleCollapseAll);

  // Planner week nav (inside the planner pane).
  $("[data-planner-prev]").addEventListener("click", () => gotoWeek(-1));
  $("[data-planner-next]").addEventListener("click", () => gotoWeek(1));
  $("[data-planner-today]").addEventListener("click", () => {
    const w = isoWeek(new Date());
    openPlannerWeek(w.year, w.week);
  });
  $("[data-mealplan-shop]").addEventListener("click", generateShoppingList);

  // Header "New" menu — one place to create every note type.
  function setNewMenu(open) {
    newDropdown.hidden = !open;
    newMenuBtn.setAttribute("aria-expanded", String(open));
    if (open) positionDropdown(newMenuBtn, newDropdown);
  }
  newMenuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    setNewMenu(newDropdown.hidden);
  });
  newDropdown.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-new-kind]");
    if (!btn) return;
    setNewMenu(false);
    const kind = btn.getAttribute("data-new-kind");
    const w = isoWeek(new Date());
    if (kind === "note") { newNote(); return; }
    if (kind === "planner") { openPlannerWeek(w.year, w.week); return; }
    if (kind === "mealplan") { openMealplanWeek(w.year, w.week); return; }
    if (kind === "meeting") { openMeetingToday(); return; }
    if (kind === "routines") { openRoutines(); return; }
    if (kind === "recipe") {
      let name = prompt("Recipe name:", "");
      if (name === null) return;
      name = name.trim();
      if (!name) return;
      const path = "recipes/" + slugify(name) + ".md";
      if (notes.some((n) => n.path === path)) { openNote(path); return; }
      newTypedNote(path);
    }
  });

  // Routines: add a chore from the text input + the recurrence picker.
  if (routinesForm) {
    routinesForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const picker = routinesPickerMount && routinesPickerMount._picker;
      addRoutine(routinesInput.value, picker ? picker.getValue() : "1w");
      routinesInput.value = "";
      routinesInput.focus();
    });
  }

  // Agenda (passive dashboard).
  $("[data-agenda-open]").addEventListener("click", openAgenda);
  $("[data-agenda-close]").addEventListener("click", closeAgenda);
  $("[data-agenda-refresh]").addEventListener("click", () => { if (agendaOpen) renderAgenda(); });

  // Search.
  $("[data-search-open]").addEventListener("click", openSearch);
  $("[data-search-close]").addEventListener("click", closeSearch);
  searchForm.addEventListener("submit", (e) => { e.preventDefault(); runSearch(); });
  searchInput.addEventListener("input", scheduleSearch);
  $("[data-draft-discard]").addEventListener("click", discardDraft);

  // Settings (auto-sync).
  $("[data-settings]").addEventListener("click", (e) => { e.stopPropagation(); openSettings(e.currentTarget); });
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
      if (!newDropdown.hidden) setNewMenu(false);
      if (agendaOpen) { closeAgenda(); return; }
      if (searchOpen) { closeSearch(); return; }
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
