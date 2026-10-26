# Registro de bugs

Errores encontrados durante el desarrollo, con **síntoma → causa raíz → fix →
cómo se verificó**. Sirve para no volver a pisarlos y para entender por qué el
código tiene ciertas rarezas (varias son contraintuitivas y parecen
innecesarias hasta que se lee el motivo).

---

## Geometría (kitty-shapes)

### 1. La máscara de la forma tenía agujeros

- **Síntoma**: algunas formas salían con huecos o con los arcos girados al revés.
- **Causa**: el `%` de JavaScript devuelve negativos con divisor positivo, así
  que el ángulo de los vértices cóncavos se calculaba al revés.
- **Fix**: `mod()` en `geometry.ts` (`((v % d) + d) % d`).
- **Verificación**: test "la máscara de la forma cubre el lienzo (sin agujeros)".

### 2. `arch` y `semiCircle` eran la misma forma

- **Causa**: ambas se construían con el mismo rectángulo redondeado y el mismo
  radio; la diferencia de Material está en **qué esquinas** se redondean.
- **Fix**: recetas separadas en `shapes.ts`.
- **Verificación**: test "arch y semiCircle no son la misma forma".

### 3. Las estrellas tenían el doble de puntas

- **Causa**: `RoundedPolygon.star(n)` cuenta vértices **por radio** (n = puntas
  × 2); las recetas viejas de m3shapes contaban vértices **totales**.
- **Fix**: traducir 12 → 6 puntas, 8 → 4 puntas al portar las recetas.
- **Verificación**: test "la cookie12 tiene 12 vértices y 6 puntas".

---

## Protocolo gráfico de Kitty y layout

### 4. El logo viejo quedaba pegado en pantalla

- **Síntoma**: al redimensionar aparecía el emblema anterior superpuesto.
- **Causa**: la limpieza usaba `ESC[0J` (*erase to end*), que **no borra
  imágenes** — solo texto. El protocolo dice que únicamente `ESC[2J`
  (*clear screen*) borra los gráficos.
- **Fix**: se dejó de borrar a mano y se aprovecha el `ESC[2J`/`ESC[3J` que
  fastfetch emite al inicio de cada render (para el primer dibujo). Para los
  re-render se quitan esas secuencias a propósito (ver bug 19) y se reescribe
  el bloque encima.
- **Verificación**: buscar `ESC[2J` en la salida y comprobar que no queda
  ninguna imagen huérfana.

### 5. La imagen y el texto se pisaban

- **Síntoma**: con `--logo-padding-left > 0`, el logo quedaba en la columna 0 y
  el texto en la 40+N.
- **Causa**: la imagen se dibuja con **posicionamiento absoluto** (`a=T`: donde
  está el cursor) y el texto se desplaza con **CHA relativo/absoluto**. Sumar
  padding a uno solo los desalinea.
- **Fix**: el padding mueve **ambos** (fastfetch lo calcula junto en modo lado);
  en apilado, el texto se corre con `indent` en `draw()`.
- **Verificación**: medir `ESC[<n>H` (CUP) y `ESC[<n>G` (CHA) en la salida.

### 6. `--logo-padding-left` no hacía nada en apilado

- **Síntoma**: el logo quedaba siempre en la columna 1.
- **Causa**: con `--logo-position top`, fastfetch **no emite CUP** y el CHA del
  texto queda en 1; el padding no se aplica.
- **Fix**: en apilado, la imagen se mueve con `padding-left` (que sí emite
  espacios antes del escape gráfico) y el texto con `indent`.
- **Verificación**: comparar la posición del escape `ESC_G` con padding 0 y 10.

### 7. En apilado el texto se volvía a la columna 1

- **Síntoma**: se agregaban espacios al texto pero las líneas de módulos
  seguían pegadas a la izquierda.
- **Causa**: fastfetch posiciona los valores con columnas **absolutas**
  (`ESC[<n>G`); prepender espacios no las mueve.
- **Fix**: el filtro `perl` suma `indent` a cada `ESC[<n>G` además de indentar
  el texto.
- **Verificación**: en la salida, `ESC[12G` + indent 10 → `ESC[22G`.

### 8. "Arranca centrado y después se va a la izquierda"

