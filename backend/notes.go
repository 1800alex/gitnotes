package main

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

// maxUpload caps the size of an uploaded attachment.
const maxUpload = 32 << 20 // 32 MiB

// Notes serves the markdown files inside each user's git-backed repos and ties
// write operations to commits/pushes. Every request is scoped to one repo,
// resolved from the authenticated user's config; access to a repo a user does
// not list is rejected.
type Notes struct {
	cfg   *Config
	store *UserStore
	repos *RepoManager
}

func NewNotes(cfg *Config, store *UserStore, repos *RepoManager) *Notes {
	return &Notes{cfg: cfg, store: store, repos: repos}
}

// resolve authorises the current user for a repo id and returns its shared
// handle + on-disk path. It writes an error response and returns ok=false when
// the repo is missing or inaccessible.
func (n *Notes) resolve(w http.ResponseWriter, r *http.Request, repoID string) (*repoHandle, string, bool) {
	if strings.TrimSpace(repoID) == "" {
		writeError(w, http.StatusBadRequest, "repo is required")
		return nil, "", false
	}
	repo, ok := n.store.ResolveRepo(userFromContext(r.Context()), repoID)
	if !ok {
		writeError(w, http.StatusNotFound, "unknown or inaccessible repo")
		return nil, "", false
	}
	return n.repos.handle(repo.Path), repo.Path, true
}

// NoteMeta is the lightweight listing entry sent to the UI.
type NoteMeta struct {
	Path     string `json:"path"`     // repo-relative, forward-slashed
	Name     string `json:"name"`     // base file name
	Dir      string `json:"dir"`      // parent dir ("" for root)
	Size     int64  `json:"size"`
	Modified string `json:"modified"` // RFC3339
}

// resolvePath validates a user-supplied repo-relative path against a repo root
// and returns the cleaned relative path plus its absolute on-disk location. It
// rejects traversal, absolute paths, and any dot-segment (e.g. .git, .env).
func (n *Notes) resolvePath(repoDir, rel string) (string, string, error) {
	rel = strings.TrimSpace(rel)
	if rel == "" {
		return "", "", errors.New("path is required")
	}
	rel = filepath.ToSlash(rel)
	if strings.HasPrefix(rel, "/") {
		return "", "", errors.New("path must be relative")
	}
	clean := path.Clean(rel)
	if clean == "." || clean == ".." || strings.HasPrefix(clean, "../") {
		return "", "", errors.New("path escapes the repository")
	}
	for _, seg := range strings.Split(clean, "/") {
		if strings.HasPrefix(seg, ".") {
			return "", "", errors.New("dotfiles are not accessible")
		}
	}
	// Resolve both the repo root and the target to absolute paths before the
	// containment check — otherwise a relative NOTES_REPO (e.g. "../repo") makes
	// abs relative while repoAbs is absolute, so every path looks like it escapes.
	repoAbs, err := filepath.Abs(repoDir)
	if err != nil {
		return "", "", err
	}
	abs := filepath.Join(repoAbs, filepath.FromSlash(clean))
	if !strings.HasPrefix(abs, repoAbs+string(os.PathSeparator)) {
		return "", "", errors.New("path escapes the repository")
	}
	return clean, abs, nil
}

// safePath is resolvePath plus the note-extension restriction (for note CRUD).
func (n *Notes) safePath(repoDir, rel string) (string, string, error) {
	clean, abs, err := n.resolvePath(repoDir, rel)
	if err != nil {
		return "", "", err
	}
	if !strings.HasSuffix(strings.ToLower(clean), n.cfg.NoteExt) {
		return "", "", fmt.Errorf("only %s files are allowed", n.cfg.NoteExt)
	}
	return clean, abs, nil
}

