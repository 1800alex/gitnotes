package main

import (
	"testing"
	"time"
)

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
	today := time.Date(2026, 8, 4, 0, 0, 0, 0, time.UTC)
	var out []AgendaItem
	scanDueLines("planner/x.md", content, today, &out)

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

// A recurring line has its next occurrence resolved relative to today, is
// flagged Recurring, and never lands in the past (pure-display semantics).
func TestScanDueLinesRecurring(t *testing.T) {
	// 2026-08-04 is a Tuesday.
	today := time.Date(2026, 8, 4, 0, 0, 0, 0, time.UTC)
	content := "# Chores\n" +
		"- [ ] Take out the trash every:tue\n" +          // today is Tue → due today
		"- [ ] Water plants every:wed\n" +                // next Wed → tomorrow
		"- [ ] Add salt to softener every:6w since:2026-07-01\n" + // 2026-07-01 + 6w = 08-12
		"- [ ] Not a chore every:sometimes\n" +           // invalid spec → skipped (no due)
		"- [x] Done chore every:mon\n"                     // completed → skipped
	var out []AgendaItem
	scanDueLines("routines/home.md", content, today, &out)

	if len(out) != 3 {
		t.Fatalf("got %d items, want 3: %+v", len(out), out)
	}
	byText := map[string]AgendaItem{}
	for _, it := range out {
		byText[it.Text] = it
	}
	if it := byText["Take out the trash"]; it.Due != "2026-08-04" || !it.Recurring || it.Every != "tue" {
		t.Errorf("trash = %+v", it)
	}
	if it := byText["Water plants"]; it.Due != "2026-08-05" {
		t.Errorf("plants = %+v", it)
	}
	if it := byText["Add salt to softener"]; it.Due != "2026-08-12" || it.Since != "2026-07-01" || it.Every != "6w" {
		t.Errorf("salt = %+v", it)
	}
}

// nextOccurrence math, kept in lock-step with core.test.js.
func TestNextOccurrence(t *testing.T) {
	today := time.Date(2026, 8, 4, 0, 0, 0, 0, time.UTC) // Tuesday
	cases := []struct {
		spec  string
		since string
		want  string
	}{
		{"tue", "", "2026-08-04"},              // today is Tuesday
		{"mon", "", "2026-08-10"},              // next Monday
		{"sun", "", "2026-08-09"},              // upcoming Sunday
		{"1d", "", "2026-08-04"},               // no anchor → today
		{"6w", "2026-07-01", "2026-08-12"},     // 07-01 + 6 weeks
		{"2w", "2026-08-20", "2026-08-20"},     // future anchor → itself
		{"1m", "2026-01-31", "2026-08-31"},     // month clamp path lands on 08-31
		{"1y", "2020-08-04", "2026-08-04"},     // yearly rolled forward
	}
	for _, c := range cases {
		rec, ok := parseRecurrence(c.spec)
		if !ok {
			t.Fatalf("parseRecurrence(%q) failed", c.spec)
		}
		if got := nextOccurrence(rec, c.since, today); got != c.want {
			t.Errorf("nextOccurrence(%q, %q) = %q, want %q", c.spec, c.since, got, c.want)
		}
	}
}
