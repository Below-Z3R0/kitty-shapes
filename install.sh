#!/usr/bin/env bash
# Instalador de kitty-shapes: deja el greeting andando desde cero.
#
#   ./install.sh              instala (idempotente: se puede repetir)
#   ./install.sh --dry-run    muestra qué haría, sin tocar nada
#   ./install.sh --uninstall  revierte lo que instaló este script
#   ./install.sh --no-fish    no toca ~/.config/fish/config.fish
#
# Qué hace:
#   1. comprueba las dependencias (bun, fastfetch, kitty)
#   2. bun install + typecheck + tests
#   3. compila el binario  → ~/.config/fastfetch/kitty-shapes
#   4. copia el script    → ~/.config/fastfetch/b3l0wz3r0-fastfetch
#   5. copia las configs  → ~/.config/fastfetch/config{,-min,-micro}.jsonc
#   6. copia las formas   → ~/.config/fastfetch/emblem-shapes.txt
#   7. engancha el greeting en fish (si no está ya)
#
# Nunca pisa un archivo del usuario sin hacer backup: todo lo que sobrescribe
# queda como <archivo>.bak-<fecha>.

set -euo pipefail

# bun instala en ~/.bun/bin, que no suele estar en el PATH de un script no-login
export PATH="$HOME/.bun/bin:$PATH"

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/fastfetch"
FISH_CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/fish/config.fish"
BIN="$CONFIG_DIR/kitty-shapes"
SCRIPT="$CONFIG_DIR/b3l0wz3r0-fastfetch"
SHAPES="$CONFIG_DIR/emblem-shapes.txt"
STAMP="$(date +%Y%m%d-%H%M%S)"

DRY_RUN=0
UNINSTALL=0
TOUCH_FISH=1

# ── salida ──────────────────────────────────────────────────────────────────
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'
  C_DIM=$'\033[2m'; C_B=$'\033[1m'; C_OFF=$'\033[0m'
else
  C_OK=""; C_WARN=""; C_ERR=""; C_DIM=""; C_B=""; C_OFF=""
fi

step() { printf '%s▸%s %s\n' "$C_B" "$C_OFF" "$*"; }
ok()   { printf '  %s✓%s %s\n' "$C_OK" "$C_OFF" "$*"; }
warn() { printf '  %s!%s %s\n' "$C_WARN" "$C_OFF" "$*"; }
die()  { printf '  %s✗%s %s\n' "$C_ERR" "$C_OFF" "$*" >&2; exit 1; }
run()  { if [ "$DRY_RUN" = 1 ]; then printf '  %s· %s%s\n' "$C_DIM" "$*" "$C_OFF"; else "$@"; fi; }
have() { command -v "$1" >/dev/null 2>&1; }

# ── argumentos ──────────────────────────────────────────────────────────────
for arg in "$@"; do
  case "$arg" in
    --dry-run)   DRY_RUN=1 ;;
    --uninstall) UNINSTALL=1 ;;
    --no-fish)   TOUCH_FISH=0 ;;
    -h|--help)   sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "opción desconocida: $arg (probá --help)" ;;
  esac
done

# ── pasos declarados (para dry-run y uninstall) ─────────────────────────────
# Cada paso es: nombre|ruta destino|fuente|tipo
#   code   → se actualiza siempre (con backup): es código del repo
#   config → NUNCA se pisa: es del usuario (los colores los sincroniza Noctalia)
targets() {
  printf '%s\n' \
    "binario|$BIN|$REPO/src/cli.ts|code" \
    "script|$SCRIPT|$REPO/examples/fastfetch-kitty.sh|code" \
    "formas|$SHAPES|$REPO/examples/emblem-shapes.txt|config" \
    "config|$CONFIG_DIR/config.jsonc|$REPO/examples/fastfetch-config.jsonc|config" \
    "config-min|$CONFIG_DIR/config-min.jsonc|$REPO/examples/fastfetch-config-min.jsonc|config" \
    "config-micro|$CONFIG_DIR/config-micro.jsonc|$REPO/examples/fastfetch-config-micro.jsonc|config"
}

