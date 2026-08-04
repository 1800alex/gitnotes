package main

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

// Git wraps a single repository, shelling out to the git binary. Running the
// real git client (rather than a Go library) means it transparently uses the
// user's bind-mounted SSH keys and .gitconfig for auth and identity.
type Git struct {
	dir        string
	authorName string
	authorMail string
}

func NewGit(dir, name, mail string) *Git {
	return &Git{dir: dir, authorName: name, authorMail: mail}
}

// run executes a git subcommand, returning combined trimmed stdout and stderr
// separately so callers can surface meaningful messages to the user.
func (g *Git) run(args ...string) (stdout string, stderr string, err error) {
	full := append([]string{"-C", g.dir}, args...)
	cmd := exec.Command("git", full...)
	// Make output script-friendly and non-interactive (never prompt for creds).
	cmd.Env = append(cmd.Environ(),
		"GIT_TERMINAL_PROMPT=0",
		"GIT_PAGER=cat",
	)
	var out, errBuf bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errBuf
	err = cmd.Run()
	return strings.TrimSpace(out.String()), strings.TrimSpace(errBuf.String()), err
}

// IsRepo reports whether dir is the top level of a git working tree.
func (g *Git) IsRepo() bool {
	out, _, err := g.run("rev-parse", "--is-inside-work-tree")
	return err == nil && out == "true"
}

func (g *Git) commitArgs() []string {
	args := []string{}
	if g.authorName != "" {
		args = append(args, "-c", "user.name="+g.authorName)
	}
	if g.authorMail != "" {
		args = append(args, "-c", "user.email="+g.authorMail)
	}
	return args
}

// Status describes the current state of the repo for the UI.
type Status struct {
	Branch      string `json:"branch"`
	HasUpstream bool   `json:"hasUpstream"`
	Remote      string `json:"remote"`
	Ahead       int    `json:"ahead"`
	Behind      int    `json:"behind"`
	Dirty       bool   `json:"dirty"`
	LastCommit  string `json:"lastCommit"`
	LastDate    string `json:"lastDate"`
}

func (g *Git) Status() (*Status, error) {
	s := &Status{}

	branch, _, err := g.run("rev-parse", "--abbrev-ref", "HEAD")
	if err != nil {
		return nil, fmt.Errorf("read branch: %w", err)
	}
	s.Branch = branch

	// Upstream tracking ref, if any.
	if up, _, err := g.run("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"); err == nil && up != "" {
		s.HasUpstream = true
		if i := strings.Index(up, "/"); i > 0 {
			s.Remote = up[:i]
		}
		// ahead<TAB>behind counts.
		if counts, _, err := g.run("rev-list", "--left-right", "--count", "@{u}...HEAD"); err == nil {
			fields := strings.Fields(counts)
			if len(fields) == 2 {
				s.Behind, _ = strconv.Atoi(fields[0])
				s.Ahead, _ = strconv.Atoi(fields[1])
			}
		}
	}

	if out, _, err := g.run("status", "--porcelain"); err == nil {
		s.Dirty = out != ""
	}

	if msg, _, err := g.run("log", "-1", "--pretty=%s"); err == nil {
		s.LastCommit = msg
	}
	if date, _, err := g.run("log", "-1", "--pretty=%cI"); err == nil {
		s.LastDate = date
	}

	return s, nil
}

// CommitResult reports what happened when persisting a change.
type CommitResult struct {
	Committed bool   `json:"committed"`
	Pushed    bool   `json:"pushed"`
	Message   string `json:"message"`
	PushError string `json:"pushError,omitempty"`
}

// CommitPath stages a single path, commits it, and (when an upstream exists and
// auto-push is on) pushes. A push failure is reported but not treated as fatal:
// the change is safely committed locally and the user is told why the push failed.
func (g *Git) CommitPath(relPath, message string, autoPush bool) (*CommitResult, error) {
	res := &CommitResult{}

	if _, stderr, err := g.run("add", "--", relPath); err != nil {
		return nil, fmt.Errorf("git add: %s", firstNonEmpty(stderr, err.Error()))
	}

	// Nothing staged (content identical) — not an error, just a no-op.
	if _, _, err := g.run("diff", "--cached", "--quiet"); err == nil {
		res.Message = "no changes to commit"
		return res, nil
	}

	args := g.commitArgs()
	args = append(args, "commit", "-m", message)
	if _, stderr, err := g.run(args...); err != nil {
		return nil, fmt.Errorf("git commit: %s", firstNonEmpty(stderr, err.Error()))
	}
	res.Committed = true
	res.Message = "committed"

	if autoPush {
		g.attachPush(res)
	}
	return res, nil
}

func (g *Git) attachPush(res *CommitResult) {
	s, err := g.Status()
	if err != nil || !s.HasUpstream {
		return
	}
	if _, stderr, err := g.run("push"); err != nil {
		res.PushError = firstNonEmpty(stderr, err.Error())
		return
	}
	res.Pushed = true
	res.Message = "committed and pushed"
}

