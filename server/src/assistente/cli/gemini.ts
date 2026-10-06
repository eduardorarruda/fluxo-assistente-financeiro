import { join, relative } from 'node:path';
import { MODELOS } from './modelos';
import { classificarErro, comoObjeto, criarEmissorDeTexto, cortar, lerLinhaJson, numero, texto, type Objeto } from './comum';
import type { AdaptadorCli, CodigoErro, EventoAgente, Interprete, ParametrosExecucao } from './tipos';

const LIMITE_RESULTADO = 8000;

/** Códigos de saída do Gemini CLI (exit codes) que têm explicação própria. */
const SAIDA_AUTENTICACAO = 41;
const SAIDA_ENTRADA = 42;
const SAIDA_PASTA_RECUSADA = 55;
/** HTTP 429 (cota) sai como 429 & 0xff. */
const SAIDA_COTA = 173;

const FALHAS: Record<'autenticacao' | 'limite' | 'pasta', { codigo: CodigoErro; mensagem: string }> = {
  autenticacao: {
    codigo: 'autenticacao',
    mensagem: "O Gemini CLI não está logado. Num terminal, rode `gemini` e escolha 'Login with Google'.",
  },
  limite: { codigo: 'limite', mensagem: 'O limite de uso do seu plano do Gemini acabou por agora. Tente de novo mais tarde.' },
  pasta: { codigo: 'cli', mensagem: 'O Gemini recusou a pasta de trabalho da conversa (pasta não confiável). Atualize o Gemini CLI e tente de novo.' },
};

/**
 * Gemini CLI (`gemini -p "" -o stream-json`, prompt pela entrada padrão).
 * Travado por uma política de administrador que nega toda ferramenta, menos
 * as do MCP do Fluxo e a leitura de arquivos (presa à pasta da conversa, onde
 * ficam os anexos). Nunca usa `--yolo`: o que a política não libera, nega.
 */
export const adaptadorGemini: AdaptadorCli = {
  provedor: 'gemini',
  nome: 'Gemini CLI',
  binario: 'gemini',
  comoInstalar: 'npm install -g @google/gemini-cli',
  comoEntrar: 'gemini   # escolha "Login with Google" e entre com a conta do seu plano',
  variavelDeConta: 'GEMINI_CLI_HOME',
  modelos: MODELOS.gemini,
  // Sem GEMINI_API_KEY de propósito: a ideia é usar o login do plano da pessoa
  // ("Login with Google"), não uma chave de API cobrada por uso.
  variaveisPermitidas: [
    'GEMINI_CLI_HOME', 'GOOGLE_CLOUD_PROJECT', 'GOOGLE_CLOUD_LOCATION', 'GOOGLE_GENAI_USE_GCA', 'GOOGLE_GENAI_USE_VERTEXAI',
    'GOOGLE_APPLICATION_CREDENTIALS', 'GEMINI_FORCE_ENCRYPTED_FILE_STORAGE',
  ],

  montar(p: ParametrosExecucao) {
    const politica = join(p.pastaExecucao, 'politica-gemini.toml');
    const args = [
      '-p', '', '-o', 'stream-json',
      // Servidor MCP por stdio só sobe em pasta confiável (e pasta não confiável ignora o settings.json dela).
      '--skip-trust',
      '-e', 'none',
      '--allowed-mcp-server-names', p.mcp.nome,
      '--admin-policy', politica,
    ];
    if (p.modelo) args.push('-m', p.modelo);
    if (p.sessaoId) args.push('--resume', p.sessaoId);
    const pastaGemini = join(p.pasta, '.gemini');
    return {
      args,
      entrada: prepararEntrada(p),
      arquivos: [
        // Fica na pasta da conversa (que o modelo consegue ler): por isso leva só
        // a referência `$VARIAVEL`, que o Gemini expande do próprio ambiente.
        { caminho: join(pastaGemini, 'settings.json'), conteudo: configuracao(p) },
        // O Gemini procura .env subindo a partir da pasta atual; o do projeto,
        // lá em cima, tem segredos. Um .env vazio aqui encerra a busca.
        { caminho: join(pastaGemini, '.env'), conteudo: '' },
        { caminho: join(p.pasta, '.env'), conteudo: '' },
        { caminho: join(p.pasta, 'GEMINI.md'), conteudo: p.instrucoes },
        { caminho: politica, conteudo: politicaDeFerramentas(p.mcp.nome) },
      ],
      env: { [p.mcp.segredo.variavel]: p.mcp.segredo.valor },
    };
  },

  novoInterprete: criarInterprete,

  sessaoPerdida(codigo, stderr) {
    if (/no previous sessions found|invalid session identifier/i.test(stderr)) return true;
    return codigo === SAIDA_ENTRADA && /\bsession/i.test(stderr);
  },

  explicarFalha(codigo, stderr) {
    if (codigo === SAIDA_AUTENTICACAO) return FALHAS.autenticacao;
    if (codigo === SAIDA_COTA) return FALHAS.limite;
    if (codigo === SAIDA_PASTA_RECUSADA) return FALHAS.pasta;
    const tipo = classificarErro(stderr);
    return tipo ? FALHAS[tipo] : null;
  },
};

function configuracao(p: ParametrosExecucao): string {
  const variavel = p.mcp.segredo.variavel;
  const servidor = {
    command: p.mcp.comando,
    args: p.mcp.args,
    env: { ...p.mcp.env, [variavel]: `$${variavel}` },
    trust: true,
    // gerar_imagem (Nano Banana) pode levar mais de um minuto.
    timeout: 200000,
  };
  // Sem `tools.core`: ele cria uma negação que vence a confiança do MCP.
  return JSON.stringify({
    mcpServers: { [p.mcp.nome]: servidor },
    general: { sessionRetention: { enabled: false } },
    skills: { enabled: false },
    hooksConfig: { enabled: false },
  });
}

