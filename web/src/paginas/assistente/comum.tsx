import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProvedorIA } from '../../api/tipos-assistente';
import { Icone } from '../../icones/Icone';

export const NOME_PROVEDOR: Record<ProvedorIA, string> = { claude: 'Claude', gemini: 'Gemini', codex: 'Codex' };

/** O nome que a pessoa conhece de cada provedor (escolha do provedor, nome sugerido de conta de API). */
export const MARCA_PROVEDOR: Record<ProvedorIA, string> = { claude: 'Claude', gemini: 'Gemini', codex: 'ChatGPT' };

/** Marca do CLI que respondeu: um selo pequeno com a cor de cada um. */
export function MarcaProvedor({ provedor, tamanho = 28 }: { provedor: ProvedorIA | null; tamanho?: number }) {
  const p = provedor ?? 'claude';
  return (
    <span className={`marca-ia marca-ia--${p}`} style={{ width: tamanho, height: tamanho }} aria-hidden>
      <Icone nome={`ia-${p}`} tamanho={Math.round(tamanho * 0.56)} traco={2} />
    </span>
  );
}

/** 850 ms · 12,4 s · 2 min 05 s */
export function duracaoLegivel(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s`;
  const min = Math.floor(s / 60);
  return `${min} min ${String(Math.round(s % 60)).padStart(2, '0')} s`;
}

/** Copia para a área de transferência; sem a API (janela sem HTTPS antigo), usa a seleção. */
export async function copiarTexto(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = texto;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand?.('copy') ?? false;
    area.remove();
    return ok;
  }
}

const TEMPO_COPIADO_MS = 1600;

/** Botão de copiar com o "Copiado" de confirmação. `texto` pode ser calculado na hora do clique. */
export function BotaoCopiar({ texto, rotulo = 'Copiar', comTexto = false, className = '' }: { texto: string | (() => string); rotulo?: string; comTexto?: boolean; className?: string }) {
  const [copiado, setCopiado] = useState(false);
  const relogio = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(relogio.current), []);
  const copiar = useCallback(async () => {
    const ok = await copiarTexto(typeof texto === 'function' ? texto() : texto);
    if (!ok) return;
    setCopiado(true);
    clearTimeout(relogio.current);
    relogio.current = setTimeout(() => setCopiado(false), TEMPO_COPIADO_MS);
  }, [texto]);
  const nome = copiado ? 'Copiado' : rotulo;
  return (
    <button type="button" className={`acao-mini ${copiado ? 'acao-mini--ok' : ''} ${className}`} onClick={() => void copiar()} aria-label={nome} title={nome}>
      <Icone nome={copiado ? 'check' : 'copiar'} tamanho={15} />
      {comTexto && <span>{nome}</span>}
      <span className="oculto-leitor" aria-live="polite">{copiado ? 'Copiado' : ''}</span>
    </button>
  );
}

/** Verdadeiro quando a tela é estreita (a lista de conversas vira gaveta). */
export function useTelaEstreita(largura = 900): boolean {
  const consulta = `(max-width: ${largura}px)`;
  const [estreita, setEstreita] = useState(() => window.matchMedia(consulta).matches);
  useEffect(() => {
    const m = window.matchMedia(consulta);
    const mudou = () => setEstreita(m.matches);
    mudou();
    m.addEventListener('change', mudou);
    return () => m.removeEventListener('change', mudou);
  }, [consulta]);
  return estreita;
}

/** Um comando de terminal pronto para copiar ("Para instalar", "Para entrar nesta conta"). */
export function Comando({ rotulo, comando, destaque = false }: { rotulo: string; comando: string; destaque?: boolean }) {
  if (!comando) return null;
  return (
    <div className={`comando-ia ${destaque ? 'comando-ia--destaque' : ''}`}>
      <span className="texto-3 pequeno">{rotulo}</span>
      <div className="comando-ia__codigo">
        <code>{comando}</code>
        <BotaoCopiar texto={comando} rotulo={`Copiar: ${rotulo.toLowerCase()}`} />
      </div>
    </div>
  );
}