backup() {
  [ -e "$1" ] || return 0
  cp -a "$1" "$1.bak-$STAMP"
  ok "backup: $1.bak-$STAMP"
}

if [ "$UNINSTALL" = 1 ]; then
  step "Desinstalando kitty-shapes"
  targets | while IFS='|' read -r _ dest _ tipo; do
    if [ "$tipo" = "config" ]; then
      if [ -e "$dest" ]; then
        if [ "$DRY_RUN" = 1 ]; then
          printf '  %s· dejaría %s (es configuración tuya)%s\n' "$C_DIM" "$dest" "$C_OFF"
        else
          ok "se deja: $dest (es configuración tuya)"
        fi
      fi
      continue
    fi
    if [ -e "$dest" ]; then
      if [ "$DRY_RUN" = 1 ]; then
        printf '  %s· borraría %s%s\n' "$C_DIM" "$dest" "$C_OFF"
      else
        rm -f "$dest" && ok "borrado: $dest"
      fi
    fi
  done
  if [ "$TOUCH_FISH" = 1 ] && [ -f "$FISH_CONFIG" ]; then
    if grep -q 'b3l0wz3r0-fastfetch' "$FISH_CONFIG"; then
      if [ "$DRY_RUN" = 1 ]; then
        printf '  %s· quitaría el enganche de fish%s\n' "$C_DIM" "$C_OFF"
      else
        cp -a "$FISH_CONFIG" "$FISH_CONFIG.bak-$STAMP"
        perl -0pi -e 's/\n# Custom greeting.*?\nend\n//s' "$FISH_CONFIG"
        perl -0pi -e 's/\n# kitty-shapes — greeting con emblema.*?\nset -gx FASTFETCH_RERENDER 1\n//s' "$FISH_CONFIG"
        ok "enganche de fish quitado (backup: $FISH_CONFIG.bak-$STAMP)"
      fi
    fi
  fi
  printf '\n%sListo.%s Los backups quedan como *.bak-%s.\n' "$C_B" "$C_OFF" "$STAMP"
  exit 0
fi

printf '\n%skitty-shapes · instalador%s\n' "$C_B" "$C_OFF"

# ── 1. dependencias ─────────────────────────────────────────────────────────
step "Comprobando dependencias"
missing=0
for dep in bun fastfetch kitty; do
  if have "$dep"; then
    ok "$dep"
  else
    case "$dep" in
      bun)      warn "falta bun  → curl -fsSL https://bun.sh/install | bash" ;;
      fastfetch) warn "falta fastfetch → sudo pacman -S fastfetch" ;;
      kitty)    warn "falta kitty   → sudo pacman -S kitty" ;;
    esac
    missing=1
  fi
done
[ "$missing" = 1 ] && [ "$DRY_RUN" = 0 ] && die "faltan dependencias (arriba está cómo instalarlas)"

# bun 1.4+ escribe `bun.lock` con lockfileVersion 2; bun 1.3 no lo sabe leer y
# lo reescribe a v1 en cada `bun install` (el lockfile nunca queda quieto).
if have bun; then
  bun_version="$(bun --version 2>/dev/null || echo 0)"
  bun_major="${bun_version%%.*}"
  bun_rest="${bun_version#*.}"
  bun_minor="${bun_rest%%.*}"
  if [ "$bun_major" -lt 1 ] || { [ "$bun_major" -eq 1 ] && [ "$bun_minor" -lt 4 ]; }; then
    warn "bun $bun_version es anterior a 1.4 → actualizalo: bun upgrade"
  else
    ok "bun $bun_version (soporta lockfileVersion 2)"
  fi
fi

# ── 2. dependencias del proyecto ────────────────────────────────────────────
step "Instalando dependencias del proyecto"
cd "$REPO"
run bun install
if [ -f bun.lock ]; then
  lock_v="$(grep -oE '"lockfileVersion"[[:space:]]*:[[:space:]]*[0-9]+' bun.lock | head -1 | grep -oE '[0-9]+')"
  ok "bun.lock con lockfileVersion ${lock_v:-?}"
fi
run bun run typecheck
run bun test

