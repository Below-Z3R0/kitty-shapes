#!/usr/bin/env bun
/**
 * kitty-shapes: emblemas con formas de Material 3 a partir de cualquier imagen.
 *
 *   bun run src/cli.ts build osito.png              -> 8 PNG + manifest.json
 *   bun run src/cli.ts pick  osito.png | kitty +kitten icat
 *   bun run src/cli.ts pick  salida/manifest.json | kitty +kitten icat
 *
 * El tamaño de salida se adapta al de la imagen: se conserva el aspecto, así
 * que las formas nunca se deforman.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { detectBoxes } from "./detect";
import { quantize } from "./quantize";
import { type EmblemOptions, renderEmblem } from "./render";
import { BUILDERS, DEFAULT_SHAPES, NOTES, build } from "./shapes";

// `@napi-rs/canvas` (Skia) tarda ~74 ms en cargarse. Importarlo arriba lo
// paga TODO comando, incluso `--help` y `list`, que no lo necesitan. Se
// carga bajo demanda: solo cuando hay que dibujar.
type CanvasModule = typeof import("@napi-rs/canvas");
let canvasModule: CanvasModule | null = null;

/** Carga Skia bajo demanda (cuesta ~74 ms; no hace falta para `--help`). */
async function loadCanvas(): Promise<CanvasModule> {
  if (!canvasModule) {
    canvasModule = await import("@napi-rs/canvas");
  }
  return canvasModule;
}

type Canvas = import("@napi-rs/canvas").Canvas;

interface Manifest {
  source: string;
  width: number;
  height: number;
  shapes: { name: string; file: string; note: string }[];
}

const DEFAULT_LONGEST_SIDE = 1100;
const MAX_LONGEST_SIDE = 4096;

function parseArgs(argv: string[]): { command: string; positional: string[]; flags: Map<string, string> } {
  const [command = "", ...rest] = argv;
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]!;
    if (token.startsWith("--")) {
      const equals = token.indexOf("=");
      if (equals > 2) {
        flags.set(token.slice(2, equals), token.slice(equals + 1));
        continue;
      }
      const key = token.slice(2);
      const next = rest[i + 1];
      if (next === undefined || next.startsWith("--")) flags.set(key, "true");
      else {
        flags.set(key, next);
        i++;
      }
    } else positional.push(token);
  }
  return { command, positional, flags };
}

function flagNumber(flags: Map<string, string>, name: string, fallback: number): number {
  const raw = flags.get(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`--${name} necesita un número`);
  return value;
}

/** Lee una lista de formas desde un fichero (una por línea, # para comentarios). */
async function shapesFromFile(path: string): Promise<string[]> {
  const text = await readFile(path, "utf8");
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

async function flagListAsync(
  flags: Map<string, string>,
  name: string,
  fallback: string[],
): Promise<string[]> {
  const file = flags.get("shapes-file");
  if (file && file !== "true") {
    const items = await shapesFromFile(file);
    if (items.length) return ensureShapes(items, ` en ${file}`);
  }
  return flagList(flags, name, fallback);
}

/** Rechaza nombres de forma que no existan en BUILDERS. */
function ensureShapes(items: string[], where = ""): string[] {
  const unknown = items.filter((item) => !(item in BUILDERS));
  if (unknown.length) throw new Error(`formas desconocidas${where}: ${unknown.join(", ")}`);
  return items;
}

function flagList(flags: Map<string, string>, name: string, fallback: string[]): string[] {
  const raw = flags.get(name);
  if (!raw || raw === "true") return fallback;
  return ensureShapes(raw.split(",").map((item) => item.trim()).filter(Boolean));
}

/** "0.6" o "16/9" -> proporción ancho/alto. */
function parseAspect(value: string): number {
  const parts = value.split("/").map((part) => Number(part.trim()));
  const width = parts[0]!;
  const height = parts.length > 1 ? parts[1]! : 1;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`--aspect necesita algo como 0.6 o 16/9 (no "${value}")`);
  }
  return width / height;
}

interface Size {
  width: number;
  height: number;
  aspect: number;
}

/**
 * Resuelve el tamaño del lienzo.
 *
 * El aspecto manda: por defecto es el de la imagen, pero `--aspect` lo
 * fuerza (más alto o más ancho) y `--square` lo pone a 1. El lado largo se
 * queda en el tamaño pedido, así que al forzar el aspecto lo que cambia es
 * el encuadre, no el tamaño.
 */
