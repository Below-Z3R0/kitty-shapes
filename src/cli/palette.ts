/**
 * Cuantización de un PNG ya renderizado (mantiene el alfa).
 */

import { quantize } from "../quantize";
import { loadCanvas } from "./canvas";

export async function applyPalette(png: Buffer, colors: number): Promise<Buffer> {
  if (colors <= 0) return png;
  const { createCanvas, loadImage } = await loadCanvas();
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const source = ctx.getImageData(0, 0, image.width, image.height);
  const { data } = quantize(source, colors);
  source.data.set(data);
  ctx.putImageData(source, 0, 0);
  return canvas.toBuffer("image/png");
}
