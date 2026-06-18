# syntax=docker/dockerfile:1

# ---- Stage 1: build the Eleventy frontend ----
FROM node:22-alpine AS frontend
WORKDIR /build
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: build the Go backend ----
FROM golang:1.25-alpine AS backend
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o /out/notes .

# ---- Stage 3: runtime ----
FROM alpine:3.20
# git + ssh for the repository sync, su-exec to drop privileges to the host user,
# tzdata/ca-certificates for sane timestamps and TLS to remotes.
RUN apk add --no-cache git openssh-client ca-certificates tzdata su-exec

COPY --from=backend /out/notes /app/notes
COPY --from=frontend /build/_site /app/site
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENV STATIC_DIR=/app/site \
    NOTES_REPO=/data/repo \
    USERS_FILE=/data/users.json \
    LISTEN_ADDR=:8080 \
    HOME=/home/appuser

EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["/app/notes"]