- **Síntoma**: en fullscreen, el primer render quedaba centrado y el re-render
  saltaba a la izquierda.
- **Causa**: el watcher medía el ancho con `tput cols`, que **devuelve 80**
  (el default de terminfo) cuando stdout no es un TTY. El primer render usaba
  240; el re-render creía 80.
- **Fix**: `term_cols()` lee **primero** `stty size </dev/tty` (ioctl al kernel)
  y deja `tput` como último recurso.
- **Evidencia**: log instrumentado — `tput=80 stty="50 240"`; al invertir el
  orden, `cols=240` en ambos renders.

### 9. La imagen quedaba pegada al texto

- **Síntoma**: el texto arrancaba exactamente en el borde de la imagen, sin aire.
- **Causa**: al pasar `--logo` por CLI, fastfetch **reemplaza el bloque `logo`
  entero del config**, incluido `padding.right: 4`. El texto arrancaba en la
  columna 40 (fin de la imagen).
- **Fix**: `logo_gap=4` y `--logo-padding-right 4` explícito en cada render.
- **Evidencia**: con `--logo` CLI, el texto pasó de la columna 40 a la 44.

### 10. El texto se cortaba contra el borde derecho

- **Síntoma**: las líneas largas (CPU) se cortaban en terminales de ~96 columnas.
- **Causa**: `text_w = medida - 20` (una resta heredada de cuando las keys no se
  veían). Con las keys visibles el ancho real es mayor y el bloque se
  subestimaba en 20 columnas.
- **Fix**: `text_w` = la medida real de la línea más larga.
- **Evidencia**: `text_w` pasó de 44 a 58; el bloque dejó de desbordar.

### 11. Las keys desaparecían

- **Síntoma**: los valores se dibujaban en la columna 1 y tapaban "CPU", "OS", etc.
- **Causa**: `display.key.width: 1` en `config.jsonc` hacía que fastfetch
  alineara los valores en la columna 1.
- **Fix**: `key.width: 0` (ancho natural, `KEY  valor`).
- **Evidencia**: con `width: 1` la salida tenía `ESC[1G` y no se veían las keys;
  con `0` no hay `ESC[1G` y las keys aparecen.

### 12. El ancho del bloque estaba hardcodeado

- **Síntoma**: el bloque quedaba descentrado 24 columnas.
- **Causa**: `block=95` fijo; el real es `logo_width + texto`.
- **Fix**: medir con `measure_modules()` y calcular `block = logo + gap + text_w`.

### 13. `logo_args` perdía los flags de layout

- **Causa**: una rama sobreescribía `logo_args` en vez de anteponer.
- **Fix**: `logo_args=(--logo … --logo-type kitty-direct "${logo_args[@]}")`.

---

## Procesos, concurrencia y ciclo de vida

### 14. El re-render borraba la pantalla y el scrollback

- **Síntoma**: al redimensionar, todo lo que había en pantalla y el historial
  desaparecían.
- **Causa**: fastfetch emite `ESC[2J` (borra pantalla) + `ESC[3J` (borra
  scrollback) al inicio de **cada** render.
- **Fix**: en los re-render el filtro `perl` quita esas dos secuencias, convierte
  el CUP absoluto en un avance de columna y `render()` borra **solo la cola
  sobrante** (`ESC[1B ESC[2K` por línea de más).
- **Evidencia**: `2J=False 3J=False` en el re-render; el primer render sí los
  conserva.

### 15. Todas las ventanas escribían el mismo PNG

- **Síntoma**: al abrir varias terminales a la vez, algunas salían sin imagen.
- **Causa**: el emblema se nombraba con `KITTY_WINDOW_ID`, que vale **1 en todas
  las instancias de kitty recién abiertas** (`kitty --detach` → cada proceso
  numera desde 1).
- **Fix**: un archivo por **PID** en `$XDG_RUNTIME_DIR`.
- **Evidencia**: 8 terminales simultáneas → 8/8 con imagen (antes 7/8).

### 16. El PNG compartido se corrompía

- **Síntoma**: fastfetch caía al logo ASCII de CachyOS.
- **Causa**: `cp -f` escribe **in-place**; otra terminal podía leer el archivo a
  medio escribir.
- **Fix**: escribir a `.tmp.$$` y `mv` (rename atómico en el mismo filesystem).
- **Evidencia**: firma PNG + `IEND` válidos tras la prueba de carrera.

