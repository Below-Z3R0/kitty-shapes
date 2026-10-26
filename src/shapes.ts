/**
 * Recetas de las formas de Material 3.
 *
 * Unidades Material: radio 100 (igual que las definiciones de Material, donde
 * `round 50` es la mitad del radio). Los vértices se cuentan como en Material:
 * una estrella tiene 2 * verticesPerRadius vértices.
 */

import { type Outline, rectangle, regularPolygon, star } from "./geometry";

const RECT_WIDTH = 200;

type Builder = (aspect: number) => Outline;

function starCookie(
  name: string,
  perRadius: number,
  innerRatio: number,
  rounding: number,
  rotation = -90,
): Builder {
  return () => ({
    name,
    points: star(perRadius, 100, innerRatio, rotation),
    radii: Array.from({ length: perRadius * 2 }, () => rounding),
  });
}

function polygon(name: string, sides: number, rounding: number): Builder {
  return () => ({
    name,
    points: regularPolygon(sides, 100),
    radii: Array.from({ length: sides }, () => rounding),
  });
}

/** Rectángulo con redondeo por vértice (Material `perVertexRounding`). */
function roundedRect(name: string, top: number, bottom: number): Builder {
  return (aspect) => {
    const width = RECT_WIDTH;
    // `aspect` es ancho/alto del lienzo: la forma toma la misma proporción.
    const height = width / aspect;
    return {
      name,
      points: rectangle(width, height),
      radii: [top, top, bottom, bottom],
    };
  };
}

const gem: Builder = () => ({
  name: "gem",
  points: [
    [0, -100],
    [78, -30],
    [44, 68],
    [-44, 68],
    [-78, -30],
  ],
  radii: [40, 40, 40, 40, 40],
});

export const BUILDERS: Record<string, Builder> = {
  // m3shapes: star(12, 1.0, 0.8, round 50) -> 12 vértices = 6 puntas
  cookie12: starCookie("cookie12", 6, 0.8, 50),
  cookie9: polygon("cookie9", 9, 50),
  cookie7: polygon("cookie7", 7, 50),
  cookie6: starCookie("cookie6", 3, 0.8, 50),
  cookie4: starCookie("cookie4", 2, 0.8, 50),
  // m3shapes: star(8, 1.0, 0.8, round 15) -> 8 vértices = 4 puntas
  sunny: starCookie("sunny", 4, 0.8, 15, 0),
  hexagon: polygon("hexagon", 6, 34),
  octagon: polygon("octagon", 8, 34),
  pentagon: polygon("pentagon", 5, 34),
  gem,
  // m3shapes: rectángulo con redondeo por vértice (100,100,20,20) / (20,20,100,100)
  arch: roundedRect("arch", 100, 20),
  semiCircle: roundedRect("semiCircle", 20, 100),
};

export const DEFAULT_SHAPES = [
  "cookie12",
  "hexagon",
  "octagon",
  "pentagon",
  "gem",
  "sunny",
  "arch",
  "semiCircle",
] as const;

export const NOTES: Record<string, string> = {
  cookie12: "star(12, 1.0, 0.8, round 50) - 12 vértices, 6 puntas",
  sunny: "star(8, 1.0, 0.8, round 15) - 8 vértices, 4 puntas",
  arch: "rectángulo, redondeo por vértice (100, 100, 20, 20)",
  semiCircle: "rectángulo, redondeo por vértice (20, 20, 100, 100)",
};

/** Construye la forma `name` para un lienzo de aspecto ancho/alto = `aspect`. */
export function build(name: string, aspect = 1): Outline {
  const builder = BUILDERS[name];
  if (!builder) {
    throw new Error(
      `forma desconocida: ${name} (disponibles: ${Object.keys(BUILDERS).sort().join(", ")})`,
    );
  }
  return builder(aspect);
}
