const STORAGE_KEY = "kavia_notes_v1";

/**
 * @typedef {Object} Note
 * @property {string} id
 * @property {string} title
 * @property {string} content
 * @property {string} updatedAt ISO date string
 * @property {string} createdAt ISO date string
 */

// PUBLIC_INTERFACE
export function getApiBaseUrl() {
  /** Returns the API base URL from environment variables (or empty string if unset). */
  const base = (process.env.REACT_APP_API_BASE || process.env.REACT_APP_BACKEND_URL || "").trim();
  return base.replace(/\/$/, "");
}

function nowIso() {
  return new Date().toISOString();
}

function generateId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function readLocalNotes() {
  const raw = localStorage.getItem(STORAGE_KEY);
  const parsed = raw ? safeJsonParse(raw) : null;
  const notes = Array.isArray(parsed) ? parsed : [];
  // newest first
  return notes
    .filter((n) => n && typeof n.id === "string")
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

function writeLocalNotes(notes) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
}

function upsertLocal(note) {
  const notes = readLocalNotes();
  const idx = notes.findIndex((n) => n.id === note.id);
  if (idx >= 0) notes[idx] = note;
  else notes.unshift(note);
  writeLocalNotes(notes);
  return note;
}

function deleteLocal(id) {
  const notes = readLocalNotes().filter((n) => n.id !== id);
  writeLocalNotes(notes);
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const text = await res.text();
  const data = text ? safeJsonParse(text) : null;

  if (!res.ok) {
    const msg = (data && (data.detail || data.message)) || `Request failed (${res.status})`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

/**
 * Attempts a network call; if it fails due to network/unreachable/CORS/etc., falls back to local storage.
 * We treat any fetch exception as offline; HTTP errors still bubble (so user sees validation issues if backend is reachable).
 */
async function withOfflineFallback(networkFn, offlineFn) {
  try {
    const base = getApiBaseUrl();
    if (!base) throw new Error("API base URL is not configured");
    return await networkFn(base);
  } catch (err) {
    // If it's an HTTP error (status present), backend responded; do not silently fallback.
    if (err && typeof err.status === "number") throw err;
    return offlineFn(err);
  }
}

/**
 * Normalize note from backend or local.
 * Accepts multiple common backend shapes.
 */
function normalizeNote(raw) {
  if (!raw) return null;
  const id = String(raw.id ?? raw._id ?? raw.note_id ?? "");
  if (!id) return null;

  const title = String(raw.title ?? "");
  const content = String(raw.content ?? raw.body ?? "");
  const createdAt = String(raw.createdAt ?? raw.created_at ?? nowIso());
  const updatedAt = String(raw.updatedAt ?? raw.updated_at ?? createdAt);

  return { id, title, content, createdAt, updatedAt };
}

// PUBLIC_INTERFACE
export async function listNotes() {
  /** List notes, preferring backend and falling back to localStorage. */
  return withOfflineFallback(
    async (base) => {
      // Try a couple of common endpoints.
      const endpoints = [`${base}/notes`, `${base}/api/notes`];
      let lastErr = null;

      for (const url of endpoints) {
        try {
          const data = await fetchJson(url, { method: "GET" });
          const items = Array.isArray(data) ? data : Array.isArray(data?.notes) ? data.notes : [];
          const normalized = items.map(normalizeNote).filter(Boolean);
          return normalized.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
        } catch (e) {
          lastErr = e;
          // try next endpoint only for 404
          if (e && e.status === 404) continue;
          throw e;
        }
      }
      throw lastErr || new Error("Unable to list notes");
    },
    () => readLocalNotes()
  );
}

// PUBLIC_INTERFACE
export async function createNote({ title, content }) {
  /** Create a new note. */
  const newLocal = {
    id: generateId(),
    title: title || "Untitled",
    content: content || "",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  return withOfflineFallback(
    async (base) => {
      const endpoints = [`${base}/notes`, `${base}/api/notes`];
      let lastErr = null;

      for (const url of endpoints) {
        try {
          const data = await fetchJson(url, {
            method: "POST",
            body: JSON.stringify({ title: newLocal.title, content: newLocal.content }),
          });
          const normalized = normalizeNote(data?.note ?? data) || newLocal;
          // Keep a local mirror for offline continuity.
          upsertLocal(normalized);
          return normalized;
        } catch (e) {
          lastErr = e;
          if (e && e.status === 404) continue;
          throw e;
        }
      }
      throw lastErr || new Error("Unable to create note");
    },
    () => upsertLocal(newLocal)
  );
}

// PUBLIC_INTERFACE
export async function updateNote(id, { title, content }) {
  /** Update an existing note by id. */
  return withOfflineFallback(
    async (base) => {
      const endpoints = [`${base}/notes/${encodeURIComponent(id)}`, `${base}/api/notes/${encodeURIComponent(id)}`];
      let lastErr = null;

      for (const url of endpoints) {
        try {
          const data = await fetchJson(url, {
            method: "PUT",
            body: JSON.stringify({ title, content }),
          });
          const normalized = normalizeNote(data?.note ?? data) || normalizeNote({ id, title, content, updatedAt: nowIso() });
          upsertLocal(normalized);
          return normalized;
        } catch (e) {
          lastErr = e;
          if (e && e.status === 404) continue;
          throw e;
        }
      }
      throw lastErr || new Error("Unable to update note");
    },
    () => {
      const existing = readLocalNotes().find((n) => n.id === id);
      const updated = {
        id,
        title: title ?? existing?.title ?? "Untitled",
        content: content ?? existing?.content ?? "",
        createdAt: existing?.createdAt ?? nowIso(),
        updatedAt: nowIso(),
      };
      return upsertLocal(updated);
    }
  );
}

// PUBLIC_INTERFACE
export async function deleteNote(id) {
  /** Delete an existing note by id. */
  return withOfflineFallback(
    async (base) => {
      const endpoints = [`${base}/notes/${encodeURIComponent(id)}`, `${base}/api/notes/${encodeURIComponent(id)}`];
      let lastErr = null;

      for (const url of endpoints) {
        try {
          await fetchJson(url, { method: "DELETE" });
          deleteLocal(id);
          return { ok: true };
        } catch (e) {
          lastErr = e;
          if (e && e.status === 404) continue;
          throw e;
        }
      }
      throw lastErr || new Error("Unable to delete note");
    },
    () => {
      deleteLocal(id);
      return { ok: true };
    }
  );
}

// PUBLIC_INTERFACE
export async function getNote(id) {
  /** Fetch a note by id (backend first, then localStorage). */
  return withOfflineFallback(
    async (base) => {
      const endpoints = [`${base}/notes/${encodeURIComponent(id)}`, `${base}/api/notes/${encodeURIComponent(id)}`];
      let lastErr = null;

      for (const url of endpoints) {
        try {
          const data = await fetchJson(url, { method: "GET" });
          const normalized = normalizeNote(data?.note ?? data);
          if (normalized) upsertLocal(normalized);
          return normalized;
        } catch (e) {
          lastErr = e;
          if (e && e.status === 404) continue;
          throw e;
        }
      }
      throw lastErr || new Error("Unable to fetch note");
    },
    () => readLocalNotes().find((n) => n.id === id) || null
  );
}
