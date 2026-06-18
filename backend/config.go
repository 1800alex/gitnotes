package main

import (
	"crypto/rand"
	"encoding/hex"
	"log"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config holds runtime configuration, sourced entirely from environment
// variables so it composes cleanly with docker-compose / .env files.
type Config struct {
	ListenAddr string        // address to bind, e.g. ":8080"
	StaticDir  string        // built Eleventy site to serve
	RepoDir    string        // git-backed notes repository (bind mounted)
	UsersFile  string        // flat JSON file of users + password hashes
	JWTSecret  []byte        // HMAC secret for signing tokens
	TokenTTL   time.Duration // how long an issued token is valid
	AutoPush   bool          // push to upstream after each change
	AutoPull   bool          // pull from upstream on startup
	NoteExt    string        // file extension treated as a note (".md")
	CommitName string        // optional git author override
	CommitMail string        // optional git author email override
}

func env(key, def string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return def
}

func envBool(key string, def bool) bool {
	v, ok := os.LookupEnv(key)
	if !ok || v == "" {
		return def
	}
	switch strings.ToLower(v) {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	}
	return def
}

// LoadConfig reads configuration from the environment, applying sane defaults
// that match the docker-compose deployment.
func LoadConfig() *Config {
	c := &Config{
		ListenAddr: env("LISTEN_ADDR", ":8080"),
		StaticDir:  env("STATIC_DIR", "/app/site"),
		RepoDir:    env("NOTES_REPO", "/data/repo"),
		UsersFile:  env("USERS_FILE", "/data/users.json"),
		AutoPush:   envBool("AUTO_PUSH", true),
		AutoPull:   envBool("AUTO_PULL", true),
		NoteExt:    env("NOTE_EXT", ".md"),
		CommitName: env("GIT_AUTHOR_NAME", ""),
		CommitMail: env("GIT_AUTHOR_EMAIL", ""),
	}

	hours := 24 * 30 // 30 days default — a comfortably long-lived token
	if v := env("TOKEN_TTL_HOURS", ""); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			hours = n
		}
	}
	c.TokenTTL = time.Duration(hours) * time.Hour

	if secret := env("JWT_SECRET", ""); secret != "" {
		c.JWTSecret = []byte(secret)
	} else {
		// Generate an ephemeral secret so the app still runs, but warn loudly:
		// every restart invalidates existing tokens, forcing users to log in.
		buf := make([]byte, 32)
		_, _ = rand.Read(buf)
		c.JWTSecret = []byte(hex.EncodeToString(buf))
		log.Println("WARNING: JWT_SECRET not set — generated an ephemeral secret. " +
			"Tokens will not survive a restart. Set JWT_SECRET in your .env for persistent logins.")
	}

	if !strings.HasPrefix(c.NoteExt, ".") {
		c.NoteExt = "." + c.NoteExt
	}

	return c
}
