#!/usr/bin/env bash
# Teste do scripts/rotacionar-log.sh numa pasta temporária (nunca no ~/.cache de verdade).
set -euo pipefail
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
falhou() { echo "FALHOU: $1" >&2; exit 1; }
hoje="$(date +%F)"
velho="$(date -d '-120 days' +%d/%m/%Y)"; velho_iso="$(date -d '-120 days' +%F)"
recente="$(date -d '-10 days' +%d/%m/%Y)"; recente_iso="$(date -d '-10 days' +%F)"

printf '%s\n' "saída do build sem data" \
  "[Nest] 1  - $velho, 10:00:00     LOG [Fluxo] Pronto" \
  "linha solta depois" \
  "[Nest] 2  - $recente, 11:00:00     LOG [Fluxo] Pronto" > "$T/fluxo.log"

saida="$("$AQUI/rotacionar-log.sh" "$T")"
[[ "$saida" == "$T/fluxo/fluxo-$hoje.log" ]] || falhou "caminho de hoje: $saida"
[[ -L "$T/fluxo.log" ]] || falhou "fluxo.log devia virar atalho"
[[ ! -e "$T/fluxo/fluxo-$velho_iso.log" ]] || falhou "o dia de 120 dias atrás devia ter sido apagado"
[[ -f "$T/fluxo/fluxo-$recente_iso.log" ]] || falhou "o dia de 10 dias atrás devia ficar"
grep -q "11:00:00" "$T/fluxo/fluxo-$recente_iso.log" || falhou "linha recente no arquivo do dia"
[[ "$(stat -c %a "$T/fluxo")" == 700 ]] || falhou "pasta 0700"
[[ "$(stat -c %a "$T/fluxo/fluxo-$hoje.log")" == 600 ]] || falhou "log 0600"

# Rodar de novo não estraga nada e continua apagando o que passa de 90 dias.
touch -d '-91 days' "$T/fluxo/fluxo-$recente_iso.log"
"$AQUI/rotacionar-log.sh" "$T" >/dev/null
[[ ! -e "$T/fluxo/fluxo-$recente_iso.log" ]] || falhou "arquivo com mais de 90 dias devia sair"
[[ -f "$T/fluxo/fluxo-$hoje.log" ]] || falhou "log de hoje continua"
echo "rotacionar-log: ok"
