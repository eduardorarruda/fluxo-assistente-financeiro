import { join } from 'node:path';
import { MODELOS } from './modelos';
import { classificarErro, comoObjeto, criarEmissorDeTexto, cortar, lerLinhaJson, numero, texto, textoDeConteudo, type Objeto } from './comum';
import type { AdaptadorCli, CodigoErro, EventoAgente, Interprete, ParametrosExecucao } from './tipos';

const LIMITE_RESULTADO = 8000;
/** Segundos que o Codex espera o MCP do Fluxo subir. */
const TEMPO_PARA_O_MCP_SUBIR = 20;

const FALHAS: Record<'autenticacao' | 'limite', { codigo: CodigoErro; mensagem: string }> = {
  autenticacao: {
    codigo: 'autenticacao',
    mensagem: 'O Codex CLI não está logado. Num terminal, rode `codex login` (use a conta do seu plano do ChatGPT).',
  },
  limite: { codigo: 'limite', mensagem: 'O limite de uso do seu plano do ChatGPT acabou por agora. Tente de novo mais tarde.' },
};

/** Ferramentas que o modo travado não deixa rodar: se aparecerem, a pessoa fica sabendo. */
const BLOQUEADAS: Record<string, (item: Objeto) => string> = {
  command_execution: (item) => `rodar o comando "${cortar(texto(item.command) ?? '?', 200)}"`,
  file_change: () => 'alterar arquivos',
  web_search: (item) => `pesquisar na web${texto(item.query) ? ` ("${cortar(texto(item.query)!, 200)}")` : ''}`,
};

/**
 * Codex CLI (`codex exec --json -`, prompt pela entrada padrão). Roda com
 * sandbox só de leitura, sem a ferramenta de shell, sem busca na web e sem a
 * configuração do usuário (que pode ter outros servidores MCP). Sobra o MCP
 * do Fluxo; as imagens vão com `-i`.
 */
export const adaptadorCodex: AdaptadorCli = {
  provedor: 'codex',
  nome: 'Codex CLI',
  binario: 'codex',
  comoInstalar: 'npm install -g @openai/codex',
  comoEntrar: 'codex login   # entre com a conta do ChatGPT do seu plano',
  variavelDeConta: 'CODEX_HOME',
  modelos: MODELOS.codex,
  // Sem OPENAI_API_KEY nem CODEX_API_KEY de propósito: a ideia é usar o login
  // do plano do ChatGPT da pessoa, não uma chave de API cobrada por uso.
  variaveisPermitidas: ['CODEX_HOME'],

  montar(p: ParametrosExecucao) {
    const args = [
      'exec', '--json', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules',
      '-s', 'read-only', '-C', p.pasta,
      '--disable', 'shell_tool',
      '-c', 'web_search="disabled"',
      ...configuracaoMcp(p),
    ];
    if (p.modelo) args.push('-m', p.modelo);
    for (const imagem of p.imagens) args.push('-i', imagem);
    // Depois do `resume` o Codex não aceita -s/-C/--add-dir: toda opção vem antes.
    if (p.sessaoId) args.push('resume', p.sessaoId);
    args.push('-');
    return {
      args,
      entrada: p.prompt,
      arquivos: [{ caminho: join(p.pasta, 'AGENTS.md'), conteudo: p.instrucoes }],
      env: { [p.mcp.segredo.variavel]: p.mcp.segredo.valor },
    };
  },

  novoInterprete: criarInterprete,

  sessaoPerdida(_codigo, stderr) {
    return /\bno (session|thread|rollout|conversation)s?\b.*\b(found|with id)\b|\b(session|thread|rollout|conversation)s?\b.*\bnot found\b/i.test(stderr);
  },

  explicarFalha(_codigo, stderr) {
    const tipo = classificarErro(stderr) ?? (/\b401\b/.test(stderr) ? 'autenticacao' : null);
    return tipo ? FALHAS[tipo] : null;
  },
};

/** String básica TOML: o JSON de uma string é TOML válido (aspas e barras escapadas). */
const stringToml = (valor: string) => JSON.stringify(valor);

/**
 * O MCP do Fluxo pela linha de comando: cada `-c chave=valor` num argumento só,
 * com o valor em TOML. O token não vai aqui (ps mostra): `env_vars` manda o
 * Codex copiar a variável do próprio ambiente para o processo do MCP.
 */
