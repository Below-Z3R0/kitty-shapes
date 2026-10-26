/**
 * `doctor`: chequea que el entorno pueda hacer su trabajo.
 *
 * Cada chequeo dice qué falta y cómo se arregla. Sale con código 1 solo
 * cuando el problema impide renderizar; las ausencias opcionales (kitty,
 * fastfetch, el binario instalado) son avisos.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface Check {
  ok: boolean;
  warn: boolean;
  label: string;
}

/** Corre un comando y devuelve su primera línea, o null si falla. */
function run(cmd: string[]): string | null {
  const proc = Bun.spawnSync({ cmd, stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) return null;
  return proc.stdout.toString().trim().split("\n")[0] ?? null;
}

function configDir(): string {
  return process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
}

export async function cmdDoctor(): Promise<number> {
  const checks: Check[] = [];

  // Bun: es el runtime; sin esto no hay nada.
  checks.push({
    ok: true,
    warn: false,
    label: `bun ${Bun.version}`,
  });

  // Skia: es el único que puede impedir renderizar.
  const started = performance.now();
  try {
    await import("@napi-rs/canvas");
    const ms = Math.round(performance.now() - started);
    checks.push({ ok: true, warn: false, label: `canvas (Skia) carga en ${ms} ms` });
  } catch (error) {
    checks.push({
      ok: false,
      warn: false,
      label: `canvas no carga: ${(error as Error).message}`,
    });
  }

  // Kitty: solo hace falta para mostrar el emblema.
  const kitty = Bun.which("kitty") ?? run(["kitty", "--version"]);
  checks.push({ ok: Boolean(kitty), warn: true, label: kitty ? `kitty en ${kitty}` : "kitty no está en PATH" });

  const fastfetch = Bun.which("fastfetch") ?? run(["fastfetch", "--version"]);
  checks.push({
    ok: Boolean(fastfetch),
    warn: true,
    label: fastfetch ? `fastfetch en ${fastfetch}` : "fastfetch no está en PATH",
  });

  // Config de fastfetch: la que engancha el greeting.
  const config = join(configDir(), "fastfetch", "config.jsonc");
  checks.push({
    ok: existsSync(config),
    warn: true,
    label: existsSync(config) ? `config de fastfetch en ${config}` : `falta ${config}`,
  });

  // Binario instalado: puede estar en el config dir (install.sh) o en ~/.local/bin.
  const installed = [
    join(configDir(), "fastfetch", "kitty-shapes"),
    join(homedir(), ".local", "bin", "kitty-shapes"),
  ].find((path) => existsSync(path));
  checks.push({
    ok: Boolean(installed),
    warn: true,
    label: installed ? `binario instalado en ${installed}` : "binario no instalado (corré ./install.sh)",
  });

  process.stdout.write("▸ kitty-shapes doctor\n\n");
  for (const check of checks) {
    const mark = check.ok ? "✓" : check.warn ? "!" : "✗";
    process.stdout.write(`  ${mark} ${check.label}\n`);
  }

  const failed = checks.filter((check) => !check.ok && !check.warn).length;
  const warnings = checks.filter((check) => !check.ok && check.warn).length;
  process.stdout.write(
    `\n  ${checks.length - failed - warnings} ok` +
      (warnings ? `, ${warnings} aviso${warnings === 1 ? "" : "s"}` : "") +
      (failed ? `, ${failed} error${failed === 1 ? "" : "es"}` : "") +
      "\n",
  );

  return failed === 0 ? 0 : 1;
}
