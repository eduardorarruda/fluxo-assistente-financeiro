import { deveOuvir, ESTADO_INICIAL, type EstadoConversa, type EventoConversa, juntarFala, reduzirConversa, rotuloDaFase } from './maquina-conversa';

const aplicar = (eventos: EventoConversa[], inicio: EstadoConversa = ESTADO_INICIAL) => eventos.reduce(reduzirConversa, inicio);

const ouvindo = aplicar([{ tipo: 'pronto' }]);

describe('máquina do modo conversação', () => {
  it('faz a volta completa: ouvindo → enviando → pensando → falando → ouvindo', () => {
    let e = ouvindo;
    expect(e.fase).toBe('ouvindo');
    expect(deveOuvir(e)).toBe(true);

    e = aplicar([{ tipo: 'parcial', texto: 'quanto eu' }], e);
    expect(e.parcial).toBe('quanto eu');
    e = aplicar([{ tipo: 'final', texto: 'quanto eu gastei' }, { tipo: 'final', texto: 'em setembro?' }], e);
    expect(e.fala).toBe('quanto eu gastei em setembro?');
    expect(e.parcial).toBe('');

    e = aplicar([{ tipo: 'enviar' }], e);
    expect(e.fase).toBe('enviando');
    expect(e.pergunta).toBe('quanto eu gastei em setembro?');
    expect(deveOuvir(e)).toBe(false);

    e = aplicar([{ tipo: 'enviado', execucaoId: 'x1', respostaId: 'm2' }], e);
    expect(e).toMatchObject({ fase: 'pensando', execucaoId: 'x1', respostaId: 'm2' });

    e = aplicar([{ tipo: 'passo', rotulo: 'Resumo de set/2026' }], e);
    expect(e.passo).toBe('Resumo de set/2026');

    e = aplicar([{ tipo: 'falando', frase: 'Você gastou R$ 3.210,00.' }], e);
    expect(e).toMatchObject({ fase: 'falando', legenda: 'Você gastou R$ 3.210,00.' });
    expect(deveOuvir(e)).toBe(false);

    // A fila esvaziou mas a resposta ainda chega: volta a "pensando", sem ouvir.
    e = aplicar([{ tipo: 'calou' }], e);
    expect(e.fase).toBe('pensando');

    e = aplicar([{ tipo: 'falando', frase: 'O maior foi mercado.' }, { tipo: 'fimDaResposta', aviso: null, aindaFalando: true }], e);
    expect(e).toMatchObject({ fase: 'falando', respostaAcabou: true });

    e = aplicar([{ tipo: 'calou' }], e);
    expect(e).toMatchObject({ fase: 'ouvindo', fala: '', execucaoId: null, respostaId: null, passo: null });
    // A última frase fica à vista até a pessoa voltar a falar.
    expect(e.legenda).toBe('O maior foi mercado.');
    e = aplicar([{ tipo: 'parcial', texto: 'e' }], e);
    expect(e.legenda).toBe('');
  });

  it('não envia sem nada dito e junta o provisório na hora de enviar', () => {
    expect(aplicar([{ tipo: 'enviar' }], ouvindo).fase).toBe('ouvindo');
    const e = aplicar([{ tipo: 'final', texto: 'e outubro' }, { tipo: 'parcial', texto: 'também' }, { tipo: 'enviar' }], ouvindo);
    expect(e.pergunta).toBe('e outubro também');
  });

  it('resposta que termina sem nada para ler volta direto a ouvir', () => {
    const e = aplicar([{ tipo: 'final', texto: 'oi' }, { tipo: 'enviar' }, { tipo: 'enviado', execucaoId: 'x', respostaId: 'r' }, { tipo: 'fimDaResposta', aviso: null, aindaFalando: false }], ouvindo);
    expect(e.fase).toBe('ouvindo');
  });

  it('interromper cala, limpa a legenda e volta a ouvir', () => {
    const falando = aplicar([{ tipo: 'final', texto: 'oi' }, { tipo: 'enviar' }, { tipo: 'enviado', execucaoId: 'x', respostaId: 'r' }, { tipo: 'falando', frase: 'Olá!' }], ouvindo);
    const e = reduzirConversa(falando, { tipo: 'interromper' });
    expect(e).toMatchObject({ fase: 'ouvindo', legenda: '', execucaoId: null, respostaAcabou: false });
    // Interromper quando já está ouvindo não muda nada.
    expect(reduzirConversa(e, { tipo: 'interromper' })).toBe(e);
  });

  it('mudo pausa a escuta, descarta o provisório e aparece como "Pausado"', () => {
    const comParcial = aplicar([{ tipo: 'parcial', texto: 'quan' }], ouvindo);
    const mudo = reduzirConversa(comParcial, { tipo: 'mudo', mudo: true });
    expect(deveOuvir(mudo)).toBe(false);
    expect(mudo.parcial).toBe('');
    expect(rotuloDaFase(mudo)).toBe('Pausado');
    // Mudo, o que chega do reconhecimento é ignorado.
    expect(reduzirConversa(mudo, { tipo: 'final', texto: 'eco' }).fala).toBe('');
    expect(deveOuvir(reduzirConversa(mudo, { tipo: 'mudo', mudo: false }))).toBe(true);
  });

  it('erro de microfone para tudo até "tentar de novo"', () => {
    const e = reduzirConversa(ouvindo, { tipo: 'erro', mensagem: 'O microfone está bloqueado.' });
    expect(e).toMatchObject({ fase: 'erro', erro: 'O microfone está bloqueado.' });
    expect(deveOuvir(e)).toBe(false);
    expect(reduzirConversa(e, { tipo: 'final', texto: 'x' })).toBe(e);
    expect(reduzirConversa(e, { tipo: 'tentarDeNovo' })).toEqual(ESTADO_INICIAL);
  });

  it('falha no envio volta a ouvir com aviso, sem reenviar sozinho', () => {
    const e = aplicar([{ tipo: 'final', texto: 'oi' }, { tipo: 'enviar' }, { tipo: 'falhaNoEnvio', mensagem: 'Ainda há uma resposta em andamento.' }], ouvindo);
    expect(e).toMatchObject({ fase: 'ouvindo', fala: '', aviso: 'Ainda há uma resposta em andamento.' });
    expect(reduzirConversa(e, { tipo: 'limparAviso' }).aviso).toBeNull();
  });

  it('resposta com erro deixa o aviso e segue a conversa', () => {
    const e = aplicar([{ tipo: 'final', texto: 'oi' }, { tipo: 'enviar' }, { tipo: 'enviado', execucaoId: 'x', respostaId: 'r' }, { tipo: 'fimDaResposta', aviso: 'Login expirado', aindaFalando: true }], ouvindo);
    expect(e).toMatchObject({ fase: 'falando', aviso: 'Login expirado' });
    expect(reduzirConversa(e, { tipo: 'calou' })).toMatchObject({ fase: 'ouvindo', aviso: 'Login expirado' });
  });

  it('abrir com uma resposta em andamento acompanha ela primeiro', () => {
    const e = reduzirConversa(ESTADO_INICIAL, { tipo: 'acompanhar', execucaoId: 'x', respostaId: 'r' });
    expect(e).toMatchObject({ fase: 'pensando', respostaId: 'r' });
    expect(reduzirConversa(e, { tipo: 'pronto' })).toBe(e);
  });

  it('juntarFala não deixa espaço antes de pontuação nem dobrado', () => {
    expect(juntarFala('  oi ', ' tudo bem ')).toBe('oi tudo bem');
    expect(juntarFala('oi', '?')).toBe('oi?');
    expect(juntarFala('', 'oi')).toBe('oi');
  });

  it('avisar mostra o aviso sem mudar a fase', () => {
    const falando = { ...ESTADO_INICIAL, fase: 'falando' as const };
    expect(reduzirConversa(falando, { tipo: 'avisar', mensagem: 'voz do navegador' })).toEqual({ ...falando, aviso: 'voz do navegador' });
  });
});
