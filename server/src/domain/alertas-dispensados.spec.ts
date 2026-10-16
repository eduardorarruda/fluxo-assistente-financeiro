import type { Alerta, Gravidade } from './alertas';
import { assinatura, dispensar, podarDispensas, separarDispensados } from './alertas-dispensados';

const AGORA = '2026-09-24T15:00:00.000Z';
const aviso = (id: string, gravidade: Gravidade, titulo = id): Alerta => ({ id, gravidade, titulo, detalhe: '', destino: '/' });

describe('alertas dispensados', () => {
  it('a assinatura é id + gravidade, nunca o título (que muda todo dia)', () => {
    expect(assinatura(aviso('conta-a-pagar:1', 'ATENCAO', 'Luz vence em 3 dias'))).toBe('conta-a-pagar:1|ATENCAO');
    const dispensas = dispensar({}, [aviso('conta-a-pagar:1', 'ATENCAO', 'Luz vence em 3 dias')], ['conta-a-pagar:1'], AGORA);
    // No dia seguinte o título mudou, o aviso é o mesmo: continua escondido.
    const amanha = [aviso('conta-a-pagar:1', 'ATENCAO', 'Luz vence em 2 dias')];
    expect(separarDispensados(amanha, dispensas)).toEqual({ visiveis: [], dispensados: amanha });
  });

  it('guarda o instante da dispensa e ignora id que não é de nenhum aviso de agora', () => {
    const atuais = [aviso('orcamento:lazer', 'INFO'), aviso('aumento:spotify', 'INFO')];
    expect(dispensar({}, atuais, ['orcamento:lazer', 'inventado:1'], AGORA)).toEqual({ 'orcamento:lazer|INFO': AGORA });
  });

  it('a gravidade é sempre a de agora, do servidor', () => {
    const d = dispensar({}, [aviso('fatura:k:2026-09', 'CRITICO')], ['fatura:k:2026-09'], AGORA);
    expect(Object.keys(d)).toEqual(['fatura:k:2026-09|CRITICO']);
  });

  it('volta quando piora: vence logo → atrasada, perto do limite → estourou', () => {
    const d = dispensar({}, [aviso('conta-a-pagar:1', 'ATENCAO'), aviso('orcamento:lazer', 'INFO')], ['conta-a-pagar:1', 'orcamento:lazer'], AGORA);
    const pioraram = [aviso('conta-a-pagar:1', 'CRITICO'), aviso('orcamento:lazer', 'ATENCAO')];
    expect(separarDispensados(pioraram, d).visiveis).toEqual(pioraram);
    // E a dispensa antiga, que não esconde mais nada, é esquecida.
    expect(podarDispensas(d, pioraram)).toEqual({});
  });

  it('quem dispensou o mais grave não volta a ver o mesmo aviso mais brando', () => {
    const d = dispensar({}, [aviso('conta-a-pagar:1', 'CRITICO')], ['conta-a-pagar:1'], AGORA);
    const brando = [aviso('conta-a-pagar:1', 'ATENCAO')];
    expect(separarDispensados(brando, d).visiveis).toEqual([]);
    expect(podarDispensas(d, brando)).toEqual(d);
  });

  it('resolvido, a dispensa é esquecida: se o problema voltar, o aviso volta', () => {
    const d = dispensar({}, [aviso('google:erro', 'ATENCAO'), aviso('orcamento:lazer', 'INFO')], ['google:erro'], AGORA);
    const semGoogle = [aviso('orcamento:lazer', 'INFO')];
    const podadas = podarDispensas(d, semGoogle);
    expect(podadas).toEqual({});
    expect(separarDispensados([aviso('google:erro', 'ATENCAO')], podadas).visiveis).toHaveLength(1);
  });

  it('o aviso do Google Agenda também pode ser dispensado', () => {
    const atuais = [aviso('google:reconectar', 'CRITICO'), aviso('orcamento:lazer', 'INFO')];
    const d = dispensar({}, atuais, ['google:reconectar'], AGORA);
    expect(separarDispensados(atuais, d)).toEqual({ visiveis: [atuais[1]], dispensados: [atuais[0]] });
  });

  it('dispensar não muda o objeto recebido e mantém as outras dispensas ativas', () => {
    const atuais = [aviso('a', 'INFO'), aviso('b', 'ATENCAO')];
    const antes = Object.freeze({ 'a|INFO': '2026-09-01T00:00:00.000Z', 'sumiu|INFO': '2026-09-01T00:00:00.000Z' });
    const depois = dispensar(antes, atuais, ['b'], AGORA);
    expect(depois).toEqual({ 'a|INFO': '2026-09-01T00:00:00.000Z', 'b|ATENCAO': AGORA });
    expect(Object.keys(antes)).toHaveLength(2);
  });

  it('id com espaço ou barra vertical (chave de recorrência) funciona igual', () => {
    const atuais = [aviso('aumento:apple com bill|icloud', 'INFO')];
    const d = dispensar({}, atuais, ['aumento:apple com bill|icloud'], AGORA);
    expect(separarDispensados(atuais, d).visiveis).toEqual([]);
  });
});
