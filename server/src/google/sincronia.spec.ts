import { ApiAgenda } from './agenda-api';
import type { MapaDeEventos } from './cofre-google';
import { hashDoCorpo, type CorpoDoEvento, type EventoDesejado } from './eventos';
import { aplicarNaAgenda, reconciliar } from './sincronia';
import { GoogleFalso } from './testing/google-falso';

function desejado(chave: string, summary: string): EventoDesejado {
  const corpo: CorpoDoEvento = {
    summary, description: '', start: { date: '2026-10-10' }, end: { date: '2026-10-11' }, colorId: '7', status: 'confirmed',
    transparency: 'transparent', reminders: { useDefault: false, overrides: [] }, extendedProperties: { private: { fluxo: '1', fluxoChave: chave } },
  };
  return { chave, hash: hashDoCorpo(corpo), corpo };
}

async function montar() {
  const google = new GoogleFalso();
  const api = new ApiAgenda(google.fetch, { tokenDeAcesso: async () => 'acesso-1', descartarToken: () => undefined, esperar: async () => undefined, intervaloMs: 0 });
  const agenda = await api.criarAgenda();
  const salvos: MapaDeEventos[] = [];
  const aplicar = (d: EventoDesejado[], mapa: MapaDeEventos) => aplicarNaAgenda(api, agenda, d, mapa, (m) => salvos.push(m));
  return { google, api, agenda, salvos, aplicar };
}

describe('aplicarNaAgenda', () => {
  it('cria o que falta, guarda o hash no evento e no mapa; de novo, igual, não chama o Google', async () => {
    const { google, agenda, salvos, aplicar } = await montar();
    const d = [desejado('a', 'Pagar: Luz'), desejado('b', 'Pagar: Água')];
    expect(await aplicar(d, {})).toEqual({ criados: 2, atualizados: 0, apagados: 0, iguais: 0 });
    const mapa = salvos.at(-1)!;
    expect(Object.keys(mapa).sort()).toEqual(['a', 'b']);
    expect(mapa.a!.hash).toBe(d[0]!.hash);
    expect(google.eventosDe(agenda).map((e) => (e.extendedProperties as { private: Record<string, string> }).private)).toEqual([
      { fluxo: '1', fluxoChave: 'a', fluxoHash: d[0]!.hash },
      { fluxo: '1', fluxoChave: 'b', fluxoHash: d[1]!.hash },
    ]);
    const antes = google.chamadas.length;
    expect(await aplicar(d, mapa)).toEqual({ criados: 0, atualizados: 0, apagados: 0, iguais: 2 });
    expect(google.chamadas.length).toBe(antes);
  });

  it('conteúdo mudou → PUT no mesmo evento; item sumiu → DELETE e sai do mapa', async () => {
    const { google, agenda, salvos, aplicar } = await montar();
    await aplicar([desejado('a', 'Pagar: Luz'), desejado('b', 'Pagar: Água')], {});
    const mapa = salvos.at(-1)!;
    const r = await aplicar([desejado('a', '✓ Paga: Luz')], mapa);
    expect(r).toEqual({ criados: 0, atualizados: 1, apagados: 1, iguais: 0 });
    expect(google.chamadas.slice(-2).map((c) => c.metodo)).toEqual(['PUT', 'DELETE']);
    expect(Object.keys(salvos.at(-1)!)).toEqual(['a']);
    expect(salvos.at(-1)!.a!.id).toBe(mapa.a!.id);
    expect(google.eventosDe(agenda).map((e) => e.summary)).toEqual(['✓ Paga: Luz']);
  });

  it('evento apagado à mão no Google: o PUT dá 404 e ele é recriado', async () => {
    const { google, agenda, salvos, aplicar, api } = await montar();
    await aplicar([desejado('a', 'Pagar: Luz')], {});
    const mapa = salvos.at(-1)!;
    await api.apagarEvento(agenda, mapa.a!.id);
    expect(await aplicar([desejado('a', 'Pagar: Luz (novo valor)')], mapa)).toMatchObject({ criados: 1, atualizados: 0 });
    expect(salvos.at(-1)!.a!.id).not.toBe(mapa.a!.id);
    expect(google.eventosDe(agenda)).toHaveLength(1);
  });
});

describe('aplicarNaAgenda — interrupção', () => {
  it('a 2ª criação falha: o mapa salvo tem a 1ª; rodar de novo cria só a 2ª', async () => {
    const google = new GoogleFalso();
    const salvos: MapaDeEventos[] = [];
    const d = [desejado('a', 'A'), desejado('b', 'B')];
    let n = 0;
    const original = google.fetch;
    const comFalha = (async (url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST' && String(url).includes('/events') && ++n === 2) return new Response(JSON.stringify({ error: { errors: [{ reason: 'invalid' }] } }), { status: 400 });
      return original(url, init);
    }) as typeof fetch;
    const api = new ApiAgenda(comFalha, { tokenDeAcesso: async () => 'acesso-1', descartarToken: () => undefined, esperar: async () => undefined, intervaloMs: 0 });
    const agenda = await api.criarAgenda();
    await expect(aplicarNaAgenda(api, agenda, d, {}, (m) => salvos.push(m))).rejects.toThrow();
    expect(Object.keys(salvos.at(-1)!)).toEqual(['a']);
    expect(await aplicarNaAgenda(api, agenda, d, salvos.at(-1)!, (m) => salvos.push(m))).toEqual({ criados: 1, atualizados: 0, apagados: 0, iguais: 1 });
    expect(google.eventosDe(agenda)).toHaveLength(2);
  });
});

describe('reconciliar', () => {
  it('refaz o mapa pelo Google, ignora eventos da pessoa e apaga chaves duplicadas', async () => {
    const { google, agenda, api } = await montar();
    await api.inserirEvento(agenda, { ...desejado('a', 'A').corpo, extendedProperties: { private: { fluxo: '1', fluxoChave: 'a', fluxoHash: 'h1' } } });
    await api.inserirEvento(agenda, { ...desejado('a', 'A').corpo, extendedProperties: { private: { fluxo: '1', fluxoChave: 'a', fluxoHash: 'h1' } } });
    await api.inserirEvento(agenda, { summary: 'Aniversário da Ana' } as never);
    const { mapa, apagados } = await reconciliar(api, agenda);
    expect(apagados).toBe(1);
    expect(Object.keys(mapa)).toEqual(['a']);
    expect(mapa.a!.hash).toBe('h1');
    expect(google.eventosDe(agenda).map((e) => e.summary)).toEqual(['A', 'Aniversário da Ana']);
  });
});
