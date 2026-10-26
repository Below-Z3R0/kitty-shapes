/**
 * Cuantización de color para los PNG.
 *
 * El dibujo es un lápiz con aguadas: muchos píxeles casi iguales pero no
 * idénticos, y eso hace que el PNG crezca mucho. Cuantizamos a N colores
 * (histograma de 5 bits por canal + color más cercano) y el PNG sigue siendo
 * RGBA, pero comprime como si fuera una paleta: el alfa se respeta intacto.
 */

const BITS = 5;
const LEVELS = 1 << BITS; // 32
const SHIFT = 8 - BITS;

export function quantize(
  image: { data: Uint8ClampedArray; width: number; height: number },
  maxColors = 256,
): { data: Uint8ClampedArray; colors: number } {
  const { data, width, height } = image;
  const pixels = width * height;

  // 1. Histograma de los colores reducidos a 5 bits por canal. Además de la
  // cuenta se acumula la suma de cada canal: el color del bucket es su MEDIA
  // real (usar el borde inferior del bucket oscurecía hasta 7 por canal).
  interface Entry {
    count: number;
    r: number;
    g: number;
    b: number;
  }
  const histogram = new Map<number, Entry>();
  const bucketOf = new Int32Array(pixels);
  for (let i = 0; i < pixels; i++) {
    const o = i * 4;
    if (data[o + 3]! < 8) {
      // Los píxeles totalmente transparentes no cuentan: si contaran, se
      // llevarían una ranura de la paleta y podrían arrastrar un halo oscuro.
      bucketOf[i] = -1;
      continue;
    }
    const key =
      ((data[o]! >> SHIFT) << (BITS * 2)) |
      ((data[o + 1]! >> SHIFT) << BITS) |
      (data[o + 2]! >> SHIFT);
    bucketOf[i] = key;
    const entry = histogram.get(key);
    if (entry) {
      entry.count++;
      entry.r += data[o]!;
      entry.g += data[o + 1]!;
      entry.b += data[o + 2]!;
    } else {
      histogram.set(key, { count: 1, r: data[o]!, g: data[o + 1]!, b: data[o + 2]! });
    }
  }

  // 2. Los N buckets más frecuentes, con su color medio.
  const top = [...histogram.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, maxColors);
  if (top.length === 0) return { data: new Uint8ClampedArray(data), colors: 0 };

  const centre = new Map<number, [number, number, number]>();
  for (const [key, entry] of histogram) {
    centre.set(key, [
      Math.round(entry.r / entry.count),
      Math.round(entry.g / entry.count),
      Math.round(entry.b / entry.count),
    ]);
  }
  const palette = top.map(([key]) => centre.get(key)!);

  // 3. Cada píxel al color de la paleta más cercano (con caché por bucket).
  const nearest = new Int32Array(LEVELS * LEVELS * LEVELS).fill(-1);
  const out = new Uint8ClampedArray(data);
  for (let i = 0; i < pixels; i++) {
    const key = bucketOf[i]!;
    if (key < 0) continue; // transparente: se queda como está
    let index = nearest[key]!;
    if (index < 0) {
      // Se compara contra el color del bucket, no contra el píxel: así todos
      // los píxeles del mismo bucket comparten decisión y la caché es coherente
      // (antes el primero del bucket decidía por todos).
      const [br, bg, bb] = centre.get(key)!;
      let best = 0;
      let bestDistance = Infinity;
      for (let p = 0; p < palette.length; p++) {
        const colour = palette[p]!;
        const dr = br - colour[0]!;
        const dg = bg - colour[1]!;
        const db = bb - colour[2]!;
        const distance = dr * dr + dg * dg + db * db;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = p;
        }
      }
      index = best;
      nearest[key] = best;
    }
    const colour = palette[index]!;
    const o = i * 4;
    out[o] = colour[0]!;
    out[o + 1] = colour[1]!;
    out[o + 2] = colour[2]!;
  }

  return { data: out, colors: palette.length };
}
