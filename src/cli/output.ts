/**
 * Salida de la CLI: el mismo formato en todos los comandos.
 *
 * Los colores solo se emiten si stdout es una terminal y NO_COLOR no
 * está definido, para que un pipe o un log no se llene de escapes.
 */

const color = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

export function paint(code: string, text: string): string {
  return color ? `\x1b[${code}m${text}\x1b[0m` : text;
}

export const bold = (text: string): string => paint("1", text);
export const dim = (text: string): string => paint("2", text);

/** Encabezado de un paso. */
export function step(text: string): void {
  console.log(`${bold("▸")} ${text}`);
}

export function ok(text: string): void {
  console.log(`  ${paint("32", "✓")} ${text}`);
}

export function warn(text: string): void {
  console.log(`  ${paint("33", "!")} ${text}`);
}

export function fail(text: string): void {
  console.error(`  ${paint("31", "✗")} ${text}`);
}
