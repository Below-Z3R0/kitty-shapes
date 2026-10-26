import { describe, expect, test } from "bun:test";
import { quantize } from "../src/quantize";

type Pixel = [number, number, number, number];

function image(width: number, height: number, pixel: (x: number, y: number) => Pixel) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x, y);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return { data, width, height };
}

describe("quantize", () => {
  test("el color del bucket es la media, no el borde inferior", () => {
    // 8 píxeles con valores 0..7: todos caen en el mismo bucket de 5 bits.
    // La media es 3,5 → 4. El borde inferior daría 0 (imagen más oscura).
    const source = image(8, 1, (x) => [x, x, x, 255]);
    const result = quantize(source, 1);
    for (let x = 0; x < 8; x++) {
      expect(result.data[x * 4]).toBe(4);
      expect(result.data[x * 4 + 1]).toBe(4);
      expect(result.data[x * 4 + 2]).toBe(4);
    }
  });

  test("respeta el máximo de colores", () => {
    const source = image(64, 64, (x, y) => [(x * 4) % 256, (y * 4) % 256, 128, 255]);
    expect(quantize(source, 16).colors).toBeLessThanOrEqual(16);
  });

  test("no toca los píxeles transparentes", () => {
    const source = image(4, 4, (x) => [200, 100, 50, x === 0 ? 0 : 255]);
    const result = quantize(source, 4);
    for (let y = 0; y < 4; y++) {
      const i = y * 4 * 4; // primera columna
      expect(result.data[i + 3]).toBe(0);
      expect(result.data[i]).toBe(source.data[i]);
      expect(result.data[i + 1]).toBe(source.data[i + 1]);
      expect(result.data[i + 2]).toBe(source.data[i + 2]);
    }
  });
});