### 17. El watcher moría al instante

- **Síntoma (histórico)**: con `trap … HUP`, el watcher se cerraba en el acto.
- **Causa de entonces**: el watcher se lanzaba **sin** `disown`; al terminar el
  greeting el shell le mandaba SIGHUP y el trap lo mataba.
- **Fix de entonces**: no poner trap HUP.
- **Estado actual**: el lanzador hace `&` + `disown`, que es justo lo que evita
  ese SIGHUP. El único HUP que llega es el del **cierre real** de la terminal, y
  ahí sí conviene salir limpiando el lock: `trap 'exit 0' TERM INT HUP` dispara
  el EXIT → `limpiar_lock`.
- **Evidencia**: 2 terminales abiertas → 2 locks; cerrar una → 1; cerrar la otra
  → 0 (antes quedaban los 2 huérfanos hasta la próxima apertura).

### 18. El watcher quedaba huérfano para siempre

- **Causa**: `setsid` lo separa de la sesión → no recibe el SIGHUP al cerrar.
- **Fix**: sin `setsid`; hereda el tty y muere con la sesión.

### 19. El guard no detectaba nada

- **Causa**: `[ -c /dev/tty ]` **siempre** es verdadero (el nodo existe aunque
  no haya terminal de control).
- **Fix**: `{ : >/dev/tty; } 2>/dev/null || exit 0` (abre el dispositivo de
  verdad; falla con `ENXIO` cuando no hay tty).

### 20. Watchers duplicados

- **Síntoma**: correr el greeting dos veces en la misma terminal dejaba **dos**
  watchers; cada resize dibujaba dos veces (parpadeo).
- **Fix**: lock por tty (`$XDG_RUNTIME_DIR/fastfetch-watch-<tty>`); al arrancar
  se mata el anterior si su PID sigue vivo.
- **Evidencia**: 3 corridas → 1 watcher.

### 21. Otra terminal borraba el emblema de una viva

- **Síntoma**: al abrir una segunda terminal, la primera perdía el logo en el
  próximo resize (y aparecía otra forma).
- **Causa**: el emblema se nombraba con el PID del **script padre**, que muere
  enseguida; el barrido de la siguiente terminal veía ese PID muerto y lo
  borraba.
- **Fix**: el watcher copia el emblema a un archivo con **su propio PID** (que
  vive mientras la terminal exista).

### 22. Fuga de emblemas en RAM

- **Síntoma**: 138 archivos PNG (5.6 MB) en `tmpfs` con 0 procesos vivos.
- **Causa**: la limpieza era `find -mmin +1440` (24 h).
- **Fix**: borrar cualquier `fastfetch-emblem-*.png` cuyo PID ya no exista
  (solo builtins, sin `fork`).

### 23. El avatar cambiaba de forma en cada resize

- **Causa**: `regen_emblem()` volvía a llamar a `kitty-shapes pick`, que elige
  una forma **al azar** en cada invocación.
- **Fix**: el emblema no depende del ancho (fastfetch lo escala con
  `--logo-width`), así que no se regenera al redimensionar.
- **Bonus**: −125 ms por resize.

---

## Errores de shell

### 24. `pad: unbound variable`

- **Causa**: `set -u` con una variable usada antes de asignarse en una rama.
- **Fix**: inicializar (`pad=0`, `indent=0`, `${var:-0}` donde corresponde).
- **Verificación**: fuzz de 22 anchos × 4 alturas con `set -u` activo.

### 25. El shell quedaba colgado

- **Causa**: el watcher se lanzó en primer plano (`while true` sin `&`).
- **Fix**: primer dibujo síncrono, watcher desacoplado y `exit 0`.

### 26. `noctalia config export` era caro y frágil

- **Causa**: 24 ms por arranque (13 % del total).
- **Fix**: leer `~/.local/state/noctalia/settings.toml` (1 ms) y dejar el
  `export` como **respaldo**.
- **Ojo**: leer `~/.config/noctalia/config.toml` **no** sirve — ahí
  `avatar_path` está vacío; el valor real lo escribe la GUI en `state/`.

### 27. Copias apiladas del bloque al redimensionar (el bug más visible)

