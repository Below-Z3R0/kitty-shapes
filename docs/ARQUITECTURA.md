# Arquitectura

Mapa completo del repositorio y del script de integración con fastfetch:
**qué hace cada archivo, cada función y en qué orden corre todo**.

> Este documento es el "dónde está cada cosa". Para el recorrido paso a paso
> del arranque y del re-render, ver [`FLUJO.md`](FLUJO.md). Para los números,
> [`RENDIMIENTO.md`](RENDIMIENTO.md). Para los errores que se corrigieron y por
> qué, [`BUGS.md`](BUGS.md).

---

## 1. Árbol del repositorio

```
kitty-shapes/
├── README.md                    # qué es, instalación, uso, opciones, fidelidad a Material
├── package.json                 # bin: kitty-shapes → src/cli.ts · scripts build/pick/test/typecheck
├── tsconfig.json                # TypeScript estricto; incluye src/ y tests/
├── bun.lock                     # lockfile (lockfileVersion 2 → exige bun ≥ 1.4)
├── install.sh                   # instalador: deps, binario, configs y enganche de fish
│
├── src/
│   ├── geometry.ts              # matemática pura: polígonos, estrellas, arcos, encaje
│   ├── shapes.ts                # recetas de Material 3 (qué forma es cada nombre)
│   ├── detect.ts                # detecta la lámina y el sujeto de la imagen
│   ├── render.ts                # dibuja el arte y lo recorta contra la forma
│   ├── quantize.ts              # reduce la paleta del PNG (peso)
│   └── cli.ts                   # la línea de órdenes: build / pick / list
│
├── tests/
│   ├── geometry.test.ts         # vértices, arcos, encaje y máscara
│   ├── detect.test.ts           # lámina/sujeto (incluye PNG con alfa)
│   └── quantize.test.ts         # paleta, color medio por bucket y alfa
│
├── examples/
│   ├── fastfetch-kitty.sh       # EL SCRIPT de fastfetch (copia canónica, 462 líneas)
│   ├── fastfetch-config.jsonc   # config de fastfetch lista para copiar
│   ├── fastfetch-config-min.jsonc   # versión corta (ventanas medianas)
│   ├── fastfetch-config-micro.jsonc  # versión mínima (ventanas chicas)
│   ├── emblem-shapes.txt        # las formas que pueden salir
│   └── noctalia-avatar-check.sh # diagnóstico del avatar de Noctalia
│
├── docs/
│   ├── ARQUITECTURA.md          # este documento
│   ├── FLUJO.md                 # los flujos: arranque, render, re-render, cache, watcher
│   ├── RENDIMIENTO.md           # medidas, metodología y qué se optimizó
│   ├── BUGS.md                  # registro de errores encontrados y su causa raíz
│   ├── PRUEBAS.md               # cómo se prueba todo esto (arnés pty, fuzz, carrera)
│   └── NOCTALIA.md              # conectar el avatar con Noctalia y con SDDM
│
└── demo/
    ├── bear-demo.png            # el oso original
    ├── masks.png                # las 8 máscaras
    ├── aspectos.png             # el mismo arte con distintos aspectos
    └── compare-geometry.png     # comparación de la geometría
```

---

## 2. El pipeline de kitty-shapes

Quién llama a quién dentro de `src/`:

```
cli.ts  (build | pick)
  │
  ├─ loadImage()            @napi-rs/canvas → Canvas con el arte
  │
  ├─ detect.ts ──────────── detectBoxes(canvas)
  │      └─ devuelve { content, subject }  ← cajas en píxeles
  │
  ├─ resolveSize()          (en cli.ts) tamaño y aspecto del lienzo
  │
  ├─ shapes.ts ──────────── build(nombre, aspecto)
  │      └─ usa geometry.ts ── regularPolygon / star / rectangle / fillet
  │      └─ devuelve un Outline (vértices + radio de arco por vértice)
  │
  ├─ render.ts ──────────── renderEmblem(arte, outline, opciones)
  │      ├─ shapePath()     outline → path en píxeles (fitToBox, uniforme)
  │      ├─ placeArt()      escala/coloca el arte para cubrir la forma
  │      └─ destination-in  arte ∩ forma
  │
  ├─ quantize.ts ────────── applyPalette(png, colores)
  │
  └─ salida: PNG por stdout · --path (archivo) · --escape (protocolo kitty)
```

