# Cómo se prueba

El greeting no se puede probar "a ojo": depende del TTY, del ancho, del
protocolo gráfico y de procesos que quedan vivos. Este documento describe el
arnés que se usó y las pruebas que conviene correr antes de tocar nada.

---

## 1. La regla básica: pty, no redirección

Redirigir a un archivo **rompe todo**:

```bash
bash script > /tmp/out.txt     # ❌
```

- `tput cols` devuelve **80** (default de terminfo) porque stdout no es un TTY.
- `stty size </dev/tty` falla o devuelve `0 0`.
- fastfetch no puede hablar con el terminal.

Hay que abrir un **pty real**, fijar el tamaño con `ioctl(TIOCSWINSZ)` y leer de
ahí.

---

## 2. El arnés mínimo (Python)

```python
import os, time, select, struct, fcntl, termios, signal

SCRIPT = "/home/USUARIO/.config/fastfetch/b3l0wz3r0-fastfetch"

def run(width=110, rows=40, cmd=None, wait=2.5):
    mfd, sfd = os.openpty()
    fcntl.ioctl(sfd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, width, 0, 0))

    pid = os.fork()
    if pid == 0:                      # hijo
        os.close(mfd)
        os.setsid()                   # sesión propia
        fcntl.ioctl(sfd, termios.TIOCSCTTY, 0)   # el pty pasa a ser su tty
        os.dup2(sfd, 0); os.dup2(sfd, 1); os.dup2(sfd, 2)
        os.environ["TERM"] = "xterm-kitty"
        os.execvp("bash", ["bash", "-c", cmd or f"bash {SCRIPT}; sleep 10"])
        os._exit(1)

    os.close(sfd)
    out = b""
    end = time.time() + wait
    while time.time() < end:
        r, _, _ = select.select([mfd], [], [], 0.05)
        if r:
            try:
                chunk = os.read(mfd, 65536)
            except OSError:
                break
            if not chunk:
                break
            out += chunk

    try: os.kill(pid, signal.SIGTERM)
    except ProcessLookupError: pass
    os.close(mfd)
    try: os.waitpid(pid, 0)
    except ChildProcessError: pass
    return out
```

### Tres detalles que hacen fallar el arnés

1. **`setsid()` + `TIOCSCTTY`**: sin esto, el hijo no tiene terminal de control
   y `/dev/tty` falla. El guard del watcher lo mata.
2. **El hijo tiene que quedarse vivo**: si el proceso que corre el greeting es
   el líder de sesión y termina, el kernel manda SIGHUP a todo el grupo y el
   watcher muere. Por eso el comando es `bash script; sleep 10` y no solo el
   script.
3. **`kitty --detach` no propaga el tamaño**: pedir `initial_window_width=52`
   no garantiza que el pty del hijo tenga 52 columnas (el compositor lo tilea).
   Para tamaños exactos, usar el arnés y `TIOCSWINSZ`.

### Limitación: no hay emulador

En un pty pelado **no hay emulador de terminal**, así que:

- nadie responde a `ESC[6n` (DSR), y
- nadie borra ni redibuja: se lee el **stream** de bytes, no la pantalla.

Eso alcanza para verificar el protocolo (qué secuencias salen y en qué orden),
pero no para ver el resultado visual. Para lo visual: `grim` + una ventana real.

**Ojo con `ESC[6n` en ventanas anchas**: con `--pipe false` y la imagen **al lado**
del texto, fastfetch consulta la posición del cursor (`ESC[6n`). Sin emulador nadie
responde y fastfetch se queda esperando: el pty recibe solo el prefijo y parece que
"no hay imagen". Con la imagen **arriba** (ventanas angostas) no pasa.

- ✅ El pty sirve para: crashes, `unbound variable`, layout apilado, re-render.
- ❌ No sirve para: layout al lado en anchos grandes. Eso se valida en kitty real
  (que responde el DSR en ~1 ms y no deja basura en el prompt: verificado).

---

## 3. Pruebas

### 3.1 Fuzz de anchos y alturas

```python
for w in (1, 3, 8, 12, 20, 30, 40, 50, 58, 60, 66, 70, 73, 74, 80, 90,
          100, 110, 120, 150, 200, 240):
    out = run(width=w)
    t = out.decode("utf8", "replace").lower()
    for k in ("unbound variable", "command not found", "syntax error"):
        assert k not in t, (w, k)
```

Con un caso por modo (lado / apilado / solo texto). Y lo mismo variando
filas (5, 10, 15, 24) para el bloque más alto que la pantalla.

### 3.2 Carrera: muchas terminales a la vez

```bash
for i in $(seq 0 7); do
  kitty --detach --listen-on unix:/tmp/z_$i \
    bash -c "TERM=xterm-kitty bash $SCRIPT; sleep 20"
  sleep 0.4
done
sleep 12
ok=0
for i in $(seq 0 7); do
  kitty @ --to unix:/tmp/z_$i get-text | grep -q 'b3low-z3r0' && ok=$((ok+1))
done
echo "$ok/8 con texto (y su emblema)"
```