// list walks a repo for note files, skipping the .git directory and dotfiles.
func (n *Notes) list(repoDir string) ([]NoteMeta, error) {
	var out []NoteMeta
	err := filepath.WalkDir(repoDir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		name := d.Name()
		if d.IsDir() {
			if name == ".git" || (name != "." && strings.HasPrefix(name, ".") && p != repoDir) {
				return filepath.SkipDir
			}
			return nil
		}
		if strings.HasPrefix(name, ".") {
			return nil
		}
		if !strings.HasSuffix(strings.ToLower(name), n.cfg.NoteExt) {
			return nil
		}
		rel, _ := filepath.Rel(repoDir, p)
		rel = filepath.ToSlash(rel)
		info, err := d.Info()
		if err != nil {
			return nil
		}
		out = append(out, NoteMeta{
			Path:     rel,
			Name:     name,
			Dir:      filepath.ToSlash(filepath.Dir(rel)),
			Size:     info.Size(),
			Modified: info.ModTime().UTC().Format(time.RFC3339),
		})
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out, nil
}

// HandleRepos: GET /api/repos — the repos the current user may access.
func (n *Notes) HandleRepos(w http.ResponseWriter, r *http.Request) {
	repos := n.store.Repos(userFromContext(r.Context()))
	writeJSON(w, http.StatusOK, map[string]any{"repos": publicRepos(repos)})
}

// HandleList: GET /api/notes?repo=<id>
func (n *Notes) HandleList(w http.ResponseWriter, r *http.Request) {
	h, repoDir, ok := n.resolve(w, r, r.URL.Query().Get("repo"))
	if !ok {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	notes, err := n.list(repoDir)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list notes: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"notes": notes})
}

