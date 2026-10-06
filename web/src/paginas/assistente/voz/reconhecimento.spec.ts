import { instalarReconhecimentoFalso, ReconhecimentoFalso, removerReconhecimentoFalso } from '../../../testes/voz-falsa';
import { criarEscuta, instalarLocal, mensagemDeErro, reiniciarSituacaoLocal, usarLocal, verificarLocal } from './reconhecimento';
import { PREFERENCIAS_PADRAO } from './preferencias-voz';

function escutar(local = false) {
  const parciais: string[] = [];
  const finais: string[] = [];
  const erros: string[] = [];
  const escuta = criarEscuta({
    local,
    aoParcial: (t) => parciais.push(t),
    aoFinal: (t) => finais.push(t),
    aoErro: (e) => erros.push(e.codigo),
  });
  if (!escuta) throw new Error('sem reconhecimento');
  return { escuta, parciais, finais, erros };
}

describe('escuta contínua', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    instalarReconhecimentoFalso();
  });
  afterEach(() => {
    vi.useRealTimers();
    removerReconhecimentoFalso();
    reiniciarSituacaoLocal();
  });

  it('configura pt-BR contínuo com provisórios e, se pedido, no computador', () => {
    escutar(true).escuta.iniciar();
    expect(ReconhecimentoFalso.ultima).toMatchObject({ lang: 'pt-BR', continuous: true, interimResults: true, processLocally: true, ligado: true });
  });

  it('entrega provisórios e cada final uma vez só', () => {
    const { escuta, parciais, finais } = escutar();
    escuta.iniciar();
    const r = ReconhecimentoFalso.ultima;
    r.ouvir([['quanto', false]]);
    r.ouvir([['quanto gastei', true]]);
    r.ouvir([['quanto gastei', true], [' em setembro', false]], 1);
    r.ouvir([['quanto gastei', true], [' em setembro', true]], 0);
    expect(finais).toEqual(['quanto gastei', 'em setembro']);
    expect(parciais).toContain('quanto');
    expect(parciais.at(-1)).toBe('');
  });

  it('religa sozinho quando o Chrome encerra por silêncio', () => {
    const { escuta, erros } = escutar();
    escuta.iniciar();
    ReconhecimentoFalso.ultima.errar('no-speech');
    ReconhecimentoFalso.ultima.encerrar();
    expect(ReconhecimentoFalso.instancias).toHaveLength(1);
    vi.advanceTimersByTime(200);
    expect(ReconhecimentoFalso.instancias).toHaveLength(2);
    expect(ReconhecimentoFalso.ultima.ligado).toBe(true);
    expect(erros).toEqual([]);
  });

  it('parar confirma o que ainda era provisório e não religa', () => {
    const { escuta, finais } = escutar();
    escuta.iniciar();
    ReconhecimentoFalso.ultima.ouvir([['e outubro', false]]);
    escuta.parar();
    vi.advanceTimersByTime(500);
    expect(finais).toEqual(['e outubro']);
    expect(ReconhecimentoFalso.instancias).toHaveLength(1);
    expect(escuta.ativa).toBe(false);
  });

  it('abortar descarta o provisório', () => {
    const { escuta, finais } = escutar();
    escuta.iniciar();
    ReconhecimentoFalso.ultima.ouvir([['ruído', false]]);
    escuta.abortar();
    expect(finais).toEqual([]);
  });

  it('permissão negada é definitiva: avisa e não religa', () => {
    const { escuta, erros } = escutar();
    escuta.iniciar();
    ReconhecimentoFalso.ultima.errar('not-allowed');
    ReconhecimentoFalso.ultima.encerrar();
    vi.advanceTimersByTime(1000);
    expect(erros).toEqual(['not-allowed']);
    expect(ReconhecimentoFalso.instancias).toHaveLength(1);
  });

  it('desiste se encerra logo de novo, várias vezes, sem ouvir nada', () => {
    const { escuta, erros } = escutar();
    escuta.iniciar();
    for (let i = 0; i < 8; i++) {
      ReconhecimentoFalso.ultima.encerrar();
      vi.advanceTimersByTime(200);
    }
    expect(erros).toEqual(['nao-comeca']);
  });

  it('sem Web Speech API não cria escuta', () => {
    removerReconhecimentoFalso();
    expect(criarEscuta({ local: false, aoParcial: vi.fn(), aoFinal: vi.fn(), aoErro: vi.fn() })).toBeNull();
  });
});

describe('reconhecimento no computador', () => {
  beforeEach(() => instalarReconhecimentoFalso());
  afterEach(() => {
    removerReconhecimentoFalso();
    reiniciarSituacaoLocal();
  });

  it('consulta a disponibilidade de pt-BR local e instala o pacote', async () => {
    ReconhecimentoFalso.disponibilidade = 'downloadable';
    expect(await verificarLocal()).toBe('downloadable');
    expect(ReconhecimentoFalso.available).toHaveBeenCalledWith({ langs: ['pt-BR'], processLocally: true });
    ReconhecimentoFalso.disponibilidade = 'available';
    expect(await instalarLocal()).toBe(true);
    expect(ReconhecimentoFalso.install).toHaveBeenCalledWith({ langs: ['pt-BR'], processLocally: true });
    expect(await verificarLocal()).toBe('available');
  });

  it('usa o local só se a pessoa prefere e o pacote está pronto', () => {
    expect(usarLocal(PREFERENCIAS_PADRAO, 'available')).toBe(true);
    expect(usarLocal(PREFERENCIAS_PADRAO, 'downloadable')).toBe(false);
    expect(usarLocal({ ...PREFERENCIAS_PADRAO, reconhecimento: 'nuvem' }, 'available')).toBe(false);
  });

  it('as mensagens de erro explicam o que fazer', () => {
    expect(mensagemDeErro('not-allowed')).toMatch(/bloqueado.*Informações do app/);
    expect(mensagemDeErro('service-not-allowed', true)).toMatch(/pacote/);
    expect(mensagemDeErro('audio-capture')).toMatch(/Nenhum microfone/);
    expect(mensagemDeErro('network')).toMatch(/internet/);
  });
});
