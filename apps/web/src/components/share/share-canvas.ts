// Pure canvas renderer for the workout / report share card. No external
// image libraries — draws directly onto a 2D canvas so the whole feature
// stays dependency-free (photo compositing, gradients, text layout).
//
// Layout is modeled on the familiar Garmin/Strava "share to story" card:
// stats stacked top-left, a vertical brand badge top-right, and an
// icon + title + date block anchored to the bottom.

export type ShareLayout = "story" | "square";

export interface ShareStat {
  label: string;
  value: string;
  unit?: string;
}

export interface ShareCardData {
  eyebrow: string;
  title: string;
  dateLine: string;
  stats: ShareStat[];
  accentColor: string;
  accentDeep: string;
  photo?: HTMLImageElement | null;
}

const SIZES: Record<ShareLayout, { w: number; h: number }> = {
  story: { w: 1080, h: 1920 },
  square: { w: 1080, h: 1080 },
};

const FONT_STACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
const MONO_STACK = 'ui-monospace, SFMono-Regular, Menlo, monospace';
const EMOJI_STACK = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

export function sizeFor(layout: ShareLayout): { w: number; h: number } {
  return SIZES[layout];
}

/** Small activity glyph, matched from the eyebrow text (sport / report kind). */
function iconFor(eyebrow: string): string {
  const s = eyebrow.toLowerCase();
  if (s.includes("run")) return "🏃";
  if (s.includes("bike") || s.includes("ride") || s.includes("cycl")) return "🚴";
  if (s.includes("swim")) return "🏊";
  if (s.includes("strength")) return "🏋";
  if (s.includes("mobility")) return "🧘";
  if (s.includes("weekly")) return "📅";
  if (s.includes("monthly")) return "🗓";
  return "⚡";
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  let consumed = 0;
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (current && ctx.measureText(test).width > maxWidth) {
      lines.push(current);
      if (lines.length === maxLines) break;
      current = word;
    } else {
      current = test;
    }
    consumed += 1;
  }
  if (lines.length < maxLines && current) {
    lines.push(current);
    consumed = words.length;
  }

  const overflowed = consumed < words.length;
  if (lines.length === maxLines && overflowed) {
    let truncated = lines[maxLines - 1] ?? "";
    while (truncated.length > 1 && ctx.measureText(truncated + "…").width > maxWidth) {
      truncated = truncated.slice(0, -1);
    }
    lines[maxLines - 1] = truncated + "…";
  }
  return lines;
}

