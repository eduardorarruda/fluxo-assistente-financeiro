import type { Alerta } from '../api/tipos';
import { CATEGORIAS } from './ambiente';
import estado from './fixtures/estado.json';
import visaoGeral from './fixtures/visao-geral.json';

export const AVISOS: Alerta[] = [
  { id: 'google:reconectar', gravidade: 'CRITICO', titulo: 'Google Agenda desconectado', detalhe: 'Conecte de novo.', destino: '/ajustes#google' },
  { id: 'orcamento:delivery', gravidade: 'INFO', titulo: 'Delivery perto do limite', detalhe: 'No ritmo atual passa.', destino: '/orcamento' },
  { id: 'aumento:spotify', gravidade: 'INFO', titulo: 'Spotify ficou mais caro', detalhe: 'De R$ 21,90 para R$ 23,90.', destino: '/recorrencias' },
];

/**
 * Um servidor de mentira que lembra o que foi dispensado (o fetch falso de
 * `renderizar` responde sempre igual, e a visão geral é recarregada depois de
 * cada dispensa). `falhar` faz a próxima escrita voltar 500.
 */
export function servidorDeAlertas(dispensadosNoInicio: string[] = []) {
  const dispensados = new Set(dispensadosNoInicio);
  const pedidos: { url: string; corpo: unknown; xFluxo: string | null }[] = [];
  const s = { falhar: false };
  const situacao = () => ({ alertas: AVISOS.filter((a) => !dispensados.has(a.id)), dispensados: dispensados.size });
  const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });

  globalThis.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const caminho = String(url);
    if (!init?.method || init.method === 'GET') {
      if (caminho.startsWith('/api/estado')) return json(estado);
      if (caminho.startsWith('/api/categorias')) return json(CATEGORIAS);
      if (caminho.startsWith('/api/visao-geral')) {
        const { alertas, dispensados: n } = situacao();
        return json({ ...visaoGeral, alertas, alertasDispensados: n });
      }
      return json({});
    }
    const corpo = init.body ? (JSON.parse(String(init.body)) as { ids?: string[] }) : undefined;
    pedidos.push({ url: caminho, corpo, xFluxo: new Headers(init.headers).get('X-Fluxo') });
    if (s.falhar) {
      s.falhar = false;
      return json({ erro: 'O servidor recusou.' }, 500);
    }
    if (caminho === '/api/alertas/dispensar') for (const id of corpo?.ids ?? []) dispensados.add(id);
    if (caminho === '/api/alertas/dispensar-todos') for (const a of AVISOS) dispensados.add(a.id);
    if (caminho === '/api/alertas/restaurar') dispensados.clear();
    return json(situacao());
  }) as typeof fetch;

  return { pedidos, controle: s };
}
