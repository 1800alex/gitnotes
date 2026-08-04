#!/usr/bin/env bash
#
# seed.sh — build a git-backed notes repo pre-populated with realistic sample
# content for local testing: plain notes, nested checklists, weekly planners,
# recipes, a meal plan, and meeting notes with follow-ups.
#
# The content follows the conventions in docs/design.md so the app's typed views
# light up automatically:
#   - frontmatter `type:` (planner | recipe | mealplan | meeting), and/or
#   - folder conventions (planner/, recipes/, meal-plans/, meetings/).
# Task lines use the shared grammar: leading `HH:MM` time, `due:YYYY-MM-DD`,
# `@owner`, `#tag`, trailing `!` important.
#
# Dates are computed relative to *today*, so the planner + meal plan always fall
# on the current ISO week and meeting follow-ups are due "this week".
#
# Usage:
#   testdata/seed.sh [TARGET_DIR]     # default: testdata/repo
#   testdata/seed.sh --force [DIR]    # wipe TARGET_DIR first
#
set -euo pipefail

# ---- args ----
FORCE=0
TARGET=""
for arg in "$@"; do
  case "$arg" in
    --force|-f) FORCE=1 ;;
    -h|--help) sed -n '2,26p' "$0"; exit 0 ;;
    *) TARGET="$arg" ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${TARGET:-$SCRIPT_DIR/repo}"

# ---- dynamic dates (GNU date) ----
if ! date -d "today" +%F >/dev/null 2>&1; then
  echo "error: this script needs GNU date (date -d …)." >&2
  exit 1
fi
TODAY=$(date +%F)                                   # 2026-08-04
DOW=$(date +%u)                                     # 1=Mon … 7=Sun
MON=$(date -d "-$((DOW - 1)) days" +%F)             # Monday of this week
SUN=$(date -d "$MON +6 days" +%F)
THIS_WEEK=$(date +%G-W%V)                           # ISO week-year, e.g. 2026-W32
NEXT_WEEK=$(date -d "$MON +7 days" +%G-W%V)
WK_NUM=$(date -d "$MON" +%V | sed 's/^0*//')        # 32 (no leading zero)
RANGE="$(date -d "$MON" '+%b %-d') – $(date -d "$SUN" '+%b %-d'), $(date -d "$SUN" +%Y)"
YESTERDAY=$(date -d "-1 day" +%F)
D_PLUS_2=$(date -d "+2 days" +%F)
D_PLUS_5=$(date -d "+5 days" +%F)
LAST_WED=$(date -d "$MON -5 days" +%F)              # a date in the prior week

# ---- target repo ----
if [[ -e "$REPO" ]]; then
  if [[ "$FORCE" == "1" ]]; then
    rm -rf "$REPO"
  else
    echo "error: $REPO already exists (pass --force to overwrite)." >&2
    exit 1
  fi
fi
mkdir -p "$REPO"

# Write a note at a repo-relative path, creating parent dirs. Body comes on stdin.
note() {
  local p="$REPO/$1"
  mkdir -p "$(dirname "$p")"
  cat > "$p"
}

# ---------------------------------------------------------------------------
# Plain notes
# ---------------------------------------------------------------------------
note "welcome.md" <<EOF
# Welcome 👋

This is a **seeded test repository** for the notes app. It has a bit of
everything so you can exercise every view:

