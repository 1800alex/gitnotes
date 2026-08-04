.PHONY: install frontend backend build dev run seed demo test test-go test-js test-up test-down test-logs itest itest-setup itest-deps hashpw up down logs rebuild clean

SEED_REPO ?= testdata/repo
TEST_COMPOSE = docker-compose -f testdata/docker-compose.yml

# Install frontend dependencies.
install:
	cd frontend && npm install

# Build the static Eleventy site into frontend/_site.
frontend:
	cd frontend && npm run build

# Build the Go backend binary into backend/notes.
backend:
	cd backend && go build -o notes .

build: frontend backend

# Live-reload the frontend during development (http://localhost:8080 via eleventy).
dev:
	cd frontend && npm run dev

# Run the backend locally, serving the freshly built static site.
# Requires a checked-out repo and a users.json — see README.
run: build
	cd backend && \
	STATIC_DIR=../frontend/_site \
	NOTES_REPO=$${NOTES_REPO:-../repo} \
	USERS_FILE=$${USERS_FILE:-../users.json} \
	JWT_SECRET=$${JWT_SECRET:-dev-secret} \
	LISTEN_ADDR=:8080 \
	./notes

# Populate a test repo with sample notes/checklists/recipes/meetings.
seed:
	./testdata/seed.sh --force $(SEED_REPO)

# Build + run the app locally against the seeded test repo (seeds it if
# missing). Self-contained test accounts: admin/admin, user/user.
demo: build
	@test -d $(SEED_REPO) || ./testdata/seed.sh $(SEED_REPO)
	cd backend && \
	STATIC_DIR=../frontend/_site \
	NOTES_REPO=../$(SEED_REPO) \
	USERS_FILE=../testdata/users.demo.json \
	JWT_SECRET=$${JWT_SECRET:-dev-secret} \
	AUTO_PUSH=false AUTO_PULL=false \
	LISTEN_ADDR=:8080 \
	./notes

# Run the self-contained test stack in Docker (its own compose, port 8090).
test-up:
	@test -d $(SEED_REPO) || ./testdata/seed.sh $(SEED_REPO)
	$(TEST_COMPOSE) up -d --build

test-down:
	$(TEST_COMPOSE) down

test-logs:
	$(TEST_COMPOSE) logs -f

# Fast unit tests (no Docker): Go backend logic + JS pure helpers (core.js).
test: test-go test-js
test-go:
	cd backend && go test ./...
test-js:
	cd frontend && node --test test/*.test.js

# One-time setup for the integration tests: npm deps + the Playwright browser.
itest-setup:
	cd integration && npm install && npx playwright install chromium

# Install Chromium's system libraries (needs sudo/apt). Run once if the browser
# fails to launch with a missing-library error.
itest-deps:
	cd integration && npx playwright install-deps chromium

# Full end-to-end integration run: seed → dockerized app → Playwright → teardown.
# Runs itest-setup first so a fresh checkout works with a single command.
itest: itest-setup
	./integration/run.sh

# Generate a bcrypt hash for a users.json entry (prompts for the password).
hashpw: backend
	@cd backend && ./notes -hashpw

# docker-compose lifecycle.
up:
	docker-compose up -d --build

down:
	docker-compose down

logs:
	docker-compose logs -f

rebuild:
	docker-compose up -d --build --force-recreate

clean:
	cd frontend && npm run clean || true
	rm -f backend/notes
