/**
 * Carga de Skia bajo demanda.
 *
 * `@napi-rs/canvas` tarda ~74 ms en cargarse y lo paga todo comando,
 * incluso `--help` y `list`, que no dibujan nada. Por eso se importa
 * recién cuando hay que renderizar.
 */

type CanvasModule = typeof import("@napi-rs/canvas");

let canvasModule: CanvasModule | null = null;

/** Carga Skia bajo demanda (cuesta ~74 ms; no hace falta para `--help`). */
export async function loadCanvas(): Promise<CanvasModule> {
  if (!canvasModule) {
    canvasModule = await import("@napi-rs/canvas");
  }
  return canvasModule;
}

export type Canvas = import("@napi-rs/canvas").Canvas;
