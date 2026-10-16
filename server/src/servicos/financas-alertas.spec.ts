import { abrirBanco } from '../db/conexao';
import { Repositorio } from '../dados/repositorio';
import type { Alerta, Gravidade } from '../domain/alertas';
import { relogioFixo } from '../relogio';
import { Financas } from './financas';

const aviso = (id: string, gravidade: Gravidade, titulo = id): Alerta => ({ id, gravidade, titulo, detalhe: '', destino: '/ajustes#google' });

/** Finanças vazias + uma fonte de avisos controlada pelo teste (como a do Google Agenda). */
function montar() {
  const relogio = relogioFixo('2026-09-24');
  const repo = new Repositorio(abrirBanco(':memory:'), relogio);
  const financas = new Financas(repo, relogio);
  let atuais: Alerta[] = [];
  financas.registrarAlertas(() => atuais);
  return { repo, financas, definir: (a: Alerta[]) => { atuais = a; } };
}

describe('Financas · avisos dispensados', () => {
  it('o aviso do Google Agenda some do sino, da visão geral e do assistente depois do X', () => {
    const { financas, definir } = montar();
    definir([aviso('google:reconectar', 'CRITICO'), aviso('google:outro', 'INFO')]);

    const depois = financas.dispensarAlertas(['google:reconectar']);

    expect(depois).toEqual({ alertas: [aviso('google:outro', 'INFO')], dispensados: 1 });
    expect(financas.alertas().map((a) => a.id)).toEqual(['google:outro']);
    const v = financas.visaoGeral('2026-09');
    expect(v.alertas.map((a) => a.id)).toEqual(['google:outro']);
    expect(v.alertasDispensados).toBe(1);
  });

  it('fica guardado no banco (configuracoes) com o instante, e sem atrapalhar as configurações', () => {
    const { repo, financas, definir } = montar();
    definir([aviso('google:erro', 'ATENCAO')]);
    financas.dispensarAlertas(['google:erro']);
    // O instante vem do relógio (15:00 no fuso local): em UTC depende de onde o teste roda.
    expect(repo.alertasDispensados()).toEqual({ 'google:erro|ATENCAO': relogioFixo('2026-09-24').agora().toISOString() });
    expect(repo.configuracoes()).toEqual({ caixinhasNoSaldo: false, demoDispensada: false });
    // Outra instância (o servidor reiniciado) continua escondendo.
    const reaberta = new Financas(repo, relogioFixo('2026-09-24'));
    reaberta.registrarAlertas(() => [aviso('google:erro', 'ATENCAO')]);
    expect(reaberta.alertas()).toEqual([]);
  });

  it('volta quando piora e quando reaparece depois de resolvido', () => {
    const { repo, financas, definir } = montar();
    definir([aviso('conta-a-pagar:1', 'ATENCAO', 'Luz vence amanhã')]);
    financas.dispensarAlertas(['conta-a-pagar:1']);
    definir([aviso('conta-a-pagar:1', 'ATENCAO', 'Luz vence hoje')]);
    expect(financas.alertas()).toEqual([]);

    definir([aviso('conta-a-pagar:1', 'CRITICO', 'Luz está atrasada')]);
    expect(financas.situacaoDosAlertas()).toEqual({ alertas: [aviso('conta-a-pagar:1', 'CRITICO', 'Luz está atrasada')], dispensados: 0 });
    expect(repo.alertasDispensados()).toEqual({});

    financas.dispensarAlertas(['conta-a-pagar:1']);
    definir([]); // paga: o aviso some e a dispensa é esquecida
    expect(financas.situacaoDosAlertas()).toEqual({ alertas: [], dispensados: 0 });
    expect(repo.alertasDispensados()).toEqual({});
    definir([aviso('conta-a-pagar:1', 'CRITICO')]); // reaberta: avisa de novo
    expect(financas.alertas()).toHaveLength(1);
  });

  it('marcar todos e restaurar', () => {
    const { financas, definir } = montar();
    definir([aviso('a', 'CRITICO'), aviso('b', 'INFO')]);
    expect(financas.dispensarTodosOsAlertas()).toEqual({ alertas: [], dispensados: 2 });
    expect(financas.restaurarAlertas()).toEqual({ alertas: [aviso('a', 'CRITICO'), aviso('b', 'INFO')], dispensados: 0 });
  });

  it('linha estragada no banco vale como nenhuma dispensa', () => {
    const { repo, financas, definir } = montar();
    definir([aviso('a', 'INFO')]);
    repo.salvarAlertasDispensados(['lixo'] as unknown as Record<string, string>);
    expect(repo.alertasDispensados()).toEqual({});
    expect(financas.alertas()).toHaveLength(1);
  });
});
