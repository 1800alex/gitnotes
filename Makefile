.PHONY: install frontend backend build dev run hashpw up down logs rebuild clean

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
