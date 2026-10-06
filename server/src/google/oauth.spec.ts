import { createHash } from 'node:crypto';
import {
  ClienteOAuthGoogle, emailDoIdToken, ErroOAuth, ESCOPO_AGENDA, gerarPkce, PedidosDeConexao, URL_AUTORIZACAO, URL_REVOGAR, URL_TOKEN,
  urlDeAutorizacao, VALIDADE_DO_PEDIDO_MS,
} from './oauth';
import { CLIENT_ID, CLIENT_SECRET, EMAIL, GoogleFalso, REFRESH } from './testing/google-falso';

const cliente = { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET };

describe('PKCE', () => {
  it('verificador de 64 caracteres base64url e desafio = SHA-256 dele em base64url sem padding', () => {
    const { verificador, desafio } = gerarPkce();
    expect(verificador).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(desafio).toBe(createHash('sha256').update(verificador).digest('base64url'));
    expect(desafio).not.toContain('=');
    expect(gerarPkce().verificador).not.toBe(verificador);
  });
});

describe('PedidosDeConexao (state de uso único)', () => {
  it('state válido serve uma vez só e devolve o verificador e o client ID daquele momento', () => {
    const pedidos = new PedidosDeConexao();
    const { estado } = pedidos.criar(CLIENT_ID);
    expect(estado).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pedidos.valido(estado)).toBe(true);
    expect(pedidos.valido(estado)).toBe(true); // conferir não consome
    const consumido = pedidos.consumir(estado);
    expect(consumido?.clientId).toBe(CLIENT_ID);
    expect(consumido?.verificador).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(pedidos.valido(estado)).toBe(false);
    expect(pedidos.consumir(estado)).toBeNull();
  });

  it('expira em 10 minutos', () => {
    let agora = 1_000_000;
    const pedidos = new PedidosDeConexao(() => agora);
    const { estado } = pedidos.criar(CLIENT_ID);
    agora += VALIDADE_DO_PEDIDO_MS - 1;
    expect(pedidos.valido(estado)).toBe(true);
    agora += 2;
    expect(pedidos.valido(estado)).toBe(false);
    expect(pedidos.consumir(estado)).toBeNull();
  });

  it('recusa chute, vazio, tipo errado e texto enorme; guarda no máximo 5 pedidos', () => {
    const pedidos = new PedidosDeConexao();
    const estados = Array.from({ length: 6 }, () => pedidos.criar(CLIENT_ID).estado);
    for (const chute of ['x'.repeat(43), '', undefined, 42, ['a'], 'a'.repeat(5000)]) expect(pedidos.valido(chute)).toBe(false);
    expect(pedidos.valido(estados[0])).toBe(false); // o mais antigo saiu
    expect(estados.slice(1).every((e) => pedidos.valido(e))).toBe(true);
    pedidos.limpar();
    expect(pedidos.valido(estados[5])).toBe(false);
  });
});

describe('urlDeAutorizacao', () => {
  it('pede code + PKCE S256, offline com consent, e só os escopos necessários', () => {
    const url = new URL(urlDeAutorizacao({ clientId: CLIENT_ID, redirectUri: 'http://127.0.0.1:8778/api/google/retorno', estado: 'E'.repeat(43), desafio: 'D'.repeat(43) }));
    expect(`${url.origin}${url.pathname}`).toBe(URL_AUTORIZACAO);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: CLIENT_ID,
      redirect_uri: 'http://127.0.0.1:8778/api/google/retorno',
      response_type: 'code',
      scope: `openid email ${ESCOPO_AGENDA}`,
      state: 'E'.repeat(43),
      code_challenge: 'D'.repeat(43),
      code_challenge_method: 'S256',
      access_type: 'offline',
      prompt: 'consent',
    });
  });
});

describe('emailDoIdToken', () => {
  const token = (corpo: object) => `x.${Buffer.from(JSON.stringify(corpo)).toString('base64url')}.y`;
  it('lê o e-mail verificado e ignora o resto', () => {
    expect(emailDoIdToken(token({ email: 'a@b.com', email_verified: true }))).toBe('a@b.com');
    expect(emailDoIdToken(token({ email: 'a@b.com', email_verified: false }))).toBeNull();
    expect(emailDoIdToken(token({}))).toBeNull();
    expect(emailDoIdToken('sem-pontos')).toBeNull();
    expect(emailDoIdToken('a.!!!.c')).toBeNull();
    expect(emailDoIdToken(undefined)).toBeNull();
    expect(emailDoIdToken(token({ email: 'a@b.com', aud: 'outro-cliente' }), 'meu-cliente')).toBeNull();
    expect(emailDoIdToken(token({ email: 'a@b.com', aud: 'meu-cliente' }), 'meu-cliente')).toBe('a@b.com');
  });
});

