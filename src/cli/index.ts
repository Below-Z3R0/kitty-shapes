#!/usr/bin/env bun
/**
 * kitty-shapes: emblemas con formas de Material 3 a partir de cualquier imagen.
 *
 *   kitty-shapes build osito.png              -> 8 PNG + manifest.json
 *   kitty-shapes pick  osito.png | kitty +kitten icat
 *   kitty-shapes pick  salida/manifest.json | kitty +kitten icat
 *
 * El tamaño de salida se adapta al de la imagen: se conserva el aspecto,
 * así que las formas nunca se deforman.
 */

import { BUILDERS, NOTES } from "../shapes";
import { parseArgs } from "./args";
import { buildCommand } from "./build";
import { cmdDoctor } from "./doctor";
import { pickCommand } from "./pick";
import { USAGE } from "./usage";
import { cmdVersion } from "./version";

async function main(): Promise<void> {
  const { command, positional, flags } = parseArgs(process.argv.slice(2));

  if (flags.get("help") === "true" || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(USAGE);
    return;
  }

  if (command === "version" || command === "--version" || command === "-V") {
    cmdVersion();
    return;
  }

  if (flags.get("list") === "true" || command === "list") {
    for (const name of Object.keys(BUILDERS).sort()) {
      console.log(`${name.padEnd(12)} ${NOTES[name] ?? ""}`);
    }
    return;
  }

  switch (command) {
    case "build":
      await buildCommand(positional, flags);
      return;
    case "pick":
      await pickCommand(positional, flags);
      return;
    case "doctor":
      process.exitCode = await cmdDoctor();
      return;
    default:
      process.stderr.write(USAGE);
      process.exitCode = 1;
  }
}

// Si el consumidor cierra el pipe (p. ej. `| head`), no es un error real.
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});

main().catch((error) => {
  console.error(`error: ${(error as Error).message}`);
  process.exitCode = 1;
});