# ── 3. binario ──────────────────────────────────────────────────────────────
step "Compilando el binario"
mkdir -p "$CONFIG_DIR"
if [ "$DRY_RUN" = 1 ]; then
  printf '  %s· bun build --compile → %s%s\n' "$C_DIM" "$BIN" "$C_OFF"
else
  run bun build --compile ./src/cli.ts --outfile "$BIN"
  ok "binario: $BIN"
fi

# ── 4. archivos en ~/.config/fastfetch ──────────────────────────────────────
step "Instalando archivos en $CONFIG_DIR"
targets | while IFS='|' read -r nombre dest src tipo; do
  [ "$nombre" = "binario" ] && continue
  if [ ! -f "$src" ]; then
    warn "falta la fuente: $src"
    continue
  fi
  if [ -e "$dest" ]; then
    if cmp -s "$src" "$dest"; then
      ok "sin cambios: $dest"
    elif [ "$tipo" = "config" ]; then
      # es del usuario (los colores los sincroniza Noctalia): no se toca
      warn "dejado como está (personalizado): $dest"
      warn "  la versión del repo está en: $src"
    else
      if [ "$DRY_RUN" = 1 ]; then
        printf '  %s· actualizaría %s (hay backup previo)%s\n' "$C_DIM" "$dest" "$C_OFF"
      else
        backup "$dest"
        cp -a "$src" "$dest"
        ok "actualizado: $dest"
      fi
    fi
  else
    if [ "$DRY_RUN" = 1 ]; then
      printf '  %s· crearía %s%s\n' "$C_DIM" "$dest" "$C_OFF"
    else
      cp -a "$src" "$dest"
      ok "creado: $dest"
    fi
  fi
done
chmod +x "$SCRIPT" 2>/dev/null || true

# ── 5. enganche en fish ─────────────────────────────────────────────────────
if [ "$TOUCH_FISH" = 1 ]; then
  step "Enganchando el greeting en fish"
  if [ ! -f "$FISH_CONFIG" ]; then
    warn "no existe $FISH_CONFIG — se omite el enganche"
  elif grep -q 'b3l0wz3r0-fastfetch' "$FISH_CONFIG"; then
    ok "ya enganchado en $FISH_CONFIG"
  else
    if [ "$DRY_RUN" = 1 ]; then
      printf '  %s· añadiría fish_greeting a %s%s\n' "$C_DIM" "$FISH_CONFIG" "$C_OFF"
    else
      backup "$FISH_CONFIG"
      cat >> "$FISH_CONFIG" <<'FISH'

# kitty-shapes — greeting con emblema (instalado por install.sh)
function fish_greeting
    if test -x "$HOME/.config/fastfetch/b3l0wz3r0-fastfetch"
        "$HOME/.config/fastfetch/b3l0wz3r0-fastfetch"
    else if command -v fastfetch >/dev/null
        fastfetch --config "$HOME/.config/fastfetch/config.jsonc"
    end
end
set -gx FASTFETCH_RERENDER 1
FISH
      ok "enganchado en $FISH_CONFIG"
    fi
  fi
fi

# ── 6. verificación ─────────────────────────────────────────────────────────
if [ "$DRY_RUN" = 0 ]; then
  step "Verificando"
  if "$BIN" --help >/dev/null 2>&1; then
    ok "el binario responde --help"
  else
    die "el binario no responde (revisá el log de compilación)"
  fi
  if bash -n "$SCRIPT"; then
    ok "el script del greeting es bash válido"
  else
    die "el script del greeting tiene errores de sintaxis"
  fi
fi

if [ "$DRY_RUN" = 1 ]; then
  printf '\n%sSimulación terminada.%s No se cambió nada.\n' "$C_B" "$C_OFF"
  printf '  · para aplicarlo de verdad:  ./install.sh\n\n'
  exit 0
fi

printf '\n%sInstalado.%s\n' "$C_B" "$C_OFF"
if [ "$DRY_RUN" = 0 ]; then
  printf '  · probá el greeting con:  %s~/.config/fastfetch/b3l0wz3r0-fastfetch%s\n' "$C_DIM" "$C_OFF"
  printf '  · o abrí una terminal nueva\n'
  printf '  · para desinstalar:      ./install.sh --uninstall\n'
fi
printf '\n'
