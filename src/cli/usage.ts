/** El texto de `--help`. */

export const USAGE = `uso: kitty-shapes <build|pick|list|doctor|install|update|version> [opciones]

  build <imagen>          un PNG por forma + manifest.json
  pick  <imagen>          un emblema por stdout (para icat)
  pick  <manifest.json>   elige un PNG ya generado (instantáneo)
  list                    lista las formas disponibles
  doctor                  chequea el entorno (canvas, kitty, fastfetch, config)
  version                 imprime kitty-shapes vX.Y.Z
  install                 instala binario, configs y el greeting en fish
  install --dry-run       muestra qué haría, sin tocar nada
  install --uninstall     revierte lo instalado (deja tu configuración)
  update                  baja el último release y se reemplaza

Salida de pick
  --path                  imprime la ruta del PNG
  --out <ruta|dir>        con build, la carpeta; con pick, el fichero
  --escape                emite la secuencia del protocolo gráfico de kitty

Forma
  --shape <nombre|random> una forma concreta (default: random)
  --shapes a,b,c          formas para build
  --shapes-file <ruta>    una por línea (# comenta)
  --list                  lista las formas y sale

Lienzo
  --size <n|source>       lado largo en px (default: min(original, 1100))
  --width <n>             ancho exacto (ignora --size)
  --aspect <n|a/b>        fuerza el aspecto (0.6, 16/9)
  --square                aspecto 1:1
  --inset <0..0.2>        margen de la forma (default 0.02)

Arte
  --focus <x,y>           punto focal 0..1 (default: centro del sujeto)
  --protect               encoge el arte para no cortar el sujeto
  --palette <n>           colores de la paleta (0 = sin cuantizar, default 0)
`;
