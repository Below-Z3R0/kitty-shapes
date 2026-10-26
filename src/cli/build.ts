/**
 * `build <imagen>`: un PNG por forma + manifest.json.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { renderEmblem } from "../render";
import { build, DEFAULT_SHAPES, NOTES } from "../shapes";
import { flagListAsync, flagNumber } from "./args";
import { type Manifest } from "./manifest";
import { applyPalette } from "./palette";
import { emblemOptions, prepare } from "./prepare";

export async function buildCommand(positional: string[], flags: Map<string, string>): Promise<void> {
  const source = positional[0];
  if (!source) throw new Error("falta la imagen: build <imagen>");
  const sourcePath = resolve(source);

  const { canvas, boxes, art, width, height, subjectInCrop, focus } = await prepare(sourcePath, flags);

  const outDir = resolve(
    flags.get("out") ?? join(dirname(sourcePath), `${basename(sourcePath, ".png")}-shapes`),
  );
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
