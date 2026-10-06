import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CofreGoogle, ESTADO_INICIAL, PREFERENCIAS_PADRAO } from './cofre-google';
import { CLIENT_ID, CLIENT_SECRET, REFRESH } from './testing/google-falso';

describe('CofreGoogle', () => {
  let raiz: string;
  let pasta: string;
  beforeEach(() => {
    raiz = mkdtempSync(join(tmpdir(), 'fluxo-cofre-google-'));
    pasta = join(raiz, 'google');
  });
  afterEach(() => rmSync(raiz, { recursive: true, force: true }));

  it('grava cada arquivo 0600 numa pasta 0700, sem sobras de temporário', () => {
    const cofre = new CofreGoogle(pasta);
    cofre.salvarCliente({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    cofre.salvarToken({ refreshToken: REFRESH, email: 'a@b.com', escopos: ['openid'], conectadoEm: '2026-10-02T12:00:00.000Z' });
    cofre.mudarEstado({ agendaId: 'x@group.calendar.google.com' });
    cofre.salvarEventos({ 'conta:1:2026-10-10': { id: 'e1', hash: 'abc' } });
    expect(statSync(pasta).mode & 0o777).toBe(0o700);
    expect(readdirSync(pasta).sort()).toEqual(['cliente.json', 'estado.json', 'eventos.json', 'token.json']);
    for (const arquivo of readdirSync(pasta)) expect(statSync(join(pasta, arquivo)).mode & 0o777).toBe(0o600);
    expect(cofre.cliente()).toEqual({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    expect(cofre.token()?.refreshToken).toBe(REFRESH);
  });

  it('sem arquivos: nada configurado, estado inicial com as preferências padrão', () => {
    const cofre = new CofreGoogle(pasta);
    expect(cofre.cliente()).toBeNull();
    expect(cofre.token()).toBeNull();
    expect(cofre.estado()).toEqual(ESTADO_INICIAL);
    expect(cofre.estado().preferencias).toEqual({ cartao: true, contas: true, atrasos: true, hora: 9, antecedencias: [2, 1] });
    expect(cofre.eventos()).toEqual({});
  });

  it('arquivo adulterado ou com formato estranho conta como ausente (e o aviso não repete o conteúdo)', () => {
    const cofre = new CofreGoogle(pasta);
    cofre.salvarCliente({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    writeFileSync(join(pasta, 'cliente.json'), '{"clientId":"nao-e-id","clientSecret":"x"}');
    writeFileSync(join(pasta, 'token.json'), 'isto não é json');
    expect(cofre.cliente()).toBeNull();
    expect(cofre.token()).toBeNull();
  });

  it('recusa gravar credencial fora do formato', () => {
    const cofre = new CofreGoogle(pasta);
    expect(() => cofre.salvarCliente({ clientId: 'qualquer', clientSecret: CLIENT_SECRET })).toThrow();
  });

  it('esquecerConta apaga token e mapa, zera o estado e mantém cliente e preferências', () => {
    const cofre = new CofreGoogle(pasta);
    cofre.salvarCliente({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    cofre.salvarToken({ refreshToken: REFRESH, email: null, escopos: [], conectadoEm: 'x' });
    cofre.salvarEventos({ a: { id: 'e', hash: 'h' } });
    cofre.mudarEstado({ agendaId: 'ag', erro: 'ops', preferencias: { ...PREFERENCIAS_PADRAO, hora: 7 } });
    cofre.esquecerConta();
    expect(readdirSync(pasta).sort()).toEqual(['cliente.json', 'estado.json']);
    expect(cofre.estado()).toEqual({ ...ESTADO_INICIAL, preferencias: { ...PREFERENCIAS_PADRAO, hora: 7 } });
    expect(readFileSync(join(pasta, 'estado.json'), 'utf8')).not.toContain(REFRESH);
  });
});
