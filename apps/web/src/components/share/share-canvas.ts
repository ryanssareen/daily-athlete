// Pure canvas renderer for the workout / report share card. No external
// image libraries — draws directly onto a 2D canvas so the whole feature
// stays dependency-free (photo compositing, gradients, text layout).

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

export function sizeFor(layout: ShareLayout): { w: number; h: number } {
  return SIZES[layout];
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

/** Draws the full share card into `canvas` at the given layout's native resolution. */
export function renderShareCard(canvas: HTMLCanvasElement, layout: ShareLayout, data: ShareCardData): void {
  const { w, h } = sizeFor(layout);
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, w, h);

  if (data.photo) {
    drawCoverImage(ctx, data.photo, w, h);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "rgba(8,8,8,0.55)");
    grad.addColorStop(0.32, "rgba(8,8,8,0.12)");
    grad.addColorStop(0.62, "rgba(8,8,8,0.38)");
    grad.addColorStop(1, "rgba(8,8,8,0.85)");
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

  const padX = w * 0.09;
  const topSafe = layout === "story" ? h * 0.11 : h * 0.09;
  const bottomSafe = layout === "story" ? h * 0.09 : h * 0.07;

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  // Eyebrow
  let cursorY = topSafe;
  ctx.font = `600 ${w * 0.026}px ${MONO_STACK}`;
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fillText(data.eyebrow.toUpperCase(), padX, cursorY);

  // Title
  cursorY += w * 0.08;
  ctx.font = `700 ${w * 0.062}px ${FONT_STACK}`;
  ctx.fillStyle = "#ffffff";
  const titleLines = wrapLines(ctx, data.title, w - padX * 2, 2);
  const titleLineHeight = w * 0.072;
  for (const line of titleLines) {
    ctx.fillText(line, padX, cursorY);
    cursorY += titleLineHeight;
  }

  // Date line
  cursorY += w * 0.006;
  ctx.font = `500 ${w * 0.026}px ${FONT_STACK}`;
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.fillText(data.dateLine, padX, cursorY);

  // Stats grid, anchored upward from the bottom-safe watermark area.
  const stats = data.stats.slice(0, layout === "story" ? 6 : 4);
  const cols = 2;
  const rows = Math.ceil(stats.length / cols);
  const rowHeight = w * 0.155;
  const gridHeight = rows * rowHeight;
  const gridBottom = h - bottomSafe - w * 0.1;
  const gridTop = gridBottom - gridHeight;
  const colWidth = (w - padX * 2) / cols;

  stats.forEach((stat, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = padX + col * colWidth;
    const y = gridTop + row * rowHeight;

    ctx.font = `600 ${w * 0.021}px ${MONO_STACK}`;
    ctx.fillStyle = "rgba(255,255,255,0.62)";
    ctx.fillText(stat.label.toUpperCase(), x, y);

    ctx.font = `700 ${w * 0.05}px ${FONT_STACK}`;
    ctx.fillStyle = "#ffffff";
    const valueText = stat.unit ? `${stat.value} ${stat.unit}` : stat.value;
    ctx.fillText(valueText, x, y + w * 0.058);
  });

  // Watermark
  ctx.textAlign = "center";
  ctx.font = `600 ${w * 0.023}px ${MONO_STACK}`;
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.fillText("DA2 · DAILY ATHLETE", w / 2, h - bottomSafe * 0.4);
}
