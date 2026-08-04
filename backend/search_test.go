package main

import (
	"os"
	"path/filepath"
	"testing"
)

func writeFile(t *testing.T, dir, rel, body string) {
	t.Helper()
	p := filepath.Join(dir, rel)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestSearchNotes(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "welcome.md", "# Welcome\nThe quick brown fox\njumps over.\n")
	writeFile(t, dir, "notes/fox-facts.md", "Foxes are clever.\nNothing here matches.\n")
	writeFile(t, dir, "recipes/soup.md", "Boil water.\n")
	writeFile(t, dir, ".hidden/secret.md", "fox in a dotdir should be skipped\n")
	writeFile(t, dir, "image.png", "fox but not a note\n")

	n := &Notes{cfg: &Config{NoteExt: ".md"}}
	hits, err := n.searchNotes(dir, "fox")
	if err != nil {
		t.Fatal(err)
	}

	// welcome.md (content) + notes/fox-facts.md (path + content); NOT the dotdir
	// or the non-note image. Sorted by path.
	if len(hits) != 2 {
		t.Fatalf("got %d hits, want 2: %+v", len(hits), hits)
	}
	if hits[0].Path != "notes/fox-facts.md" || !hits[0].TitleMatch {
		t.Errorf("hit0 = %+v (want notes/fox-facts.md, titleMatch)", hits[0])
	}
	if hits[1].Path != "welcome.md" {
		t.Errorf("hit1 = %+v (want welcome.md)", hits[1])
	}
	if len(hits[1].Matches) != 1 || hits[1].Matches[0].Line != 2 {
		t.Errorf("welcome matches = %+v (want one match on line 2)", hits[1].Matches)
	}
}

func TestSearchCaseInsensitiveAndSnippet(t *testing.T) {
	dir := t.TempDir()
	long := "prefix " // build a long line with the match late so it gets windowed
	for i := 0; i < 60; i++ {
		long += "word "
	}
	long += "NEEDLE tail"
	writeFile(t, dir, "a.md", "Has a NeEdLe here\n"+long+"\n")

	n := &Notes{cfg: &Config{NoteExt: ".md"}}
	hits, err := n.searchNotes(dir, "needle")
	if err != nil {
		t.Fatal(err)
	}
	if len(hits) != 1 || len(hits[0].Matches) != 2 {
		t.Fatalf("hits = %+v (want 1 note, 2 matches)", hits)
	}
	// The long line is windowed around the match, so it stays short and elided.
	snip := hits[0].Matches[1].Text
	if len([]rune(snip)) > searchSnippetLen+2 { // +2 for the ellipsis chars
		t.Errorf("snippet too long (%d): %q", len([]rune(snip)), snip)
	}
	if snip[:len("…")] != "…" {
		t.Errorf("expected leading ellipsis on windowed snippet: %q", snip)
	}
}