> No redirigir a archivo: sin TTY se pierde el layout (ver §1).

**Esperado**: 8/8. Si alguno falla, el culpable suele ser un archivo compartido
(emblema, cache) escrito sin `mv` atómico.

### 3.3 Watchers duplicados

```python
pid, mfd, out = run(runs=3)      # corre el greeting 3 veces en la misma tty
# y contar:
ps -eo args | grep -c 'fastfetch --watch'
```

**Esperado**: 1. Si son 3, el lock por tty no está funcionando.

### 3.4 Cache y prefetch

```bash
rm -rf $XDG_RUNTIME_DIR/fastfetch-cache       # forzar frío
# correr el greeting en un pty → debe crear cache/emblem.png y cache/stamp
# correr otra vez → debe ser rápido y el hash del emblema del cache debe cambiar
```

Comprobación útil: el **hash** del cache cambia entre corridas (el prefetch
genera una forma nueva), pero cada terminal usa una forma **distinta**.

### 3.5 Re-render

Dentro de la ventana de gracia el cambio de ancho redibuja el bloque:

```python
fcntl.ioctl(mfd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 140, 0, 0))
out2 = leer(mfd)

assert b"\x1b[2J" in out2      # limpia antes de redibujar (modelo actual)
assert b"\x1b[1;1H" in out2    # ancla arriba a la izquierda: no hay drift
assert b"\x1b_G" in out2       # sigue habiendo imagen
```

Y pasado el plazo, un resize **no** debe producir salida:

```python
time.sleep(16)                 # 15 s de gracia + margen
fcntl.ioctl(mfd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 90, 0, 0))
assert leer(mfd) == b""        # el watcher ya murió
```

La prueba que importa no es el byte exacto sino que el texto **no se duplique**:
contar ocurrencias del título en `kitty @ get-text` después de 10 resizes debe
dar 1.

### 3.6 Tiempos por fase

Se instrumenta una copia:

```bash
ts(){ printf "%s %d\n" "$1" $(date +%s%N) >> /tmp/fase.log; }
```

y se intercalan llamadas antes/después de cada bloque. Después se restan los
nanosegundos consecutivos.

### 3.7 CPU real de un proceso con hijos

`ps -o times` **no** cuenta a los hijos. Para el watcher:

```python
def cpu(pid):
    parts = open(f"/proc/{pid}/stat").read().split()
    return int(parts[13]) + int(parts[14]), int(parts[15]) + int(parts[16])
    #        utime            stime            cutime            cstime
```

`cutime`/`cstime` acumulan el CPU de los hijos **ya recolectados** (`stty`).

---

## 4. Checklist antes de cambiar el script

- [ ] `bash -n b3l0wz3r0-fastfetch` (sintaxis)
- [ ] Fuzz de anchos (1 → 240) sin "unbound variable"
- [ ] Frío: se crea el caché y el emblema pesa ~55-80 KB
- [ ] Caliente: arranque < 40 ms
- [ ] Carrera de 8 terminales: 8/8 con imagen
- [ ] 3 corridas en la misma tty: **1** watcher
- [ ] Re-render: `2J` + `1;1H`, con imagen, y **sin duplicar** el texto
- [ ] Cerrar la terminal: no quedan watchers ni locks
- [ ] Al abrir otra terminal, la primera **conserva** su emblema
- [ ] Captura visual (`grim`) en un ancho ancho y en uno angosto

---

## 5. Verificación visual

En un entorno con Wayland (Umbriel/Niri):

```bash
kitty --detach bash -c "TERM=xterm-kitty bash $SCRIPT; sleep 14"
sleep 6
grim /tmp/shot.png
```

Y se mira: keys visibles, aire entre imagen y texto, bloque centrado, sin texto
cortado. Para el modo apilado, si el compositor no deja abrir una ventana
angosta, se captura la salida de un pty de 60 columnas y se **reproduce** en
una terminal real con `cat` (las secuencias ya vienen calculadas para ese
ancho).

---

## 6. Probar kitty-shapes (el binario)

```bash
bun test                                   # 17 tests (geometría, formas, máscara, detección, cuantización)
bun run src/cli.ts pick osito.png --list   # ver formas disponibles
bun run src/cli.ts pick osito.png --shape arch --path --out /tmp/a.png
```

Para el timing del corte:

```bash
for i in 1 2 3; do
  s=$(date +%s%N)
  ~/.config/fastfetch/kitty-shapes pick osito.png --size 384 --palette 256 --path --out /tmp/x.png
  e=$(date +%s%N); echo "$(( (e-s)/1000000 )) ms"
done
```

Referencia: ~145 ms por proceso, y **~90 ms son importar `@napi-rs/canvas`**;
el trabajo real (detectar + render + cuantizar + codificar) son ~52 ms. Por eso
el greeting cachea el emblema: en régimen normal esa carga no se paga.
