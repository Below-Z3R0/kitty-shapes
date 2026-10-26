/**
 * `bundle`: arma el tar.gz del release. Es del mantenedor, no del usuario.
 *
 * Compila el binario, copia lo que va en el paquete (install.sh, examples,
 * docs) y empaqueta con tar reproducible: orden fijo, mtime fijo y
 * uid/gid 0, así el mismo commit da el mismo tar.
 *
 * No genera checksums: eso está pendiente por decisión del proyecto.
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { bold, dim, fail, ok, step } from "./output";

/** La raíz del repo: package.json + examples/, subiendo desde el entry. */
function repoRoot(): string | null {
  let dir = dirname(Bun.main);
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "package.json")) && existsSync(join(dir, "examples"))) return dir;
    dir = dirname(dir);
  }
  return null;
}

function run(cmd: string[], cwd: string): string {
  const proc = Bun.spawnSync({ cmd, cwd, stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) {
    throw new Error(`${cmd[0]} falló: ${proc.stderr.toString().trim().split("\n").slice(-1)[0]}`);
  }
  return proc.stdout.toString().trim();
}

export async function cmdBundle(flags: Map<string, string>): Promise<number> {
  console.log(`\n${bold("kitty-shapes · bundle")}\n`);

  const root = repoRoot();
  if (!root) {
    fail("no encuentro la raíz del repo (bundle se corre desde el código, no desde el binario)");
    return 1;
  }
  ok(`repo: ${root}`);

  const outFlag = flags.get("out");
  const dist = resolve(outFlag && outFlag !== "true" ? outFlag : join(root, "dist"));
  const stage = join(dist, "kitty-shapes");
  const binary = join(dist, "kitty-shapes-linux-x64");

  try {
    rmSync(dist, { recursive: true, force: true });
    mkdirSync(stage, { recursive: true });

    step("Compilando el binario");
    run(
      [process.execPath, "build", join(root, "src/cli/index.ts"), "--compile", "--outfile", binary],
      root,
    );
    ok(`binario: ${binary}`);

    step("Copiando el paquete");
    for (const file of ["kitty-shapes", "install.sh", "README.md", "LICENSE"]) {
      const src = file === "kitty-shapes" ? binary : join(root, file);
      Bun.spawnSync({ cmd: ["cp", "-a", src, join(stage, file)] });
      ok(file);
    }
    for (const dir of ["examples", "docs"]) {
      run(["cp", "-a", join(root, dir), stage], root);
      ok(`${dir}/`);
    }
    // El binario tiene que ir con +x; cp lo conserva, pero no está de más.
    run(["chmod", "755", join(stage, "kitty-shapes")], root);

    step("Empaquetando (reproducible)");
    const tar = join(dist, "kitty-shapes.tar.gz");
    run(
      [
        "tar",
        "--sort=name",
        "--mtime=@1730000000",
        "--owner=0",
        "--group=0",
        "--numeric-owner",
        "-czf",
        tar,
        "-C",
        dist,
        "kitty-shapes",
      ],
      root,
    );

    const size = Bun.file(tar).size;
    ok(`tar: ${tar} (${Math.round(size / 1048576)} MB)`);
    console.log(`\n${bold("Listo.")} Subí los dos assets al release.`);
    console.log(`  ${dim(tar)}`);
    console.log(`  ${dim(binary)}\n`);
    return 0;
  } catch (error) {
    fail((error as Error).message);
    return 1;
  }
}
