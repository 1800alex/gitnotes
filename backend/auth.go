package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

// Repo is one git-backed notebook a user can access. The same Path may appear
// in several users' configs — that's how a repo is "shared".
type Repo struct {
	ID   string `json:"id"`   // stable, unique per user (slug)
	Name string `json:"name"` // display label
	Path string `json:"path"` // on-disk repo path (never sent to the client)
}

// User is a single account entry in the flat users JSON file.
type User struct {
	Username     string `json:"username"`
	PasswordHash string `json:"passwordHash"` // bcrypt hash
	Repos        []Repo `json:"repos"`
}

type usersFile struct {
	Users []User `json:"users"`
}

// UserStore loads and serves users from a flat JSON file. It is read-only at
// runtime; accounts are managed by editing the file (see `notes -hashpw`).
type UserStore struct {
	path        string
	defaultPath string // fallback repo for users with no `repos` (back-compat)
	mu          sync.RWMutex
	byName      map[string]User
}

func NewUserStore(path, defaultPath string) (*UserStore, error) {
	s := &UserStore{path: path, defaultPath: defaultPath, byName: map[string]User{}}
	if err := s.reload(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *UserStore) reload() error {
	data, err := os.ReadFile(s.path)
	if err != nil {
		return err
	}
	var uf usersFile
	if err := json.Unmarshal(data, &uf); err != nil {
		return err
	}
	m := make(map[string]User, len(uf.Users))
	for _, u := range uf.Users {
		// Back-compat: a user with no repos falls back to the single default repo.
		if len(u.Repos) == 0 && s.defaultPath != "" {
			u.Repos = []Repo{{ID: "default", Name: "Notes", Path: s.defaultPath}}
		}
		m[strings.ToLower(u.Username)] = u
	}
	s.mu.Lock()
	s.byName = m
	s.mu.Unlock()
	return nil
}

// Repos returns the repos a user may access (id + name only is the caller's job
// to project; full structs are returned here).
func (s *UserStore) Repos(username string) []Repo {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.byName[strings.ToLower(username)].Repos
}

// allRepoPaths returns every distinct repo path across all users (for startup).
func (s *UserStore) allRepoPaths() []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	seen := map[string]bool{}
	var paths []string
	for _, u := range s.byName {
		for _, r := range u.Repos {
			if r.Path != "" && !seen[r.Path] {
				seen[r.Path] = true
				paths = append(paths, r.Path)
			}
		}
	}
	return paths
}

// ResolveRepo authorises a user for a repo id and returns it. This is the access
// boundary: a user can only reach repos listed in their own config.
func (s *UserStore) ResolveRepo(username, repoID string) (Repo, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, r := range s.byName[strings.ToLower(username)].Repos {
		if r.ID == repoID {
			return r, true
		}
	}
	return Repo{}, false
}

// Verify checks a username/password pair against the store. It always performs
// a bcrypt comparison (against a dummy hash for unknown users) to avoid leaking
// account existence through response timing.
func (s *UserStore) Verify(username, password string) (User, bool) {
	s.mu.RLock()
	u, ok := s.byName[strings.ToLower(username)]
	s.mu.RUnlock()

	hash := u.PasswordHash
	if !ok {
		// Constant-ish work for unknown users.
		hash = "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin"
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)); err != nil {
		return User{}, false
	}
	return u, ok
}

// Auth wires the user store, signing secret and token lifetime together.
type Auth struct {
	store  *UserStore
	secret []byte
	ttl    time.Duration
}

func NewAuth(store *UserStore, secret []byte, ttl time.Duration) *Auth {
	return &Auth{store: store, secret: secret, ttl: ttl}
}

func (a *Auth) issueToken(username string) (string, time.Time, error) {
	exp := time.Now().Add(a.ttl)
	claims := jwt.RegisteredClaims{
		Subject:   username,
		IssuedAt:  jwt.NewNumericDate(time.Now()),
		ExpiresAt: jwt.NewNumericDate(exp),
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := tok.SignedString(a.secret)
	return signed, exp, err
}

func (a *Auth) parseToken(tokenStr string) (string, error) {
	claims := &jwt.RegisteredClaims{}
	_, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return a.secret, nil
	})
	if err != nil {
		return "", err
	}
	return claims.Subject, nil
}

type ctxKey string

const userCtxKey ctxKey = "user"

// Middleware enforces a valid Bearer token and stashes the username in context.
func (a *Auth) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		header := r.Header.Get("Authorization")
		const prefix = "Bearer "
		if !strings.HasPrefix(header, prefix) {
			writeError(w, http.StatusUnauthorized, "missing or malformed Authorization header")
			return
		}
		username, err := a.parseToken(strings.TrimPrefix(header, prefix))
		if err != nil {
			writeError(w, http.StatusUnauthorized, "invalid or expired token")
			return
		}
		ctx := context.WithValue(r.Context(), userCtxKey, username)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func userFromContext(ctx context.Context) string {
	if v, ok := ctx.Value(userCtxKey).(string); ok {
		return v
	}
	return ""
}

// HandleLogin authenticates a user and returns a signed token.
func (a *Auth) HandleLogin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	user, ok := a.store.Verify(req.Username, req.Password)
	if !ok {
		writeError(w, http.StatusUnauthorized, "invalid username or password")
		return
	}
	token, exp, err := a.issueToken(user.Username)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not issue token")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"token":     token,
		"username":  user.Username,
		"expiresAt": exp.Format(time.RFC3339),
		"repos":     publicRepos(a.store.Repos(user.Username)),
	})
}

// publicRepos projects repos to the id+name the client needs, omitting paths.
func publicRepos(repos []Repo) []map[string]string {
	out := make([]map[string]string, 0, len(repos))
	for _, r := range repos {
		out = append(out, map[string]string{"id": r.ID, "name": r.Name})
	}
	return out
}

// hashPassword is used by the -hashpw CLI helper to generate users.json entries.
func hashPassword(password string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	return string(b), err
}
