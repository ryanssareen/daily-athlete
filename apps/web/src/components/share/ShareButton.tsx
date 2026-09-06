"use client";

import { useEffect, useRef, useState } from "react";

import { renderShareCard, sizeFor, type ShareLayout, type ShareStat } from "./share-canvas";

interface ShareButtonProps {
  eyebrow: string;
  title: string;
  dateLine: string;
  stats: ShareStat[];
  accentColor: string;
  accentDeep: string;
  fileNamePrefix: string;
  buttonLabel?: string;
  buttonStyle?: React.CSSProperties;
}

function loadImageFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read image"));
    };
    img.src = url;
  });
}

function ShareIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}

const DEFAULT_BUTTON_STYLE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 14px",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  border: "1px solid var(--color-border)",
  background: "var(--color-paper)",
  color: "var(--color-ink)",
  transition: "all 0.12s",
};

const OVERLAY_STYLE: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.45)",
  zIndex: 40,
};

const DIALOG_WRAP_STYLE: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 50,
  padding: 16,
  pointerEvents: "none",
};

const DIALOG_CARD_STYLE: React.CSSProperties = {
  background: "var(--color-paper)",
  border: "1px solid var(--color-border)",
  borderRadius: 16,
  padding: "24px 28px",
  width: "100%",
  maxWidth: 560,
  pointerEvents: "auto",
};

const CLOSE_BTN_STYLE: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "var(--color-ink-muted)",
  fontSize: 16,
  cursor: "pointer",
  lineHeight: 1,
  padding: 4,
};

const SECONDARY_BTN_STYLE: React.CSSProperties = {
  padding: "7px 14px",
  borderRadius: 999,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  border: "1px solid var(--color-border)",
  background: "var(--color-paper)",
  color: "var(--color-ink)",
};

const PRIMARY_BTN_STYLE: React.CSSProperties = {
  padding: "7px 16px",
  borderRadius: 999,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  border: "none",
  background: "var(--color-ink)",
  color: "var(--color-canvas)",
};

/**
 * "Share" trigger + dialog: renders workout/report stats onto a canvas as
 * either an Instagram Story (9:16) or square card, optionally composited
 * over a user-picked photo. Everything runs client-side — no upload, no
 * server round trip — so the photo never leaves the browser.
 */
