/**
 * `pick <imagen|manifest.json>`: un emblema por stdout.
 *
 * Con una imagen renderiza una forma al vuelo; con un manifest elige
 * un PNG ya generado, que es instantáneo.
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { renderEmblem } from "../render";
import { BUILDERS, build, DEFAULT_SHAPES } from "../shapes";
import { flagListAsync, flagNumber } from "./args";
import { type Manifest } from "./manifest";
import { applyPalette } from "./palette";
import { emblemOptions, prepare } from "./prepare";

function randomItem<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

export async function pickCommand(positional: string[], flags: Map<string, string>): Promise<void> {
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
    await renderEmblem(
      art,
      build(name, width / height),
      emblemOptions(width, height, subjectInCrop, focus, flags),
    ),
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