describe('ClienteOAuthGoogle (fetch falso)', () => {
  it('troca o código: POST form-urlencoded com verifier, redirect, client id e secret', async () => {
    const google = new GoogleFalso();
    const r = await new ClienteOAuthGoogle(google.fetch).trocarCodigo(cliente, { codigo: 'codigo-do-google', verificador: 'v'.repeat(64), redirectUri: 'http://127.0.0.1:8778/api/google/retorno' }, 0);
    expect(r).toEqual({ acesso: 'acesso-1', expiraEmMs: 3_599_000, refreshToken: REFRESH, escopos: expect.arrayContaining([ESCOPO_AGENDA]), email: EMAIL });
    const [chamada] = google.chamadas;
    expect(chamada!.url).toBe(URL_TOKEN);
    expect(chamada!.cabecalhos['content-type']).toBe('application/x-www-form-urlencoded');
    expect(chamada!.corpo).toEqual({
      grant_type: 'authorization_code', code: 'codigo-do-google', code_verifier: 'v'.repeat(64),
      redirect_uri: 'http://127.0.0.1:8778/api/google/retorno', client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
    });
  });

  it('renova com o refresh token; invalid_grant vira concessao-invalida e invalid_client vira cliente-invalido', async () => {
    const google = new GoogleFalso();
    const oauth = new ClienteOAuthGoogle(google.fetch);
    expect((await oauth.renovar(cliente, REFRESH)).acesso).toBe('acesso-1');
    google.refreshValido = false;
    await expect(oauth.renovar(cliente, REFRESH)).rejects.toMatchObject({ motivo: 'concessao-invalida' });
    await expect(oauth.renovar({ ...cliente, clientSecret: 'GOCSPX-errado-000000' }, REFRESH)).rejects.toMatchObject({ motivo: 'cliente-invalido' });
  });

  it('sem rede: erro amigável de rede (sem detalhes técnicos)', async () => {
    const google = new GoogleFalso();
    google.redeFora = true;
    const erro = await new ClienteOAuthGoogle(google.fetch).renovar(cliente, REFRESH).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroOAuth);
    expect(erro).toMatchObject({ motivo: 'rede', message: expect.stringMatching(/Sem conexão com o Google/) });
  });

  it('5xx do Google é passageiro; erro desconhecido diz o código', async () => {
    const google = new GoogleFalso();
    const oauth = new ClienteOAuthGoogle(google.fetch);
    google.forcar(URL_TOKEN, () => new Response('{}', { status: 503 }));
    await expect(oauth.renovar(cliente, REFRESH)).rejects.toMatchObject({ motivo: 'rede' });
    google.forcar(URL_TOKEN, () => new Response(JSON.stringify({ error: 'invalid_request' }), { status: 400 }));
    await expect(oauth.renovar(cliente, REFRESH)).rejects.toMatchObject({ motivo: 'outro', message: expect.stringContaining('invalid_request') });
    google.forcar(URL_TOKEN, () => new Response(JSON.stringify({ token_type: 'Bearer' }), { status: 200 }));
    await expect(oauth.renovar(cliente, REFRESH)).rejects.toMatchObject({ message: expect.stringMatching(/sem o token/) });
  });

  it('revoga; token que o Google já não conhece conta como revogado', async () => {
    const google = new GoogleFalso();
    const oauth = new ClienteOAuthGoogle(google.fetch);
    await oauth.revogar(REFRESH);
    expect(google.chamadas.at(-1)).toMatchObject({ url: URL_REVOGAR, metodo: 'POST', corpo: { token: REFRESH } });
    google.forcar(URL_REVOGAR, () => new Response(JSON.stringify({ error: 'invalid_token' }), { status: 400 }));
    await expect(oauth.revogar(REFRESH)).resolves.toBeUndefined();
  });
});