function configuracaoMcp(p: ParametrosExecucao): string[] {
  const prefixo = `mcp_servers.${p.mcp.nome}`;
  const env = Object.entries(p.mcp.env).map(([chave, valor]) => `${stringToml(chave)}=${stringToml(valor)}`);
  const valores = [
    `command=${stringToml(p.mcp.comando)}`,
    `args=[${p.mcp.args.map(stringToml).join(',')}]`,
    `env={${env.join(',')}}`,
    `env_vars=[${stringToml(p.mcp.segredo.variavel)}]`,
    // Sem isto, o exec nega ferramenta MCP sem readOnlyHint ("requires approval") — e as de ação do Fluxo
    // (ajustar, propor, confirmar) não têm: quem decide o que pode é o servidor do Fluxo, não o CLI.
    'default_tools_approval_mode="approve"',
    'required=true',
    `startup_timeout_sec=${TEMPO_PARA_O_MCP_SUBIR}`,
    // gerar_imagem (Nano Banana) pode levar mais de um minuto; o padrão do Codex é 60 s.
    'tool_timeout_sec=200',
  ];
  return valores.flatMap((v) => ['-c', `${prefixo}.${v}`]);
}

function criarInterprete(): Interprete {
  const emissor = criarEmissorDeTexto();
  /** Chamadas de ferramenta já anunciadas e itens bloqueados já avisados (pelo id do item). */
  const anunciadas = new Set<string>();
  const avisados = new Set<string>();
  let erroEmitido = false;

  const ferramentaMcp = (item: Objeto, id: string, terminou: boolean): EventoAgente[] => {
    const eventos: EventoAgente[] = [];
    const ferramenta = texto(item.tool);
    if (!anunciadas.has(id) && ferramenta) {
      anunciadas.add(id);
      emissor.novoBloco();
      const servidor = texto(item.server);
      const nome = servidor ? `mcp__${servidor}__${ferramenta}` : ferramenta;
      eventos.push({ tipo: 'ferramenta', id, nome, entrada: comoObjeto(item.arguments) ?? {} });
    }
    if (terminou) {
      const erro = texto(comoObjeto(item.error)?.message);
      const ok = item.status === 'completed' && !erro;
      const resultado = erro ?? textoDeConteudo(comoObjeto(item.result)?.content);
      eventos.push({ tipo: 'ferramenta_fim', id, ok, resultado: cortar(resultado, LIMITE_RESULTADO) });
    }
    return eventos;
  };

  const avisoUmaVez = (id: string, mensagem: string): EventoAgente[] => {
    if (avisados.has(id)) return [];
    avisados.add(id);
    return [{ tipo: 'aviso', mensagem }];
  };

  const item = (o: Objeto): EventoAgente[] => {
    const it = comoObjeto(o.item);
    const id = texto(it?.id);
    if (!it || !id) return [];
    const terminou = o.type === 'item.completed';
    const tipo = texto(it.type) ?? '';
    if (tipo === 'agent_message') {
      if (!terminou) return [];
      emissor.novoBloco();
      return emissor.emitir(texto(it.text));
    }
    if (tipo === 'mcp_tool_call') return ferramentaMcp(it, id, terminou);
    if (tipo === 'error') {
      const mensagem = texto(it.message);
      return mensagem ? avisoUmaVez(id, `O Codex avisou: ${cortar(mensagem, 400)}`) : [];
    }
    const bloqueada = BLOQUEADAS[tipo];
    if (bloqueada) return avisoUmaVez(id, `O Codex tentou ${bloqueada(it)}, o que está bloqueado aqui.`);
    return [];
  };

  const falha = (o: Objeto): EventoAgente[] => {
    if (erroEmitido) return [];
    erroEmitido = true;
    const detalhe = texto(comoObjeto(o.error)?.message);
    const tipo = detalhe ? classificarErro(detalhe) : null;
    if (tipo) return [{ tipo: 'erro', ...FALHAS[tipo] }];
    const mensagem = detalhe ? `O Codex CLI parou com erro: ${cortar(detalhe, 400)}` : 'O Codex CLI parou com erro no meio da resposta.';
    return [{ tipo: 'erro', codigo: 'desconhecido', mensagem }];
  };

  const uso = (o: Objeto): EventoAgente[] => {
    const u = comoObjeto(o.usage);
    // Na conta da OpenAI, os tokens em cache já estão dentro de input_tokens.
    return [{ tipo: 'uso', uso: { tokensEntrada: numero(u?.input_tokens), tokensSaida: numero(u?.output_tokens), custoUsd: null, duracaoMs: null } }];
  };

  return (linha) => {
    const o = lerLinhaJson(linha);
    if (!o) return [];
    if (o.type === 'thread.started') {
      const sessaoId = texto(o.thread_id);
      return sessaoId ? [{ tipo: 'sessao', sessaoId, modelo: null }] : [];
    }
    if (o.type === 'item.started' || o.type === 'item.updated' || o.type === 'item.completed') return item(o);
    if (o.type === 'turn.completed') return uso(o);
    if (o.type === 'turn.failed') return falha(o);
    // Erro solto é transitório (o Codex reconecta sozinho); o fatal vem em turn.failed.
    if (o.type === 'error') {
      const mensagem = texto(o.message);
      return mensagem ? [{ tipo: 'aviso', mensagem: `O Codex avisou: ${cortar(mensagem, 400)}` }] : [];
    }
    return [];
  };
}
