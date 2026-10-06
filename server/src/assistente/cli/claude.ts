import { join, relative } from 'node:path';
import { MODELOS } from './modelos';
import {
  classificarErro, comoObjeto, criarEmissorDeTexto, cortar, lerLinhaJson, lista, numero, somar, texto, textoDeConteudo,
  type Objeto,
} from './comum';
import type { AdaptadorCli, CodigoErro, EventoAgente, Interprete, ParametrosExecucao } from './tipos';

const LIMITE_RESULTADO = 8000;

/**
 * O Claude Code carrega CLAUDE.md e `.claude/rules` (do usuário e de cada pasta
 * acima da de trabalho) — instruções de programação que não têm nada a ver com
 * finanças e só gastariam contexto. `--restricted` ignora os arquivos de
 * configuração mas não a memória; estas exclusões (picomatch sobre caminho
 * absoluto) e o `autoMemoryEnabled` desligam o resto.
 */
const CONFIGURACAO = {
  claudeMdExcludes: ['**/CLAUDE.md', '**/CLAUDE.local.md', '**/.claude/**'],
  autoMemoryEnabled: false,
};

/**
 * Erros que o Claude CLI devolve como mensagem "sintética" do assistente
 * (campo `error`), com o texto em inglês no lugar da resposta.
 */
const ERROS_DA_API: Record<string, { codigo: CodigoErro; mensagem: string }> = {
  authentication_failed: {
    codigo: 'autenticacao',
    mensagem: 'O Claude Code não está logado (ou o login expirou). Abra um terminal, rode `claude` e digite /login.',
  },
  rate_limit: { codigo: 'limite', mensagem: 'O limite de uso do seu plano do Claude acabou por agora. Tente de novo mais tarde.' },
  billing_error: { codigo: 'limite', mensagem: 'O Claude recusou por causa do plano ou da cobrança da sua conta.' },
};

/**
 * Claude Code (`claude -p`). Roda em modo restrito: só o `Read` (preso à pasta
 * da conversa, onde ficam os anexos) e as ferramentas do MCP do Fluxo. O
 * `dontAsk` nega sozinho qualquer coisa fora dessa lista — não há ninguém
 * para clicar em "permitir".
 */
export const adaptadorClaude: AdaptadorCli = {
  provedor: 'claude',
  nome: 'Claude Code',
  binario: 'claude',
  comoInstalar: 'curl -fsSL https://claude.ai/install.sh | bash',
  comoEntrar: 'claude   # depois digite /login e entre com a conta do seu plano',
  variavelDeConta: 'CLAUDE_CONFIG_DIR',
  modelos: MODELOS.claude,
  variaveisPermitidas: ['CLAUDE_CONFIG_DIR'],

  montar(p: ParametrosExecucao) {
    const configMcp = join(p.pastaExecucao, 'mcp-claude.json');
    const instrucoes = join(p.pastaExecucao, 'instrucoes.md');
    const configuracao = join(p.pastaExecucao, 'configuracao-claude.json');
    const args = [
      '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
      '--restricted', '--strict-mcp-config', '--mcp-config', configMcp,
      '--tools', 'Read',
      '--permission-mode', 'dontAsk',
      '--allowedTools', `mcp__${p.mcp.nome} Read`,
      '--append-system-prompt-file', instrucoes,
      '--settings', configuracao,
    ];
    if (p.modelo) args.push('--model', p.modelo);
    if (p.sessaoId) args.push('--resume', p.sessaoId);
    // O arquivo fica na pasta da execução (fora do alcance do Read), então o segredo pode ir nele.
    const env = { ...p.mcp.env, [p.mcp.segredo.variavel]: p.mcp.segredo.valor };
    const servidor = { type: 'stdio', command: p.mcp.comando, args: p.mcp.args, env };
    return {
      args,
      entrada: comImagens(p),
      arquivos: [
        { caminho: configMcp, conteudo: JSON.stringify({ mcpServers: { [p.mcp.nome]: servidor } }) },
        { caminho: instrucoes, conteudo: p.instrucoes },
        { caminho: configuracao, conteudo: JSON.stringify(CONFIGURACAO) },
      ],
      env: {},
    };
  },

  novoInterprete: criarInterprete,

  sessaoPerdida(_codigo, stderr) {
    return /no conversation found|session .*not found/i.test(stderr);
  },

  explicarFalha(_codigo, stderr) {
    const tipo = classificarErro(stderr);
    if (tipo === 'autenticacao') return ERROS_DA_API.authentication_failed!;
    if (tipo === 'limite') return ERROS_DA_API.rate_limit!;
    return null;
  },
};

/** O Claude abre imagens com o Read: basta dizer onde estão (relativo à pasta da conversa). */
function comImagens(p: ParametrosExecucao): string {
  if (!p.imagens.length) return p.prompt;
  const lista = p.imagens.map((i) => `- ${relative(p.pasta, i)}`).join('\n');
  return `${p.prompt}\n\nImagens anexadas a esta mensagem (abra cada uma com a ferramenta Read antes de responder):\n${lista}`;
}

