/**
 * Argumentos de la línea de órdenes.
 *
 * Todas las órdenes comparten el mismo formato: `--clave valor`,
 * `--clave=valor` y `--flag` (que se guarda como "true").
 */

import { readFile } from "node:fs/promises";
import { BUILDERS } from "../shapes";

export interface Parsed {
  command: string;
  positional: string[];
  flags: Map<string, string>;
}

export function parseArgs(argv: string[]): Parsed {
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

export function flagNumber(flags: Map<string, string>, name: string, fallback: number): number {
  const raw = flags.get(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`--${name} necesita un número`);
  return value;
}

/** Zona del nombre que tiene que existir en BUILDERS. */
export function ensureShapes(items: string[], where = ""): string[] {
  const unknown = items.filter((item) => !(item in BUILDERS));
  if (unknown.length) throw new Error(`formas desconocidas${where}: ${unknown.join(", ")}`);
  return items;
}

export function flagList(flags: Map<string, string>, name: string, fallback: string[]): string[] {
  const raw = flags.get(name);
  if (!raw || raw === "true") return fallback;
  return ensureShapes(raw.split(",").map((item) => item.trim()).filter(Boolean));
}

/** Lee una lista de formas desde un fichero (una por línea, # para comentarios). */
export async function shapesFromFile(path: string): Promise<string[]> {
  const text = await readFile(path, "utf8");
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

export async function flagListAsync(
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
