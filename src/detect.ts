/**
 * Detección automática de la lámina y del sujeto.
 *
 * Sirve para ilustraciones a tinta sobre un fondo plano: el color de fondo se
 * saca de las esquinas y la "tinta" es todo lo que se aleja de ese color.
 */

import type { Canvas } from "@napi-rs/canvas";

export interface Boxes {
  /** La lámina completa con el dibujo. */
  content: [number, number, number, number];
  /** La caja del sujeto (por ejemplo oso + globo), sin la línea de suelo. */
  subject: [number, number, number, number];
}

const THRESHOLD = 20;
/** Ancho de la franja que se mira para detectar la línea de suelo. */
const EDGE = 8;

export function detectBoxes(image: Canvas, threshold = THRESHOLD): Boxes {
  const { width, height } = image;
  const ctx = image.getContext("2d");
  const { data } = ctx.getImageData(0, 0, width, height);

  const corners = [
    pixelAt(data, width, 0, 0),
    pixelAt(data, width, width - 1, 0),
    pixelAt(data, width, 0, height - 1),
    pixelAt(data, width, width - 1, height - 1),
  ];
  // Fondo = mediana de las esquinas OPACAS. Si todas son transparentes se
  // asume blanco (una lámina con alfa suele tener el fondo recortado).
  const opaque = corners.filter((corner) => corner[3]! >= 128);
  const background = [0, 1, 2].map((channel) => {
    const values = opaque.map((corner) => corner[channel]!).sort((a, b) => a - b);
    return values.length ? values[Math.floor(values.length / 2)]! : 255;
  });

  const rowMin = new Int32Array(height).fill(-1);
  const rowMax = new Int32Array(height).fill(-1);
  let contentLeft = width;
  let contentRight = -1;
  let contentTop = height;
  let contentBottom = -1;
  let groundTop = height;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width * 4;
    for (let x = 0; x < width; x++) {
      const i = rowOffset + x * 4;
      const dr = Math.abs(data[i]! - background[0]!);
      const dg = Math.abs(data[i + 1]! - background[1]!);
      const db = Math.abs(data[i + 2]! - background[2]!);
      // Un píxel transparente es fondo por definición: sin esto, un PNG
      // recortado tomaría su RGB (normalmente negro) como tinta.
      if (data[i + 3]! < 128) continue;
      const diff = dr > dg ? (dr > db ? dr : db) : dg > db ? dg : db;
      if (diff <= threshold) continue;

      if (rowMin[y]! < 0) {
        rowMin[y] = x;
        if (y < contentTop) contentTop = y;
      }
      rowMax[y] = x;
      if (x < contentLeft) contentLeft = x;
      if (x > contentRight) contentRight = x;
      if (y > contentBottom) contentBottom = y;
      if (x < EDGE && y < groundTop) groundTop = y;
    }
  }

  if (contentRight < 0) {
    // No hay tinta detectable: se usa la imagen entera.
    return {
      content: [0, 0, width, height],
      subject: [0, 0, width, height],
    };
  }

  let subjectLeft = width;
  let subjectRight = -1;
  let subjectTop = height;
  let subjectBottom = -1;
  for (let y = 0; y < groundTop; y++) {
    if (rowMin[y]! < 0) continue;
    if (rowMin[y]! < subjectLeft) subjectLeft = rowMin[y]!;
    if (rowMax[y]! > subjectRight) subjectRight = rowMax[y]!;
    if (y < subjectTop) subjectTop = y;
    if (y > subjectBottom) subjectBottom = y;
  }
  // Si la línea de suelo era lo único, el sujeto es todo el dibujo.
  if (subjectRight < 0 || subjectRight - subjectLeft < 8 || subjectBottom - subjectTop < 8) {
    subjectLeft = contentLeft;
    subjectRight = contentRight;
    subjectTop = contentTop;
    subjectBottom = contentBottom;
  }

  return {
    content: [contentLeft, contentTop, contentRight + 1, contentBottom + 1],
    subject: [subjectLeft, subjectTop, subjectRight + 1, subjectBottom + 1],
  };
}

function pixelAt(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
): [number, number, number, number] {
  const i = (y * width + x) * 4;
  return [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!];
}