### `src/geometry.ts` — 186 líneas, cero dependencias

| Export | Qué hace |
|---|---|
| `Point` | tipo `readonly [number, number]` |
| `Outline` | nombre + polígono + radios de redondeo por vértice |
| `regularPolygon(n, radius, rotation?)` | polígono regular |
| `star(numVerticesPerRadius, radius, innerRatio, rounding?)` | estrella con semántica **de Material** (vértices por radio, no totales) |
| `rectangle(w, h)` | rectángulo base para las formas rectangulares |
| `fillet(points, radii, samples)` | convierte cada esquina en un **arco tangente** exacto (`t = r/tan(θ/2)`) |
| `fitToBox(points, w, h, inset)` | encaje **uniforme** al lienzo (no deforma) |

Convención: la geometría se construye con **y hacia arriba** (como AndroidX) y
`fitToBox` la invierte al pasar a píxeles. `mod()` existe porque el `%` de
JavaScript devuelve negativos y eso giraba los arcos al revés (bug real, ver
`BUGS.md`).

### `src/shapes.ts` — 108 líneas

- `BUILDERS`: el diccionario nombre → receta (`cookie12`, `hexagon`, `arch`,
  `semiCircle`, `sunny`, `gem`, `pentagon`, `octagon`, `cookie4/6/7/9`…).
- `DEFAULT_SHAPES`: las 8 que se usan si no hay `--shapes-file`.
- `NOTES`: notas de fidelidad por forma.
- `build(nombre, aspecto)`: valida el nombre y devuelve el `Outline`.

Unidades Material (radio 100): `round 50` = mitad del radio, igual que las
definiciones de Material.

### `src/detect.ts` — 114 líneas

`detectBoxes(canvas, threshold = 20)` devuelve:

- `content`: la lámina completa con el dibujo.
- `subject`: la caja del sujeto (oso + globo) **sin la línea de suelo**.

Cómo: saca el color de fondo de la **mediana de las esquinas opacas** (albura
por defecto si todas son transparentes), calcula la "tinta" (todo lo que se aleja
más que el umbral) y detecta la línea de suelo porque **toca el borde izquierdo**.
Los píxeles con alfa < 128 son fondo por definición (bug 35).

### `src/render.ts` — 233 líneas

| Export | Qué hace |
|---|---|
| `EmblemOptions` | tamaño, `inset`, `focus`, `subject`, `protect` |
| `Placement` | dónde y a qué escala quedó el arte |
| `shapePath(outline, w, h, inset)` | el path de la forma en píxeles |
| `placeArt(...)` | escala el arte para **cubrir** la forma y lo coloca según el foco; con `protect` recoloca/encoge hasta que el sujeto entre entero |
| `renderEmblem(arte, outline, opciones)` | dibuja el arte y aplica `destination-in` (arte ∩ forma) → PNG |

Todo con Canvas2D de Skia: antialiasing de 1 px en el borde de la silueta.

Skia se carga **bajo demanda** (`loadCanvas()`): el import estático costaba
~74 ms en cada comando, incluso en los que no dibujan. `renderEmblem()` es
`async` por eso.

### `src/quantize.ts` — 108 líneas

`quantize(imageData, maxColors = 256)`: histograma de 5 bits por canal; cada
bucket acumula la **suma de sus canales** y su color es la **media real** (no el
borde inferior, que oscurecía). El PNG sigue siendo RGBA (el **alfa se respeta**),
pero comprime como si fuera de paleta: ~55-77 KB por emblema de 288×384.

`maxColors = 0` (o negativo) devuelve la imagen sin tocar.

### `src/cli.ts` — 423 líneas

Tres subcomandos:

- `build <imagen>` → un PNG por forma + `manifest.json`.
- `pick <imagen|manifest>` → un emblema (al azar o `--shape`).
- `list` → las formas disponibles con su nota.

`--help` (o `-h`, o `help`) imprime el uso completo y sale con **0**; sin
argumentos muestra lo mismo por stderr con código **1**.

