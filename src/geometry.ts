/**
 * Geometría de las formas de Material 3. Sin dependencias: solo matemáticas.
 *
 * Convención: las formas se construyen con la y hacia arriba (como los
 * polígonos de AndroidX) y `fitToBox` la invierte al pasarla a píxeles.
 */

export type Point = readonly [number, number];

const TWO_PI = Math.PI * 2;

/** Módulo siempre positivo (el % de JS devuelve negativo con divisor positivo). */
function mod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

export interface Outline {
  name: string;
  points: Point[];
  radii: number[];
}

export function regularPolygon(
  sides: number,
  radius = 1,
  rotationDeg = 0,
): Point[] {
  if (sides < 3) throw new Error("un polígono necesita al menos 3 lados");
  const points: Point[] = [];
  for (let i = 0; i < sides; i++) {
    const angle = ((rotationDeg + (360 * i) / sides) * Math.PI) / 180;
    points.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
  }
  return points;
}

/**
 * Estrella al estilo Material.
 *
 * Material cuenta vértices POR RADIO: el polígono tiene 2 * N vértices.
 * La receta `star(12, 1.0, 0.8, round 50)` de m3shapes (API antigua) contaba
 * vértices TOTALES, así que son 6 puntas: `star(6, …)` en esta función.
 */
export function star(
  verticesPerRadius: number,
  radius = 1,
  innerRatio = 0.8,
  rotationDeg = -90,
): Point[] {
  if (verticesPerRadius < 2) throw new Error("una estrella necesita 2 vértices por radio");
  if (!(innerRatio > 0 && innerRatio <= 1)) throw new Error("innerRatio debe estar en (0, 1]");
  const total = verticesPerRadius * 2;
  const inner = radius * innerRatio;
  const points: Point[] = [];
  for (let i = 0; i < total; i++) {
    const angle = ((rotationDeg + (360 * i) / total) * Math.PI) / 180;
    const r = i % 2 === 0 ? radius : inner;
    points.push([Math.cos(angle) * r, Math.sin(angle) * r]);
  }
  return points;
}

/** Rectángulo centrado en el origen: TR, TL, BL, BR. */
export function rectangle(width: number, height: number): Point[] {
  const hw = width / 2;
  const hh = height / 2;
  return [
    [hw, hh],
    [-hw, hh],
    [-hw, -hh],
    [hw, -hh],
  ];
}

/**
 * Redondea cada vértice con un arco circular tangente a los dos lados.
 *
 * Es el `CornerRounding` de Material con smoothing = 0: el radio `r` es el
 * radio del arco y la tangente vale r / tan(θ/2). También funciona en los
 * vértices cóncavos (las puntas interiores de una estrella, que se rellenan).
 * Si el radio no cabe en la arista, se recorta.
 */
export function fillet(points: Point[], radii: number[], samples = 24): Point[] {
  const count = points.length;
  if (count < 3) throw new Error("hacen falta al menos 3 vértices");
  if (count !== radii.length) throw new Error("un radio por vértice");

  const contour: Point[] = [];
  for (let index = 0; index < count; index++) {
    const current = points[index]!;
    const previous = points[(index - 1 + count) % count]!;
    const following = points[(index + 1) % count]!;
    let radius = radii[index]!;

    if (radius <= 0) {
      contour.push(current);
      continue;
    }

    const toPrev: Point = [previous[0] - current[0], previous[1] - current[1]];
    const toNext: Point = [following[0] - current[0], following[1] - current[1]];
    const lenPrev = Math.hypot(toPrev[0], toPrev[1]);
    const lenNext = Math.hypot(toNext[0], toNext[1]);
    if (lenPrev < 1e-9 || lenNext < 1e-9) {
      contour.push(current);
      continue;
    }

    const u1: Point = [toPrev[0] / lenPrev, toPrev[1] / lenPrev];
    const u2: Point = [toNext[0] / lenNext, toNext[1] / lenNext];

    const cosine = Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1]));
    const theta = Math.acos(cosine);
    if (theta < 1e-6 || theta > Math.PI - 1e-6) {
      contour.push(current);
      continue;
    }

    const half = theta / 2;
    let bx = u1[0] + u2[0];
    let by = u1[1] + u2[1];
    const blen = Math.hypot(bx, by) || 1;
    const bisector: Point = [bx / blen, by / blen];

    let tangent = radius / Math.tan(half);
    const limit = Math.min(lenPrev, lenNext) * 0.5;
    if (tangent > limit) {
      tangent = limit;
      radius = tangent * Math.tan(half);
    }

    const centre: Point = [
      current[0] + (bisector[0] * radius) / Math.sin(half),
      current[1] + (bisector[1] * radius) / Math.sin(half),
    ];
    const start: Point = [current[0] + u1[0] * tangent, current[1] + u1[1] * tangent];
    const end: Point = [current[0] + u2[0] * tangent, current[1] + u2[1] * tangent];

    const a1 = Math.atan2(start[1] - centre[1], start[0] - centre[0]);
    const a2 = Math.atan2(end[1] - centre[1], end[0] - centre[0]);
    const nearest: Point = [
      centre[0] - bisector[0] * radius,
      centre[1] - bisector[1] * radius,
    ];
    const am = Math.atan2(nearest[1] - centre[1], nearest[0] - centre[0]);

    // OJO: el % de JavaScript puede salir negativo (a diferencia de Python),
    // así que el módulo se hace a mano.
    let delta = mod(a2 - a1 + Math.PI, TWO_PI) - Math.PI;
    const direction = delta >= 0 ? 1 : -1;
    const travelled = mod((am - a1) * direction, TWO_PI);
    if (travelled > Math.abs(delta) + 1e-9) {
      delta -= Math.sign(delta) * 2 * Math.PI;
    }

    for (let step = 0; step <= samples; step++) {
      const angle = a1 + (delta * step) / samples;
      contour.push([centre[0] + Math.cos(angle) * radius, centre[1] + Math.sin(angle) * radius]);
    }
  }
  return contour;
}

/** Escala UNIFORME (la forma no se deforma) y centra en el lienzo. */
export function fitToBox(
  points: Point[],
  width: number,
  height: number,
  margin = 0,
  flipY = false,
): Point[] {
  const source = flipY ? points.map(([x, y]) => [x, -y] as Point) : points;
  const xs = source.map((p) => p[0]);
  const ys = source.map((p) => p[1]);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  if (spanX <= 0 || spanY <= 0) throw new Error("forma degenerada");

  const scale = Math.min(
    (width * (1 - 2 * margin)) / spanX,
    (height * (1 - 2 * margin)) / spanY,
  );
  const offX = width / 2 - ((Math.min(...xs) + Math.max(...xs)) / 2) * scale;
  const offY = height / 2 - ((Math.min(...ys) + Math.max(...ys)) / 2) * scale;
  return source.map(([x, y]) => [x * scale + offX, y * scale + offY] as Point);
}