function resolveSize(
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
async function decode(path: string): Promise<Canvas> {
  const { createCanvas, loadImage } = await loadCanvas();
  const image = await loadImage(path);
  const canvas = createCanvas(image.width, image.height);
  canvas.getContext("2d").drawImage(image, 0, 0);
  return canvas;
}

interface Prepared {
  canvas: Canvas;
  boxes: ReturnType<typeof detectBoxes>;
  art: Canvas;
  width: number;
  height: number;
  subjectInCrop: [number, number, number, number];
  focus: [number, number];
}

/**
 * Pipeline común de `build` y `pick`: decodifica, detecta la lámina, recorta
 * el arte, resuelve tamaño/aspecto y calcula el foco.
 */
async function prepare(sourcePath: string, flags: Map<string, string>): Promise<Prepared> {
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
function emblemOptions(
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

function randomItem<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

async function buildCommand(positional: string[], flags: Map<string, string>) {
  const source = positional[0];
  if (!source) throw new Error("falta la imagen: build <imagen>");
  const sourcePath = resolve(source);

  const { canvas, boxes, art, width, height, subjectInCrop, focus } = await prepare(sourcePath, flags);

  const outDir = resolve(flags.get("out") ?? join(dirname(sourcePath), `${basename(sourcePath, ".png")}-shapes`));
  await mkdir(outDir, { recursive: true });

  const names = await flagListAsync(flags, "shapes", [...DEFAULT_SHAPES]);
  const palette = flagNumber(flags, "palette", 0);
  const options = emblemOptions(width, height, subjectInCrop, focus, flags);

  const manifest: Manifest = { source: sourcePath, width, height, shapes: [] };
  for (const name of names) {
    const outline = build(name, width / height);
    const png = await renderEmblem(art, outline, options);
    const file = join(outDir, `${name}.png`);
    await writeFile(file, await applyPalette(png, palette));
    manifest.shapes.push({ name, file, note: NOTES[name] ?? "" });
  }

  const manifestPath = join(outDir, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  console.error(`imagen   : ${canvas.width}x${canvas.height}`);
  console.error(`lámina   : ${boxes.content.join(",")}`);
  console.error(`sujeto   : ${subjectInCrop.join(",")}`);
  console.error(`lienzo   : ${width}x${height}  (aspecto ${(width / height).toFixed(3)})`);
  console.error(`${names.length} emblemas -> ${outDir}`);
  console.log(manifestPath);
}

async function pickCommand(positional: string[], flags: Map<string, string>) {
  const target = positional[0];
  if (!target) throw new Error("falta la imagen o el manifest: pick <imagen|manifest.json>");

  // Si es un manifest, se elige un PNG ya hecho (instantáneo).
  if (target.endsWith("manifest.json")) {
    const manifest = JSON.parse(await readFile(target, "utf8")) as Manifest;
    const wanted = flags.get("shape");
    const chosen =
      wanted && wanted !== "true" && wanted !== "random"
        ? manifest.shapes.find((shape) => shape.name === wanted)
        : randomItem(manifest.shapes);
    if (!chosen) throw new Error(`forma no está en el manifest: ${wanted}`);
    const png = await readFile(chosen.file);
    // Mismos modos de salida que con una imagen: escape, ruta o bytes.
    if (flags.get("escape") === "true") process.stdout.write(kittyEscape(png));
    else if (flags.get("path") === "true") console.log(chosen.file);
    else process.stdout.write(png);
    return;
  }

  const sourcePath = resolve(target);
  const { art, width, height, subjectInCrop, focus } = await prepare(sourcePath, flags);

  const names = await flagListAsync(flags, "shapes", [...DEFAULT_SHAPES]);
  const wanted = flags.get("shape");
  const name = !wanted || wanted === "true" || wanted === "random" ? randomItem(names) : wanted;
  if (!(name in BUILDERS)) throw new Error(`forma desconocida: ${name}`);

  const png = await applyPalette(
    await renderEmblem(art, build(name, width / height), emblemOptions(width, height, subjectInCrop, focus, flags)),
    flagNumber(flags, "palette", 0),
  );

  if (flags.get("escape") === "true") {
    process.stdout.write(kittyEscape(png));
    return;
  }
  if (flags.get("path") === "true") {
    const out = resolve(flags.get("out") ?? "emblem.png");
    await writeFile(out, png);
    console.log(out);
    return;
  }
  process.stdout.write(png);
}

/** Cuantiza un PNG ya renderizado (mantiene el alfa). */
async function applyPalette(png: Buffer, colors: number): Promise<Buffer> {
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

/** Escape del protocolo gráfico de Kitty (a=T: transmite y muestra). */
export function kittyEscape(png: Buffer, chunk = 4096): string {
  let out = "";
  for (let i = 0; i < png.length; i += chunk) {
    const slice = png.subarray(i, i + chunk);
    const more = i + chunk < png.length ? 1 : 0;
    out += `\x1b_Gf=100,a=T,m=${more};${slice.toString("base64")}\x1b\\`;
  }
  return out;
}

const USAGE = `uso: kitty-shapes <build|pick|list> [opciones]

  build <imagen>          un PNG por forma + manifest.json
  pick  <imagen>          un emblema por stdout (para icat)
  pick  <manifest.json>   elige un PNG ya generado (instantáneo)
  list                    lista las formas disponibles

Salida de pick
  --path                  imprime la ruta del PNG
  --out <ruta|dir>        con build, la carpeta; con pick, el fichero
  --escape                emite la secuencia del protocolo gráfico de kitty

Forma
  --shape <nombre|random> una forma concreta (default: random)
  --shapes a,b,c          formas para build
  --shapes-file <ruta>    una por línea (# comenta)
  --list                  lista las formas y sale

Lienzo
  --size <n|source>       lado largo en px (default: min(original, 1100))
  --width <n>             ancho exacto (ignora --size)
  --aspect <n|a/b>        fuerza el aspecto (0.6, 16/9)
  --square                aspecto 1:1
  --inset <0..0.2>        margen de la forma (default 0.02)

Arte
  --focus <x,y>           punto focal 0..1 (default: centro del sujeto)
  --protect               encoge el arte para no cortar el sujeto
  --palette <n>           colores de la paleta (0 = sin cuantizar, default 0)
`;

async function main() {
  const { command, positional, flags } = parseArgs(process.argv.slice(2));

  if (flags.get("help") === "true" || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(USAGE);
    return;
  }

  if (flags.get("list") === "true" || command === "list") {
    for (const name of Object.keys(BUILDERS).sort()) {
      console.log(`${name.padEnd(12)} ${NOTES[name] ?? ""}`);
    }
    return;
  }

  switch (command) {
    case "build":
      await buildCommand(positional, flags);
      return;
    case "pick":
      await pickCommand(positional, flags);
      return;
    default:
      process.stderr.write(USAGE);
      process.exitCode = 1;
  }
}

// Si el consumidor cierra el pipe (p. ej. `| head`), no es un error real.
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});

main().catch((error) => {
  console.error(`error: ${(error as Error).message}`);
  process.exitCode = 1;
});