Y `kittyEscape(png, chunk = 4096)`: arma la secuencia del protocolo gráfico de
Kitty (`a=T`, `f=100`, chunks con `m=1`).

Opciones: `--out`, `--size`, `--width`, `--aspect`, `--square`, `--shapes`,
`--shapes-file`, `--shape`, `--inset`, `--focus`, `--protect`, `--palette`
(`0` = sin cuantizar), `--path`, `--escape`, `--list`, `--help`. El detalle, en
`README.md`.

### `tests/*.test.ts` — 17 tests

`bun test` (17). Cubre:

- **geometría**: vértices de la estrella, alternancia de radios, polígono
  regular, arco tangente, vértice cóncavo, encaje uniforme, `arch` ≠
  `semiCircle`, formas con aspecto, `cookie12` = 12 vértices / 6 puntas.
- **render**: tamaño pedido y máscara **sin agujeros**.
- **detección**: caja con fondo opaco y con fondo **transparente** (bug 35).
- **cuantización**: color medio por bucket, máximo de colores, alfa intacto.

---

## 2.b `install.sh` — el instalador

Un solo comando deja el greeting andando desde cero:

```bash
./install.sh            # instala
./install.sh --dry-run  # muestra qué haría
./install.sh --uninstall
```

**Siete pasos**, en orden: comprobar `bun`/`fastfetch`/`kitty` → `bun install` +
`typecheck` + `test` → compilar el binario → copiar el script del greeting →
copiar las configs y la lista de formas → enganchar `fish_greeting` en fish →
verificar (el binario responde `--help`, el script pasa `bash -n`).

La regla que lo gobierna: **el código se actualiza, la configuración no**.

| Tipo | Archivos | Qué hace el instalador |
|---|---|---|
| `code` | `kitty-shapes`, `b3l0wz3r0-fastfetch` | actualiza siempre, con backup `<archivo>.bak-<fecha>` |
| `config` | `config.jsonc`, `config-min.jsonc`, `config-micro.jsonc`, `emblem-shapes.txt` | crea solo si falta; si existe y difiere, **avisa y no toca nada** |

El motivo: los colores de `config.jsonc` los sincroniza Noctalia, así que
pisarlos sería perder la personalización. El instalador tampoco borra configs al
desinstalar.

Todo lo que hace es idempotente: se puede ejecutar las veces que haga falta.

**Versión de bun**: el instalador avisa si `bun` es anterior a **1.4**. Motivo:
bun 1.4 escribe `bun.lock` con `lockfileVersion: 2` y las versiones anteriores no
lo saben leer — dan `Unknown lockfile version`, ignoran el archivo y lo
reescriben a v1 en cada `bun install`. Con 1.4 el lockfile queda quieto.

## 3. El script del greeting

Vive en `~/.config/fastfetch/b3l0wz3r0-fastfetch` (copiado desde
`examples/fastfetch-kitty.sh`). Es bash puro, 462 líneas, sin dependencias más
allá de `fastfetch`, `kitty-shapes`, `perl` y `sed`.

### 3.1 Las dos entradas

| Modo | Cómo se invoca | Qué hace |
|---|---|---|
| **Normal** | lo llama `fish_greeting` | dibuja el bloque una vez y deja un watcher vivo |
| **Watcher** | `bash "$0" --watch …` (se relanza a sí mismo) | solo redibuja cuando cambia el ancho |

### 3.2 Variables de configuración (líneas 24-39)

| Variable | Default | Para qué |
|---|---|---|
| `config` | `~/.config/fastfetch/config.jsonc` | el dossier de fastfetch |
| `shapes_bin` | `~/.config/fastfetch/kitty-shapes` | el binario compilado |
| `shapes_list` | `~/.config/fastfetch/emblem-shapes.txt` | qué formas pueden salir |
| `fallback_emblem` | `~/.config/fastfetch/emblem/current.png` | último emblema bueno (y `source` del config) |
| `fallback_img` | **= `fallback_emblem`** | respaldo si Noctalia no está |
| `cache_dir` | `$XDG_RUNTIME_DIR/fastfetch-cache` | cache del emblema |
| `cached_emblem` | `$cache_dir/emblem.png` | el PNG cacheado |
| `cached_stamp` | `$cache_dir/stamp` | huella para invalidar el cache |

