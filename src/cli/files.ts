/**
 * Rutas, copia con backup y el mapa de archivos que instala la CLI.
 *
 * Separado de `install.ts` para que ese archivo hable solo del flujo
 * (dependencias, binario, verificación) y este de dónde va cada cosa.
 */

import { copyFileSync, existsSync, renameSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { ok } from "./output";

export interface Paths {
  dir: string;
  bin: string;
  script: string;
  shapes: string;
  fish: string;
}

export interface Target {
  name: string;
  dest: string;
  src: string;
  /** code: se actualiza con backup. config: es del usuario, no se pisa. */
  kind: "code" | "config";
}

const CONFIGS = [
  ["config", "fastfetch-config.jsonc"],
  ["config-min", "fastfetch-config-min.jsonc"],
  ["config-micro", "fastfetch-config-micro.jsonc"],
] as const;

export function configRoot(): string {
  return process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
}

export function paths(): Paths {
  const dir = join(configRoot(), "fastfetch");
  return {
    dir,
    bin: join(dir, "kitty-shapes"),
    script: join(dir, "b3l0wz3r0-fastfetch"),
    shapes: join(dir, "emblem-shapes.txt"),
    fish: join(configRoot(), "fish", "config.fish"),
  };
}

export function stamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/**
 * Directorio que tiene `examples/`: el repo clonado o el bundle
 * descomprimido. Se busca en --from, el cwd y al lado del ejecutable.
 */
export function sourceDir(flags: Map<string, string>): string | null {
  const candidates = [flags.get("from"), process.cwd(), resolve(process.execPath, "..")].filter(
    (item): item is string => Boolean(item && item !== "true"),
  );
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "examples"))) return resolve(candidate);
  }
  return null;
}

export function sameFile(a: string, b: string): boolean {
  try {
    const sa = statSync(a);
    const sb = statSync(b);
    return sa.size === sb.size && sa.mtimeMs === sb.mtimeMs;
  } catch {
    return false;
  }
}

/** Copia con rename: evita "text file busy" si el destino está corriendo. */
export function installFile(src: string, dest: string): void {
  const tmp = `${dest}.new`;
  copyFileSync(src, tmp);
  // rename es atómico en el mismo filesystem.
  renameSync(tmp, dest);
}

export function backup(path: string, when: string): void {
  copyFileSync(path, `${path}.bak-${when}`);
  ok(`backup: ${path}.bak-${when}`);
}

export function targets(p: Paths, repo: string): Target[] {
  const examples = join(repo, "examples");
  return [
    { name: "script", dest: p.script, src: join(examples, "fastfetch-kitty.sh"), kind: "code" },
    { name: "formas", dest: p.shapes, src: join(examples, "emblem-shapes.txt"), kind: "config" },
    ...CONFIGS.map(([name, file]) => ({
      name,
      dest: join(p.dir, file),
      src: join(examples, file),
      kind: "config" as const,
    })),
  ];
}
