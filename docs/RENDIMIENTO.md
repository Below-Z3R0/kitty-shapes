# Rendimiento

Todas las cifras de este documento son **medidas**, no estimadas. Abajo está
también el método para reproducirlas.

> Hardware de referencia: Intel i5-12450H (8 P + 4 E, 12 hilos), CachyOS,
> kitty, fastfetch 2.70, bun 1.3.

---

## 1. Resumen

| Métrica | Antes | Ahora | Mejora |
|---|---:|---:|---:|
| Arranque del greeting (caliente) | 184 ms | **17-21 ms** | **~9×** |
| Arranque del greeting (frío, sin caché) | 184 ms | ~177 ms | igual (lo domina el corte) |
| CPU del watcher | 0.74 % de un core | **0 % pasada la ventana** | ∞ |
| Memoria del watcher | 4.5 MB | 4.5 MB | igual |
| Basura acumulada al redimensionar | crecía sin límite | 1 bloque siempre | corregido |

> El DSR (preguntarle al terminal dónde quedó el cursor) se eliminó en la
> reescritura: el re-render ahora limpia con `ESC[2J` y redibuja, y solo lo hace
> durante la ventana de gracia. Eso quitó ~5 ms del arranque y toda la
> fragilidad de la altura del bloque.

---

## 2. Desglose del arranque

### Antes (184 ms)

| Fase | ms | % |
|---|---:|---:|
| `kitty-shapes pick` | 141 | 77 % |
| `noctalia config export` | 24 | 13 % |
| `measure_modules` (2.º fastfetch) | 8 | 4 % |
| `stty` + copia + render | 11 | 6 % |

### Ahora, en caliente (~18 ms)

| Fase | ms | Nota |
|---|---:|---|
| `term_size` | 1 | `stty size` sin `awk` |
| medidas de los 3 configs | **0** | caché `sizes`; en frío: 3 fastfetch en paralelo (~21 ms de CPU) |
| `pick_avatar` + stamp | 2 | lee `settings.toml` directo |
| copia del emblema | ~1 | `cp` del caché |
| `decide_layout` + `apply_layout` | ~1 | aritmética pura |
| render (fastfetch + perl) | 5-9 | |
| resto (shell, lock, launch) | ~4 | |

### Ahora, en frío (~177 ms)

Igual, más el corte (`crop_emblem`, ~145 ms) que **escribe el caché**: se paga
una vez por cambio de avatar. De esos 145 ms, ~90 son importar el binding de
`@napi-rs/canvas`; el trabajo del CLI son ~52 ms.

---

## 3. Qué se optimizó y qué ganó

| Cambio | Ganancia | Cómo |
|---|---:|---|
| **Caché del emblema** | **−140 ms** | `emblem.png` + `stamp` en `$XDG_RUNTIME_DIR/fastfetch-cache` |
| **Prefetch en background** | 0 ms en el arranque | el corte de la próxima forma corre desacoplado |
| **Avatar desde `settings.toml`** | **−22 ms** | `sed` (1 ms) en vez de `noctalia config export` (24 ms) |
| **`term_size` sin `awk`** | −1 ms por consulta | parseo con `${size#* }` |
| **stamp con `read`** | −1 ms | builtin en vez de `cat` |
| **Limpieza por PID** | evita MB en RAM | `[ -d /proc/$pid ]` sin forks |

### Lo que **no** funcionó

| Intento | Resultado |
|---|---|
| Bajar `--size` del emblema | **0 ms**: 384→192 px solo baja de 130 a 119 ms; domina el *decode* del PNG fuente (197 KB) |
| Bajar `--palette` | 0 ms: 256→64 colores no cambia el tiempo, solo el peso |
| Leer `avatar_path` del `config.toml` | **rompía el avatar**: ese archivo tiene `avatar_path = ""`; el real está en `settings.toml` |

---

## 4. Coste del watcher

El watcher **se apaga solo** cuando termina la ventana de gracia
(`FASTFETCH_RERENDER_GRACE`, 15 s por defecto):