### 3.3 Las funciones, una por una

| Línea | Función | Responsabilidad |
|---:|---|---|
| 40 | `term_size()` | `TERM_COLS` / `TERM_ROWS` (`stty size` con `tput` de respaldo) |
| 54 | `module_size(cfg)` | ancho y líneas del bloque de texto (se cachea) |
| 65 | `img_rows(w)` | filas que ocupa una imagen de `w` celdas (~0,8 por columna) |
| 69 | `fit_with(c, r, tw, tl)` | ¿entra la imagen al lado o arriba? → `side:N` / `stack:N` |
| 91 | `decide_layout(c, r)` | cascada **full → min → micro**, imagen al lado o arriba |
| 126 | `apply_layout(c)` | traduce la decisión a `logo_args` / `indent` / `skip_draw` |
| 160 | `with_logo(img)` | antepone `--logo` al layout si hay imagen y entra |
| 172 | `draw()` | ejecuta fastfetch y lo filtra con `perl` (CUP → columna, indent) |
| 192 | `render()` | `ESC[2J` si es re-render, `ESC[1;1H` y dibuja |
| 203 | `next_shape()` | rotación de formas con índice persistente (`shape-idx`) |
| 217 | `crop_emblem(dest)` | recorta el avatar con `SHAPE` (~140 ms) |
| 226 | `publish_emblem(src)` | publica PNG y **después** el stamp (atómico) |
| 237 | `sweep_stale()` | borra emblemas y locks de procesos muertos |
| 251 | `avatar_path()` | primer `avatar_path = "..."` de un settings.toml |
| 256 | `pick_avatar()` | deja `source_img` (state ~1 ms, `config export` de respaldo) |
| 268 | `resolve_emblem()` | orquesta: barrido → avatar → caché → corte → `logo_file` |
| 310 | `prefetch_emblem()` | prepara la forma de la próxima terminal (lock) |

> El watcher no tiene funciones propias: reusa `decide_layout` / `apply_layout` /
> `render` y se apaga solo cuando termina la ventana de gracia.

### 3.4 Orden de ejecución (modo normal)

```
 1. set -uo pipefail
 2. rutas y defaults (grace, logo_gap, logo_min…)
 3. ¿es kitty?                          → is_kitty = 0 | 1
 4. term_size                           → TERM_COLS / TERM_ROWS
 5. logo_full = primera "width" del config
 6. medidas de los tres configs:
      ├─ ¿caché válido? (huella mtime+tamaño) → leer `sizes`
      └─ si no: 3 fastfetch en paralelo → `sizes` y se cachea
 7. resolve_emblem:
      a. sweep_stale (emblemas y locks de PIDs muertos)
      b. pick_avatar (settings.toml → config export → fallback)
      c. shape_args + stamp_now
      d. caché válido → cp · si no → crop_emblem + publish_emblem
      e. copia estable para el config + logo_file
 8. si falta el config → exec fastfetch "$@"
 9. decide_layout · apply_layout · with_logo
10. render "$@"                         ← ESC[1;1H + draw (primer dibujo)
11. lock por tty: matar el watcher viejo, anotar el PID
12. lanzar el watcher desacoplado
13. si usó caché → prefetch_emblem en background
14. exit 0
```

### 3.5 Modo watcher (`--watch`)

Argumentos posicionales: `cols sizes logo_full emblem lock grace`, donde `sizes`
es `58:25:30:8:11:2` (ancho:líneas de full, min y micro).

```
 1. escribe SU pid en el lock
 2. copia el emblema a un archivo con SU propio PID  ← el del padre muere enseguida
 3. suppress_clear = 1
 4. traps: EXIT → liberar lock · TERM/INT/HUP → salir limpio
 5. loop (ticks = grace × 10/8, uno cada 0.8 s):
      ├─ abrir /dev/tty de verdad (si falla → salir)
      ├─ term_size(): si el ancho no cambió → continue
      ├─ debounce: esperar hasta 10 × 0.15 s a que el ancho se estabilice
      │  (en Dwindle el resize llega en ráfaga)
      ├─ decide_layout · apply_layout · with_logo
      ├─ si no entra nada (lmode = none) → continue  ← no deja la pantalla en blanco
      └─ render: ESC[2J + ESC[1;1H + draw
```

