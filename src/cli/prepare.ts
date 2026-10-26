/**
 * Pipeline común de `build` y `pick`: decodificar, detectar la lámina,
 * recortar el arte, resolver el tamaño y calcular el foco.
 */

import { detectBoxes } from "../detect";
import { type EmblemOptions } from "../render";
import { type Canvas, loadCanvas } from "./canvas";
import { flagNumber } from "./args";

export const DEFAULT_LONGEST_SIDE = 1100;
export const MAX_LONGEST_SIDE = 4096;

/** "0.6" o "16/9" -> proporción ancho/alto. */
export function parseAspect(value: string): number {
  const parts = value.split("/").map((part) => Number(part.trim()));
  const width = parts[0]!;
  const height = parts.length > 1 ? parts[1]! : 1;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`--aspect necesita algo como 0.6 o 16/9 (no "${value}")`);
  }
  return width / height;
}

export interface Size {
  width: number;
  height: number;
  aspect: number;
}

/**
 * Resuelve el tamaño del lienzo.
 *
 * El aspecto manda: por defecto es el de la imagen, pero `--aspect` lo
 * fuerza y `--square` lo pone a 1. El lado largo se queda en el tamaño
 * pedido, así que al forzar el aspecto cambia el encuadre, no el tamaño.
 */
export function resolveSize(
  artWidth: number,
  artHeight: number,
  flags: Map<string, string>,
  target: number,
): Size {
  let aspect = artWidth / artHeight;
  if (flags.get("square") === "true") aspect = 1;
  const aspectFlag = flags.get("aspect");
  if (aspectFlag && aspectFlag !== "true") aspect = parseAspect(aspectFlag);

  const widthFlag = flags.get("width");
  if (widthFlag && widthFlag !== "true") {
    const width = Math.round(Number(widthFlag));
    if (!Number.isFinite(width) || width <= 0) throw new Error("--width necesita un número");
    return { width, height: Math.max(1, Math.round(width / aspect)), aspect };
  }

  if (aspect >= 1) {
    return { width: target, height: Math.max(1, Math.round(target / aspect)), aspect };
  }
  return { width: Math.max(1, Math.round(target * aspect)), height: target, aspect };
}

/** Carga la imagen en un canvas (solo hace falta el canvas después). */
export async function decode(path: string): Promise<Canvas> {
  const { createCanvas, loadImage } = await loadCanvas();
  const image = await loadImage(path);
  const canvas = createCanvas(image.width, image.height);
  canvas.getContext("2d").drawImage(image, 0, 0);
  return canvas;
}

export interface Prepared {
  canvas: Canvas;
  boxes: ReturnType<typeof detectBoxes>;
  art: Canvas;
  width: number;
  height: number;
  subjectInCrop: [number, number, number, number];
  focus: [number, number];
}

export async function prepare(sourcePath: string, flags: Map<string, string>): Promise<Prepared> {
  const canvas = await decode(sourcePath);
  const boxes = detectBoxes(canvas);
  const [left, top, right, bottom] = boxes.content;
  const { createCanvas } = await loadCanvas();
  const art = createCanvas(right - left, bottom - top);
  art.getContext("2d").drawImage(canvas, -left, -top);

  const longest = Math.max(art.width, art.height);
  const requested = flags.get("size");
  let target =
    requested === "source"
      ? longest
      : requested && requested !== "true"
        ? Number(requested)
        : Math.min(longest, DEFAULT_LONGEST_SIDE);
  if (!Number.isFinite(target) || target <= 0) throw new Error("--size necesita un número o 'source'");
  target = Math.min(Math.round(target), MAX_LONGEST_SIDE);

  const { width, height } = resolveSize(art.width, art.height, flags, target);
  const subjectInCrop: [number, number, number, number] = [
    boxes.subject[0] - left,
    boxes.subject[1] - top,
    boxes.subject[2] - left,
    boxes.subject[3] - top,
  ];
  const focusFlag = flags.get("focus");
  let focus: [number, number] = [
    (subjectInCrop[0] + subjectInCrop[2]) / 2 / art.width,
    (subjectInCrop[1] + subjectInCrop[3]) / 2 / art.height,
  ];
  if (focusFlag && focusFlag !== "true") {
    const parts = focusFlag.split(",").map(Number);
    if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n) || n < 0 || n > 1)) {
      throw new Error(`--focus necesita dos números entre 0 y 1 (x,y), no "${focusFlag}"`);
    }
    focus = parts as [number, number];
  }
  return { canvas, boxes, art, width, height, subjectInCrop, focus };
}

/** Opciones de render comunes a `build` y `pick`. */
export function emblemOptions(
  width: number,
  height: number,
  subject: [number, number, number, number],
  focus: [number, number],
  flags: Map<string, string>,
): EmblemOptions {
  return {
    width,
    height,
    inset: flagNumber(flags, "inset", 0.02),
    focus,
    subject,
    protect: flags.get("protect") === "true",
  };
}