/**
 * Política de administrador (vence as do usuário): nega tudo, libera o MCP do Fluxo e a leitura. A regra
 * do MCP é pelo nome do servidor, sem `toolAnnotations`: vale também para as ferramentas de ação
 * (`readOnlyHint: false`), que o próprio Fluxo limita (propostas, guardas de confirmação).
 */
function politicaDeFerramentas(servidor: string): string {
  // JSON.stringify gera uma string básica válida em TOML.
  const regras = [
    ['toolName = "*"', 'decision = "deny"', 'priority = 100', 'denyMessage = "Somente as ferramentas do Fluxo estão disponíveis."'],
    [`mcpName = ${JSON.stringify(servidor)}`, 'decision = "allow"', 'priority = 200'],
    ['toolName = "read_file"', 'decision = "allow"', 'priority = 200'],
    ['toolName = "read_many_files"', 'decision = "allow"', 'priority = 200'],
  ];
  return regras.map((r) => `[[rule]]\n${r.join('\n')}\n`).join('\n');
}

/**
 * Para o Gemini, a entrada não é texto puro: `@caminho` em qualquer lugar vira
 * leitura de arquivo, e começar com `/` vira comando do CLI. O texto da pessoa
 * (e o que veio de terceiros, como descrição de Pix) não pode disparar nada
 * disso — só as imagens anexadas, que o próprio Fluxo referencia.
 */
function prepararEntrada(p: ParametrosExecucao): string {
  const escapado = p.prompt.replaceAll('@', '\\@');
  const prompt = escapado.trimStart().startsWith('/') ? `Mensagem:\n${escapado}` : escapado;
  if (!p.imagens.length) return prompt;
  const referencias = p.imagens.map((i) => `@${relative(p.pasta, i).replaceAll(' ', '\\ ')}`).join('\n');
  return `${prompt}\n\nImagens anexadas a esta mensagem:\n${referencias}`;
}

/** `mcp_fluxo_resumo_do_mes` → `mcp__fluxo__resumo_do_mes`, o padrão que o resto do Fluxo espera. */
function nomeDaFerramenta(nome: string): string {
  const partes = /^mcp_([^_]+)_(.+)$/.exec(nome);
  return partes ? `mcp__${partes[1]}__${partes[2]}` : nome;
}

function criarInterprete(): Interprete {
  const emissor = criarEmissorDeTexto();
  let erroEmitido = false;

  const mensagem = (o: Objeto): EventoAgente[] => (o.role === 'assistant' ? emissor.emitir(texto(o.content)) : []);

  const usoDeFerramenta = (o: Objeto): EventoAgente[] => {
    const id = texto(o.tool_id);
    const nome = texto(o.tool_name);
    if (!id || !nome) return [];
    emissor.novoBloco();
    return [{ tipo: 'ferramenta', id, nome: nomeDaFerramenta(nome), entrada: comoObjeto(o.parameters) ?? {} }];
  };

  const retornoDeFerramenta = (o: Objeto): EventoAgente[] => {
    const id = texto(o.tool_id);
    if (!id) return [];
    const ok = o.status === 'success';
    const resultado = texto(o.output) ?? texto(comoObjeto(o.error)?.message) ?? '';
    return [{ tipo: 'ferramenta_fim', id, ok, resultado: cortar(resultado, LIMITE_RESULTADO) }];
  };

  const aviso = (o: Objeto): EventoAgente[] => {
    const mensagemAviso = texto(o.message);
    return mensagemAviso ? [{ tipo: 'aviso', mensagem: `O Gemini avisou: ${cortar(mensagemAviso, 400)}` }] : [];
  };

  const resultado = (o: Objeto): EventoAgente[] => {
    const eventos: EventoAgente[] = [];
    if (o.status === 'error' && !erroEmitido) {
      erroEmitido = true;
      eventos.push(erroDoResultado(texto(comoObjeto(o.error)?.message)));
    }
    const stats = comoObjeto(o.stats);
    eventos.push({
      tipo: 'uso',
      uso: {
        tokensEntrada: numero(stats?.input_tokens),
        tokensSaida: numero(stats?.output_tokens),
        custoUsd: null,
        duracaoMs: numero(stats?.duration_ms),
      },
    });
    return eventos;
  };

  return (linha) => {
    const o = lerLinhaJson(linha);
    if (!o) return [];
    if (o.type === 'init') {
      const sessaoId = texto(o.session_id);
      return sessaoId ? [{ tipo: 'sessao', sessaoId, modelo: texto(o.model) }] : [];
    }
    if (o.type === 'message') return mensagem(o);
    if (o.type === 'tool_use') return usoDeFerramenta(o);
    if (o.type === 'tool_result') return retornoDeFerramenta(o);
    if (o.type === 'error') return aviso(o);
    if (o.type === 'result') return resultado(o);
    return [];
  };
}

function erroDoResultado(detalhe: string | null): EventoAgente {
  const tipo = detalhe ? classificarErro(detalhe) : null;
  if (tipo) return { tipo: 'erro', ...FALHAS[tipo] };
  const mensagem = detalhe ? `O Gemini CLI parou com erro: ${cortar(detalhe, 400)}` : 'O Gemini CLI parou com erro no meio da resposta.';
  return { tipo: 'erro', codigo: 'desconhecido', mensagem };
}