El `2J` borra la pantalla **visible** (y las imágenes); el scrollback queda. Por
eso el watcher vive solo `grace` segundos: pasado ese plazo no vuelve a tocar
nada de lo que hayas escrito.

### 3.6 Qué hace cada archivo en runtime

| Archivo | Quién lo escribe | Para qué |
|---|---|---|
| `$XDG_RUNTIME_DIR/fastfetch-emblem-<pid>.png` | el script (una por terminal) | el emblema de esa terminal. El watcher lo **renombra** al suyo y lo **borra** al salir |
| `$XDG_RUNTIME_DIR/fastfetch-cache/emblem.png` | la primera terminal / el prefetch | reutilizar sin recortar (140 ms → 1 ms) |
| `$XDG_RUNTIME_DIR/fastfetch-cache/stamp` | idem | huella para invalidar el cache |
| `$XDG_RUNTIME_DIR/fastfetch-cache/sizes` | la primera terminal | medidas de los 3 configs + ancho del logo (7 campos) |
| `$XDG_RUNTIME_DIR/fastfetch-cache/shape-idx` | el prefetch | índice de la rotación de formas (nunca repite) |
| `$XDG_RUNTIME_DIR/fastfetch-watch-<tty>` | el watcher | un solo watcher por terminal |
| `~/.config/fastfetch/emblem/current.png` | el script (atómico) | `source` del config y respaldo |
| `~/.config/noctalia/config.toml` | Noctalia | config de usuario (`avatar_path` suele estar vacío) |
| `~/.local/state/noctalia/settings.toml` | la GUI de Noctalia | **el `avatar_path` real** |

---

## 4. Las configs de fastfetch

Tres configs, de más a menos contenido:

| Config | Contenido | Ancho × líneas |
|---|---|---|
| `config.jsonc` | completo (VITALS, SYSTEM, SESSION, colores) | 58 × 25 |
| `config-min.jsonc` | OS, KERNEL, MEM, WM, TERM | 31 × 7 |
| `config-micro.jsonc` | ■ usuario + OS | 11 × 2 |

El script mide los tres y elige el más grande que entre, con imagen al lado o
arriba. Lo único que necesita del config:

| Clave | Valor | Por qué |
|---|---|---|
| `logo.type` | `kitty-direct` | transmite el PNG por el protocolo de Kitty |
| `logo.source` | `~/.config/fastfetch/emblem/current.png` | respaldo si no se pasa `--logo` |
| `logo.width` | `40` | el script lo lee para calcular el layout |
| `logo.padding.right` | `0` | **se ignora** cuando se pasa `--logo` por CLI |
| `display.key.width` | `0` | con `1` los valores se dibujaban en la columna 1 y **borraban las keys** |
| `display.separator` | `"  "` | dos espacios entre key y valor |

El script **pisa por CLI** `--logo`, `--logo-type`, `--logo-width`,
`--logo-position`, `--logo-padding-left` y `--logo-padding-right`, porque al
pasar `--logo` fastfetch reemplaza el bloque `logo` completo del config (incluido
su `padding`).

---

## 5. Glosario

| Término | Significado |
|---|---|
| **bloque** | el conjunto imagen + dossier |
| **lado** | layout imagen a la izquierda, texto a la derecha |
| **apilado** | imagen arriba, texto abajo (terminales angostas) |
| **`logo_args`** | array de flags que recibe fastfetch para el logo |
| **`indent`** | columnas que se corre el texto en modo apilado |
| **`text_w`** | ancho de la línea más larga del dossier (medido, no hardcodeado) |
| **CHA** | `ESC[<n>G`, posicionamiento **absoluto** de columna |
| **CUP** | `ESC[<fila>;<col>H`, posicionamiento absoluto de fila y columna |
| **DSR** | `ESC[6n`, fastfetch pregunta dónde está el cursor (lo consume él) |
| **stamp** | huella que decide si el cache del emblema sigue válido |
