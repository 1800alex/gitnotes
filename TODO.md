# TODO — gitnotes

A running list of gaps and improvements, roughly ranked. Born from a review on
2026-08-04. Items marked ✅ are done; the rest are open.

## Top tier — will actually bite a phone-primary, git-backed notebook

1. **Content search** ✅ *(in progress → done)* — the sidebar only filters the
   note *list* by path (`n.path.includes(q)`). As the notebook grows you can't
   find text you wrote. Add a `GET /api/search?q=` that greps the working tree
   (reuse the agenda tree-walk) and a mobile-friendly results view.

2. **Markdown XSS → token theft** — `preview.innerHTML = marked.parse(...)` has
   **no sanitizer**, and the JWT lives in `localStorage`. A note pulled in via
   git from another device (or pasted) carrying `<img onerror=…>` could run and
   exfiltrate the token. Wrap the two `marked.parse` calls in DOMPurify. One
   dependency, closes the sharpest security edge. **(open)**

3. **Offline / flaky-network drafts on mobile** ✅ *(in progress → done)* — there's
   a manifest, offline detection and a `beforeunload` guard, but no local draft
   buffer: type on a subway, Save fails, and a dialog is the only safety net.
   Persist a per-note draft to `localStorage` on edit (independent of auto-sync),
   restore it on reopen, clear it on a successful save. A service worker for the
   app shell is the fuller follow-up.

## Worth doing, not urgent

4. **Attachments bloat the repo.** Image upload commits binaries forever (no
   git-LFS) and relative-image resolution is still deferred. Decide the story
   before the repo gets heavy; pasting a phone screenshot is a common action.

5. **Deleting is easy to fat-finger.** ✅ *(done — hardened)* Delete now requires
   typing the note's **exact path** to confirm (GitHub-style modal); the button
   stays locked until it matches, Escape/Cancel/backdrop abort, and the local
   draft is cleared on delete. Still a `git rm` under the hood, so a UI **restore
   from git history** (recover a deleted note) remains a nice follow-up.

6. **Backlinks / wikilinks / a tag view.** `#tag` exists in the grammar and
   inter-note link navigation is deferred. This is what turns a pile of files
   into a system. Higher effort, high payoff.

## Small, sharp edges

7. **Agenda timezone.** The server resolves recurrence next-occurrences with
   `time.Now()` (container TZ) while the client buckets with the browser clock.
   Fine at home; can misbucket by a day when you travel. Let one side own the
   clock (send the client date, or the rule, and resolve there).

8. **"Pause = checkbox `[x]`" overloads the checkbox** in Routines. Works, but a
   paused chore reads as "done" in the raw markdown. A `paused:` token or an
   archived section would be clearer if it ever confuses.

## Fixed — mobile layout

- **Header actions clipped** ✅ the action row overflowed and pushed Save off-screen
  with no way to scroll. On mobile the brand text is dropped (mark stays) and the
  icon buttons/spacing tightened so the whole row fits.
- **Content-rich views wouldn't scroll** ✅ agenda / meal plan / meeting panes grew
  the layout grid instead of scrolling internally (a grid track's default `auto`
  min). Capped both axes with `minmax(0, 1fr)` so panes scroll in their own
  container and the layout never exceeds the viewport.
- **Pop-out menus off-screen** ✅ the toolbox/New menus anchored to their button and
  ran off the edge; they now anchor to the toolbar/header right edge on mobile.
- Covered by `mobile.spec.js` regressions (header fits, agenda scrolls, meal-plan
  scrolls + toolbox opens on-screen).

## Solid — don't second-guess

Typed-view architecture (parse→render→commit, textarea as source of truth),
per-repo mutex, 3-way union merge + conflict path, push-failure→Refresh nudge,
and the integration + Go/JS parity test discipline.
