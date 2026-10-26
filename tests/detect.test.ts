import { describe, expect, test } from "bun:test";
import { type SKRSContext2D, createCanvas } from "@napi-rs/canvas";
import { detectBoxes } from "../src/detect";

function canvas(width: number, height: number, draw: (ctx: SKRSContext2D) => void) {
  const surface = createCanvas(width, height);
  draw(surface.getContext("2d"));
  return surface;
}

describe("detectBoxes", () => {
  test("fondo transparente: la caja es el dibujo, no el lienzo entero", () => {
    // Regresión: los píxeles transparentes tienen RGB negro y antes contaban
    // como tinta, así que la caja salía 0,0,200,200.
    const image = canvas(200, 200, (ctx) => {
      ctx.clearRect(0, 0, 200, 200);
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.arc(100, 100, 30, 0, Math.PI * 2);
      ctx.fill();
    });

    expect(detectBoxes(image).content).toEqual([70, 70, 130, 130]);
  });

  test("fondo blanco opaco: ajusta la caja a la tinta", () => {
    const image = canvas(120, 120, (ctx) => {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, 120, 120);
      ctx.fillStyle = "#000";
      ctx.fillRect(40, 50, 30, 20);
    });

    expect(detectBoxes(image).content).toEqual([40, 50, 70, 70]);
  });
});
