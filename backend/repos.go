package main

import "sync"

// repoHandle bundles a repo's git wrapper with a mutex that serializes all
// access to that working tree. The mutex is keyed by on-disk path (not by user
// or repo id) so that a repo shared between several users is still mutated one
// operation at a time.
type repoHandle struct {
	git *Git
	mu  sync.Mutex
}

// RepoManager lazily creates and caches one repoHandle per distinct repo path.
type RepoManager struct {
	cfg     *Config
	mu      sync.Mutex
	handles map[string]*repoHandle
}

func NewRepoManager(cfg *Config) *RepoManager {
	return &RepoManager{cfg: cfg, handles: map[string]*repoHandle{}}
}

// handle returns the shared handle for a repo path, creating it on first use.
func (m *RepoManager) handle(path string) *repoHandle {
	m.mu.Lock()
	defer m.mu.Unlock()
	h := m.handles[path]
	if h == nil {
		h = &repoHandle{git: NewGit(path, m.cfg.CommitName, m.cfg.CommitMail)}
		m.handles[path] = h
	}
	return h
}
