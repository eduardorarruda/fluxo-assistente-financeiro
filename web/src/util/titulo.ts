import { ROTAS } from '../componentes/Navegacao';

const OUTRAS: Record<string, string> = { '/conexoes': 'Conexões', '/ajustes': 'Ajustes' };

/** Nome da tela para o <title> da aba (WCAG 2.4.2): o leitor de tela anuncia ao trocar de página. */
export function tituloDaPagina(caminho: string): string {
  const rota = ROTAS.find((r) => (r.caminho === '/' ? caminho === '/' : caminho.startsWith(r.caminho)));
  const nome = rota?.nome ?? Object.entries(OUTRAS).find(([c]) => caminho.startsWith(c))?.[1] ?? 'Página não encontrada';
  return `${nome} · Fluxo`;
}
