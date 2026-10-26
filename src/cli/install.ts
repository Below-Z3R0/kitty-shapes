/**
 * `install` / `uninstall`: deja el greeting andando desde cero.
 *
 * La lógica vive acá y no en install.sh: el script queda como bootstrap
 * (baja el release y llama a este comando). Así hay una sola
 * implementación, testeable, y el binario compilado la lleva adentro.
 *
 * Nunca pisa un archivo del usuario sin backup. La configuración
 * (colores, formas) no se toca: es del usuario y la sincroniza Noctalia.
 */

import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { type Paths, backup, installFile, paths, sameFile, sourceDir, stamp, targets } from "./files";
import { addHook, removeHook } from "./fish";
import { bold, dim, fail, ok, step, warn } from "./output";

/** El binario que se instala: este mismo, o uno compilado si corre con bun. */
function prepareBinary(p: Paths, apply: boolean): boolean {
  step("Instalando el binario");

  if (!apply) {
    console.log(`  ${dim(`· copiaría el binario a ${p.bin}`)}`);
    return true;
  }

  try {
    mkdirSync(p.dir, { recursive: true });
    if (resolve(process.execPath) === resolve(p.bin)) {
      ok(`ya está en su lugar: ${p.bin}`);
      return true;
    }

    // En desarrollo se corre con `bun run`: no hay binario que copiar,
    // hay que compilarlo. El compilado sí se copia a sí mismo.
    if (basename(process.execPath) === "bun") {
      const out = `/tmp/kitty-shapes-build-${Date.now()}`;
      // process.execPath es el propio bun: buscarlo en el PATH falla
      // cuando el instalador corre desde un script no-login.
      const built = Bun.spawnSync({
        cmd: [process.execPath, "build", Bun.main, "--compile", "--outfile", out],
        stdout: "pipe",
        stderr: "pipe",
      });
      if (built.exitCode !== 0) {
        fail(`no compiló: ${built.stderr.toString().trim().split("\n").slice(-1)[0]}`);
        return false;
      }
      installFile(out, p.bin);
      rmSync(out, { force: true });
    } else {
      installFile(process.execPath, p.bin);
    }
    chmodSync(p.bin, 0o755);
    ok(`binario: ${p.bin}`);
    return true;
  } catch (error) {
    fail(`no se pudo instalar el binario: ${(error as Error).message}`);
    return false;
  }
}

function installFiles(p: Paths, repo: string, when: string, apply: boolean): boolean {
  step(`Instalando archivos en ${p.dir}`);
  let all = true;
  for (const target of targets(p, repo)) {
    if (!existsSync(target.src)) {
      warn(`falta la fuente: ${target.src}`);
      all = false;
      continue;
    }
    if (!existsSync(target.dest)) {
      if (apply) {
        mkdirSync(dirname(target.dest), { recursive: true });
        copyFileSync(target.src, target.dest);
        ok(`creado: ${target.dest}`);
      } else {
        console.log(`  ${dim(`· crearía ${target.dest}`)}`);
      }
      continue;
    }
    if (sameFile(target.src, target.dest)) {
      ok(`sin cambios: ${target.dest}`);
      continue;
    }
    if (target.kind === "config") {
      // Los colores los sincroniza Noctalia: pisarlos rompe el tema.
      warn(`dejado como está (personalizado): ${target.dest}`);
      warn(`  la versión del repo está en: ${target.src}`);
      continue;
    }
    if (apply) {
      backup(target.dest, when);
      installFile(target.src, target.dest);
      ok(`actualizado: ${target.dest}`);
    } else {
      console.log(`  ${dim(`· actualizaría ${target.dest} (con backup)`)}`);
    }
  }
  if (apply) chmodSync(p.script, 0o755);
  return all;
}

function checkDeps(): boolean {
  step("Comprobando dependencias");
  let all = true;
  for (const dep of ["fastfetch", "kitty"]) {
    const found = Bun.which(dep);
    if (found) ok(`${dep} en ${found}`);
    else {
      warn(`falta ${dep} → sudo pacman -S ${dep}`);
      all = false;
    }
  }
  return all;
}

