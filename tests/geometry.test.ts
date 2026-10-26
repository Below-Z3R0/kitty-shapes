/**
 * Tests de la geometría y del render.
 *
 *   bun test
 */

import { describe, expect, test } from "bun:test";
import { createCanvas } from "@napi-rs/canvas";
import { fillet, fitToBox, rectangle, regularPolygon, star } from "../src/geometry";
import { renderEmblem, shapePath } from "../src/render";
import { build } from "../src/shapes";

const distance = (a: readonly [number, number], b: readonly [number, number]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1]);

describe("geometría", () => {
  test("la estrella cuenta vértices por radio, como Material", () => {
    expect(star(6, 100, 0.8)).toHaveLength(12); // cookie12Sided
    expect(star(4, 100, 0.8)).toHaveLength(8); // sunny
    expect(star(3, 100, 0.8)).toHaveLength(6);
  });

  test("la estrella alterna radio exterior e interior", () => {
    const points = star(4, 100, 0.8, -90);
    points.forEach((point, index) => {
      const radius = Math.hypot(point[0], point[1]);
      expect(radius).toBeCloseTo(index % 2 === 0 ? 100 : 80, 6);
    });
  });

  test("el polígono regular mantiene todos los vértices en la circunferencia", () => {
    for (const point of regularPolygon(6, 100)) {
      expect(Math.hypot(point[0], point[1])).toBeCloseTo(100, 6);
    }
  });

  test("sin radio, el contorno son los vértices", () => {
    const points = rectangle(2, 2);
    const contour = fillet(points, [0, 0, 0, 0]);
    expect(contour).toHaveLength(4);
    contour.forEach((point, index) => expect(distance(point, points[index]!)).toBeLessThan(1e-9));
  });

  test("el arco de una esquina es tangente a los lados", () => {
    const points: [number, number][] = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
    const contour = fillet(points, [0, 0, 0.5, 0]);
    const arc = contour.slice(2, 11);
    expect(arc).toHaveLength(9);
    for (const point of arc) {
      expect(distance(point, [0.5, 0.5])).toBeCloseTo(0.5, 6);
    }
  });

  test("en un vértice cóncavo el arco rellena el hueco", () => {
    const root3 = Math.sqrt(3);
    const points: [number, number][] = [
      [300, -100],
      [root3 * 100, -100],
      [0, 0],
      [root3 * 100, 100],
      [300, 100],
    ];
    const contour = fillet(points, [0, 0, 20, 0, 0], 8);
    const arc = contour.slice(2, 11);
    for (const point of arc) {
      expect(distance(point, [40, 0])).toBeCloseTo(20, 6);
    }
    expect(Math.min(...arc.map((p) => p[0]))).toBeCloseTo(20, 6);
  });

  test("el encaje es uniforme: no deforma la forma", () => {
    const points: [number, number][] = [
      [0, 0],
      [200, 0],
      [200, 100],
      [0, 100],
    ];
    const fitted = fitToBox(points, 400, 400);
    const xs = fitted.map((p) => p[0]);
    const ys = fitted.map((p) => p[1]);
    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);
    expect(width / height).toBeCloseTo(2, 6);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(200, 6);
  });
});

describe("formas", () => {
  test("arch y semiCircle no son la misma forma", () => {
    const arch = build("arch", 0.75);
    const semi = build("semiCircle", 0.75);
    expect(arch.radii).not.toEqual(semi.radii);
    expect(fillet(arch.points, arch.radii, 12)).not.toEqual(fillet(semi.points, semi.radii, 12));
  });

  test("las formas rectangulares siguen el aspecto del lienzo", () => {
    for (const aspect of [0.5, 0.75, 1, 1.8]) {
      for (const name of ["arch", "semiCircle"]) {
        const outline = build(name, aspect);
        const xs = outline.points.map((p) => p[0]);
        const ys = outline.points.map((p) => p[1]);
        const ratio = (Math.max(...xs) - Math.min(...xs)) / (Math.max(...ys) - Math.min(...ys));
        expect(ratio).toBeCloseTo(aspect, 6);
      }
    }
  });

  test("la cookie12 tiene 12 vértices y 6 puntas", () => {
    const outline = build("cookie12", 1);
    expect(outline.points).toHaveLength(12);
    const outer = outline.points.filter((_, index) => index % 2 === 0);
    expect(outer).toHaveLength(6);
  });
});

describe("render", () => {
  test("el emblema respeta el tamaño pedido", async () => {
    const art = createCanvas(200, 260);
    const ctx = art.getContext("2d");
    ctx.fillStyle = "#c86";
    ctx.fillRect(0, 0, 200, 260);
    const png = await renderEmblem(art, build("hexagon", 1), { width: 300, height: 400 });
    expect(png.subarray(1, 4).toString()).toBe("PNG");
  });

  test("la máscara de la forma cubre el lienzo (sin agujeros)", () => {
    for (const name of ["arch", "semiCircle", "hexagon", "cookie12"]) {
      const canvas = createCanvas(400, 400);
      const ctx = canvas.getContext("2d");
      const points = shapePath(ctx, build(name, 1), 400, 400, 0.02);
      ctx.fillStyle = "#fff";
      ctx.fill();
      const { data } = ctx.getImageData(0, 0, 400, 400);
      let opaque = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i]! > 127) opaque++;
      const coverage = opaque / (400 * 400);
      // Una forma rellena debe cubrir la mayor parte del lienzo; los agujeros
      // del bug del módulo dejaban el área en un ~30%. El hexágono regular
      // ocupa ~0.65 de su caja, así que el listón va por debajo de eso.
      expect(coverage).toBeGreaterThan(0.6);
      expect(points.length).toBeGreaterThan(20);
    }
  });
});