- **Síntoma**: al cambiar el tamaño varias veces, la pantalla se llenaba de
  copias del fastfetch: varios osos, varios bloques de texto, superpuestos.
- **Causa doble**:
  1. **La altura del bloque se medía con `wc -l`**, pero la imagen del logo
     ocupa filas **sin emitir `\n`**. El "subir N líneas" del re-render quedaba
     corto y el bloque se dibujaba cada vez más abajo.
  2. **El bloque viejo nunca se borraba**: al quitar `ESC[2J` se dejó de limpiar
     la pantalla, y `ESC[2K` **no borra imágenes**. Cada render dejaba el suyo.
- **Fix**: se dejó de usar el movimiento relativo. Ahora:
  - el bloque se dibuja **siempre en (1,1)** (el CUP de fastfetch se convierte
    en un avance de columna con `perl`);
  - antes de redibujar, `erase_block()` borra el **placement de la imagen**
    (`ESC_Ga=d,d=p,x=<col>,y=1`) y las `block_h` líneas de texto;
  - `block_h` se obtiene **preguntándole al terminal** dónde quedó el cursor
    (DSR: `ESC[6n` → `ESC[fila;colR`).
- **Verificación**: en kitty real, 10 resizes seguidos y `kitty @ get-text`:
  **1** ocurrencia del título, **1** de `VITALS`, **1** de `TERM`. Antes:
  decenas.
- **Lección**: para reposicionar algo que incluye una imagen no sirve contar
  líneas; hay que preguntarle al terminal (DSR) y borrar los gráficos con el
  comando del protocolo, no con escapes de texto.

### 28. El guard del cursor pisaba la salida del usuario

- **Síntoma**: con el re-render determinista, redimensionar después de correr
  comandos redibujaba el bloque arriba y tapaba parte de la salida.
- **Fix**: en cada resize se consulta la fila del cursor; si está **más de 3
  filas abajo** del bloque, no se redibuja (el greeting queda con el layout
  viejo, pero no se toca nada).
- **Verificación**: escribir 3 líneas y redimensionar → las 3 líneas siguen
  ahí, el greeting aparece una sola vez.

### 29. DSR viejo: `block_h` salía de 9 líneas para un bloque de 25

> **Obsoleto**: en la reescritura se eliminó el DSR por completo. El re-render
> ahora limpia con `ESC[2J` y redibuja, así que no necesita medir la altura.
> Queda como registro del problema.

- **Síntoma**: en Dwindle algunas ventanas quedaban con restos al redimensionar.
- **Causa**: **fastfetch también pregunta la posición del cursor** (`ESC[6n`) al
  pintar la imagen. Si su respuesta queda en el buffer de entrada, nuestro
  `cursor_row()` leía **esa** posición (vieja) en vez de la propia. Resultado:
  `block_h` de 9 líneas para un bloque de 25 → el borrado se quedaba corto.
- **Fix**: antes de preguntar, se **drena** el buffer (`read -n1 -t 0.001` en
  bucle hasta que no quede nada). Después del fix: `dsr_r=26 → block_h=25`.
- **Lección**: si el programa que dibuja ya usa DSR, hay que limpiar el buffer
  antes de preguntar.

### 30. Dwindle: la ventana encoge y la terminal re-envuelve el bloque

> **Obsoleto**: el reflow ya no importa porque el re-render limpia todo con
> `ESC[2J`. Se mantiene la ventana de gracia para no borrar nada después.

- **Síntoma**: al abrir terminales en Dwindle (cada una redimensiona las demás)
  aparecían bloques duplicados y fragmentos.
- **Causa**: al encoger, **la terminal re-envuelve el contenido**: el bloque
  dibujado a 96 columnas pasa a ocupar muchas más filas. `block_h` (medido a 96)
  ya no sirve y el borrado por N líneas dejaba el resto. Encima, el guard del
  cursor (que compara con `block_h`) bloqueaba el redibujado porque el reflow
  empuja el cursor lejos.
