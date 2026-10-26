/**
 * Render de los emblemas: la forma recorta el arte.
 *
 * Todo con Canvas2D (@napi-rs/canvas): la silueta se dibuja con arcos exactos
 * y Skia se encarga del antialiasing, así que el borde queda de 1 px limpio.
 */

import type { Canvas, SKRSContext2D } from "@napi-rs/canvas";
import { type Outline, type Point, fillet, fitToBox } from "./geometry";

// Skia (~74 ms) se carga bajo demanda: este módulo también se usa para cosas
// que no dibujan (la geometría), y `import { createCanvas }` arriba lo
// cargaría siempre.
type CanvasModule = typeof import("@napi-rs/canvas");
let canvasModule: CanvasModule | null = null;

async function loadCanvas(): Promise<CanvasModule> {
  if (!canvasModule) {
    canvasModule = await import("@napi-rs/canvas");
  }
  return canvasModule;
}

export interface EmblemOptions {
  width: number;
  height: number;
  /** Margen de la forma respecto al lienzo (0..0.2). */
  inset?: number;
  /** Punto focal del arte (0..1). */
  focus?: [number, number];
  /** Caja del arte que no debe cortarse: [x0, y0, x1, y1] en píxeles del arte. */
  subject?: [number, number, number, number] | null;
  /** Si hay `subject`, el arte se encoge/recoloca para que quepa entero. */
  protect?: boolean;
}

export interface Placement {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Construye el path de la forma (en coordenadas de píxel, y hacia abajo). */
export function shapePath(
  ctx: SKRSContext2D,
  outline: Outline,
  width: number,
  height: number,
  inset = 0,
): Point[] {
  const points = fitToBox(
    fillet(outline.points, outline.radii),
    width,
    height,
    inset,
    true,
  );
  ctx.beginPath();
  points.forEach(([x, y], index) => {
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  return points;
}

function boundsOf(points: Point[]) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
}

/**
 * Coloca el arte: cubre la caja de la forma (la silueta siempre se ve) y, si
 * se protege un sujeto, se recoloca o encoge hasta que quepa entero.
 */
export function placeArt(
  art: Canvas,
  box: { left: number; top: number; right: number; bottom: number },
  options: EmblemOptions,
  mask?: (rect: [number, number, number, number]) => number,
): Placement {
  const { focus = [0.5, 0.5] } = options;
  const boxW = Math.max(1, box.right - box.left);
  const boxH = Math.max(1, box.bottom - box.top);
  const artW = art.width;
  const artH = art.height;

  let scale = Math.max(boxW / artW, boxH / artH);
  let chosenFocus = focus;

  if (options.subject && mask) {
    const subject = options.subject;
    // Camino rápido: a escala completa (la normal) el sujeto ya entra, así que
    // no hay que buscarlo. Sin esto se hacían 28 × 16 lecturas de píxeles por
    // emblema (~450 `getImageData`), que es el grueso de los ~140 ms.
    const at = layout(
      artW,
      artH,
      scale,
      focus,
      box.left + boxW * focus[0],
      box.top + boxH * focus[1],
      box,
    );
    if (mask(subjectRect(at, subject, scale)) < 0.999) {
      let best: { scale: number; focus: [number, number] } | null = null;
      for (const candidate of focusCandidates(focus)) {
        const centreX = box.left + boxW * candidate[0];
        const centreY = box.top + boxH * candidate[1];
        let low = 0;
        let high = scale;
        for (let i = 0; i < 16; i++) {
          const mid = (low + high) / 2;
          const placement = layout(artW, artH, mid, candidate, centreX, centreY, box);
          if (mask(subjectRect(placement, subject, mid)) >= 0.999) low = mid;
          else high = mid;
        }
        if (!best || low > best.scale) best = { scale: low, focus: candidate };
      }
      if (best) {
        scale = best.scale;
        chosenFocus = best.focus;
      }
    }
  }

  const centreX = box.left + boxW * chosenFocus[0];
  const centreY = box.top + boxH * chosenFocus[1];
  return layout(artW, artH, scale, chosenFocus, centreX, centreY, box);
}

/** Caja del sujeto (en píxeles del arte) llevada al lienzo con `scale`. */
function subjectRect(
  placement: Placement,
  subject: [number, number, number, number],
  scale: number,
): [number, number, number, number] {
  return [
    placement.x + Math.round(subject[0] * scale),
    placement.y + Math.round(subject[1] * scale),
    placement.x + Math.round(subject[2] * scale),
    placement.y + Math.round(subject[3] * scale),
  ];
}

function layout(
  artW: number,
  artH: number,
  scale: number,
  focus: [number, number],
  centreX: number,
  centreY: number,
  box: { left: number; top: number; right: number; bottom: number },
): Placement {
  const width = Math.max(1, Math.round(artW * scale));
  const height = Math.max(1, Math.round(artH * scale));
  let x = Math.round(centreX - width * focus[0]);
  let y = Math.round(centreY - height * focus[1]);
  const boxW = box.right - box.left;
  const boxH = box.bottom - box.top;
  x = width >= boxW ? Math.min(Math.max(x, box.right - width), box.left) : box.left + (boxW - width) / 2;
  y = height >= boxH ? Math.min(Math.max(y, box.bottom - height), box.top) : box.top + (boxH - height) / 2;
  return { x, y, width, height };
}

function focusCandidates(focus: [number, number], steps = 2, step = 0.07): [number, number][] {
  const out: [number, number][] = [[focus[0], focus[1]]];
  for (let i = 1; i <= steps; i++) {
    for (const dx of [-step * i, 0, step * i]) {
      for (const dy of [-step * i, 0, step * i]) {
        if (dx === 0 && dy === 0) continue;
        const candidate: [number, number] = [
          Math.min(1, Math.max(0, focus[0] + dx)),
          Math.min(1, Math.max(0, focus[1] + dy)),
        ];
        if (!out.some((c) => c[0] === candidate[0] && c[1] === candidate[1])) out.push(candidate);
      }
    }
  }
  return out;
}

/**
 * Compone un emblema: el arte recortado por la forma.
 * Devuelve el PNG en Buffer.
 */
export async function renderEmblem(art: Canvas, outline: Outline, options: EmblemOptions): Promise<Buffer> {
  const { width, height, inset = 0.02 } = options;
  const { createCanvas } = await loadCanvas();
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // Máscara aparte: sirve para decidir si el sujeto cabe dentro.
  const maskCanvas = createCanvas(width, height);
  const maskCtx = maskCanvas.getContext("2d");
  const points = shapePath(maskCtx, outline, width, height, inset);
  maskCtx.fillStyle = "#fff";
  maskCtx.fill();

  const box = boundsOf(points);
  const mask =
    options.subject && options.protect
      ? (rect: [number, number, number, number]) => {
          const [x0, y0, x1, y1] = rect;
          if (x0 < 0 || y0 < 0 || x1 > width || y1 > height || x1 <= x0 || y1 <= y0) return 0;
          const data = maskCtx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
          let sum = 0;
          for (let i = 3; i < data.length; i += 4) sum += data[i]!;
          return sum / (255 * ((x1 - x0) * (y1 - y0)));
        }
      : undefined;

  const placement = placeArt(art, box, options, mask);

  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(art as unknown as Canvas, placement.x, placement.y, placement.width, placement.height);

  // Recorte final: la forma manda.
  ctx.globalCompositeOperation = "destination-in";
  shapePath(ctx, outline, width, height, inset);
  ctx.fillStyle = "#fff";
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";

  return canvas.toBuffer("image/png");
}
