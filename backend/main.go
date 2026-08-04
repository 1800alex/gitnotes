package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
)

func main() {
	hashpw := flag.Bool("hashpw", false, "read a password from stdin and print a bcrypt hash for users.json")
	flag.Parse()

	if *hashpw {
		runHashPW()
		return
	}

	cfg := LoadConfig()

	store, err := NewUserStore(cfg.UsersFile, cfg.RepoDir)
	if err != nil {
		log.Fatalf("could not load users file %q: %v", cfg.UsersFile, err)
	}
	auth := NewAuth(store, cfg.JWTSecret, cfg.TokenTTL)
	repos := NewRepoManager(cfg)

	// Best-effort: report and (optionally) sync every distinct repo on startup.
	for _, path := range store.allRepoPaths() {
		h := repos.handle(path)
		if !h.git.IsRepo() {
			log.Printf("WARNING: %q is not a git repository. Notes there will be saved but not version-controlled.", path)
			continue
		}
		if cfg.AutoPull {
			if res, err := h.git.Refresh(); err != nil {
				log.Printf("startup refresh %q failed: %v", path, err)
			} else if res.Message != "" {
				log.Printf("startup refresh %q: %s", path, res.Message)
			}
		}
	}

	notes := NewNotes(cfg, store, repos)

	mux := http.NewServeMux()

	// --- Public API ---
	mux.HandleFunc("POST /api/login", auth.HandleLogin)

	// --- Protected API ---
	protected := http.NewServeMux()
	protected.HandleFunc("GET /api/repos", notes.HandleRepos)
	protected.HandleFunc("GET /api/notes", notes.HandleList)
	protected.HandleFunc("GET /api/note", notes.HandleGet)
	protected.HandleFunc("GET /api/raw", notes.HandleRaw)
	protected.HandleFunc("POST /api/upload", notes.HandleUpload)
	protected.HandleFunc("PUT /api/note", notes.HandleSave)
	protected.HandleFunc("DELETE /api/note", notes.HandleDelete)
	protected.HandleFunc("GET /api/status", notes.HandleStatus)
	protected.HandleFunc("GET /api/agenda", notes.HandleAgenda)
	protected.HandleFunc("POST /api/refresh", notes.HandleRefresh)
	mux.Handle("/api/", auth.Middleware(protected))

	// --- Static Eleventy site ---
	mux.Handle("/", spaFileServer(cfg.StaticDir))

	log.Printf("notes server listening on %s", cfg.ListenAddr)
	log.Printf("  static : %s", cfg.StaticDir)
	log.Printf("  users  : %s", cfg.UsersFile)
	if err := http.ListenAndServe(cfg.ListenAddr, mux); err != nil {
		log.Fatal(err)
	}
}

// spaFileServer serves the built static site, falling back to pretty-URL
// directory index files (Eleventy emits <page>/index.html).
func spaFileServer(dir string) http.Handler {
	fs := http.FileServer(http.Dir(dir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Never let the API fall through to the file server.
		if strings.HasPrefix(r.URL.Path, "/api/") {
			writeError(w, http.StatusNotFound, "unknown endpoint")
			return
		}
		// Always revalidate HTML so freshly-deployed asset versions (the ?v=…
		// query on css/js) are picked up instead of a stale cached page.
		p := r.URL.Path
		if p == "/" || strings.HasSuffix(p, "/") || strings.HasSuffix(p, ".html") {
			w.Header().Set("Cache-Control", "no-cache")
		}
		fs.ServeHTTP(w, r)
	})
}

func runHashPW() {
	fmt.Fprint(os.Stderr, "Password: ")
	reader := bufio.NewReader(os.Stdin)
	line, _ := reader.ReadString('\n')
	pw := strings.TrimRight(line, "\r\n")
	if pw == "" {
		log.Fatal("empty password")
	}
	hash, err := hashPassword(pw)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(hash)
}

// --- small JSON helpers shared by handlers ---

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func decodeJSON(r *http.Request, v any) error {
	// Notes can be large; cap at 10 MiB to bound memory.
	dec := json.NewDecoder(io.LimitReader(r.Body, 10<<20))
	return dec.Decode(v)
}
