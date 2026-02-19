import React, { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { createNote, deleteNote, getApiBaseUrl, listNotes, updateNote } from "./services/notesService";

function formatUpdatedAt(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function notePreview(content) {
  const cleaned = String(content || "").replace(/\s+/g, " ").trim();
  return cleaned.length > 80 ? `${cleaned.slice(0, 80)}…` : cleaned;
}

function clampTitle(title) {
  const t = String(title || "").trim();
  return t || "Untitled";
}

// PUBLIC_INTERFACE
function App() {
  const apiBase = getApiBaseUrl();

  const [notes, setNotes] = useState([]);
  const [selectedId, setSelectedId] = useState(null);

  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  const [isSaving, setIsSaving] = useState(false);
  const [isOffline, setIsOffline] = useState(!apiBase);
  const [error, setError] = useState("");

  // editor local draft state (to allow fast typing, and debounce saving)
  const selectedNote = useMemo(() => notes.find((n) => n.id === selectedId) || null, [notes, selectedId]);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const lastSavedRef = useRef({ title: "", content: "" });
  const saveTimerRef = useRef(null);

  const filteredNotes = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return notes;

    return notes.filter((n) => {
      const t = (n.title || "").toLowerCase();
      const c = (n.content || "").toLowerCase();
      return t.includes(q) || c.includes(q);
    });
  }, [notes, query]);

  async function refreshNotes({ keepSelection = true } = {}) {
    setIsLoading(true);
    setError("");
    try {
      const items = await listNotes();
      setNotes(items);

      if (!keepSelection) {
        setSelectedId(items[0]?.id || null);
      } else {
        // If selection disappeared, pick first.
        const stillExists = selectedId && items.some((n) => n.id === selectedId);
        if (!stillExists) setSelectedId(items[0]?.id || null);
      }

      setIsOffline(!apiBase); // when base is missing, always offline
    } catch (e) {
      setError(e?.message || "Failed to load notes.");
      // If listNotes threw an HTTP error, backend is reachable but failed. Mark offline=false.
      setIsOffline(!apiBase);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    refreshNotes({ keepSelection: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase]);

  // Sync draft state whenever selection changes
  useEffect(() => {
    const t = selectedNote?.title || "";
    const c = selectedNote?.content || "";
    setDraftTitle(t);
    setDraftContent(c);
    lastSavedRef.current = { title: t, content: c };
  }, [selectedNote?.id]); // only on note switch

  async function handleCreate() {
    setError("");
    try {
      const created = await createNote({ title: "Untitled", content: "" });
      setNotes((prev) => {
        const without = prev.filter((n) => n.id !== created.id);
        return [created, ...without].sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
      });
      setSelectedId(created.id);
      setIsOffline(!apiBase); // createNote falls back locally when offline; base missing implies offline
    } catch (e) {
      setError(e?.message || "Failed to create note.");
    }
  }

  async function handleDelete(noteId) {
    if (!noteId) return;
    const note = notes.find((n) => n.id === noteId);
    const ok = window.confirm(`Delete “${note?.title || "Untitled"}”? This cannot be undone.`);
    if (!ok) return;

    setError("");
    try {
      await deleteNote(noteId);
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
      setSelectedId((prevSelected) => {
        if (prevSelected !== noteId) return prevSelected;
        const remaining = notes.filter((n) => n.id !== noteId);
        return remaining[0]?.id || null;
      });
      setIsOffline(!apiBase);
    } catch (e) {
      setError(e?.message || "Failed to delete note.");
    }
  }

  async function saveNow({ title, content }) {
    if (!selectedId) return;
    setIsSaving(true);
    setError("");
    try {
      const updated = await updateNote(selectedId, { title: clampTitle(title), content });
      setNotes((prev) => {
        const next = prev.map((n) => (n.id === selectedId ? { ...n, ...updated } : n));
        return next.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
      });
      lastSavedRef.current = { title: clampTitle(title), content };
      setIsOffline(!apiBase);
    } catch (e) {
      setError(e?.message || "Failed to save note.");
    } finally {
      setIsSaving(false);
    }
  }

  function scheduleAutosave(nextTitle, nextContent) {
    if (!selectedId) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);

    saveTimerRef.current = window.setTimeout(() => {
      const last = lastSavedRef.current;
      if (last.title === clampTitle(nextTitle) && last.content === nextContent) return;
      saveNow({ title: nextTitle, content: nextContent });
    }, 600);
  }

  function handleTitleChange(e) {
    const v = e.target.value;
    setDraftTitle(v);
    scheduleAutosave(v, draftContent);
  }

  function handleContentChange(e) {
    const v = e.target.value;
    setDraftContent(v);
    scheduleAutosave(draftTitle, v);
  }

  function handleSelect(id) {
    setSelectedId(id);
  }

  const statusText = useMemo(() => {
    if (isSaving) return "Saving…";
    if (isOffline) return "Offline (local)";
    return "Online";
  }, [isSaving, isOffline]);

  const canEdit = Boolean(selectedNote);

  return (
    <div className="notesApp">
      <header className="topbar">
        <div className="brand">
          <div className="brandMark" aria-hidden="true" />
          <div className="brandText">
            <div className="brandTitle">Notes</div>
            <div className="brandSubtitle">Simple, fast, and local fallback</div>
          </div>
        </div>

        <div className="topbarRight">
          <div className={`statusPill ${isOffline ? "statusPillOffline" : "statusPillOnline"}`} title={apiBase ? `API: ${apiBase}` : "No API configured; using local storage"}>
            {statusText}
          </div>
          <button className="btnPrimary" onClick={handleCreate}>
            New note
          </button>
        </div>
      </header>

      <div className="content">
        <aside className="sidebar" aria-label="Notes sidebar">
          <div className="sidebarHeader">
            <input
              className="searchInput"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search notes…"
              aria-label="Search notes"
            />
          </div>

          <div className="sidebarList" role="list" aria-busy={isLoading ? "true" : "false"}>
            {isLoading ? (
              <div className="emptyState">Loading notes…</div>
            ) : filteredNotes.length === 0 ? (
              <div className="emptyState">
                <div className="emptyTitle">No notes</div>
                <div className="emptyBody">{query.trim() ? "Try a different search." : "Create your first note to get started."}</div>
              </div>
            ) : (
              filteredNotes.map((n) => {
                const active = n.id === selectedId;
                return (
                  <button
                    key={n.id}
                    className={`noteRow ${active ? "noteRowActive" : ""}`}
                    onClick={() => handleSelect(n.id)}
                    role="listitem"
                    aria-current={active ? "true" : "false"}
                  >
                    <div className="noteRowTop">
                      <div className="noteRowTitle">{n.title || "Untitled"}</div>
                      <div className="noteRowTime">{formatUpdatedAt(n.updatedAt)}</div>
                    </div>
                    <div className="noteRowPreview">{notePreview(n.content)}</div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <main className="editor" aria-label="Editor">
          {!selectedNote ? (
            <div className="editorEmpty">
              <div className="editorEmptyTitle">Select a note</div>
              <div className="editorEmptyBody">Choose one from the sidebar or create a new note.</div>
              <button className="btnPrimary" onClick={handleCreate}>
                New note
              </button>
            </div>
          ) : (
            <>
              <div className="editorHeader">
                <div className="editorMeta">
                  <div className="editorMetaLine">
                    <span className="metaLabel">Last updated</span>
                    <span className="metaValue">{formatUpdatedAt(selectedNote.updatedAt) || "—"}</span>
                  </div>
                  {error ? <div className="errorBanner">Error: {error}</div> : null}
                </div>

                <div className="editorActions">
                  <button className="btnSecondary" onClick={() => refreshNotes({ keepSelection: true })}>
                    Refresh
                  </button>
                  <button className="btnDanger" onClick={() => handleDelete(selectedNote.id)}>
                    Delete
                  </button>
                </div>
              </div>

              <div className="editorBody">
                <label className="fieldLabel" htmlFor="noteTitle">
                  Title
                </label>
                <input
                  id="noteTitle"
                  className="titleInput"
                  value={draftTitle}
                  onChange={handleTitleChange}
                  placeholder="Untitled"
                  disabled={!canEdit}
                />

                <label className="fieldLabel" htmlFor="noteContent">
                  Content
                </label>
                <textarea
                  id="noteContent"
                  className="contentInput"
                  value={draftContent}
                  onChange={handleContentChange}
                  placeholder="Write your note here…"
                  disabled={!canEdit}
                />

                <div className="editorFooter">
                  <div className="hint">
                    Autosaves after you stop typing. {apiBase ? "If the backend is down, changes will be saved locally." : "Backend not configured; saving locally."}
                  </div>
                  <button
                    className="btnSecondary"
                    onClick={() => saveNow({ title: draftTitle, content: draftContent })}
                    disabled={!canEdit || isSaving}
                  >
                    Save now
                  </button>
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
