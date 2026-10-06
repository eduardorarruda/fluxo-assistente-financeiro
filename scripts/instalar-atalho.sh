#!/usr/bin/env bash
# Põe o Fluxo no menu de aplicativos (KDE, GNOME…): copia fluxo.desktop para
# ~/.local/share/applications com o caminho desta pasta no lugar de @PASTA@.
set -euo pipefail
PASTA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESTINO="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
mkdir -p "$DESTINO"
sed "s|@PASTA@|$PASTA|g" "$PASTA/fluxo.desktop" > "$DESTINO/fluxo.desktop"
chmod +x "$PASTA/fluxo.sh"
command -v update-desktop-database >/dev/null && update-desktop-database "$DESTINO" >/dev/null 2>&1 || true
echo "Pronto: procure \"Fluxo\" no menu de aplicativos."
