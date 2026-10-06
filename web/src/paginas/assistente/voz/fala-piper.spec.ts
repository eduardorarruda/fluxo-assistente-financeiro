import type { EstadoVozNatural, PedidoDeSintese } from '../../../api/voz-natural';
import { criarMotorFalso } from '../../../testes/voz-falsa';
import { ANTECIPAR, AVISO_RESERVA, type ContextoDeAudio, criarMotorPiper, opcoesDaFala, partirParaSintese, vozNaturalEfetiva } from './fala-piper';
import { PREFERENCIAS_PADRAO } from './preferencias-voz';

/** Web Audio de mentira: cada fonte criada fica na lista; `acabar()` dispara o onended. */
function contextoFalso() {
  const fontes: { buffer: { duration: number; texto: string } | null; tocando: boolean; parada: boolean; onended: (() => void) | null; acabar: () => void }[] = [];
  let nivel = 0;
  const contexto = {
    state: 'running',
    destination: {},
    resume: vi.fn(async () => undefined),
    createAnalyser: () => ({
      fftSize: 0,
      connect: vi.fn(),
      getFloatTimeDomainData: (destino: Float32Array) => destino.fill(nivel),
    }),
    createBufferSource: () => {
      const fonte = {
        buffer: null as { duration: number; texto: string } | null,
        tocando: false,
        parada: false,
        onended: null as (() => void) | null,
        connect: vi.fn(),
        start() {
          fonte.tocando = true;
        },
        stop() {
          fonte.parada = true;
          fonte.tocando = false;
        },
        acabar() {
          fonte.tocando = false;
          fonte.onended?.();
        },
      };
      fontes.push(fonte);
      return fonte;
    },
    // O "WAV" do teste é o próprio texto: o buffer guarda de onde veio.
    decodeAudioData: vi.fn(async (bytes: ArrayBuffer) => ({ duration: 1, texto: new TextDecoder().decode(bytes) })),
  };
  return { contexto: contexto as unknown as ContextoDeAudio, fontes, definirNivel: (n: number) => (nivel = n) };
}

/** Síntese de mentira: cada pedido fica pendente até o teste resolver (ou falhar). */
function sintetizadorFalso() {
  const pedidos: { pedido: PedidoDeSintese; sinal: AbortSignal; resolver: () => void; falhar: (e: Error) => void }[] = [];
  const sintetizar = vi.fn(
    (pedido: PedidoDeSintese, sinal: AbortSignal) =>
      new Promise<ArrayBuffer>((resolve, reject) => {
        sinal.addEventListener('abort', () => reject(new DOMException('cancelado', 'AbortError')));
        pedidos.push({ pedido, sinal, resolver: () => resolve(new TextEncoder().encode(pedido.texto).buffer as ArrayBuffer), falhar: reject });
      }),
  );
  return { sintetizar, pedidos };
}

const PIPER = { voz: null, velocidade: 1.1, motor: 'piper' as const, vozNatural: 'faber' };
const esvaziarPromessas = () => new Promise((r) => setTimeout(r, 0));

function montar() {
  const audio = contextoFalso();
  const sintese = sintetizadorFalso();
  const reserva = criarMotorFalso();
  const preparar = vi.fn();
  const motor = criarMotorPiper({ reserva: reserva.motor, sintetizar: sintese.sintetizar, criarContexto: () => audio.contexto, preparar });
  const legendas: string[] = [];
  const avisos: string[] = [];
  let vazias = 0;
  motor.aoComecar((t) => legendas.push(t));
  motor.aoEsvaziar(() => (vazias += 1));
  motor.aoAvisar?.((a) => avisos.push(a));
  return { motor, audio, sintese, reserva, preparar, legendas, avisos, vazias: () => vazias };
}

