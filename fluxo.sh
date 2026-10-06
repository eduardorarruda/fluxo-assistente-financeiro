#!/usr/bin/env bash
# Abre o Fluxo: sobe o servidor (se não estiver de pé) e abre a janela.
#
#   ./fluxo.sh              uso normal — janela própria (Chrome --app)
#   ./fluxo.sh --navegador  abre numa aba do navegador padrão
#   ./fluxo.sh --servidor   só o servidor, sem janela (Ctrl+C para parar)
#
# Fechou a janela, o servidor percebe em até 90 s e desliga sozinho.

set -uo pipefail
umask 077   # banco, sessão e log: só você lê

PASTA="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORTA="${FLUXO_PORTA:-8778}"
ENDERECO="http://127.0.0.1:$PORTA"
LOG="${XDG_CACHE_HOME:-$HOME/.cache}/fluxo.log"

avisar() {
  echo "$1" >&2
  command -v notify-send >/dev/null && notify-send -a Fluxo -i "$PASTA/web/public/fluxo.svg" "Fluxo" "$1"
}

# O menu do KDE não carrega o nvm: procura o Node do mesmo jeito que o terminal acharia.
achar_node() {
  if [[ -n "${FLUXO_NODE:-}" && -x "$FLUXO_NODE" ]]; then echo "$FLUXO_NODE"; return; fi
  if command -v node >/dev/null; then command -v node; return; fi
  local candidato
  candidato="$(ls -1d "$HOME"/.local/share/nvm/v*/bin/node "$HOME"/.nvm/versions/node/v*/bin/node 2>/dev/null | sort -V | tail -1)"
  if [[ -n "$candidato" ]]; then echo "$candidato"; return; fi
  [[ -x /usr/bin/node ]] && echo /usr/bin/node
}

NODE="$(achar_node)"
if [[ -z "$NODE" ]]; then
  avisar "Node.js não encontrado. Instale o Node 22 ou mais novo."
  exit 1
fi
export PATH="$(dirname "$NODE"):$PATH"

if [[ ! -f "$PASTA/server/dist/main.js" || ! -f "$PASTA/web/dist/index.html" ]]; then
  avisar "Preparando o Fluxo pela primeira vez (uns segundos)…"
  (cd "$PASTA" && npm run build >>"$LOG" 2>&1) || { avisar "A compilação falhou. Veja $LOG"; exit 1; }
fi

de_pe() { curl -sf -m 1 "$ENDERECO/api/saude" >/dev/null 2>&1; }

PID=""
if ! de_pe; then
  mkdir -p "$(dirname "$LOG")"
  NODE_ENV=production DESLIGAR_SEM_JANELA=$([[ "${1:-}" == "--servidor" ]] && echo 0 || echo 1) \
  PORTA="$PORTA" "$NODE" "$PASTA/server/dist/main.js" >>"$LOG" 2>&1 &
  PID=$!
  for _ in $(seq 1 100); do de_pe && break; sleep 0.1; done
  if ! de_pe; then
    avisar "O Fluxo não subiu. Veja o log em $LOG"
    exit 1
  fi
fi

# Entrada de uso único: vira o cookie da sessão e some da barra de endereço.
ENTRADA="$ENDERECO/entrar?c=$(cat "$PASTA/data/.entrada" 2>/dev/null)"

case "${1:-}" in
  --servidor)
    echo "Fluxo em $ENDERECO — Ctrl+C para parar."
    [[ -n "$PID" ]] && wait "$PID"
    ;;
  --navegador)
    xdg-open "$ENTRADA" >/dev/null 2>&1
    ;;
  *)
    # Perfil próprio: assim a janela é um Chrome à parte e as opções abaixo valem mesmo
    # com o Chrome do dia a dia aberto. X11 (XWayland) porque no Wayland do KDE o Chrome
    # não entrega requestAnimationFrame para a janela e toda troca de tela ficava preta.
    PERFIL="${XDG_CONFIG_HOME:-$HOME/.config}/fluxo/chrome"
    OPCOES=(--app="$ENTRADA" --class=Fluxo --window-size=1480,940 --user-data-dir="$PERFIL"
            --ozone-platform=x11 --no-first-run --no-default-browser-check)
    if command -v google-chrome-stable >/dev/null; then
      google-chrome-stable "${OPCOES[@]}" >/dev/null 2>&1 &
    elif command -v chromium >/dev/null; then
      chromium "${OPCOES[@]}" >/dev/null 2>&1 &
    else
      xdg-open "$ENTRADA" >/dev/null 2>&1
    fi
    ;;
esac
