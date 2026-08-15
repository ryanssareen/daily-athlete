"use client";

import { useState } from "react";

export function WorkoutNotes({
  rpe,
  notes,
  onRpeChange,
  onNotesChange,
}: {
  rpe: number;
  notes: string;
  onRpeChange: (rpe: number) => void;
  onNotesChange: (notes: string) => void;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <section className="notes-section">
      <div className="section-head compact">
        <div>
          <div className="section-eyebrow">Subjective</div>
          <h2 className="section-title">How did it feel?</h2>
        </div>
      </div>

      <div className="notes-grid">
        <div className="rpe-card">
          <div className="rpe-card-label">Rate of Perceived Exertion</div>
          <div className="rpe-scale">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
              <button
                key={n}
                className={"rpe-dot " + (n === rpe ? "is-on" : "") + (n <= rpe ? " is-filled" : "")}
                onClick={() => onRpeChange(n)}
                title={`${n}/10`}
              >
                {n === rpe ? n : ""}
              </button>
            ))}
          </div>
          <div className="rpe-labels">
            <span>Easy</span>
            <span>Moderate</span>
            <span>Max</span>
          </div>
        </div>

        <div className="note-card">
          <div className="note-card-head">
            <div className="rpe-card-label">Workout notes</div>
            {!editing && <button className="note-edit-btn" onClick={() => setEditing(true)}>Edit</button>}
            {editing && (
              <button className="note-edit-btn primary" onClick={() => setEditing(false)}>
                Done
              </button>
            )}
          </div>
          {editing ? (
            <textarea
              className="note-textarea"
              value={notes}
              onChange={(e) => onNotesChange(e.target.value)}
              autoFocus
              rows={4}
              placeholder="How did it feel? Anything notable?"
            />
          ) : (
            <p className="note-display">{notes}</p>
          )}
          <div className="note-tags">
            <button className="note-tag">+ tag</button>
            <span className="note-tag-pill">#intervals</span>
            <span className="note-tag-pill">#skyline</span>
            <span className="note-tag-pill">#fast-recovery</span>
          </div>
        </div>
      </div>
    </section>
  );
}
