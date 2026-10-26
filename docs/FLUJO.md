# El flujo completo

Qué pasa, en orden, desde que abrís la terminal hasta que el oso aparece
pintado, y qué pasa después cuando redimensionás la ventana.

> Hay **seis flujos** distintos y conviene leerlos por separado: arranque en
> frío, arranque en caliente, prefetch, render, re-render y ciclo de vida del
> watcher. Para el mapa de archivos y funciones, ver
> [`ARQUITECTURA.md`](ARQUITECTURA.md).

---

## El mapa: quién es quién

| Pieza | Dónde vive | Qué hace |
|---|---|---|
| **fish** | tu shell | al abrir la terminal lanza `fish_greeting` |
| **tu script** | `~/.config/fastfetch/b3l0wz3r0-fastfetch` | elige logo, layout y deja el watcher |
| **kitty-shapes** | `~/.config/fastfetch/kitty-shapes` | corta el avatar con una forma |
| **Noctalia** | shell de Wayland (C++) | guarda tu avatar |
| **fastfetch** | el sistema | pinta el logo y el dossier |
| **kitty** | la terminal | recibe el PNG por el protocolo gráfico |

```
fish_greeting
   └─ b3l0wz3r0-fastfetch
        ├─ term_size()             → ancho y alto reales
        ├─ sizes (caché o 3 ff)    → medidas de los 3 configs
        ├─ decide_layout()         → texto (full/min/micro) + lado/arriba
        ├─ pick_avatar()           → avatar de Noctalia
        ├─ caché / crop_emblem()   → emblem.png
        ├─ fastfetch               → dibuja el bloque
        └─ watcher (0.8 s)         → redibuja al redimensionar
```

---

## Flujo A — arranque en frío (no hay cache)

Ocurre la primera vez después de cambiar el avatar, o tras limpiar
`$XDG_RUNTIME_DIR/fastfetch-cache`.

```
 1. fish ejecuta el script
 2. ¿KITTY_WINDOW_ID o TERM=xterm-kitty?  → sí ⇒ is_kitty=1
 3. term_size                              (~1 ms)  → TERM_COLS / TERM_ROWS
 4. sizes: ¿caché válido? ⇒ leer : 3 fastfetch en paralelo (~21 ms de CPU)
 5. sweep_stale + pick_avatar               (~2 ms)
 6. emblem = $XDG_RUNTIME_DIR/fastfetch-emblem-$$.png
 7. stamp_now = huella(avatar, formas, 384, 256)
 8. caché vacío o huella distinta ⇒ crop_emblem          (~145 ms)
 9. publish_emblem: primero el PNG, después el stamp (tmp + mv atómico)
10. copia estable a emblem/current.png (tmp + mv)
11. decide_layout · apply_layout · with_logo
12. render "$@"                            (~5 ms)
13. lanza el watcher
14. NO lanza prefetch (esta corrida ya generó un emblema nuevo)
```

**Total medido: ~177 ms** (de los cuales ~90 ms son importar el binding de canvas).

---

## Flujo B — arranque en caliente (cache válido)

El caso normal: abrís una terminal y el cache ya tiene un emblema con la misma
huella.

```
 1-4. igual que el flujo A (las medidas salen del caché: 0 fastfetch)
 5. pick_avatar + stamp_now                            (~2 ms)
 6. emblem = $XDG_RUNTIME_DIR/fastfetch-emblem-$$.png
 7. stamp del caché == stamp_now ⇒ cp caché → emblem   (~1 ms)
 8. decide_layout · apply_layout · with_logo
 9. render "$@"                                        (~5 ms)
10. lanza el watcher
11. lanza prefetch_emblem() en background              (~145 ms, fuera del camino)
```

**Total medido: 17-20 ms.** El corte se movió al fondo.

---

## Flujo C — prefetch (la forma de la próxima terminal)

Para no perder la variedad (cada terminal con una forma distinta) sin pagar los
140 ms en el arranque:

```
terminal N abre
  ├─ usa el emblema del cache          (rápido)
  └─ lanza en background:
        prefetch_emblem()
          ├─ si el cache se regeneró hace <0,3 s → se sale (ráfaga)
          ├─ lock por mkdir ($cache_dir/.lock)   ← si otra terminal ya está cortando, se sale
          ├─ next_shape: avanza `shape-idx` (tmp + mv)
          ├─ kitty-shapes pick --shape <esa forma>
          ├─ mv del PNG al cache (atómico)
          └─ escribe el stamp DESPUÉS del PNG
terminal N+1 abre
  └─ encuentra el cache nuevo ⇒ otra forma distinta
```