function criarInterprete(): Interprete {
  const emissor = criarEmissorDeTexto();
  /** Mensagens cujo texto já chegou em pedaços: a versão completa não é repetida. */
  const transmitidas = new Set<string>();
  let mensagemAtual = '';
  let erroEmitido = false;

  const init = (o: Objeto): EventoAgente[] => {
    const eventos: EventoAgente[] = [];
    const sessaoId = texto(o.session_id);
    if (sessaoId) eventos.push({ tipo: 'sessao', sessaoId, modelo: texto(o.model) });
    const fluxo = lista(o.mcp_servers).map(comoObjeto).find((s) => s?.name === 'fluxo');
    if (fluxo && fluxo.status !== 'connected') {
      eventos.push({ tipo: 'aviso', mensagem: 'As ferramentas do Fluxo não conectaram: a resposta pode sair sem olhar os seus dados.' });
    }
    return eventos;
  };

  const eventoParcial = (evento: Objeto | null): EventoAgente[] => {
    if (!evento) return [];
    if (evento.type === 'message_start') {
      mensagemAtual = texto(comoObjeto(evento.message)?.id) ?? '';
      return [];
    }
    if (evento.type === 'content_block_start') {
      const bloco = comoObjeto(evento.content_block);
      if (bloco?.type === 'text') emissor.novoBloco();
      if (bloco?.type === 'tool_use') return ferramenta(bloco);
      return [];
    }
    if (evento.type === 'content_block_delta') {
      const delta = comoObjeto(evento.delta);
      if (delta?.type !== 'text_delta') return [];
      transmitidas.add(mensagemAtual);
      return emissor.emitir(texto(delta.text));
    }
    return [];
  };

  const assistente = (o: Objeto): EventoAgente[] => {
    const mensagem = comoObjeto(o.message);
    const erro = texto(o.error);
    if (erro) {
      erroEmitido = true;
      const conhecido = ERROS_DA_API[erro];
      return [conhecido ? { tipo: 'erro', ...conhecido } : { tipo: 'erro', codigo: 'desconhecido', mensagem: textoDeConteudo(mensagem?.content) || erro }];
    }
    const jaTransmitida = transmitidas.has(texto(mensagem?.id) ?? '');
    return lista(mensagem?.content).flatMap((b): EventoAgente[] => {
      const bloco = comoObjeto(b);
      if (bloco?.type === 'tool_use') return ferramenta(bloco);
      if (bloco?.type === 'text' && !jaTransmitida) {
        emissor.novoBloco();
        return emissor.emitir(texto(bloco.text));
      }
      return [];
    });
  };

  const resultadosDeFerramentas = (o: Objeto): EventoAgente[] =>
    lista(comoObjeto(o.message)?.content).flatMap((b): EventoAgente[] => {
      const bloco = comoObjeto(b);
      const id = texto(bloco?.tool_use_id);
      if (bloco?.type !== 'tool_result' || !id) return [];
      return [{ tipo: 'ferramenta_fim', id, ok: bloco.is_error !== true, resultado: cortar(textoDeConteudo(bloco.content), LIMITE_RESULTADO) }];
    });

  const resultado = (o: Objeto): EventoAgente[] => {
    const eventos: EventoAgente[] = [];
    const falhou = o.is_error === true || (texto(o.subtype) ?? '').startsWith('error');
    if (falhou && !erroEmitido) {
      erroEmitido = true;
      eventos.push({ tipo: 'erro', codigo: 'desconhecido', mensagem: mensagemDeFalha(o) });
    } else if (!falhou && !erroEmitido && !emissor.algumTexto) {
      eventos.push(...emissor.emitir(texto(o.result)));
    }
    const uso = comoObjeto(o.usage);
    eventos.push({
      tipo: 'uso',
      uso: {
        tokensEntrada: somar(uso?.input_tokens, uso?.cache_read_input_tokens, uso?.cache_creation_input_tokens),
        tokensSaida: numero(uso?.output_tokens),
        custoUsd: numero(o.total_cost_usd),
        duracaoMs: numero(o.duration_ms),
      },
    });
    return eventos;
  };

  return (linha) => {
    const o = lerLinhaJson(linha);
    if (!o) return [];
    if (o.type === 'system') return o.subtype === 'init' ? init(o) : [];
    if (o.type === 'stream_event') return eventoParcial(comoObjeto(o.event));
    if (o.type === 'assistant') return assistente(o);
    if (o.type === 'user') return resultadosDeFerramentas(o);
    if (o.type === 'result') return resultado(o);
    return [];
  };
}

function ferramenta(bloco: Objeto): EventoAgente[] {
  const id = texto(bloco.id);
  const nome = texto(bloco.name);
  return id && nome ? [{ tipo: 'ferramenta', id, nome, entrada: comoObjeto(bloco.input) ?? {} }] : [];
}

function mensagemDeFalha(o: Objeto): string {
  const detalhe = texto(o.result);
  if (o.subtype === 'error_max_turns') return 'A resposta passou do número máximo de passos e foi interrompida.';
  if (detalhe) return `O Claude Code parou com erro: ${cortar(detalhe, 400)}`;
  return 'O Claude Code parou com erro no meio da resposta.';
}