function verify(p: Paths): boolean {
  step("Verificando");
  const run = Bun.spawnSync({ cmd: [p.bin, "--help"], stdout: "pipe", stderr: "pipe" });
  if (run.exitCode !== 0) {
    fail("el binario instalado no responde --help");
    return false;
  }
  ok("el binario responde --help");

  const syntax = Bun.spawnSync({ cmd: ["bash", "-n", p.script], stdout: "pipe", stderr: "pipe" });
  if (syntax.exitCode !== 0) {
    fail(`el script del greeting tiene errores: ${syntax.stderr.toString().trim()}`);
    return false;
  }
  ok("el script del greeting es bash válido");
  return true;
}

export function cmdInstall(flags: Map<string, string>): number {
  const p = paths();
  const dryRun = flags.get("dry-run") === "true";
  const noFish = flags.get("no-fish") === "true";
  const apply = !dryRun;

  if (flags.get("uninstall") === "true") return uninstall(p, flags, apply);

  console.log(`\n${bold("kitty-shapes · instalador")}\n`);

  const repo = sourceDir(flags);
  if (!repo) {
    fail("no encuentro examples/ (usá --from <directorio del repo o bundle>)");
    return 1;
  }
  ok(`fuente: ${repo}`);

  checkDeps();
  if (!prepareBinary(p, apply)) return 1;
  installFiles(p, repo, stamp(), apply);

  if (noFish) {
    step("Enganche de fish");
    ok("omitido (--no-fish)");
  } else {
    step("Enganchando el greeting en fish");
    const result = addHook(p.fish, stamp(), apply);
    if (result === "missing") warn(`no existe ${p.fish}; se omite el enganche`);
    else if (result === "present") ok(`ya enganchado en ${p.fish}`);
    else if (apply) ok(`enganchado en ${p.fish}`);
    else console.log(`  ${dim(`· añadiría fish_greeting a ${p.fish}`)}`);
  }

  if (!apply) {
    console.log(`\n${bold("Simulación terminada.")} No se cambió nada.`);
    console.log(`  ${dim("· para aplicarlo de verdad: kitty-shapes install")}\n`);
    return 0;
  }

  if (!verify(p)) return 1;

  console.log(`\n${bold("Instalado.")}`);
  console.log(`  ${dim(`· probá el greeting con: ${p.script}`)}`);
  console.log(`  ${dim("· o abrí una terminal nueva")}`);
  console.log(`  ${dim("· para desinstalar: kitty-shapes install --uninstall")}\n`);
  return 0;
}

function uninstall(p: Paths, flags: Map<string, string>, apply: boolean): number {
  const noFish = flags.get("no-fish") === "true";
  console.log(`\n${bold("Desinstalando kitty-shapes")}\n`);

  for (const path of [p.bin, p.script]) {
    if (!existsSync(path)) continue;
    if (apply) {
      rmSync(path, { force: true });
      ok(`borrado: ${path}`);
    } else {
      console.log(`  ${dim(`· borraría ${path}`)}`);
    }
  }

  for (const target of targets(p, "/nonexistent")) {
    if (target.kind === "config" && existsSync(target.dest)) {
      if (apply) ok(`se deja: ${target.dest} (es configuración tuya)`);
      else console.log(`  ${dim(`· dejaría ${target.dest} (es tuya)`)}`);
    }
  }

  if (!noFish) {
    const result = removeHook(p.fish, stamp(), apply);
    if (result === "removed" && apply) ok(`enganche de fish quitado (backup en ${p.fish}.bak-*)`);
    else if (result === "removed") console.log(`  ${dim("· quitaría el enganche de fish")}`);
    else if (result === "absent") ok("fish no tenía el enganche");
    else warn(`no existe ${p.fish}; nada que quitar`);
  }

  console.log(`\n${bold("Listo.")} Los backups quedan como *.bak-*.\n`);
  return 0;
}