Detalles que importan:

- **El lock es un directorio** (`mkdir` es atómico). Si el proceso muere, el lock
  queda; el siguiente prefetch lo libera si tiene más de **1 minuto**.
- **El stamp se escribe después del PNG**: si el proceso muere en el medio, la
  próxima terminal ve la huella vieja y regenera (nunca sirve un PNG viejo con
  huella nueva).
- **Siempre se prefetchea**, también la primera vez. Si la terminal que genera su
  propio emblema no preparara el siguiente, la 2.ª heredaría exactamente la forma
  de la 1.ª y se verían iguales.
- **La forma no es al azar**: `shape-idx` guarda el índice y `next_shape()` lo
  avanza, así cada terminal muestra una forma distinta a la anterior (`--shape
  random` sigue existiendo para pedir azar puro).

---

## Flujo D — el layout: qué texto y dónde va la imagen

`decide_layout(c, r)` prueba los tres textos de mayor a menor y, para cada uno,
intenta la imagen **al lado** y **arriba**:

```
completo (58×25) → compacto (30×8) → micro (11×2)
```

El primero que entra gana. Si ningún texto deja entrar la imagen, usa el más
grande que entre **sin** imagen; si tampoco, `none` (no dibuja nada y no toca la
pantalla).

`fit_with(c, r, tw, tl)` hace las dos cuentas, con `logo_min = 4`:

```
lado:   logo = min(c - tw - logo_gap, logo_full)           ; r >= img_rows(logo)
arriba: logo = min((r - tl - 1) * 10 / 8, logo_full, c-2)  ; r >= tl + img_rows(logo)
```

`img_rows(w) = (w * 8 + 9) / 10 + 1`: la celda es más alta que ancha, así que una
imagen de `w` columnas ocupa ~0,8 × w filas.

### Geometría del modo lado

```
avail = c - text_w - logo_gap          (entre logo_min y logo_full)
block = avail + logo_gap + text_w
pad   = (c - block) / 2

--logo-width avail
--logo-padding-left pad
--logo-padding-right logo_gap
```

Ejemplos medidos (con `text_w = 58`, `logo_gap = 4`):

| cols | avail | pad | resultado |
|---:|---:|---:|---|
| 240 | 40 | 71 | logo 40 |
| 120 | 40 | 11 | logo 40 |
| 110 | 40 | 6 | logo 40 |
| 96 | 34 | 0 | logo 34 |
| 74 | 12 | 0 | logo 12 |

### Geometría del modo apilado

```
w      = min(c - 2, logo_full)
bw     = max(w, text_w)                ← el bloque lo define el más ancho
indent = (c - bw) / 2
lado   = indent + (bw - w) / 2         ← centra el logo DENTRO del bloque

--logo-position top
--logo-padding-bottom 1
--logo-padding-left lado
--logo-width w
```

`indent` se aplica al texto en `draw()` porque `--logo-padding-left` **solo
mueve la imagen** (emite espacios antes del escape gráfico) y el texto queda en
la columna 1.

### Por qué no se puede usar `--logo-padding-left` para todo

El protocolo de kitty dibuja la imagen con **posicionamiento absoluto**
(`a=T`: el cursor donde esté) mientras fastfetch mueve el texto con **CHA
absoluto** (`ESC[<n>G`). Si se suma padding a uno solo, se pisan. De ahí que:

- en **lado**: el padding mueve la imagen y el texto a la vez (fastfetch lo
  calcula junto) — funciona;
- en **apilado**: `--logo-position top` deja el texto en la columna 1, así que
  la imagen se mueve con `padding-left` y el texto con `indent`.

---

## Flujo E — el render inicial

```
1. term_size()            → TERM_COLS / TERM_ROWS (una sola llamada a stty)
2. se lanzan en background las medidas de los DOS configs (ancho y líneas)
3. resolve_emblem()       → avatar, cache, corte si hace falta
4. decide_layout(cols, rows) → side | stack | text | none
5. apply_layout(cols)     → logo_args / indent / skip_draw
6. render: ESC[1;1H + draw (fastfetch | perl)
```

`draw()` filtra la salida con `perl`:

- convierte el CUP absoluto `ESC[2;NH` en un avance de columna, para que el
  bloque arranque en (1,1);
- en **stack** agrega `indent` espacios al texto y suma `indent` a cada
  `ESC[<n>G` (las columnas absolutas de los valores);
- las líneas del protocolo gráfico (`ESC_G`) se dejan intactas.

