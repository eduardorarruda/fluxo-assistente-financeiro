#!/usr/bin/env bash
# Log do Fluxo: um arquivo por dia em <cache>/fluxo/, e o que passar de 90 dias é apagado.
#
#   scripts/rotacionar-log.sh <pasta de cache>   →  imprime o caminho do log de hoje
#
# O log antigo (um arquivo só, <cache>/fluxo.log) é dividido uma vez por data, para
# que as linhas velhas também saiam aos 90 dias. <cache>/fluxo.log vira um atalho
# para o log do dia, então quem procura no lugar de sempre continua achando.
set -euo pipefail
umask 077

CACHE="${1:?informe a pasta de cache}"
DIAS_GUARDADOS="${FLUXO_LOG_DIAS:-90}"
PASTA="$CACHE/fluxo"
ANTIGO="$CACHE/fluxo.log"
HOJE="$(date +%F)"

mkdir -p "$PASTA"
chmod 700 "$PASTA"

# Uma vez só: o arquivo único de antes vira arquivos por dia (data das linhas do Nest: dd/mm/aaaa).
if [[ -f "$ANTIGO" && ! -L "$ANTIGO" ]]; then
  primeira="$(grep -oE '[0-9]{2}/[0-9]{2}/[0-9]{4}, [0-9]{2}:[0-9]{2}' "$ANTIGO" | head -1 | cut -c1-10 || true)"
  if [[ -n "$primeira" ]]; then
    inicio="${primeira:6:4}-${primeira:3:2}-${primeira:0:2}"
  else
    inicio="$(date -r "$ANTIGO" +%F)"
  fi
  # Linha sem data (saída do build, avisos) fica no dia da última linha com data.
  awk -v pasta="$PASTA" -v dia="$inicio" '
    match($0, /[0-9][0-9]\/[0-9][0-9]\/[0-9][0-9][0-9][0-9], [0-9][0-9]:[0-9][0-9]/) {
      d = substr($0, RSTART, 10); dia = substr(d, 7, 4) "-" substr(d, 4, 2) "-" substr(d, 1, 2)
    }
    { print >> (pasta "/fluxo-" dia ".log") }
  ' "$ANTIGO"
  for arquivo in "$PASTA"/fluxo-*.log; do
    dia="$(basename "$arquivo" .log)"; dia="${dia#fluxo-}"
    [[ "$dia" < "$HOJE" ]] && touch -d "$dia 23:59" "$arquivo"
  done
  rm -f "$ANTIGO"
fi

find "$PASTA" -maxdepth 1 -name 'fluxo-*.log' -type f -mtime +"$DIAS_GUARDADOS" -delete

LOG="$PASTA/fluxo-$HOJE.log"
touch "$LOG"
chmod 600 "$LOG"
ln -sfn "$LOG" "$ANTIGO"
echo "$LOG"
