#!/usr/bin/env bash
# Diagnóstico del avatar de Noctalia v5.
#
#   ./noctalia-avatar-check.sh
#
# Comprueba: de dónde sale el avatar_path, si el fichero existe, si
# AccountsService está disponible y qué IconFile tiene registrado tu usuario.
# No modifica nada: solo informa.
set -uo pipefail

ok="  ok  "
warn="aviso "
bad=" FALLO"

echo "═══ Noctalia v5 · avatar del usuario ═══"
echo

# ── 1. De dónde sale el valor ───────────────────────────────────────────────
echo "1) Configuración"
if command -v noctalia >/dev/null 2>&1; then
  # Una sola llamada: la config exportada se reusa para el valor y el estado.
  export_cfg="$(noctalia config export 2>/dev/null)"
  avatar_path="$(printf '%s\n' "$export_cfg" |
    sed -n 's/^[[:space:]]*avatar_path[[:space:]]*=[[:space:]]*"\(.*\)".*/\1/p' | head -1)"
  if [ -n "$avatar_path" ]; then
    echo "$ok avatar_path = $avatar_path"
  else
    echo "$warn no sale avatar_path en 'noctalia config export' (puede ser el valor por defecto)"
  fi

  full="$(noctalia config export full 2>/dev/null | grep -i avatar || true)"
  [ -n "$full" ] && echo "     valor efectivo: $full"

  state_file="${XDG_STATE_HOME:-$HOME/.local/state}/noctalia/settings.toml"
  if [ -f "$state_file" ]; then
    state_avatar="$(sed -n 's/^[[:space:]]*avatar_path[[:space:]]*=[[:space:]]*"\(.*\)".*/\1/p' "$state_file" | head -1)"
    if [ -z "$state_avatar" ]; then
      echo "$ok la GUI no overridea el avatar"
    elif [ "$state_avatar" = "$avatar_path" ]; then
      echo "$ok la GUI usa el mismo avatar que la config"
    else
      echo "$warn la GUI tiene otro avatar en $state_file (GANA sobre tu config):"
      echo "     avatar_path = $state_avatar"
    fi
  else
    echo "     (no hay $state_file: la GUI no ha guardado overrides)"
  fi

else
  echo "$warn no encuentro el binario 'noctalia' en el PATH"
  avatar_path=""
fi
echo

# ── 2. ¿Existe el fichero? ─────────────────────────────────────────────────
echo "2) Fichero"
if [ -n "$avatar_path" ]; then
  expanded="${avatar_path/#\~/$HOME}"
  if [ -f "$expanded" ]; then
    echo "$ok existe: $expanded ($(stat -c%s "$expanded" 2>/dev/null || stat -f%z "$expanded") bytes)"
    if command -v identify >/dev/null 2>&1; then
      echo "     $(identify -format '%wx%h %[channels]' "$expanded" 2>/dev/null)"
    fi
  else
    echo "$bad NO existe: $expanded"
    echo "     -> genéralo con:  kitty-shapes pick ~/osito.png --shape cookie12 --size 512 \\"
    echo "                       --palette 256 --path --out '$expanded'"
  fi
else
  echo "     (sin avatar_path definido)"
fi
echo

# ── 3. AccountsService ─────────────────────────────────────────────────────
echo "3) AccountsService (lo que usa el greeter)"
if command -v busctl >/dev/null 2>&1; then
  if busctl --user status org.freedesktop.Accounts >/dev/null 2>&1; then
    echo "$ok el bus de org.freedesktop.Accounts responde"
    as_running=1
  else
    echo "$warn org.freedesktop.Accounts no está en el bus de sesión"
    as_running=0
  fi
else
  echo "     (busctl no instalado, me salto la comprobación del bus)"
  as_running=unknown
fi

if command -v systemctl >/dev/null 2>&1; then
  if systemctl is-active --quiet accounts-daemon 2>/dev/null; then
    echo "$ok accounts-daemon está activo"
  elif systemctl is-enabled --quiet accounts-daemon 2>/dev/null; then
    echo "$warn accounts-daemon está habilitado pero no activo:  sudo systemctl start accounts-daemon"
  else
    echo "$warn accounts-daemon no está instalado/activo (en Arch: sudo pacman -S accountsservice)"
  fi
fi

if command -v loginctl >/dev/null 2>&1; then
  icon="$(loginctl show-user "$(id -un)" -p IconFile --value 2>/dev/null)"
  if [ -n "$icon" ]; then
    echo "     IconFile registrado: $icon"
    if [ -f "$icon" ]; then
      echo "$ok el greeter tiene una imagen"
    else
      echo "$bad el IconFile apunta a algo que no existe"
    fi
  else
    echo "     IconFile: (vacío: el greeter usará el avatar por defecto)"
  fi
fi
echo

# ── 4. Resumen ─────────────────────────────────────────────────────────────
echo "═══ Resumen ═══"
if [ -n "$avatar_path" ] && [ -f "${avatar_path/#\~/$HOME}" ]; then
  echo "  · Noctalia tiene avatar y el fichero existe  -> ya debería estar en marcha"
else
  echo "  · Falta el avatar: genéralo y ponlo en [shell] avatar_path"
fi
case "$as_running" in
  1) echo "  · Con AccountsService, Noctalia escribe el IconFile solo: el greeter verá el mismo oso" ;;
  *) echo "  · Sin AccountsService, copia a mano:  cp <avatar> ~/.face && cp <avatar> ~/.face.icon" ;;
esac
echo
echo "  · Recargar tras tocar la config:  noctalia msg config-reload"