> `--pipe false` es obligatorio: sin él fastfetch cree que stdout no es un TTY,
> desactiva los logos de imagen en silencio y cae a ASCII.

---

## Flujo F — el re-render (ventana de gracia)

El watcher vive **solo los primeros `FASTFETCH_RERENDER_GRACE` segundos**
(15 por defecto). Dentro de esa ventana:

```
 1. sleep 0.8 s
 2. ¿cambió el ancho?  no → seguir
 3. debounce: esperar a que el ancho se quede quieto (~150 ms)
     (en Dwindle cambia en ráfaga: cada ventana nueva redimensiona las demás)
 4. decide_layout + apply_layout con el tamaño nuevo
 5. render: ESC[2J (borra pantalla e imágenes) + ESC[1;1H + draw
```

Pasada la ventana el watcher **se apaga**: no queda proceso ni se escribe un
byte más, así que lo que hayas puesto en pantalla queda intacto.

| Caso | Qué pasa |
|---|---|
| Abrís y redimensionás enseguida | se adapta perfecto |
| Escribís en los primeros 15 s y redimensionás | podés perder lo visible de esos 15 s |
| Redimensionás una terminal vieja | no se redibuja: queda el layout con el que nació |

El `2J` borra la pantalla **visible**; el scrollback queda (para eso haría
falta `3J`, que no se usa).

---

## Flujo G — el layout, según el tamaño

`decide_layout` prueba en orden, primero con el texto completo y después con el
compacto:

Para cada texto (completo → compacto → micro) prueba:

| # | Disposición | Condición |
|---|---|---|
| 1 | **side** | `logo = cols − texto − 4 ≥ 4`, y entran las filas del texto y de la imagen |
| 2 | **stack** | `logo = (filas − texto − 1) × 10/8`, acotado por `cols − 2 ≥ 4` |

Si ningún texto deja entrar la imagen, usa el **más grande** que entre **sin**
imagen (`text`: completo → compacto → micro) y, si tampoco, no dibuja nada
(`none`).

Ejemplos reales (medidos con la tabla de decisión):

| cols × filas | disposición | texto | logo |
|---|---|---|---|
| 150×40 | side | completo | 40 |
| 96×50 | side | completo | 34 |
| 80×25 | side | completo | 18 |
| 74×25 | side | completo | 12 |
| 74×24 | stack | compacto | 20 |
| 60×20 | stack | compacto | 15 |
| 46×24 | side | compacto | 11 |
| 40×12 | side | compacto | 5 |
| **30×10** | **stack** | **micro** | **8** |
| **24×8** | **stack** | **micro** | **6** |
| **20×8** | **side** | **micro** | **5** |
| 16×6 | solo texto | micro | — |
| 12×4 | solo texto | micro | — |

La altura de la imagen se estima con `img_rows(w) = ceil(w × 0,8) + 1`
(el emblema es 288×384 y la celda es más alta que ancha).

---

## Puntos de fallo, todos

| Si falla… | Qué pasa |
|---|---|
| Noctalia no está / no hay `settings.toml` | usa `noctalia config export`; si tampoco, `fallback_img` |
| El `avatar_path` no existe | `source_img = fallback_emblem` (el último bueno) |
| No hay binario `kitty-shapes` | usa el cache; si no hay, `--logo-type none` |
| `kitty-shapes` falla | ídem: cache o último bueno |
| No hay `emblem-shapes.txt` | kitty-shapes usa sus 8 formas por defecto |
| Una forma mal escrita | error claro y código 1 (no falla en silencio) |
| El cache está corrupto | `[ -s ]` lo descarta y se regenera |
| No hay `/dev/tty` | el watcher no arranca (modo no interactivo) |
| `stty` no puede leer el tamaño | fallback a `tput cols`, y si no, 100 columnas |

---

## Tiempos (medidos, ver `RENDIMIENTO.md`)

| Tramo | Frío | Caliente |
|---|---:|---:|
| `term_size` | 1 ms | 1 ms |
| medidas de los 3 configs | ~21 ms de CPU (3 ff en paralelo) | **0 ms** (caché) |
| `pick_avatar` + stamp | 2 ms | 2 ms |
| emblema | **~145 ms** (corte) | **~1 ms** (cp del caché) |
| render | 5 ms | 5 ms |
| **total** | **~177 ms** | **17-20 ms** |

> El corte incluye ~90 ms de importar `@napi-rs/canvas`; el trabajo real del CLI
> son ~52 ms. En caliente no se paga: el emblema se copia del caché.