```
0-15 s:   1 consulta de tamaño cada 0,8 s (1 fork de stty ≈ 0,3 % de un core)
después:  el proceso termina → 0 % y 0 MB
```

- **RSS mientras vive**: 4,5 MB.
- No lee el tty (sin DSR), así que no puede comerse una tecla.

## 4a. Dónde se va el tiempo de `kitty-shapes` (medido)

| Fase | Tiempo |
|---|---:|
| arranque de bun | ~10-20 ms |
| **import de `@napi-rs/canvas`** | **~85-100 ms** |
| `loadImage` | 0,4 ms |
| `detectBoxes` | 5,3 ms |
| `renderEmblem` | 19,3 ms |
| `quantize 256` | 11,5 ms (color medio por bucket) |
| `encode PNG` | 17,9 ms |

El costo dominante es **cargar el binding nativo**, no el trabajo (~52 ms). Por eso
el recorte se cachea: en régimen normal no se paga esa carga. Además, `placeArt`
tiene un camino rápido: si el sujeto entra a escala completa no hace la búsqueda
de 28 focos × 16 bisecciones (~450 lecturas de píxeles); solo aplica con
`--protect`.

## 4b. Cachés

Dos caches en `$XDG_RUNTIME_DIR/fastfetch-cache/`:

| Archivo | Qué guarda | Huella |
|---|---|---|
| `sizes` | medidas de los 3 configs (`58:25:30:8:11:2`) | mtime+tamaño de los configs |
| `stamp` + `emblem.png` | emblema recortado | avatar (mtime+tamaño+path) + formas + tamaño/paleta |

- **Medidas**: sin cache se lanzan 3 fastfetch (~7 ms de CPU cada uno). En
  caliente no se ejecuta ninguno: **~21 ms de CPU menos por apertura**.
- **Emblema**: el corte en vivo cuesta ~140 ms. El `prefetch` lo prepara en
  background para la próxima terminal. El throttle es de **0,3 s** (solo evita
  repetirlo en ráfagas reales); por encima de eso, cada terminal prepara la
  siguiente forma.
- **Formas**: `shape-idx` guarda el índice de la rotación, así que cada terminal
  muestra una forma **distinta a la anterior** (con 8 formas, 8 terminales = las
  8). El `randomItem` del CLI sigue disponible con `--shape random`.
- **No incluir `settings.toml` de Noctalia en la huella** (bug 31): se reescribe
  seguido e invalidaba el cache siempre.

## 5. Escalado y concurrencia

| Prueba | Resultado |
|---|---|
| 8 terminales abriendo a la vez | 8/8 con imagen |
| 10 terminales abriendo a la vez | 10/10 con imagen |
| 3 corridas del greeting en la misma tty | 1 watcher (no 3) |
| 22 anchos × 4 alturas | 0 errores, 0 variables sin definir |

---

## 6. Cómo se mide (reproducible)

### 6.1 Arnés de pty

No sirve redirigir a un archivo: `stty` y `tput` necesitan un TTY real. El
arnés abre un pty, fija el tamaño con `ioctl(TIOCSWINSZ)` y lee la salida:

```python
import os, pty, struct, fcntl, termios

mfd, sfd = os.openpty()
fcntl.ioctl(sfd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 110, 0, 0))
pid = os.fork()
if pid == 0:
    os.close(mfd); os.setsid()
    fcntl.ioctl(sfd, termios.TIOCSCTTY, 0)
    os.dup2(sfd, 0); os.dup2(sfd, 1); os.dup2(sfd, 2)
    os.environ["TERM"] = "xterm-kitty"
    os.execvp("bash", ["bash", "/ruta/al/script"])
```

> Importante: el proceso hijo **tiene que ser el líder de sesión** y el pty
> debe quedar como su `controlling tty`, si no `/dev/tty` falla.

### 6.2 Tiempos por fase

Se instrumenta una copia del script:

```bash
ts(){ printf "%s %d\n" "$1" $(date +%s%N) >> /tmp/fase.log; }
# y se intercalan llamadas ts antes/después de cada bloque
```

Y se restan los nanosegundos consecutivos.

### 6.3 CPU de hijos

