package main

import "testing"

func eqStrs(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// Keep these cases in lock-step with the frontend's parseAction unit tests
// (frontend/test/core.test.js) — the Agenda depends on both agreeing.
func TestParseActionTokens(t *testing.T) {
	cases := []struct {
		in        string
		text      string
		due       string
		owners    []string
		important bool
	}{
		{"Send design doc due:2026-08-03 @sam", "Send design doc", "2026-08-03", []string{"sam"}, false},
		{"Wire rollup due:2026-08-05 @alex !", "Wire rollup", "2026-08-05", []string{"alex"}, true},
		{"Buy milk!", "Buy milk!", "", []string{}, false},        // trailing ! sans space ≠ important
		{"just text", "just text", "", []string{}, false},
		{"multi @a @b due:2030-01-01", "multi", "2030-01-01", []string{"a", "b"}, false},
		{"due:2026-12-31 leading date @me", "leading date", "2026-12-31", []string{"me"}, false},
		{"!", "", "", []string{}, true},
	}
	for _, c := range cases {
		got := parseActionTokens(c.in)
		if got.Text != c.text {
			t.Errorf("%q: text=%q want %q", c.in, got.Text, c.text)
		}
		if got.Due != c.due {
			t.Errorf("%q: due=%q want %q", c.in, got.Due, c.due)
		}
		if got.Important != c.important {
			t.Errorf("%q: important=%v want %v", c.in, got.Important, c.important)
		}
		if !eqStrs(got.Owners, c.owners) {
			t.Errorf("%q: owners=%v want %v", c.in, got.Owners, c.owners)
		}
	}
}

func TestScanDueLines(t *testing.T) {
	content := "# Note\n" +
		"- [ ] open with date due:2026-01-01 @a\n" +
		"- [x] done with date due:2026-01-02\n" + // completed → skipped
		"- [ ] open no date\n" + // no due → skipped
		"prose line\n" +
		"```\n- [ ] fenced due:2026-01-03\n```\n" + // inside code fence → skipped
		"- [ ] another due:2026-01-04 !\n"
	var out []AgendaItem
	scanDueLines("planner/x.md", content, &out)

	if len(out) != 2 {
		t.Fatalf("got %d items, want 2: %+v", len(out), out)
	}
	if out[0].Due != "2026-01-01" || out[0].Path != "planner/x.md" || !eqStrs(out[0].Owners, []string{"a"}) {
		t.Errorf("item0 = %+v", out[0])
	}
	if out[1].Due != "2026-01-04" || !out[1].Important {
		t.Errorf("item1 = %+v", out[1])
	}
}