describe('motor da voz natural (Piper)', () => {
  it('pede a frase por extenso, toca pela Web Audio e a legenda mostra o texto original', async () => {
    const { motor, sintese, audio, legendas } = montar();
    motor.falar('Você gastou R$ 1.230,00.', PIPER);
    expect(motor.ocupado()).toBe(true);
    expect(sintese.pedidos[0]?.pedido).toEqual({ texto: 'Você gastou mil duzentos e trinta reais.', voz: 'faber', velocidade: 1.1 });
    sintese.pedidos[0]?.resolver();
    await esvaziarPromessas();
    expect(audio.fontes[0]?.tocando).toBe(true);
    expect(audio.fontes[0]?.buffer?.texto).toBe('Você gastou mil duzentos e trinta reais.');
    expect(legendas).toEqual(['Você gastou R$ 1.230,00.']);
  });

  it(`antecipa até ${ANTECIPAR} frases enquanto a atual toca, e segue na ordem sem buraco`, async () => {
    const { motor, sintese, audio, legendas, vazias } = montar();
    ['Um.', 'Dois.', 'Três.', 'Quatro.'].forEach((f) => motor.falar(f, PIPER));
    // a atual + ANTECIPAR adiante
    expect(sintese.pedidos.map((p) => p.pedido.texto)).toEqual(['Um.', 'Dois.', 'Três.']);
    sintese.pedidos.forEach((p) => p.resolver());
    await esvaziarPromessas();
    expect(legendas).toEqual(['Um.']);

    audio.fontes[0]?.acabar();
    expect(sintese.pedidos.map((p) => p.pedido.texto)).toEqual(['Um.', 'Dois.', 'Três.', 'Quatro.']);
    await esvaziarPromessas();
    expect(legendas).toEqual(['Um.', 'Dois.']); // a segunda já estava pronta: começa sem esperar a rede
    audio.fontes[1]?.acabar();
    await esvaziarPromessas();
    sintese.pedidos[3]?.resolver();
    audio.fontes[2]?.acabar();
    await esvaziarPromessas();
    audio.fontes[3]?.acabar();
    expect(legendas).toEqual(['Um.', 'Dois.', 'Três.', 'Quatro.']);
    expect(vazias()).toBe(1);
    expect(motor.ocupado()).toBe(false);
  });

  it('parar cancela os pedidos adiantados, cala o áudio e nada antigo volta a tocar', async () => {
    const { motor, sintese, audio, legendas, vazias } = montar();
    ['Um.', 'Dois.', 'Três.'].forEach((f) => motor.falar(f, PIPER));
    sintese.pedidos[0]?.resolver();
    await esvaziarPromessas();
    motor.parar();
    expect(audio.fontes[0]?.parada).toBe(true);
    expect(sintese.pedidos.slice(1).every((p) => p.sinal.aborted)).toBe(true);
    expect(motor.ocupado()).toBe(false);
    sintese.pedidos[1]?.resolver();
    await esvaziarPromessas();
    expect(audio.fontes).toHaveLength(1);
    expect(legendas).toEqual(['Um.']);
    expect(vazias()).toBe(0);
  });

  it('parar antes de o primeiro áudio chegar: a resposta atrasada é ignorada', async () => {
    const { motor, sintese, audio } = montar();
    motor.falar('Um.', PIPER);
    const primeiro = sintese.pedidos[0];
    motor.parar();
    primeiro?.resolver();
    await esvaziarPromessas();
    expect(audio.fontes).toHaveLength(0);
  });

  it('falha no servidor: aquela frase vai pela voz do navegador, com aviso uma vez só, e a seguinte volta ao Piper', async () => {
    const { motor, sintese, audio, reserva, legendas, avisos } = montar();
    motor.falar('Primeira.', PIPER);
    motor.falar('Segunda.', PIPER);
    sintese.pedidos[0]?.falhar(new Error('503'));
    await esvaziarPromessas();
    expect(reserva.faladas.map((f) => f.trecho)).toEqual(['Primeira.']);
    expect(legendas).toEqual(['Primeira.']);
    expect(avisos).toEqual([AVISO_RESERVA]);

    reserva.comecarProxima();
    reserva.terminarAtual(); // a reserva acabou: segue a fila
    sintese.pedidos[1]?.resolver();
    await esvaziarPromessas();
    expect(audio.fontes[0]?.buffer?.texto).toBe('Segunda.');
    expect(legendas).toEqual(['Primeira.', 'Segunda.']);

    motor.falar('Terceira.', PIPER);
    audio.fontes[0]?.acabar();
    sintese.pedidos[2]?.falhar(new Error('de novo'));
    await esvaziarPromessas();
    expect(avisos).toHaveLength(1);
  });

  it("com motor 'navegador' tudo vai para a reserva, sem pedir nada ao servidor", () => {
    const { motor, sintese, reserva, avisos } = montar();
    motor.falar('Oi.', { voz: 'x', velocidade: 1, motor: 'navegador' });
    expect(sintese.sintetizar).not.toHaveBeenCalled();
    expect(reserva.faladas).toEqual([{ trecho: 'Oi.', opcoes: { voz: 'x', velocidade: 1, motor: 'navegador' } }]);
    expect(avisos).toEqual([]);
    motor.parar();
  });

  it('sem Web Audio: lê pela reserva', async () => {
    const reserva = criarMotorFalso();
    const sintese = sintetizadorFalso();
    const motor = criarMotorPiper({ reserva: reserva.motor, sintetizar: sintese.sintetizar, criarContexto: () => null });
    motor.falar('Oi.', PIPER);
    await esvaziarPromessas();
    expect(sintese.sintetizar).not.toHaveBeenCalled();
    expect(reserva.faladas.map((f) => f.trecho)).toEqual(['Oi.']);
  });

  it('nível vem do analisador enquanto toca e cai a zero depois', async () => {
    const { motor, sintese, audio } = montar();
    motor.falar('Oi.', PIPER);
    sintese.pedidos[0]?.resolver();
    await esvaziarPromessas();
    audio.definirNivel(0.2);
    let n = 0;
    for (let i = 0; i < 20; i++) n = motor.nivel();
    expect(n).toBeGreaterThan(0.5);
    audio.fontes[0]?.acabar();
    for (let i = 0; i < 60; i++) n = motor.nivel();
    expect(n).toBeLessThan(0.01);
  });

  it('preparar só pede ao servidor com a voz natural', () => {
    const { motor, preparar } = montar();
    motor.preparar?.({ voz: null, velocidade: 1, motor: 'navegador' });
    expect(preparar).not.toHaveBeenCalled();
    motor.preparar?.(PIPER);
    expect(preparar).toHaveBeenCalledWith('faber');
  });

  it('frase longa demais é partida; só a primeira parte tem legenda', async () => {
    const { motor, sintese, audio, legendas } = montar();
    const longa = `${'palavra '.repeat(80)}fim.`;
    motor.falar(longa, PIPER);
    sintese.pedidos.forEach((p) => p.resolver());
    await esvaziarPromessas();
    expect(sintese.pedidos.length).toBe(2);
    audio.fontes[0]?.acabar();
    await esvaziarPromessas();
    expect(legendas).toEqual([longa]);
  });
});