function drawCoverImage(ctx: CanvasRenderingContext2D, img: HTMLImageElement, w: number, h: number) {
  const imgRatio = img.width / img.height;
  const boxRatio = w / h;
  let sx = 0;
  let sy = 0;
  let sw = img.width;
  let sh = img.height;
  if (imgRatio > boxRatio) {
    sw = img.height * boxRatio;
    sx = (img.width - sw) / 2;
  } else {
    sh = img.width / boxRatio;
    sy = (img.height - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
}

function drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number, data: ShareCardData) {
  if (data.photo) {
    drawCoverImage(ctx, data.photo, w, h);
    // Darken top (stats) and bottom (title) so white text stays legible
    // over an arbitrary photo, while keeping the middle clear.
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "rgba(6,6,6,0.62)");
    grad.addColorStop(0.28, "rgba(6,6,6,0.18)");
    grad.addColorStop(0.6, "rgba(6,6,6,0.22)");
    grad.addColorStop(1, "rgba(6,6,6,0.8)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  } else {
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, data.accentColor);
    grad.addColorStop(1, data.accentDeep);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    const vignette = ctx.createRadialGradient(w / 2, h * 0.32, h * 0.1, w / 2, h * 0.32, h * 0.95);
    vignette.addColorStop(0, "rgba(255,255,255,0.08)");
    vignette.addColorStop(1, "rgba(0,0,0,0.28)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);
  }
}

/** Vertical brand badge, top-right — a white pill with rotated wordmark. */
function drawBrandBadge(ctx: CanvasRenderingContext2D, w: number, padX: number, topSafe: number) {
  const badgeW = w * 0.07;
  const badgeH = w * 0.19;
  const x = w - padX - badgeW;
  const y = topSafe - badgeH * 0.55;
  const radius = w * 0.01;

  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.96)";
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, badgeW, badgeH, radius);
  } else {
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + badgeW, y, x + badgeW, y + badgeH, radius);
    ctx.arcTo(x + badgeW, y + badgeH, x, y + badgeH, radius);
    ctx.arcTo(x, y + badgeH, x, y, radius);
    ctx.arcTo(x, y, x + badgeW, y, radius);
    ctx.closePath();
  }
  ctx.fill();

  ctx.translate(x + badgeW / 2, y + badgeH / 2);
  ctx.rotate(Math.PI / 2);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${w * 0.024}px ${MONO_STACK}`;
  ctx.fillStyle = "#14110d";
  ctx.fillText("DA2", 0, 0);
  ctx.restore();
}

/** Stats stacked top-left: label above a large value + small inline unit. */
function drawStats(ctx: CanvasRenderingContext2D, w: number, padX: number, topY: number, stats: ShareStat[]) {
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  const rowGap = w * 0.125;
  const labelSize = w * 0.026;
  const valueSize = w * 0.075;
  const unitSize = w * 0.032;

  stats.forEach((stat, i) => {
    const y = topY + i * rowGap;

    ctx.font = `600 ${labelSize}px ${MONO_STACK}`;
    ctx.fillStyle = "rgba(255,255,255,0.78)";
    ctx.fillText(stat.label.toUpperCase(), padX, y);

    const valueY = y + valueSize * 0.92;
    ctx.font = `700 ${valueSize}px ${FONT_STACK}`;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(stat.value, padX, valueY);

    if (stat.unit) {
      const valueWidth = ctx.measureText(stat.value).width;
      ctx.font = `600 ${unitSize}px ${FONT_STACK}`;
      ctx.fillStyle = "rgba(255,255,255,0.82)";
      ctx.fillText(` ${stat.unit}`, padX + valueWidth, valueY);
    }
  });
}

/** Icon + title + date, anchored to the bottom-left. */
function drawFooterBlock(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  padX: number,
  bottomSafe: number,
  data: ShareCardData
) {
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  const dateSize = w * 0.027;
  const titleSize = w * 0.05;
  const iconSize = w * 0.052;

  const dateY = h - bottomSafe;
  const titleY = dateY - dateSize * 1.9;

  // Title line, with a small sport/report icon leading it.
  ctx.font = `${iconSize}px ${EMOJI_STACK}`;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(iconFor(data.eyebrow), padX, titleY);
  const iconWidth = ctx.measureText(iconFor(data.eyebrow)).width;

  ctx.font = `700 ${titleSize}px ${FONT_STACK}`;
  const titleLines = wrapLines(ctx, data.title, w - padX * 2 - iconWidth - w * 0.02, 1);
  ctx.fillText(titleLines[0] ?? data.title, padX + iconWidth + w * 0.02, titleY);

  // Date / period line below.
  ctx.font = `500 ${dateSize}px ${FONT_STACK}`;
  ctx.fillStyle = "rgba(255,255,255,0.78)";
  ctx.fillText(data.dateLine, padX, dateY);
}

/** Draws the full share card into `canvas` at the given layout's native resolution. */
export function renderShareCard(canvas: HTMLCanvasElement, layout: ShareLayout, data: ShareCardData): void {
  const { w, h } = sizeFor(layout);
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, w, h);
  drawBackground(ctx, w, h, data);

  const padX = layout === "story" ? w * 0.055 : w * 0.07;
  const topSafe = layout === "story" ? h * 0.1 : h * 0.09;
  const bottomSafe = layout === "story" ? h * 0.09 : h * 0.08;
  const maxStats = layout === "story" ? 4 : 3;

  drawBrandBadge(ctx, w, padX, topSafe);
  drawStats(ctx, w, padX, topSafe, data.stats.slice(0, maxStats));
  drawFooterBlock(ctx, w, h, padX, bottomSafe, data);
}
