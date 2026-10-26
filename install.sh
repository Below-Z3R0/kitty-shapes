#!/usr/bin/env bash
# Instalador de kitty-shapes.
#
#   ./install.sh              instala desde el código de este repo (desarrollo)
#   ./install.sh --release    baja el último release y lo instala
#   ./install.sh --dry-run    muestra qué haría, sin tocar nada
#   ./install.sh --help
#
# El trabajo real lo hace `kitty-shapes install`: este script solo
# consigue el binario (compilándolo o bajándolo) y le pasa los argumentos.
# Así no hay dos implementaciones de la instalación que se puedan separar.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE="${1:---dev}"

have() { command -v "$1" >/dev/null 2>&1; }

case "$MODE" in
  -h|--help)
    sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
  --release)
    shift || true
    tmp="$(mktemp -d)"
    trap 'rm -rf "$tmp"' EXIT
    echo "▸ Bajando el último release"
    curl -fsSL "https://github.com/Below-Z3R0/kitty-shapes/releases/latest/download/kitty-shapes.tar.gz?cb=$(date +%s)" \
      | tar xz -C "$tmp"
    "$tmp/kitty-shapes/kitty-shapes" install --from "$tmp/kitty-shapes" "$@"
    exit $?
    ;;
esac

# Desarrollo: compila este repo y delega. bun vive en ~/.bun/bin y no
# está en el PATH de un script no-login.
if ! have bun && [ -x "$HOME/.bun/bin/bun" ]; then
  export PATH="$HOME/.bun/bin:$PATH"
fi
have bun || { echo "falta bun → https://bun.sh/install" >&2; exit 1; }

bin="$(mktemp /tmp/kitty-shapes-XXXXXX)"
bun build "$REPO_DIR/src/cli/index.ts" --compile --outfile "$bin" >/dev/null
"$bin" install --from "$REPO_DIR" "${@:1}"
rm -f "$bin"
