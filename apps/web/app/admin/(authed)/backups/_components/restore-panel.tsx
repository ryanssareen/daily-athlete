"use client";

// Restore-from-file panel on the backups page. Uploads a previously downloaded
// backup artifact (gzipped NDJSON) to POST /api/admin/backups/restore, which
// upserts it back into Postgres. Optional username scopes the restore to one
// user. DESTRUCTIVE — guarded behind a typed "RESTORE" confirmation that only
// appears once a file is chosen. Calls onRestored() so the history list reloads.

import { useRef, useState } from "react";

interface RestoreSummary {
  restored: Record<string, number>;
  totalRows: number;
  skippedUnknownTables: string[];
  scopedToUserId: string | null;
}

const CONFIRM_TOKEN = "RESTORE";

export function RestorePanel({ onRestored }: { onRestored: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [username, setUsername] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<RestoreSummary | null>(null);

  const ready = file !== null && confirm === CONFIRM_TOKEN && !busy;

  function reset() {
    setFile(null);
    setConfirm("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function submit() {
    if (!file) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("confirm", confirm);
      if (username.trim()) body.set("username", username.trim());

      const res = await fetch("/api/admin/backups/restore", {
        method: "POST",
        body,
      });
      const json = (await res.json().catch(() => ({}))) as {
        summary?: RestoreSummary;
        message?: string;
      };
      if (!res.ok) {
        setError(json.message ?? "Restore failed.");
        return;
      }
      setDone(json.summary ?? null);
      reset();
      onRestored();
    } catch {
      setError("Restore failed — couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="restore-panel">
      <div className="restore-panel-head">
        <span className="restore-panel-mark" aria-hidden>
          ↺
        </span>
        <div>
          <div className="restore-panel-title">Restore from backup file</div>
          <div className="restore-panel-sub">
            Upload a previously downloaded <code>.ndjson.gz</code> backup. Leave
            username blank to restore all data. Rows are merged back in (upsert) —
            this overwrites matching live records.
          </div>
        </div>
      </div>

      <div className="restore-form">
        <div className="restore-controls">
          <label className="restore-field">
            <span className="restore-field-label">Username</span>
            <input
              className="input"
              placeholder="email or user id (optional)"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={busy}
            />
          </label>

          <button
            type="button"
            className="btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
          >
            {file ? "Change file" : "Choose file"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".gz,.ndjson,.json"
            hidden
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setConfirm("");
              setDone(null);
              setError(null);
            }}
          />
        </div>

        {file ? (
          <div className="restore-confirm">
            <span className="restore-file">
              <span className="restore-file-name">{file.name}</span>
              <button
                type="button"
                className="btn sm ghost"
                onClick={reset}
                disabled={busy}
              >
                Remove
              </button>
            </span>
            <label className="restore-field">
              <span className="restore-field-label">
                Type {CONFIRM_TOKEN} to confirm
              </span>
              <input
                className="input"
                style={{ maxWidth: 220 }}
                placeholder={CONFIRM_TOKEN}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                disabled={busy}
                aria-label={`Type ${CONFIRM_TOKEN} to confirm restore`}
              />
            </label>
            <button
              type="button"
              className="btn danger"
              onClick={submit}
              disabled={!ready}
            >
              {busy ? "Restoring…" : "Choose file & restore"}
            </button>
          </div>
        ) : null}

        {error ? (
          <div className="alert danger" role="alert">
            <span className="alert-mark">!</span>
            <div className="alert-body">
              <div className="alert-title">Restore failed</div>
              <div className="alert-desc">{error}</div>
            </div>
          </div>
        ) : null}

        {done ? (
          <div className="restore-result" role="status">
            Restored <strong>{done.totalRows.toLocaleString()}</strong> row
            {done.totalRows === 1 ? "" : "s"}
            {done.scopedToUserId ? " for the selected user" : " across all tables"}
            {done.skippedUnknownTables.length > 0
              ? ` · skipped ${done.skippedUnknownTables.length} unknown table${
                  done.skippedUnknownTables.length === 1 ? "" : "s"
                }`
              : ""}
            .
          </div>
        ) : null}
      </div>
    </div>
  );
}