// HandleGet: GET /api/note?repo=<id>&path=...
func (n *Notes) HandleGet(w http.ResponseWriter, r *http.Request) {
	h, repoDir, ok := n.resolve(w, r, r.URL.Query().Get("repo"))
	if !ok {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	rel, abs, err := n.safePath(repoDir, r.URL.Query().Get("path"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	data, err := os.ReadFile(abs)
	if err != nil {
		if os.IsNotExist(err) {
			writeError(w, http.StatusNotFound, "note not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "could not read note: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"path": rel, "content": string(data)})
}

// HandleRaw: GET /api/raw?repo=<id>&path=... — serve a raw repo file (any type,
// e.g. images referenced from a note). Authenticated + repo-scoped + path-safe.
func (n *Notes) HandleRaw(w http.ResponseWriter, r *http.Request) {
	h, repoDir, ok := n.resolve(w, r, r.URL.Query().Get("repo"))
	if !ok {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	_, abs, err := n.resolvePath(repoDir, r.URL.Query().Get("path"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	f, err := os.Open(abs)
	if err != nil {
		writeError(w, http.StatusNotFound, "file not found")
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || info.IsDir() {
		writeError(w, http.StatusNotFound, "file not found")
		return
	}
	// ServeContent sets Content-Type from the extension (and handles range
	// requests), which is what image elements need.
	http.ServeContent(w, r, info.Name(), info.ModTime(), f)
}

// HandleUpload: POST /api/upload (multipart: repo, path, file) — store an
// uploaded file (e.g. an image) in the repo, then commit + push.
func (n *Notes) HandleUpload(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxUpload+(1<<20))
	if err := r.ParseMultipartForm(maxUpload); err != nil {
		writeError(w, http.StatusBadRequest, "upload too large or malformed")
		return
	}
	h, repoDir, ok := n.resolve(w, r, r.FormValue("repo"))
	if !ok {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()

	rel, abs, err := n.resolvePath(repoDir, r.FormValue("path"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	src, _, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "missing file")
		return
	}
	defer src.Close()

	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		writeError(w, http.StatusInternalServerError, "could not create directory: "+err.Error())
		return
	}
	dst, err := os.Create(abs)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not write file: "+err.Error())
		return
	}
	if _, err := io.Copy(dst, src); err != nil {
		dst.Close()
		writeError(w, http.StatusInternalServerError, "could not write file: "+err.Error())
		return
	}
	dst.Close()

	user := userFromContext(r.Context())
	msg := fmt.Sprintf("Add %s", rel)
	if user != "" {
		msg = fmt.Sprintf("%s (via %s)", msg, user)
	}
	commit, err := h.git.CommitPath(rel, msg, n.cfg.AutoPush)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "saved file but git failed: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"path": rel, "git": commit})
}

type saveRequest struct {
	Repo    string `json:"repo"`
	Path    string `json:"path"`
	Content string `json:"content"`
	Message string `json:"message"`
	// Base is the content the client originally loaded — the common ancestor for
	// a 3-way merge. When nil (omitted) the save simply overwrites (legacy
	// behaviour); when present and the file has changed underneath, we merge.
	Base *string `json:"base"`
}

// normalizeNote keeps stored content tidy (single trailing newline) so that
// diffs, merges and base comparisons are stable.
func normalizeNote(s string) string {
	if s != "" && !strings.HasSuffix(s, "\n") {
		s += "\n"
	}
	return s
}

// HandleSave: PUT /api/note — create or update a note, then commit + push.
func (n *Notes) HandleSave(w http.ResponseWriter, r *http.Request) {
	var req saveRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	h, repoDir, ok := n.resolve(w, r, req.Repo)
	if !ok {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()

	rel, abs, err := n.safePath(repoDir, req.Path)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		writeError(w, http.StatusInternalServerError, "could not create directory: "+err.Error())
		return
	}

	content := normalizeNote(req.Content)

	// Reconcile with what's on disk. If the file changed since the client loaded
	// it (disk != base), 3-way merge rather than clobbering the other device's
	// work. Non-overlapping edits merge; overlapping ones auto-resolve to ours.
	merged := false
	overlap := false
	if disk, derr := os.ReadFile(abs); derr == nil && req.Base != nil {
		diskStr := string(disk)
		base := normalizeNote(*req.Base)
		if diskStr != base {
			result, ov, mErr := h.git.MergeFile(content, base, diskStr)
			if mErr != nil {
				writeError(w, http.StatusInternalServerError, "could not merge: "+mErr.Error())
				return
			}
			content = result
			merged = true
			overlap = ov
		}
	}

	if err := os.WriteFile(abs, []byte(content), 0o644); err != nil {
		writeError(w, http.StatusInternalServerError, "could not write note: "+err.Error())
		return
	}

	user := userFromContext(r.Context())
	msg := strings.TrimSpace(req.Message)
	if msg == "" {
		msg = fmt.Sprintf("Update %s", rel)
	}
	if merged {
		msg = fmt.Sprintf("Merge %s", rel)
	}
	if user != "" {
		msg = fmt.Sprintf("%s (via %s)", msg, user)
	}

	commit, err := h.git.CommitPath(rel, msg, n.cfg.AutoPush)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "saved to disk but git failed: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"path":    rel,
		"git":     commit,
		"merged":  merged,
		"overlap": overlap,
		"content": content,
	})
}

// HandleDelete: DELETE /api/note?repo=<id>&path=... — remove a note, then commit.
func (n *Notes) HandleDelete(w http.ResponseWriter, r *http.Request) {
	h, repoDir, ok := n.resolve(w, r, r.URL.Query().Get("repo"))
	if !ok {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()

	rel, abs, err := n.safePath(repoDir, r.URL.Query().Get("path"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if _, err := os.Stat(abs); err != nil {
		writeError(w, http.StatusNotFound, "note not found")
		return
	}
	if err := os.Remove(abs); err != nil {
		writeError(w, http.StatusInternalServerError, "could not delete note: "+err.Error())
		return
	}

	user := userFromContext(r.Context())
	msg := fmt.Sprintf("Delete %s", rel)
	if user != "" {
		msg = fmt.Sprintf("%s (via %s)", msg, user)
	}
	commit, err := h.git.CommitPath(rel, msg, n.cfg.AutoPush)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "deleted from disk but git failed: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"path": rel, "git": commit})
}

// HandleStatus: GET /api/status?repo=<id>
func (n *Notes) HandleStatus(w http.ResponseWriter, r *http.Request) {
	h, _, ok := n.resolve(w, r, r.URL.Query().Get("repo"))
	if !ok {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	s, err := h.git.Status()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not read git status: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, s)
}

type refreshRequest struct {
	Repo string `json:"repo"`
}

// HandleRefresh: POST /api/refresh {repo} — fetch + integrate upstream.
func (n *Notes) HandleRefresh(w http.ResponseWriter, r *http.Request) {
	var req refreshRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	h, _, ok := n.resolve(w, r, req.Repo)
	if !ok {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	res, err := h.git.Refresh()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// AgendaItem is one open, due-dated checklist item found anywhere in the repo.
// It mirrors the client's parseAction output so the browser can group them
// (Overdue / Today / This week / Later) relative to the user's local clock.
type AgendaItem struct {
	Path      string   `json:"path"`
	Text      string   `json:"text"`
	Due       string   `json:"due"` // YYYY-MM-DD
	Owners    []string `json:"owners"`
	Important bool     `json:"important"`
}

// Shared action-item grammar (must match the frontend's parseAction):
//
//	- [ ] text due:YYYY-MM-DD @owner !
var (
	openTaskRe = regexp.MustCompile(`^\s*[-*+]\s+\[ \]\s+(.*)$`)
	dueRe      = regexp.MustCompile(`(?:^|\s)due:(\d{4}-\d{2}-\d{2})(?:\s|$)`)
	ownerRe    = regexp.MustCompile(`(^|\s)@([^\s]+)`)
	fenceRe    = regexp.MustCompile("^\\s*```")
)

// parseActionTokens pulls due:/@owner/! tokens out of an item's text, matching
// the frontend so server- and client-side scans agree.
func parseActionTokens(raw string) AgendaItem {
	text := strings.TrimSpace(raw)
	item := AgendaItem{Owners: []string{}}
	if text == "!" || strings.HasSuffix(text, " !") {
		item.Important = true
		text = strings.TrimSpace(strings.TrimSuffix(text, "!"))
	}
	if m := dueRe.FindStringSubmatch(text); m != nil {
		item.Due = m[1]
		loc := dueRe.FindStringIndex(text)
		text = strings.TrimSpace(text[:loc[0]] + " " + text[loc[1]:])
	}
	for _, om := range ownerRe.FindAllStringSubmatch(text, -1) {
		item.Owners = append(item.Owners, om[2])
	}
	text = ownerRe.ReplaceAllString(text, "$1")
	item.Text = strings.Join(strings.Fields(text), " ")
	return item
}

// scanDueLines appends every open, due-dated checklist item in one note's
// content, skipping fenced code blocks.
func scanDueLines(relPath, content string, out *[]AgendaItem) {
	inFence := false
	for _, line := range strings.Split(content, "\n") {
		if fenceRe.MatchString(line) {
			inFence = !inFence
			continue
		}
		if inFence {
			continue
		}
		m := openTaskRe.FindStringSubmatch(line)
		if m == nil || !dueRe.MatchString(m[1]) {
			continue
		}
		item := parseActionTokens(m[1])
		if item.Due == "" {
			continue
		}
		item.Path = relPath
		*out = append(*out, item)
	}
}

// scanAgenda walks the repo and collects due-dated open items from every note,
// sorted by due date (then path). This is the server-side equivalent of the
// client's per-note scan — one request instead of N.
func (n *Notes) scanAgenda(repoDir string) ([]AgendaItem, error) {
	out := []AgendaItem{}
	err := filepath.WalkDir(repoDir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		name := d.Name()
		if d.IsDir() {
			if name == ".git" || (name != "." && strings.HasPrefix(name, ".") && p != repoDir) {
				return filepath.SkipDir
			}
			return nil
		}
		if strings.HasPrefix(name, ".") || !strings.HasSuffix(strings.ToLower(name), n.cfg.NoteExt) {
			return nil
		}
		data, rerr := os.ReadFile(p)
		if rerr != nil {
			return nil // skip unreadable files rather than failing the whole scan
		}
		rel, _ := filepath.Rel(repoDir, p)
		scanDueLines(filepath.ToSlash(rel), string(data), &out)
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Due != out[j].Due {
			return out[i].Due < out[j].Due
		}
		return out[i].Path < out[j].Path
	})
	return out, nil
}

// HandleAgenda: GET /api/agenda?repo=<id> — all open, due-dated items in the repo.
func (n *Notes) HandleAgenda(w http.ResponseWriter, r *http.Request) {
	h, repoDir, ok := n.resolve(w, r, r.URL.Query().Get("repo"))
	if !ok {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	items, err := n.scanAgenda(repoDir)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not scan agenda: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}