// SyncResult reports the outcome of a fetch/pull refresh.
type SyncResult struct {
	Fetched   bool   `json:"fetched"`
	Updated   bool   `json:"updated"`
	Conflict  bool   `json:"conflict"`
	Message   string `json:"message"`
	Detail    string `json:"detail,omitempty"`
}

// Refresh fetches and integrates upstream changes. It prefers a fast-forward;
// if that is impossible it attempts a merge, and on conflict it cleanly aborts
// and reports the conflicting files so the user understands why it failed.
func (g *Git) Refresh() (*SyncResult, error) {
	res := &SyncResult{}

	s, err := g.Status()
	if err != nil {
		return nil, err
	}
	if !s.HasUpstream {
		res.Message = "no upstream remote configured — nothing to refresh"
		return res, nil
	}

	if _, stderr, err := g.run("fetch", "--prune"); err != nil {
		return nil, fmt.Errorf("git fetch: %s", firstNonEmpty(stderr, err.Error()))
	}
	res.Fetched = true

	// Re-read counts after fetch.
	s, _ = g.Status()
	if s.Behind == 0 {
		res.Message = "already up to date"
		return res, nil
	}

	// Try a fast-forward first — the clean, common case.
	if _, _, err := g.run("merge", "--ff-only", "@{u}"); err == nil {
		res.Updated = true
		res.Message = fmt.Sprintf("fast-forwarded %d commit(s) from upstream", s.Behind)
		return res, nil
	}

	// Histories diverged: attempt a real merge.
	args := g.commitArgs()
	args = append(args, "merge", "--no-edit", "@{u}")
	_, stderr, err := g.run(args...)
	if err != nil {
		// Likely a conflict. Capture the conflicting files, then abort to leave
		// the working tree in a clean, usable state.
		conflicts, _, _ := g.run("diff", "--name-only", "--diff-filter=U")
		_, _, _ = g.run("merge", "--abort")
		res.Conflict = true
		res.Message = "merge conflict — upstream changes could not be combined with your local changes automatically"
		if conflicts != "" {
			res.Detail = "Conflicting files:\n" + conflicts +
				"\n\nThe merge was aborted and your local changes are untouched. " +
				"Resolve this from a terminal in the repo, then refresh again."
		} else {
			res.Detail = firstNonEmpty(stderr, "merge failed")
		}
		return res, nil
	}

	res.Updated = true
	res.Message = "merged upstream changes"
	return res, nil
}

// MergeFile performs a 3-way merge of note content using `git merge-file`,
// combining base->ours and base->theirs changes. Non-overlapping edits merge
// automatically. Genuinely overlapping hunks are auto-resolved with --union,
// which KEEPS BOTH sides' lines rather than producing conflict markers or
// dropping a side. This favours never losing data (e.g. both devices appending
// to the bottom of a list keep both lines); the only cost is that two different
// edits to the same line appear as two adjacent lines for the user to tidy up.
// `overlap` reports whether any hunk was combined (so the UI can mention it).
// merge-file works on standalone files, so this never touches the working tree.
func (g *Git) MergeFile(ours, base, theirs string) (merged string, overlap bool, err error) {
	dir, err := os.MkdirTemp("", "note-merge-")
	if err != nil {
		return "", false, err
	}
	defer os.RemoveAll(dir)

	write := func(name, content string) (string, error) {
		p := filepath.Join(dir, name)
		return p, os.WriteFile(p, []byte(content), 0o600)
	}
	oursPath, err := write("ours", ours)
	if err != nil {
		return "", false, err
	}
	basePath, err := write("base", base)
	if err != nil {
		return "", false, err
	}
	theirsPath, err := write("theirs", theirs)
	if err != nil {
		return "", false, err
	}

	// First a plain 3-way merge to learn whether the edits actually overlap:
	// merge-file exits 0 when clean, or 1..127 = the number of conflicting hunks.
	// -p writes the result to stdout instead of editing in place.
	run := func(extra ...string) (string, error) {
		args := append([]string{"merge-file", "-p"}, extra...)
		args = append(args, oursPath, basePath, theirsPath)
		cmd := exec.Command("git", args...)
		var out, errBuf bytes.Buffer
		cmd.Stdout = &out
		cmd.Stderr = &errBuf
		if err := cmd.Run(); err != nil {
			if exit, ok := err.(*exec.ExitError); ok && exit.ExitCode() >= 1 && exit.ExitCode() <= 127 {
				return out.String(), errConflict // conflicting hunks (auto-resolvable)
			}
			return "", fmt.Errorf("git merge-file: %s", firstNonEmpty(errBuf.String(), err.Error()))
		}
		return out.String(), nil
	}

	clean, err := run()
	if err == nil {
		return clean, false, nil // non-overlapping — merged cleanly
	}
	if err != errConflict {
		return "", false, err
	}
	// Overlapping hunks. Re-run with --union so both sides' lines are kept (never
	// conflict markers, never a dropped edit) and flag overlap so the UI can tell
	// the user to tidy up the duplicated lines.
	union, uerr := run("--union")
	if uerr != nil && uerr != errConflict {
		return "", false, uerr
	}
	return union, true, nil
}

// errConflict is a sentinel: merge-file reported overlapping (auto-resolvable) hunks.
var errConflict = errors.New("merge conflict")

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
