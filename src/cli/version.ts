/**
 * `version`: una línea parseable, `kitty-shapes vX.Y.Z`.
 *
 * La versión sale de package.json: es la única fuente, y el bundle la
 * embebe al compilar. Si estuviera escrita acá, el binario podría decir
 * una versión y el tag otra.
 */

import pkg from "../../package.json";

export function cmdVersion(): void {
  console.log(`kitty-shapes v${pkg.version}`);
}