export function ShareButton({
  eyebrow,
  title,
  dateLine,
  stats,
  accentColor,
  accentDeep,
  fileNamePrefix,
  buttonLabel = "Share",
  buttonStyle,
}: ShareButtonProps) {
  const [open, setOpen] = useState(false);
  const [layout, setLayout] = useState<ShareLayout>("story");
  const [photo, setPhoto] = useState<HTMLImageElement | null>(null);
  const [photoObjectUrl, setPhotoObjectUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [canShareFiles, setCanShareFiles] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    renderShareCard(canvas, layout, { eyebrow, title, dateLine, stats, accentColor, accentDeep, photo });
  }, [open, layout, photo, eyebrow, title, dateLine, stats, accentColor, accentDeep]);

  useEffect(() => {
    return () => {
      if (photoObjectUrl) URL.revokeObjectURL(photoObjectUrl);
    };
  }, [photoObjectUrl]);

  useEffect(() => {
    const nav = navigator as Navigator & { canShare?: (data?: ShareData) => boolean };
    setCanShareFiles(typeof nav.canShare === "function" && typeof navigator.share === "function");
  }, []);

  function handleOpen() {
    setErrorMsg("");
    setOpen(true);
  }

  function handleClose() {
    setOpen(false);
  }

  async function handlePhotoPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setErrorMsg("Choose an image file");
      return;
    }
    try {
      const img = await loadImageFile(file);
      if (photoObjectUrl) URL.revokeObjectURL(photoObjectUrl);
      setPhotoObjectUrl(img.src);
      setPhoto(img);
      setErrorMsg("");
    } catch {
      setErrorMsg("Could not load that photo");
    }
  }

  function handleRemovePhoto() {
    if (photoObjectUrl) URL.revokeObjectURL(photoObjectUrl);
    setPhotoObjectUrl(null);
    setPhoto(null);
  }

  function canvasToBlob(): Promise<Blob | null> {
    return new Promise((resolve) => {
      const canvas = canvasRef.current;
      if (!canvas) {
        resolve(null);
        return;
      }
      canvas.toBlob((blob) => resolve(blob), "image/png", 0.95);
    });
  }

  async function handleDownload() {
    setBusy(true);
    setErrorMsg("");
    try {
      const blob = await canvasToBlob();
      if (!blob) {
        setErrorMsg("Could not generate image");
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${fileNamePrefix}-${layout}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }

  async function handleNativeShare() {
    setBusy(true);
    setErrorMsg("");
    try {
      const blob = await canvasToBlob();
      if (!blob) {
        setErrorMsg("Could not generate image");
        return;
      }
      const file = new File([blob], `${fileNamePrefix}-${layout}.png`, { type: "image/png" });
      await navigator.share({ files: [file], title });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setErrorMsg("Could not share");
    } finally {
      setBusy(false);
    }
  }

  const size = sizeFor(layout);

  return (
    <>
      <button onClick={handleOpen} style={buttonStyle ?? DEFAULT_BUTTON_STYLE}>
        <ShareIcon />
        {buttonLabel}
      </button>

      {open && (
        <>
          <div aria-hidden="true" onClick={handleClose} style={OVERLAY_STYLE} />
          <div role="dialog" aria-modal="true" aria-labelledby="share-card-title" style={DIALOG_WRAP_STYLE}>
            <div onClick={(e) => e.stopPropagation()} style={DIALOG_CARD_STYLE}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
                <h2 id="share-card-title" style={{ fontSize: 17, fontWeight: 600, margin: 0, color: "var(--color-ink)" }}>
                  Share
                </h2>
                <button onClick={handleClose} aria-label="Close" style={CLOSE_BTN_STYLE}>
                  ✕
                </button>
              </div>

              <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                <div
                  style={{
                    flex: "0 0 auto",
                    width: layout === "story" ? 200 : 240,
                    aspectRatio: `${size.w} / ${size.h}`,
                    borderRadius: 12,
                    overflow: "hidden",
                    border: "1px solid var(--color-border)",
                    background: "var(--color-canvas-soft)",
                    margin: "0 auto",
                  }}
                >
                  <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
                </div>

                <div style={{ flex: "1 1 220px", display: "flex", flexDirection: "column", gap: 16, minWidth: 220 }}>
                  <div>
                    <span className="eyebrow" style={{ display: "block", marginBottom: 8 }}>
                      Layout
                    </span>
                    <div style={{ display: "flex", gap: 8 }}>
                      {(["story", "square"] as const).map((l) => (
                        <button
                          key={l}
                          onClick={() => setLayout(l)}
                          style={{
                            padding: "6px 14px",
                            borderRadius: 999,
                            fontSize: 13,
                            fontWeight: 600,
                            cursor: "pointer",
                            border: "1px solid var(--color-border)",
                            background: layout === l ? "var(--color-ink)" : "var(--color-paper)",
                            color: layout === l ? "var(--color-canvas)" : "var(--color-ink)",
                          }}
                        >
                          {l === "story" ? "Instagram Story" : "Square"}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <span className="eyebrow" style={{ display: "block", marginBottom: 8 }}>
                      Photo
                    </span>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => fileInputRef.current?.click()} style={SECONDARY_BTN_STYLE}>
                        {photo ? "Change photo" : "Add photo"}
                      </button>
                      {photo && (
                        <button onClick={handleRemovePhoto} style={SECONDARY_BTN_STYLE}>
                          Remove
                        </button>
                      )}
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handlePhotoPick}
                      style={{ display: "none" }}
                    />
                  </div>

                  {errorMsg && <span style={{ fontSize: 12, color: "var(--color-danger)" }}>{errorMsg}</span>}

                  <div style={{ display: "flex", gap: 8, marginTop: "auto", flexWrap: "wrap" }}>
                    <button onClick={handleDownload} disabled={busy} style={PRIMARY_BTN_STYLE}>
                      Download
                    </button>
                    {canShareFiles && (
                      <button onClick={handleNativeShare} disabled={busy} style={SECONDARY_BTN_STYLE}>
                        Share…
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
