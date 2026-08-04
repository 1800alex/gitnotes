/* Shared API client + token storage for the notes app.
 * The JWT is stored in localStorage and sent as a Bearer token. */
(function (global) {
  "use strict";

  const TOKEN_KEY = "notes.token";
  const USER_KEY = "notes.user";

  const Auth = {
    get token() {
      return localStorage.getItem(TOKEN_KEY) || "";
    },
    get username() {
      return localStorage.getItem(USER_KEY) || "";
    },
    isAuthenticated() {
      return !!this.token;
    },
    save(token, username) {
      localStorage.setItem(TOKEN_KEY, token);
      if (username) localStorage.setItem(USER_KEY, username);
    },
    clear() {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    },
    requireLogin() {
      if (!this.isAuthenticated()) {
        window.location.replace("/login/");
        return false;
      }
      return true;
    },
    redirectIfAuthenticated() {
      if (this.isAuthenticated()) {
        window.location.replace("/");
      }
    },
  };

  // Thrown for any non-2xx API response; carries the parsed server message.
  class ApiError extends Error {
    constructor(message, status) {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  }

  async function request(method, path, body) {
    const opts = { method, headers: {} };
    if (Auth.token) opts.headers["Authorization"] = "Bearer " + Auth.token;
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }

    const res = await fetch(path, opts);

    // Session expired / invalid — bounce to login.
    if (res.status === 401 && Auth.isAuthenticated()) {
      Auth.clear();
      window.location.replace("/login/");
      throw new ApiError("Session expired", 401);
    }

    let data = null;
    const text = await res.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (_) {
        data = { error: text };
      }
    }

    if (!res.ok) {
      const msg = (data && data.error) || res.statusText || "Request failed";
      const err = new ApiError(msg, res.status);
      err.data = data; // carry the parsed body (e.g. merge-conflict details)
      throw err;
    }
    return data;
  }

  const Api = {
    login(username, password) {
      return request("POST", "/api/login", { username, password });
    },
    repos() {
      return request("GET", "/api/repos");
    },
    listNotes(repo) {
      return request("GET", "/api/notes?repo=" + encodeURIComponent(repo));
    },
    getNote(repo, path) {
      return request(
        "GET",
        "/api/note?repo=" + encodeURIComponent(repo) + "&path=" + encodeURIComponent(path)
      );
    },
    // Upload a file into the repo (multipart) and return its stored path.
    async uploadFile(repo, path, file) {
      const fd = new FormData();
      fd.append("repo", repo);
      fd.append("path", path);
      fd.append("file", file);
      const headers = {};
      if (Auth.token) headers["Authorization"] = "Bearer " + Auth.token;
      const res = await fetch("/api/upload", { method: "POST", headers, body: fd });
      if (res.status === 401 && Auth.isAuthenticated()) {
        Auth.clear();
        window.location.replace("/login/");
        throw new ApiError("Session expired", 401);
      }
      let data = null;
      const text = await res.text();
      if (text) {
        try { data = JSON.parse(text); } catch (_) { data = { error: text }; }
      }
      if (!res.ok) throw new ApiError((data && data.error) || "Upload failed", res.status);
      return data;
    },
    // Fetch a raw repo file (e.g. an image) with auth and return an object URL.
    // <img> can't send a bearer header, so we fetch it and hand back a blob URL.
    async rawObjectUrl(repo, path) {
      const headers = {};
      if (Auth.token) headers["Authorization"] = "Bearer " + Auth.token;
      const res = await fetch(
        "/api/raw?repo=" + encodeURIComponent(repo) + "&path=" + encodeURIComponent(path),
        { headers }
      );
      if (!res.ok) throw new ApiError("file not found", res.status);
      return URL.createObjectURL(await res.blob());
    },
    // base is the content originally loaded — lets the server 3-way merge
    // concurrent edits instead of overwriting them.
    saveNote(repo, path, content, base, message) {
      return request("PUT", "/api/note", { repo, path, content, base, message });
    },
    deleteNote(repo, path) {
      return request(
        "DELETE",
        "/api/note?repo=" + encodeURIComponent(repo) + "&path=" + encodeURIComponent(path)
      );
    },
    status(repo) {
      return request("GET", "/api/status?repo=" + encodeURIComponent(repo));
    },
    // Server-side agenda scan (fast on large repos). Older backends 404 here,
    // in which case the app falls back to a client-side scan.
    agenda(repo) {
      return request("GET", "/api/agenda?repo=" + encodeURIComponent(repo));
    },
    refresh(repo) {
      return request("POST", "/api/refresh", { repo });
    },
  };

  global.NotesApp = { Auth, Api, ApiError };
})(window);