describe('partirParaSintese', () => {
  it('corta na vírgula ou no espaço, nunca no meio de palavra', () => {
    expect(partirParaSintese('curta')).toEqual(['curta']);
    const partes = partirParaSintese('aaaa bbbb, cccc dddd eeee', 12);
    expect(partes.every((p) => p.length <= 12)).toBe(true);
    expect(partes.join(' ')).toBe('aaaa bbbb, cccc dddd eeee');
  });
});

describe('escolha da voz', () => {
  const estado = (instaladas: string[]): EstadoVozNatural => ({
    instalada: instaladas.length > 0, baixando: false, vozBaixando: null, etapa: null, progresso: null, vozPadrao: 'faber', erro: null,
    vozes: ['faber', 'dii', 'cadu'].map((id) => ({
      id, nome: id, genero: 'masculina', qualidade: 'média', descricao: '', tamanhoMb: 64, licenca: '', credito: '', naoComercial: false, instalada: instaladas.includes(id),
    })),
  });

  it('a escolhida se instalada; senão a padrão; senão a primeira; nenhuma = navegador', () => {
    expect(vozNaturalEfetiva({ vozNatural: 'dii' }, estado(['faber', 'dii']))).toBe('dii');
    expect(vozNaturalEfetiva({ vozNatural: 'cadu' }, estado(['faber', 'dii']))).toBe('faber');
    expect(vozNaturalEfetiva({ vozNatural: null }, estado(['cadu']))).toBe('cadu');
    expect(vozNaturalEfetiva({ vozNatural: null }, estado([]))).toBeNull();
    expect(vozNaturalEfetiva({ vozNatural: null }, null)).toBeNull();
  });

  it('opcoesDaFala: piper só com voz instalada; o navegador quando escolhido', () => {
    expect(opcoesDaFala(PREFERENCIAS_PADRAO, estado(['faber']))).toEqual({ voz: null, velocidade: 1, motor: 'piper', vozNatural: 'faber' });
    expect(opcoesDaFala(PREFERENCIAS_PADRAO, estado([]))).toMatchObject({ motor: 'navegador', vozNatural: null });
    expect(opcoesDaFala({ ...PREFERENCIAS_PADRAO, motorFala: 'navegador' }, estado(['faber']))).toMatchObject({ motor: 'navegador' });
  });
});