- Plain markdown notes (this one).
- [Nested checklists](checklists/groceries.md) — try **Checklist mode**.
- [This week's planner](planner/$THIS_WEEK.md) — try **Planner mode**.
- Recipes under \`recipes/\` and a [meal plan](meal-plans/$THIS_WEEK.md).
- [Meeting notes](meetings/$TODAY-team-standup.md) with follow-ups.

Edit anything — every save is a git commit.
EOF

note "notes/project-ideas.md" <<EOF
# Project ideas

Running list of things worth prototyping.

## Shortlist
- A passive **Agenda** that scans every note for \`due:\` items.
- Recipe → shopping-list aggregation.
- Offline-first sync indicator on mobile.

## Parking lot
Rough thoughts that aren't ready yet. See also [reading list](reading-list.md).
EOF

note "notes/reading-list.md" <<EOF
# Reading list

| Title                | Author        | Status   |
| -------------------- | ------------- | -------- |
| The Pragmatic Programmer | Hunt & Thomas | reading  |
| Designing Data-Intensive Applications | Kleppmann | queued |
| A Philosophy of Software Design | Ousterhout | done |
EOF

# ---------------------------------------------------------------------------
# Checklists (nested — exercises Checklist mode grouping)
# ---------------------------------------------------------------------------
note "checklists/groceries.md" <<EOF
# Groceries

- [ ] Produce
  - [ ] Spinach
  - [ ] Bananas
  - [x] Garlic
- [ ] Dairy
  - [x] Greek yogurt
  - [ ] Butter
- [ ] Pantry
  - [ ] Olive oil
  - [ ] Canned tomatoes
  - [ ] Rolled oats
EOF

note "checklists/camping-trip.md" <<EOF
# Camping trip packing

- [ ] Shelter
  - [x] Tent
  - [x] Sleeping bag
  - [ ] Sleeping pad
- [ ] Kitchen
  - [ ] Stove + fuel
  - [ ] Lighter
  - [x] Mess kit
- [ ] Clothing
  - [ ] Rain jacket
  - [ ] Warm layer
EOF

# ---------------------------------------------------------------------------
# Weekly planners (type: planner)
# ---------------------------------------------------------------------------
note "planner/$THIS_WEEK.md" <<EOF
---
type: planner
week: $THIS_WEEK
---
# Week $WK_NUM · $RANGE

## Monday
- [ ] 09:00 Team standup !
- [x] Review PRs
- [ ] Plan the week

## Tuesday
- [ ] 10:30 Dentist
- [ ] Draft the Q3 doc !

## Wednesday
- [ ] 12:00 Lunch with Sam
- [ ] Grocery run

## Thursday
- [ ] 15:00 Design review

## Friday
- [ ] Ship the release !
- [x] Weekly wrap-up

## Saturday
- [ ] Camping prep

## Sunday
- [ ] Meal prep for next week
EOF

note "planner/$NEXT_WEEK.md" <<EOF
---
type: planner
week: $NEXT_WEEK
---
# Week (next)

## Monday
- [ ] 09:00 Team standup !

## Tuesday
## Wednesday
## Thursday
## Friday
- [ ] Retro

## Saturday
## Sunday
EOF

# ---------------------------------------------------------------------------
# Recipes (type: recipe) — Ingredients as a checklist for shopping-list rollup
# ---------------------------------------------------------------------------
note "recipes/sheet-pan-chicken.md" <<EOF
---
type: recipe
servings: 4
tags: [dinner, chicken, sheet-pan]
time: 45m
---
# Sheet-pan chicken & veggies

A weeknight staple — one pan, minimal cleanup.

## Ingredients
- [ ] 4 chicken thighs
- [ ] 1 lb baby potatoes
- [ ] 2 bell peppers
- [ ] 1 red onion
- [ ] 3 tbsp olive oil
- [ ] 2 tsp paprika
- [ ] Salt & pepper

## Steps
1. Heat oven to 425°F.
2. Toss veg with oil, paprika, salt & pepper on a sheet pan.
3. Nestle in the chicken; roast 35–40 min until 165°F internal.
4. Rest 5 min and serve.
EOF

note "recipes/overnight-oats.md" <<EOF
---
type: recipe
servings: 1
tags: [breakfast, no-cook, make-ahead]
time: 5m + overnight
---
# Overnight oats

## Ingredients
- [ ] 1/2 cup rolled oats
- [ ] 1/2 cup milk
- [ ] 1/4 cup Greek yogurt
- [ ] 1 tbsp chia seeds
- [ ] 1 tsp honey
- [ ] Handful of berries

## Steps
1. Combine everything in a jar.
2. Refrigerate overnight.
3. Top with berries in the morning.
EOF

note "recipes/veggie-chili.md" <<EOF
---
type: recipe
servings: 6
tags: [dinner, vegetarian, batch]
time: 50m
---
# Veggie chili

Great for batch cooking — freezes well.

## Ingredients
- [ ] 2 cans black beans
- [ ] 2 cans kidney beans
- [ ] 2 cans diced tomatoes
- [ ] 1 onion
- [ ] 3 cloves garlic
- [ ] 2 tbsp chili powder
- [ ] 1 tbsp cumin
- [ ] 1 bell pepper

## Steps
1. Sauté onion, garlic and pepper until soft.
2. Add spices; bloom 1 min.
3. Add beans and tomatoes; simmer 30 min.
4. Season and serve.
EOF

# ---------------------------------------------------------------------------
# Meal plan (type: mealplan) — cells link to recipe notes
# ---------------------------------------------------------------------------
note "meal-plans/$THIS_WEEK.md" <<EOF
---
type: mealplan
week: $THIS_WEEK
---
# Meal plan · Week $WK_NUM

| Day       | Breakfast | Dinner |
| --------- | --------- | ------ |
| Monday    | [Overnight oats](../recipes/overnight-oats.md) | [Sheet-pan chicken](../recipes/sheet-pan-chicken.md) |
| Tuesday   | [Overnight oats](../recipes/overnight-oats.md) | [Veggie chili](../recipes/veggie-chili.md) |
| Wednesday | [Overnight oats](../recipes/overnight-oats.md) | Leftovers |
| Thursday  | Eggs | [Sheet-pan chicken](../recipes/sheet-pan-chicken.md) |
| Friday    | Toast | Pizza night |

## Shopping list
Aggregated from this week's recipes — check off as you buy.
- [ ] See each recipe's Ingredients section.
EOF

# ---------------------------------------------------------------------------
# Meeting notes (type: meeting) — action items with due:/@ feed the Agenda
# ---------------------------------------------------------------------------
note "meetings/$TODAY-team-standup.md" <<EOF
---
type: meeting
date: $TODAY
attendees: [alex, sam, jordan]
project: Notes app
---
# Team standup — $TODAY

## Notes
- Planner mode shipped; recipes + meal plan next.
- Sam flagged mobile autosave indicator feedback.

## Action items
- [ ] Wire the shopping-list rollup due:$D_PLUS_2 @alex !
- [ ] Draft Agenda spec due:$D_PLUS_5 @alex
- [ ] Send design doc to the team due:$TODAY @sam
- [x] Fix ISO-week math @alex
EOF

note "meetings/$YESTERDAY-1on1.md" <<EOF
---
type: meeting
date: $YESTERDAY
attendees: [alex, jordan]
project: Career
---
# 1:1 with Jordan — $YESTERDAY

## Notes
- Discussed Q3 goals and on-call rotation.

## Action items
- [ ] Share Q3 goals doc due:$LAST_WED @alex
- [ ] Book conference travel due:$D_PLUS_5 @alex
EOF

note "meetings/$YESTERDAY-vendor-sync.md" <<EOF
---
type: meeting
date: $YESTERDAY
attendees: [alex, vendor]
project: Integrations
---
# Vendor sync — $YESTERDAY

## Notes
- Reviewed API rate limits and the migration timeline.

## Action items
- [ ] Confirm staging credentials due:$LAST_WED @vendor
- [ ] Sign off on the migration plan due:$D_PLUS_2 @alex !
EOF

# ---------------------------------------------------------------------------
# Commit (two commits so there's a little history for the git pill)
# ---------------------------------------------------------------------------
cd "$REPO"
git init -q
git config user.name  "Notes Seeder"
git config user.email "seed@example.com"
git config commit.gpgsign false

git add welcome.md notes checklists
git commit -qm "Seed: notes & checklists"

git add planner recipes meal-plans meetings
git commit -qm "Seed: planner, recipes, meal plan & meetings"

COUNT=$(git ls-files | wc -l | tr -d ' ')
echo "✔ Seeded $COUNT files into $REPO (ISO week $THIS_WEEK)"
echo
echo "Test accounts:  admin/admin   user/user"
echo
echo "Run it locally:      make demo                    # http://localhost:8080"
echo "Run it in Docker:    make test-up                 # http://localhost:8090"
echo "Custom target dir:   NOTES_REPO=\"$REPO\" make run"