`ps -o times` **no** cuenta a los hijos. Para el watcher hay que leer
`utime`, `stime`, `cutime`, `cstime` (campos 14-17 de `/proc/<pid>/stat`).

### 6.4 Protocolo

Para verificar que el render es correcto sin mirar la pantalla:

```python
b"\x1b_G" in salida          # hay imagen kitty
b"\x1b[2J" in salida         # borra pantalla
b"\x1b[3J" in salida         # borra scrollback
re.findall(r"\x1b\[(\d+);(\d+)H", salida)   # posición absoluta del logo
re.findall(r"\x1b\[(\d+)G", salida)         # columnas absolutas del texto
```

---

## 7. Lo que queda por optimizar

| # | Ítem | Ganancia | Riesgo |
|---|---|---:|---|
| 1 | Cachear `text_w` con TTL | ~5 ms | medio (si los valores crecen, el layout queda 1-2 columnas corrido) |
| 2 | Un solo `stat` para los 3 archivos del stamp | ~2 ms | nulo |
| 3 | Saltar el DSR del primer render (medir en el primer resize) | ~5 ms | bajo |
| 4 | Prefetch del emblema encadenado (2 formas de anticipación) | 0 en el arranque | bajo |

Ninguna es urgente: el arranque ya está muy por debajo del umbral perceptible
(~100 ms).

---

## 5. El arranque: Skia se carga bajo demanda

`@napi-rs/canvas` (Skia) tarda **~74 ms** en cargarse. Con el import estático,
**todo** comando lo pagaba, incluso `--help` y `list`, que no dibujan nada.

Ahora `cli.ts` y `render.ts` lo importan **de forma diferida** (un `await
import()` dentro de `loadCanvas()`, que cachea el módulo):

| Comando | Antes | Ahora |
|---|---:|---:|
| `--help` | 75,7 ms | **16,3 ms** |
| `list` | 75,4 ms | **15,1 ms** |
| `pick` (dibuja de verdad) | 135,2 ms | 136,8 ms |

El crop sigue pagando Skia (no puede ser de otra forma), pero los comandos de
consulta ya no. Coste por módulo al importarlo:

| Módulo | Antes | Ahora |
|---|---:|---:|
| `geometry.ts` | 1,0 ms | 0,6 ms |
| `shapes.ts` | 1,5 ms | 1,4 ms |
| `detect.ts` | 1,2 ms | 0,7 ms |
| `quantize.ts` | 1,1 ms | 0,9 ms |
| `render.ts` | **87,6 ms** | **1,6 ms** |

El PNG resultante es **byte-idéntico** (`cmp`): el cambio no altera la imagen.

> El mismo beneficio que daba reescribir en Go (3,4 ms de arranque), sin
> reescribir una línea.

---

## 6. Memoria (medido con 12 terminales)

| Qué | Costo | ¿Se libera al cerrar? |
|---|---:|---|
| Cada ventana de **kitty** | **~105 MB** | sí |
| Cada ventana **vacía** (control) | ~106 MB | sí |
| Greeting completo por terminal | ~5 MB (watcher bash + PNG de ~56 KB) | sí |
| Corte `kitty-shapes` (transitorio) | 37 MB privados + 171 MB de páginas del binario, 136 ms | sí (proceso efímero) |
| `fastfetch` | 6 MB | sí |

Medición:

| Escenario | kitty RSS | MemAvailable |
|---|---:|---:|
| 12 ventanas **con** greeting | **1251 MB** | 2350 MB |
| 12 ventanas **vacías** (control) | **1270 MB** | 2489 MB |
| Después de cerrar cualquiera de las dos | **0 MB** | vuelve al baseline |

**Conclusión**: abrir muchas terminales llena la RAM por **kitty** (contexto
gráfico y buffers por ventana), no por el greeting: con y sin greeting el
consumo es el mismo. No hay acumulación: al cerrar quedan 0 emblemas, 0 locks y
0 watchers, y la memoria disponible vuelve al valor previo.

Para muchas terminales conviene **tabs** dentro de una sola ventana de kitty (o
tmux): no crean un contexto gráfico nuevo.
