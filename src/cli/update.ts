/**
 * `update`: baja el último release y se reemplaza a sí mismo.
 *
 * Solo aplica cuando el binario se instaló desde un release. Si es
 * propiedad de un paquete (Etapa 2, repo pacman), el update es
 * `b3l0w update` y este comando lo dice en vez de pelear con pacman.
 */

import { chmodSync, copyFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import pkg from "../../package.json";
import { ok, step, warn } from "./output";

const REPO = "Below-Z3R0/kitty-shapes";
const ASSET = "kitty-shapes-linux-x64";

export const UPDATE_URL = `https://github.com/${REPO}/releases/latest/download/${ASSET}`;

/** Quién es dueño del binario según pacman, o null si no es de un paquete. */
function packageOwner(bin: string): string | null {
  const proc = Bun.spawnSync({ cmd: ["pacman", "-Qo", bin], stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) return null;
  const line = proc.stdout.toString().trim();
  const match = line.match(/ is owned by (\S+) /);
  return match?.[1] ?? null;
}

/** La versión de este binario: package.json es la fuente única. */
function currentVersion(): string {
  return `v${pkg.version}`;
}

/**
 * Descarga el asset a un temporal y devuelve su ruta.
 *
 * El `?cb=` evita la caché del CDN de GitHub: justo después de publicar,
 * /releases/latest/download sigue sirviendo el binario anterior.
 */
function download(): string {
  const out = join(tmpdir(), `kitty-shapes-${Date.now()}`);
  const url = `${UPDATE_URL}?cb=${Math.floor(Date.now() / 1000)}`;
  const proc = Bun.spawnSync({
    cmd: ["curl", "-fsSL", url, "-o", out],
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) {
    throw new Error(`no se pudo bajar el release: ${proc.stderr.toString().trim().split("\n").slice(-1)[0]}`);
  }
  chmodSync(out, 0o755);
  return out;
}

export function cmdUpdate(): number {
  step("Actualizando kitty-shapes");

  // Corriendo con `bun run` no hay binario instalado que reemplazar.
  if (basename(process.execPath) === "bun") {
    warn("estás corriendo desde el repo (bun run): no hay binario que actualizar");
    warn("instalá con: ./install.sh   y después usá: kitty-shapes update");
    return 1;
  }

  const owner = packageOwner(process.execPath);
  if (owner) {
    warn(`el binario es del paquete ${owner}`);
    warn("se actualiza con: b3l0w update");
    return 0;
  }

  const before = currentVersion();
  ok(`versión actual: ${before}`);

  let downloaded = "";
  try {
    downloaded = download();

    const probe = Bun.spawnSync({ cmd: [downloaded, "version"], stdout: "pipe", stderr: "pipe" });
    if (probe.exitCode !== 0) {
      throw new Error("el binario bajado no funciona");
    }
    const after = probe.stdout.toString().trim().replace(/^kitty-shapes /, "");

    if (after === before) {
      ok(`ya está al día (${after})`);
      return 0;
    }

    // Rename y no copy: si el binario está corriendo, copiar encima da
    // "text file busy".
    const tmp = `${process.execPath}.new`;
    copyFileSync(downloaded, tmp);
    chmodSync(tmp, 0o755);
    renameSync(tmp, process.execPath);
    ok(`actualizado: ${before} -> ${after}`);
    return 0;
  } catch (error) {
    warn((error as Error).message);
    return 1;
  } finally {
    if (downloaded) rmSync(downloaded, { force: true });
  }
}
