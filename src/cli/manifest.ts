/**
 * El manifest que deja `build`: la fuente, el tamaño y la lista de PNG.
 */

export interface Manifest {
  source: string;
  width: number;
  height: number;
  shapes: { name: string; file: string; note: string }[];
}
