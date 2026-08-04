package main

import (
	"strings"
	"testing"
)

// MergeFile uses a temp dir + the git binary; it needs no repo state, so a
// zero-value Git is fine.
func TestMergeFileNonOverlapping(t *testing.T) {
	g := &Git{}
	base := "a\nb\nc\n"
	ours := "a\nb\nc\nours-bottom\n"  // append
	theirs := "theirs-top\na\nb\nc\n" // prepend
	merged, overlap, err := g.MergeFile(ours, base, theirs)
	if err != nil {
		t.Fatal(err)
	}
	if overlap {
		t.Error("non-overlapping edits should not report overlap")
	}
	if !strings.Contains(merged, "ours-bottom") || !strings.Contains(merged, "theirs-top") {
		t.Errorf("both edits should survive, got:\n%s", merged)
	}
	if strings.Contains(merged, "<<<<<<<") {
		t.Errorf("clean merge should have no markers, got:\n%s", merged)
	}
}

func TestMergeFileOverlapping(t *testing.T) {
	g := &Git{}
	base := "a\nline\nc\n"
	ours := "a\nMINE\nc\n"
	theirs := "a\nTHEIRS\nc\n"
	merged, overlap, err := g.MergeFile(ours, base, theirs)
	if err != nil {
		t.Fatal(err)
	}
	if !overlap {
		t.Error("overlapping edits to the same line should report overlap")
	}
	// Union merge: both sides kept, never conflict markers.
	if strings.Contains(merged, "<<<<<<<") {
		t.Errorf("union merge should not write markers, got:\n%s", merged)
	}
	if !strings.Contains(merged, "MINE") || !strings.Contains(merged, "THEIRS") {
		t.Errorf("both sides should be kept, got:\n%s", merged)
	}
}

func TestMergeFileIdentical(t *testing.T) {
	g := &Git{}
	base := "x\ny\n"
	merged, overlap, err := g.MergeFile(base, base, base)
	if err != nil {
		t.Fatal(err)
	}
	if overlap || merged != base {
		t.Errorf("identical inputs: overlap=%v merged=%q", overlap, merged)
	}
}