- **Fix** (tres cosas):
  1. **Debounce**: tras detectar un cambio se espera a que el ancho se quede
     quieto (~150 ms). En una ráfaga de Dwindle se renderiza una sola vez, al
     final, y no en medio de un resize.
  2. **Borrado total**: `ESC[1;1H` + `ESC_Ga=d` (todas las imágenes) + `ESC[0J`
     (hasta el final de la pantalla). Ya no depende de `block_h`.
  3. **Guard solo al crecer**: si la ventana **encogió**, el reflow invalida la
     posición del cursor → se redibuja igual. Si creció, el cursor sigue siendo
     un indicador fiable y el guard protege la salida del usuario.
- **Verificación**: 6 terminales en Dwindle → 1 bloque completo en la grande,
  bloque compacto en las medianas, vacías las chicas. Sin duplicados.

### 31. Ventanas chicas: solo se veía la cola del bloque

- **Síntoma**: con 6 ventanas en mosaico, las más chicas mostraban fragmentos
  (`PKGS...`, `SESSION...`) o líneas todas envueltas.
- **Causa**: el bloque completo mide ~25 filas × 96 columnas; no entra en una
  ventana de 46×24.
- **Fix inicial**: `pick_mode` elegía entre `full` / `min` / `none` con umbrales
  fijos (74×25 y 38×8).
- **Estado actual**: ese fix quedó chico. Hoy `decide_layout()` mide los tres
  configs y hace una cascada **completo → compacto → micro**, probando la imagen
  **al lado** y **arriba** en cada uno (ver ARQUITECTURA §3.3). Ya no hay
  umbrales fijos: el layout sale de las medidas reales.

---

## CLI y TypeScript (kitty-shapes)

### 32. `pick <manifest>` ignoraba los flags de salida

**Síntoma**: `kitty-shapes pick salida/manifest.json --path --out x.png` no escribía
nada: volcaba el PNG binario a stdout (y `--shape` también se ignoraba).

**Causa**: la rama del manifest hacía `process.stdout.write(await readFile(...))` y
volvía antes de mirar `--path` / `--escape` / `--shape`.

**Fix**: la rama del manifest ahora respeta los tres: `--escape` (protocolo kitty),
`--path` (imprime la ruta del PNG ya existente) y sin flag (bytes). Si `--shape`
no está en el manifest, falla con un mensaje claro.

### 33. `--focus` aceptaba valores imposibles

`--focus 2,9` (o `--focus a,b`) se convertía en `NaN` y se propagaba al render sin
error: la imagen salía mal y no había pista. Ahora valida dos números entre 0 y 1.

### 34. La caché de cuantización usaba el color del píxel

En `quantize.ts` la decisión "a qué color de la paleta va este bucket" se cacheaba
por bucket, pero la distancia se calculaba **contra el primer píxel** que cayó en
ese bucket: el resto heredaba una decisión tomada con otro color. Ahora se compara
contra el **color del bucket**, así todos los píxeles del bucket comparten una
decisión coherente.

### 35. La detección ignoraba el canal alfa

**Síntoma latente**: con un PNG de fondo transparente, `detectBoxes` tomaba el RGB
de los píxeles transparentes (normalmente negro) como **tinta**, así que la caja
de contenido salía del tamaño del lienzo entero y el recorte no ajustaba nada.

**Fix**: un píxel con alfa < 128 es fondo por definición, y el color de fondo se
calcula solo con las esquinas **opacas** (si no hay ninguna, blanco).

**Prueba**: lienzo 200×200 transparente con un círculo negro de radio 30 en
(100,100) → `content: 70,70,130,130` (antes: `0,0,200,200`).

No afectaba al avatar actual (0 % transparente), pero sí a cualquier PNG recortado.

---

## Resumen de causas raíz (para no repetirlas)

| Familia | Lección |
|---|---|
| Protocolo de kitty | La imagen es **absoluta**; el texto, **relativo**. Todo padding/offset tiene que mover a los dos. |
| fastfetch | Pasar `--logo` **reemplaza** el bloque `logo` del config (padding incluido). |
| `tput`/`stty` | Sin TTY, `tput` miente (80). El kernel (`stty`) no. |
| Procesos | `disown` **evita** el SIGHUP del shell al salir; el HUP que llega es el del cierre del tty y conviene atraparlo para limpiar. Un PID que muere no sirve como nombre de archivo compartido. |
| Concurrencia | Todo archivo compartido entre terminales se escribe **tmp + mv**. |
| Shell | `set -u` + ramas = variables sin inicializar. |
