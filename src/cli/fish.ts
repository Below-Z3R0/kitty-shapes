/**
 * El enganche del greeting en fish.
 *
 * Se agrega un bloque al final de config.fish y se quita entero al
 * desinstalar. Cualquier cambio del archivo del usuario va con backup.
 */

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

/** Marca que identifica el bloque: sirve para no duplicarlo. */
export const FISH_MARK = "kitty-shapes — greeting con emblema";

const BLOCK = `
# ${FISH_MARK} (instalado por kitty-shapes)
function fish_greeting
    if test -x "$HOME/.config/fastfetch/b3l0wz3r0-fastfetch"
        "$HOME/.config/fastfetch/b3l0wz3r0-fastfetch"
    else if command -v fastfetch >/dev/null
        fastfetch --config "$HOME/.config/fastfetch/config.jsonc"
    end
end
set -gx FASTFETCH_RERENDER 1
`;

export function hasHook(path: string): boolean {
  return existsSync(path) && readFileSync(path, "utf8").includes(FISH_MARK);
}

export function addHook(path: string, stamp: string, apply: boolean): "added" | "present" | "missing" {
  if (!existsSync(path)) return "missing";
  if (hasHook(path)) return "present";
  if (apply) {
    copyFileSync(path, `${path}.bak-${stamp}`);
    writeFileSync(path, readFileSync(path, "utf8") + BLOCK);
  }
  return "added";
}

export function removeHook(path: string, stamp: string, apply: boolean): "removed" | "absent" | "missing" {
  if (!existsSync(path)) return "missing";
  if (!hasHook(path)) return "absent";
  if (apply) {
    copyFileSync(path, `${path}.bak-${stamp}`);
    const text = readFileSync(path, "utf8");
    // Del comentario que abre el bloque hasta el export que lo cierra.
    const cleaned = text.replace(
      /\n# kitty-shapes — greeting con emblema.*?\nset -gx FASTFETCH_RERENDER 1\n/s,
      "",
    );
    writeFileSync(path, cleaned);
  }
  return "removed";
}
