# Assistente — plano e contrato

Uma tela de conversa (estilo Claude Desktop: conversas à esquerda, mensagens no meio, caixa de texto
embaixo) em que um agente faz análise financeira com os dados do Fluxo. O "cérebro" é o CLI que a
pessoa já paga e já usa — **Claude Code**, **Gemini CLI** ou **Codex CLI** —, rodando nesta máquina
com o login dela. Como alternativa, cada provedor também pode ser usado **por chave de API** (paga por
uso, ver "Contas por API" no fim); a chave fica num arquivo 0600, nunca no banco nem na resposta da API.

## Decisões

| Tema | Decisão | Por quê |
|---|---|---|
| Como falar com o modelo | Processo filho do CLI em modo não interativo (`claude -p`, `gemini -p`, `codex exec`), prompt pela entrada padrão, saída em JSON por linha | Usa a assinatura que a pessoa já tem; nenhuma chave no Fluxo |
| Como o agente lê os dados | Servidor **MCP** próprio (`server/dist/assistente/mcp/ponte.js`, stdio) que os três CLIs sabem carregar. Ele só repassa as chamadas para a API local, com um token que vale só durante aquela resposta e só para as ferramentas do assistente (nunca para aprovar nada) | Um contrato só para os três CLIs; o agente nunca toca no SQLite nem no token da sessão |
| O que o agente pode fazer | Ler; e mudar dados só pelas ferramentas de ação do Fluxo (pequenas na hora, com Desfazer; grandes só viram proposta que a PESSOA aprova — ver "Ações"). Sem shell, sem escrever arquivo, sem web. Claude: `--restricted --tools Read --permission-mode dontAsk --allowedTools mcp__fluxo`. Gemini: política que nega tudo menos `mcp_fluxo_*`/leitura. Codex: `--sandbox read-only`, web search desligado | Descrição de Pix é texto de terceiro (prompt injection). Sem rede e sem escrita fora do Fluxo, não há como vazar; o pior que um texto de terceiro consegue é uma mudança pequena com Desfazer ou uma proposta — aprovar, só a pessoa |
| Ambiente do processo | Variáveis limpas: passa só PATH, HOME, idioma, XDG e as do próprio CLI; **nunca** `PLUGGY_*` nem `FLUXO_*` | O segredo da Pluggy não chega ao agente |
| Banco | **Continua SQLite**, com `sqlite-vec` (vetores, KNN em C dentro do processo) + FTS5 (busca por palavra, BM25) | Uma pessoa, dezenas de milhares de trechos: busca exata em milissegundos, sem servidor extra, backup continua sendo copiar um arquivo. Postgres+pgvector só valeria com vários usuários/máquinas — a camada `IndiceVetorial` deixa a troca isolada se um dia precisar |
| Vetorização | Modelo local `Xenova/multilingual-e5-small` (384 dimensões, português bom) via `@huggingface/transformers` (ONNX). Baixado **uma vez** (~120 MB) quando a pessoa ativa nos Ajustes; fica em `data/modelos/` | O extrato não sai da máquina para gerar embedding; os CLIs não oferecem embedding |
| Busca | Híbrida: vetor (cosseno) + FTS5, fundidas por *Reciprocal Rank Fusion*. Sem o modelo baixado, só FTS5 | Nome de loja ("IFD*IFOOD") acha por palavra; "comida fora de casa" acha por significado |
| O que é indexado | Movimentos (texto montado: data, descrição, loja, categoria, natureza, valor, conta) e anexos (PDF, TXT, MD, CSV, OFX, JSON) em trechos de ~900 caracteres com sobreposição | Imagem não vira texto: vai direto para o CLI ler (os três aceitam imagem) |
| Execução | Cada resposta é uma *execução* no servidor, independente da aba: o texto vai sendo gravado; a tela assina por SSE e pode sair e voltar | Fechar a conversa não mata a resposta; reabrir mostra o que já veio |
| Continuidade | Guarda o id de sessão do CLI por conversa e conta (`--resume`). Trocou de CLI no meio, o histórico recente vai como contexto no primeiro turno | A conversa continua com o mesmo "cérebro" sem reenviar tudo |

## Ferramentas do agente (MCP) — de leitura

Valores em **reais** (número com 2 casas) — nunca centavos —, datas `AAAA-MM-DD`, meses `AAAA-MM`.

| Ferramenta | O que devolve |
|---|---|
| `panorama` | Hoje, mês atual, meses com dados, contas e saldos, patrimônio, cartões (limite, fatura aberta) |
| `resumo_do_mes` `{mes}` | Receitas, despesas, guardado, resultado, gastos por categoria, comparação com o mês anterior |
| `serie_mensal` `{de, ate}` | Receitas/despesas/guardado/resultado mês a mês (até 36 meses) |
| `buscar_movimentos` `{mes?, de?, ate?, categoria?, natureza?, texto?, valorMin?, valorMax?, ordem?, limite?}` | Movimentos filtrados + totais |
| `busca_semantica` `{consulta, fontes?, limite?}` | Trechos mais parecidos (movimentos e anexos), com a fonte |
| `cartoes_e_faturas` | Cartões, faturas por mês (situação, total, pago), parcelas futuras |
| `itens_da_fatura` `{contaId, mes}` | Compras de uma fatura |
| `orcamento` `{mes}` | Limites × gasto por categoria |
| `metas` | Metas (com o `id`) e progresso |
| `recorrencias` | Assinaturas e contas fixas, custo mensal e anual |
| `caixinhas_e_investimentos` | Caixinhas, investimentos, rendimento estimado |
| `insights` `{mes}` | Os mesmos insights da tela |
| `categorias` | Lista de categorias (id, nome, grupo) |
| `anexos` | Anexos desta conversa (id, nome, tipo, situação) |
| `ler_anexo` `{anexoId, inicio?, limite?}` | Texto extraído de um anexo, em páginas |
| `gerar_imagem` `{descricao, proporcao?, qualidade?}` | Não mexe em dado financeiro: gera uma imagem com o Nano Banana (Gemini, chave paga da pessoa) e a grava como anexo `origem: 'gerada'` DESTA conversa, preso à resposta em andamento. Devolve `{ anexoId, markdown: "![…](anexo:<id>)", custoEstimadoUsd, modelo }`. Limite por dia; o modelo dos Ajustes é o teto de custo |

As que mudam dados (ações diretas e propostas) estão em "Ações", no fim.

## Contrato da API (`/api/assistente`)

> A configuração de CLIs abaixo (`CliInfo`, `provedorPadrao`, `/clis/:provedor/testar`) foi
> substituída pela de **contas** — ver "Contas (v2 do contrato)" no fim. O resto vale como está.

Toda rota exige a sessão (cookie ou `x-fluxo-sessao`), e escrita exige `X-Fluxo: 1`, como o resto da API.
Erros: `{ erro: string }` com status HTTP.

```ts
type ProvedorIA = 'claude' | 'gemini' | 'codex';

interface CliInfo {
  provedor: ProvedorIA;
  nome: string;                 // "Claude Code" | "Gemini CLI" | "Codex CLI"
  ativo: boolean;               // a pessoa ligou este CLI
  caminho: string | null;       // caminho escolhido (null = procurar sozinho)
  caminhoDetectado: string | null;
  instalado: boolean;
  versao: string | null;
  modelo: string | null;        // null = o padrão do CLI
  modelosSugeridos: string[];
  comoInstalar: string;         // comando de instalação
  comoEntrar: string;           // como fazer login
}

interface EstadoRag {
  ativo: boolean;               // modelo baixado e pronto
  preparando: boolean;          // baixando modelo ou indexando
  progresso: number | null;     // 0..1 enquanto prepara
  etapa: string | null;         // "Baixando o modelo (45 MB de 118 MB)" | "Indexando movimentos (1200 de 3400)"
  erro: string | null;
  modelo: string;
  movimentosIndexados: number;
  movimentosTotal: number;
  trechosDeAnexos: number;
}

interface ConfigAssistente {
  provedorPadrao: ProvedorIA | null;   // null = nenhum CLI pronto
  clis: CliInfo[];
  rag: EstadoRag;
}

interface ResumoConversa {
  id: string;
  titulo: string;
  provedor: ProvedorIA;
  modelo: string | null;
  fixada: boolean;
  gerando: boolean;             // há execução em andamento
  previa: string;               // começo da última mensagem
  criadaEm: string;             // ISO
  atualizadaEm: string;         // ISO
}

type TipoAnexo = 'imagem' | 'pdf' | 'texto';
interface Anexo {
  id: string;
  nome: string;
  mime: string;
  tamanho: number;              // bytes
  tipo: TipoAnexo;
  situacao: 'pendente' | 'indexando' | 'pronto' | 'sem_texto' | 'erro';
  erro: string | null;
  criadoEm: string;
}

interface PassoFerramenta {
  id: string;
  nome: string;                 // "resumo_do_mes"
  rotulo: string;               // "Resumo de set/2026" (pronto para mostrar)
  entrada: Record<string, unknown>;
  situacao: 'rodando' | 'ok' | 'erro';
  resultado: string | null;     // prévia do retorno (até ~600 caracteres)
}

interface Uso { tokensEntrada: number | null; tokensSaida: number | null; custoUsd: number | null; duracaoMs: number | null }

interface Mensagem {
  id: string;
  papel: 'usuario' | 'assistente';
  texto: string;                // markdown no caso do assistente
  passos: PassoFerramenta[];    // na ordem em que aconteceram
  anexos: Anexo[];
  situacao: 'gerando' | 'ok' | 'erro' | 'cancelada' | 'interrompida';
  erro: string | null;
  provedor: ProvedorIA | null;
  modelo: string | null;
  uso: Uso | null;
  criadaEm: string;
}

interface Conversa extends ResumoConversa {
  mensagens: Mensagem[];
  execucaoAtiva: string | null; // id para assinar os eventos
}

type EventoExecucao =
  | { tipo: 'texto'; delta: string }               // pedaço de texto do assistente
  | { tipo: 'passo'; passo: PassoFerramenta }      // novo passo ou atualização (mesmo id)
  | { tipo: 'fim'; mensagem: Mensagem };           // estado final gravado; o fluxo termina aqui
```

| Método e rota | Corpo | Resposta |
|---|---|---|
| `GET /config` | — | `ConfigAssistente` |
| `PUT /config` | `{ provedorPadrao?: ProvedorIA, clis?: Partial<Record<ProvedorIA, { ativo?: boolean; caminho?: string \| null; modelo?: string \| null }>> }` | `ConfigAssistente` |
| `POST /clis/:provedor/testar` | `{}` | `{ ok: boolean; versao: string \| null; mensagem: string; duracaoMs: number }` |
| `POST /rag/ativar` | `{}` | `EstadoRag` (baixa o modelo e indexa em segundo plano) |
| `POST /rag/reindexar` | `{}` | `EstadoRag` |
| `GET /conversas?busca=` | — | `ResumoConversa[]` (fixadas primeiro, depois mais recentes) |
| `POST /conversas` | `{ provedor?: ProvedorIA; modelo?: string \| null }` | `ResumoConversa` |
| `GET /conversas/:id` | — | `Conversa` |
| `PATCH /conversas/:id` | `{ titulo?: string; fixada?: boolean; provedor?: ProvedorIA; modelo?: string \| null }` | `ResumoConversa` |
| `DELETE /conversas/:id` | — | 204 (apaga mensagens e anexos) |
| `POST /conversas/:id/anexos?nome=<nome>` | bytes crus, `Content-Type: application/octet-stream`, até 15 MB | `Anexo` |
| `DELETE /anexos/:id` | — | 204 (só anexo que ainda não foi enviado) |
| `POST /conversas/:id/mensagens` | `{ texto: string; anexos: string[]; provedor?: ProvedorIA; modelo?: string \| null }` | `{ execucaoId: string; usuario: Mensagem; assistente: Mensagem }` |
| `GET /execucoes/:id/eventos?desde=<n>` | — | `text/event-stream`: cada evento é `id: <n>` + `data: <EventoExecucao em JSON>` |
| `POST /execucoes/:id/cancelar` | `{}` | 204 |
| `POST /mensagens/:id/repetir` | `{}` | `{ execucaoId: string; assistente: Mensagem }` (refaz a última resposta) |

Uma conversa só tem uma execução por vez (409 se já houver). Anexo aceito: PNG, JPEG, WEBP, GIF, PDF,
TXT, MD, CSV, OFX, JSON — conferido pelo conteúdo, não pela extensão.

## Segurança

- O agente lê à vontade e só muda dados pelas ferramentas de ação (ver "Ações"): as grandes viram proposta, e aprovar é da pessoa (rota com sessão ou o "sim" dela conferido pelo servidor). Os CLIs rodam travados (ver Decisões).
- O token da ponte MCP é aleatório, vale só para `/api/assistente/ferramentas/*` e morre quando a
  execução termina. A ponte recebe o token por variável de ambiente, nunca pela linha de comando.
- O caminho do CLI configurado precisa ser um arquivo executável cujo nome é o do CLI esperado
  (`claude`, `gemini`, `codex`). Nada de shell: `spawn` com lista de argumentos.
- Anexos: tipo conferido pelos bytes, nome original nunca vira caminho (`<uuid>.<ext>`), pasta 0700,
  arquivos 0600, 15 MB no máximo, 20 por conversa.
- O markdown da resposta é renderizado sem HTML cru (react-markdown sem rehype-raw); links abrem fora.
- Tempo máximo por resposta: 10 minutos; cancelar mata o grupo de processos inteiro.

## Contas (v2 do contrato — substitui `CliInfo`/`provedorPadrao` acima)

Cada **conta** é um login de um CLI. Dá para ter várias do mesmo CLI (ex.: "Claude pessoal" e
"Claude trabalho"): a diferença é a **pasta de login**, que o Fluxo passa ao CLI pela variável dele
(`CLAUDE_CONFIG_DIR`, `GEMINI_CLI_HOME`, `CODEX_HOME`). Sem pasta, a conta usa o login padrão do CLI.
As três contas que já vêm (ids `claude`, `gemini`, `codex`) são as de login padrão.

```ts
interface ProvedorInfo {
  provedor: ProvedorIA;
  nome: string;                    // "Claude Code"
  variavelDeConta: string;         // "CLAUDE_CONFIG_DIR" | "GEMINI_CLI_HOME" | "CODEX_HOME"
  modelosSugeridos: string[];
  comoInstalar: string;
}

interface ContaIA {
  id: string;                      // 'claude' | 'gemini' | 'codex' nas padrão; uuid nas criadas
  provedor: ProvedorIA;
  nome: string;                    // "Claude pessoal"
  ativo: boolean;
  caminho: string | null;          // executável (null = procurar sozinho)
  modelo: string | null;           // modelo padrão desta conta (null = o padrão do CLI)
  pastaLogin: string | null;       // null = login padrão do CLI
  // detectado:
  caminhoDetectado: string | null;
  instalado: boolean;
  versao: string | null;
  comoEntrar: string;              // comando pronto para copiar, já com a variável da pasta de login
}

interface ConfigAssistente {
  contaPadrao: string | null;      // id; null = nenhuma conta pronta
  contas: ContaIA[];
  provedores: ProvedorInfo[];
  pastaSugerida: string;           // base para sugerir a pasta de login de conta nova (ex.: "$HOME/.config/fluxo/contas")
  rag: EstadoRag;
}

// ResumoConversa e Mensagem ganham:
//   contaId: string               (conversa: a conta que responde; mensagem do assistente: quem respondeu, ou null)
//   contaNome: string | null      (para mostrar "Claude trabalho · sonnet")
// `provedor` continua vindo (derivado da conta) para o ícone.
```

| Método e rota | Corpo | Resposta |
|---|---|---|
| `GET /config` | — | `ConfigAssistente` (v2) |
| `PUT /config` | `{ contaPadrao: string }` | `ConfigAssistente` |
| `POST /contas` | `{ provedor, nome, pastaLogin?: string \| null, caminho?: string \| null, modelo?: string \| null }` | `ConfigAssistente` |
| `PATCH /contas/:id` | `{ nome?, ativo?, caminho?, modelo?, pastaLogin? }` | `ConfigAssistente` |
| `DELETE /contas/:id` | — | `ConfigAssistente` (não remove a última conta; conversas dela passam para a padrão) |
| `POST /contas/:id/testar` | `{}` | `{ ok, versao, mensagem, duracaoMs }` |
| `POST /conversas` | `{ contaId?: string; modelo?: string \| null }` | `ResumoConversa` |
| `PATCH /conversas/:id` | `{ titulo?, fixada?, contaId?, modelo? }` | `ResumoConversa` |
| `POST /conversas/:id/mensagens` | `{ texto, anexos, contaId?, modelo? }` | como antes |

Saem: `PUT /config` com `clis`/`provedorPadrao`, `POST /clis/:provedor/testar`, e `provedor` como
entrada de conversas/mensagens. `modelo` aceita qualquer nome (letras, números, `. _ - : / @`, sem
começar com `-`): a lista de sugeridos é só atalho. `pastaLogin` precisa ser caminho absoluto.

## Relatórios visuais (gráficos e imagens)

**Gráficos (de graça, números exatos).** O agente escreve um bloco de código com a linguagem `grafico`
contendo JSON; a tela troca o bloco por um gráfico desenhado com os componentes do Fluxo
(`web/src/paginas/assistente/relatorio/`). Especificação validada com zod na tela:

```ts
{ tipo: 'barras' | 'barras_empilhadas' | 'linhas' | 'area' | 'pizza'; titulo: string; subtitulo?: string;
  unidade: 'reais' | 'numero' | 'percentual';   // reais com 2 casas; percentual em pontos (12.5 = 12,5%)
  rotulos: string[];                              // até 60
  series: { nome: string; valores: number[]; cor?: 'entrada' | 'saida' | 'guardado' | 'marca' | 'info' | 'atencao' }[] } // até 8
```

Um valor por rótulo; pizza tem uma série só, sem negativos. JSON pela metade enquanto a resposta chega
mostra um esqueleto; inválido no fim vira um cartão "não consegui desenhar" com o JSON recolhido.
Cada gráfico tem "Copiar dados" (CSV com `;` e vírgula decimal, sem fórmulas) e a tabela dos dados.

**Imagens (Nano Banana, pago).** `gerar_imagem` chama `https://generativelanguage.googleapis.com/v1beta/interactions`
(endereço fixo; se não existir para a chave, o `models/{modelo}:generateContent` clássico), com a chave no
cabeçalho `x-goog-api-key`. Modelos: `gemini-3.1-flash-image` (padrão, ≈ US$ 0,067), `gemini-3-pro-image`
(≈ 0,134), `gemini-3.1-flash-lite-image` (≈ 0,034). Sem cota grátis para imagem: precisa de faturamento ativo.

- A chave fica em `<pastaAssistente>/chave-gemini` (arquivo 0600, pasta 0700) — fora do banco e fora de
  `conversas/` (que o modelo lê). Nunca volta pela API, não vai para log, argv nem para o ambiente dos CLIs.
- Na resposta, a única imagem que carrega é `![…](anexo:<uuid>)`, servida pela rota abaixo. Qualquer outra
  fonte (http, `data:`, caminho) continua virando texto.
- Prompt injection: um texto de terceiro pode levar o modelo a gerar imagem; o pior caso é gastar a cota
  do dia (limite configurável, padrão 20) — a descrição vai só para o Google, com a chave da própria pessoa.
- Ponte MCP: `gerar_imagem` espera até 190 s (as outras, 60 s). O Gemini CLI (`timeout: 60000` em
  `cli/gemini.ts`) e o Codex (`tool_timeout_sec`, 60 s por padrão) têm tempo-limite próprio de ferramenta
  MCP: imagem lenta pode estourar lá. Mesmo assim o servidor termina e grava a imagem presa à resposta;
  ela aparece embaixo da resposta (anexo gerado que o texto não cita) quando a conversa é recarregada.

| Método e rota | Corpo | Resposta |
|---|---|---|
| `GET /imagens/config` | — | `{ configurada: boolean; final: string \| null /* "…AbCd" */; modelo; limiteDiario; geradasHoje }` |
| `PUT /imagens/config` | `{ chave?: string; modelo?: ModeloImagem; limiteDiario?: 1..200 }` | idem |
| `DELETE /imagens/config` | — | idem (apaga a chave) |
| `GET /anexos/:id/arquivo` | — | os bytes da imagem (só `tipo: 'imagem'`; 404 para PDF/texto), `Content-Type` gravado, `nosniff`, `inline`, cache privado |

`Anexo` ganha `origem: 'pessoa' | 'gerada'` (migração 0006). Imagem gerada não conta no limite de
20 anexos por conversa; a cota do dia fica na configuração (apagar a conversa não a devolve).

## Contas por API (v3 do contrato — soma às contas da v2)

Além do CLI (plano da pessoa), cada provedor pode ser usado **por chave de API**, pagando por uso. Os ids de
provedor são os mesmos: `claude` → API da Anthropic, `gemini` → API do Gemini, `codex` → API da OpenAI.
O servidor chama a API pelo AI SDK (`ai` 7 + `@ai-sdk/anthropic|google|openai` 4) em
`assistente/execucao/executor-api.ts` e roda as ferramentas do Fluxo direto (`Ferramentas.executar`), sem a
ponte MCP, sem pasta de execução e sem sessão (`sessoes_cli` não é usada): a cada resposta vão as
instruções (`INSTRUCOES`), o histórico como turnos de verdade (últimas 20 mensagens, até 4000 caracteres
cada, vazias de fora) e o turno atual montado por `montarPrompt` (data, anexos e o modo voz). Imagens
anexadas vão como partes de arquivo (até 5 MB cada). Até 25 passos (chamada de modelo) por resposta; o mesmo
limite de 10 minutos e o mesmo cancelar. Os eventos são os mesmos do CLI (`texto`, `passo`, `fim`); os passos
têm o nome `mcp__fluxo__<ferramenta>` por dentro, então rótulo e nome curto saem iguais.

```ts
type TipoConta = 'cli' | 'api';

interface ContaIA {                // v2 + :
  tipo: TipoConta;                 // conta gravada antes disto = 'cli'
  chaveFinal: string | null;       // "…AbCd" (4 últimos) nas contas por API com chave; null no resto
  // nas contas por API: caminho = null, pastaLogin = null, caminhoDetectado = null, versao = null,
  // comoEntrar = '', instalado = existe chave guardada (é o que decide se a conta está "pronta")
}

interface ProvedorInfo {           // v2 + :
  api: { nome: string; ondeCriarChave: string; modelos: ModeloIA[] };
  // claude: 'API da Anthropic', 'https://console.anthropic.com/settings/keys'
  // gemini: 'API do Gemini',    'https://aistudio.google.com/apikey'
  // codex:  'API da OpenAI',    'https://platform.openai.com/api-keys'
}

interface ModeloIA { id: string; nome: string; descricao: string; selo?: string; principal?: boolean }
```

| Método e rota | Corpo | Resposta |
|---|---|---|
| `POST /contas` | `{ tipo: 'api', provedor, nome, chave: string, modelo?: string \| null, ativo?: boolean }` — ou o corpo de CLI da v2 (com `tipo: 'cli'` ou sem `tipo`) | `ConfigAssistente` |
| `PATCH /contas/:id` | v2 + `chave?: string` (troca a chave; só conta por API — 400 na de CLI). Na conta por API, `caminho`/`pastaLogin` com valor → 400 | `ConfigAssistente` |
| `DELETE /contas/:id` | — | `ConfigAssistente` (conta por API: o arquivo da chave é apagado) |
| `POST /contas/:id/testar` | `{}` | `{ ok, mensagem, duracaoMs }` — na conta por API, um pedido mínimo ("Responda apenas com a palavra OK."), sem ferramentas, sem novas tentativas, até 30 s. Sucesso: `Funcionando: respondeu “OK”.` (o campo `versao` da tabela da v2 nunca existiu no código) |
| `GET /contas/:id/modelos` | — | `{ modelos: ModeloIA[]; aoVivo: boolean }` |

- **Chave**: depois de tirar os espaços das pontas, 20 a 300 caracteres de ASCII visível, sem espaço (400 com
  "formato de chave inválido", sem repetir o valor). Fica em `<pastaAssistente>/chaves/<contaId>` (arquivo
  0600, pasta 0700, gravada num temporário e renomeada) — nunca no banco, no JSON da configuração, numa
  resposta, num log, na linha de comando ou no ambiente dos CLIs. Só sai para o cabeçalho de autenticação do
  provedor: `x-api-key` (+ `anthropic-version`), `x-goog-api-key`, `Authorization: Bearer`. Nunca na URL.
- **Endereços fixos**: `https://api.anthropic.com/v1`, `https://generativelanguage.googleapis.com/v1beta`,
  `https://api.openai.com/v1`, passados explicitamente (sem eles os provedores leriam `ANTHROPIC_BASE_URL` /
  `OPENAI_BASE_URL` do ambiente). Não há endereço configurável. Na OpenAI vai `store: false`.
- **Várias contas por API do mesmo provedor** podem conviver (a regra "mesma pasta de login" é só do CLI).
- **Modelo**: o escolhido na conversa, senão o da conta, senão o primeiro `principal` do catálogo
  (`apis/provedores-api.ts`): `claude-sonnet-5`, `gemini-3.8-flash`, `gpt-6.1-sol`.
- **`GET /contas/:id/modelos`**: conta por API → lista ao vivo do provedor (`GET /v1/models` da Anthropic,
  `GET /v1beta/models` do Gemini filtrado a `generateContent` e sem embedding/imagem/voz, `GET /v1/models` da
  OpenAI filtrado a `gpt-*`/`o<n>*`/`chatgpt*` sem embeddings, tts, whisper, dall-e, image, audio, realtime,
  moderation, transcribe, search). Mistura: os do catálogo que a chave enxerga primeiro (com nome, descrição,
  `principal`, `selo`), depois os outros como `{ nome: <nome da API ou o id>, descricao: 'da API' }`. Ids que
  não passariam na validação de `modelo` são descartados. Guardada 10 minutos por conta (trocar a chave ou
  remover a conta esquece); falha de rede, HTTP de erro ou lista vazia → o catálogo, `aoVivo: false`, sem
  erro. Conta de CLI → o catálogo do CLI, `aoVivo: false`.
- **Erros** (a mensagem nunca leva cabeçalho, chave nem o corpo do pedido; a do provedor é cortada em ~300
  caracteres e passa por um filtro de coisas com cara de chave): 401/403 → "A chave da API foi recusada
  (inválida, revogada ou sem permissão). Troque a chave nos Ajustes."; 429 ou falta de créditos → "A API
  recusou por limite de uso ou falta de créditos. …"; 404 → "O modelo “X” não existe nesta API (ou a sua chave
  não tem acesso)."; rede → "Não consegui falar com a API da …: <motivo>"; 5xx → "A API da … está com
  problema agora (código N). …". O `onError` padrão do AI SDK (que faz `console.error` do erro inteiro, com
  `requestBodyValues`) é substituído; o log leva só status + mensagem limpa.
- **Testes** nunca chamam API de verdade nem usam chave de verdade: o modelo vem do token
  `FABRICA_DE_MODELOS` (nos testes, o `MockLanguageModelV4` de `ai/test`, ver `apis/testing/modelo-falso.ts`)
  e a lista ao vivo de um `fetch` injetado em `ModelosAoVivo`.


## Voz (ditado, modo conversação e voz natural)

O ditado e o laço do modo conversação ficam em `web/src/paginas/assistente/voz/`. No servidor: o campo
`voz?: boolean` em `POST /conversas/:id/mensagens`, que acrescenta `INSTRUCOES_DE_VOZ` ao prompt (resposta curta
e falável), e a **voz natural** (Piper) em `server/src/assistente/voz/` (abaixo).

| Peça | Arquivo | O que faz |
|---|---|---|
| Reconhecimento | `reconhecimento.ts` | Web Speech API (`SpeechRecognition`/`webkitSpeechRecognition`), `pt-BR`, contínuo, com provisórios. O Chrome encerra a escuta depois de silêncio: ela é religada sozinha enquanto a pessoa não manda parar (desiste depois de 6 encerramentos seguidos em 6 s sem ouvir nada). Erros viram mensagens em português com o que fazer |
| No computador | `reconhecimento.ts` | Chrome 139+: `SpeechRecognition.available({ langs: ['pt-BR'], processLocally: true })` → `'available' \| 'downloadable' \| 'downloading' \| 'unavailable'`, `SpeechRecognition.install(...)` → `boolean` e `recognition.processLocally = true` (nomes conferidos no rascunho do W3C). Só é usado se a pessoa preferir **e** o pacote estiver pronto; senão vai pelo Google, e a tela diz isso |
| Ditado | `useDitado.ts`, `BotoesVoz.tsx` | Insere no cursor sem apagar o que já estava escrito; o provisório é trocado a cada resultado. Para com o botão, Esc, Alt+M ou ao enviar; digitar devolve a caixa à pessoa |
| Nível do microfone | `nivel-microfone.ts` | `getUserMedia` + `AnalyserNode` (o reconhecimento não informa volume): anel do botão e esfera |
| Máquina do modo conversação | `maquina-conversa.ts` | Redutor puro: `preparando → ouvindo → enviando → pensando → falando → ouvindo`, mais mudo, interromper e erro. Nunca ouve enquanto fala (não ouve a si mesmo) |
| Laço | `useConversaPorVoz.ts` | Silêncio depois de um resultado final (1,2 s, ajustável) envia com `voz: true`; a resposta é lida do cache que o SSE da conversa já preenche (`useEventosExecucao`), frase a frase enquanto chega |
| Texto falável | `texto-fala.ts` | Tira blocos de código/```grafico, tabelas, imagens (`![…](anexo:…)`), links (fica o texto), markdown e emoji; números e "R$ 1.234,56" ficam. O divisor só entrega frase inteira (não corta link nem entra em bloco aberto) |
| Números falados | `fala-numeros.ts` | `normalizarParaFala`: "R$ 1.234,56" → "mil duzentos e trinta e quatro reais e cinquenta e seis centavos", "R$ 2 mil", "8%", 05/09 → "cinco de setembro", 09/2026, set/2026, "parcela 3/10", "10x", "14h30", "1º/2ª", gênero ("duas compras"). Aplicado na síntese (as duas vozes); a legenda mostra o original |
| Voz | `fala.ts`, `fala-piper.ts` | `MotorDeFala { falar, parar, ocupado, nivel, aoComecar, aoEsvaziar, preparar?, aoAvisar? }`. `criarMotorPiper()` é o do app: com `motor: 'piper'` pede cada frase ao servidor já adiantando as próximas 2 (`ANTECIPAR`) enquanto a atual toca, toca pela Web Audio e o `nivel()` vem de um `AnalyserNode` (amplitude de verdade na esfera). Falha numa frase → aquela frase vai pela voz do navegador (reserva, `criarMotorNavegador()`) com um aviso uma vez; `parar()` aborta os pedidos e cala o áudio. Com `motor: 'navegador'`, tudo vai para a reserva. `opcoesDaFala(prefs, estado)` decide: Piper só com uma voz instalada. Na reserva, voz que não começa em 2,5 s (Linux sem speech-dispatcher) vira legenda sem som |
| Esfera | `Orbe.tsx` | Canvas a cada quadro, cores dos tokens do tema; com "reduzir movimento", redonda e calma |
| Ajustes | `AjusteVoz.tsx`, `AjusteVozNatural.tsx`, `preferencias-voz.ts` | Reconhecimento (no computador / Google), quem lê (`motorFala`: `'piper'` padrão / `'navegador'`), cartões das vozes naturais (baixar com progresso, ouvir, usar, remover, licença), voz do navegador (reserva), velocidade 0,8–1,5×, silêncio 0,8–2,5 s, "falar as respostas". Em `localStorage` (`fluxo:voz`), com padrão seguro se o armazenamento falhar. O estado das vozes naturais é um store fora do React Query (`api/voz-natural.ts`), lido também pelo motor |

### Voz natural (Piper) — `server/src/assistente/voz/`

Escolha (2026-10): **sherpa-onnx-node** (k2-fsa, Apache-2.0, addon N-API pré-compilado para linux-x64 com
onnxruntime e espeak-ng embutidos — nada no sistema, sem `LD_LIBRARY_PATH`: RUNPATH `$ORIGIN`) rodando os
modelos Piper (VITS) empacotados pelo próprio sherpa-onnx (`release tts-models`: modelo + `tokens.txt` +
`espeak-ng-data`). Descartados: o binário `piper` (outro executável e outro download por plataforma), Piper em
WASM no navegador (`piper-tts-web`: exige `'wasm-unsafe-eval'` no CSP e baixar modelo de outro domínio) e
onnxruntime-node + `phonemizer` (montar a fonetização na mão).

| Peça | Arquivo | O que faz |
|---|---|---|
| Catálogo | `catalogo.ts` | Lista FIXA: id, URL da release, tamanho e SHA-256 de cada pacote, licença e crédito. A tela só manda o `id`; nada vira URL. Padrão: `faber` |
| Download | `baixador.ts` | Baixa para `<pastaModelos>/piper/.temp-<id>-*`, conta bytes (passou do catálogo, para) e soma o SHA-256; só um pacote idêntico é aberto; confere modelo/tokens/fonética e troca de nome para `<pastaModelos>/piper/<id>` (atômico) |
| Extração | `extracao.ts`, `extracao-trabalhador.ts` | `.tar.bz2` com `unbzip2-stream` + `tar-stream` (JS puro) numa worker thread (~20 s por voz numa máquina parada). Só arquivo e pasta, nada fora da pasta, teto de 400 MB / 5 000 itens |
| Síntese | `sintetizador.ts`, `wav.ts` | `OfflineTts.createAsync` + `generateAsync` (fora da thread principal), 2 threads, `speed` = velocidade das preferências. Saída WAV PCM 16 bits mono 22 050 Hz |
| Serviço | `servico-voz.ts` | Estado (vozes, `baixando`, `progresso`, `etapa`, `erro`), um download por vez, modelo carregado na 1ª fala e mantido (um só; trocar de voz troca o modelo), fila de uma síntese por vez (máx. 6 esperando → 503), 600 caracteres por fala, 30 s de limite. Pedido cancelado (a tela parou de falar) antes da vez é pulado. O texto falado nunca vai para o log (só o tamanho, em debug) |
| Rotas | `voz.controlador.ts` | `GET /api/assistente/voz`, `POST …/voz/baixar {voz}`, `DELETE …/voz/:voz`, `POST …/voz/preparar {voz?}` (202; carrega o modelo ao abrir o modo conversação), `POST …/voz/falar {texto, voz?, velocidade?}` → `audio/wav`. Atrás da `Seguranca` (sessão + `X-Fluxo: 1`), zod estrito |

Vozes: **Faber** (masc., média, padrão), **Cadu** e **Jeff** (masc., média) — dados CC0 (OHF voice-datasets),
ajustadas a partir da voz inglesa *lessac* (dados Blizzard 2013, licença de pesquisa); **Dii** (fem., alta) e
**Miro** (masc., alta) — CC BY-NC-ND 4.0, TigreGotico Lda / OpenVoiceOS (uso pessoal, não comercial). ~64 MB
cada. A *edresson* (baixa, 16 kHz) ficou de fora: mesmo tamanho, qualidade pior. Medido (CPU de 4 núcleos, 2
threads, máquina parada): carregar a Faber ~2,8 s; frase de 3,5 s de áudio em ~0,4 s (RTF ≈ 0,1). A Dii/Miro
(high) é ~5× mais lenta (RTF ≈ 0,5–0,7) — o adiantamento de frases cobre, mas a primeira frase demora mais.
Testes nunca baixam nada: `testing/pacote-falso.ts` monta `.tar.bz2` de mentira, fetch falso e sintetizador falso.

Interromper (tocar na esfera, Espaço ou "Parar") cala a voz e cancela a execução que ainda gera; o que já
veio fica salvo na conversa. Fechar (Esc ou ×) não cancela uma resposta em andamento: ela aparece no chat.
Privacidade: no modo "Pelo Google", o **áudio** vai para o Google transcrever (é o serviço do próprio Chrome);
no "No computador", não sai da máquina. Na leitura, vozes `localService: false` (as "Google …" do Chrome) mandam o
texto da frase para o Google sintetizar; a lista mostra "online" / "no computador" em cada voz. A voz natural (Piper)
não sai da máquina: o texto vai do navegador para o servidor do Fluxo (127.0.0.1) e volta como WAV; a internet só é
usada para baixar a voz. Verificado em 2026-10 no Chromium 152 (Linux): `available`/`install`
existem, mas `pt-BR` local responde `'unavailable'` (e `en-US` também) — no Linux, por ora, é o Google.

## Ações (o assistente muda dados — com a permissão da pessoa)

O assistente também AGE, sempre a pedido da pessoa, em dois níveis. Código: `server/src/assistente/acoes/`
(serviço, operações, guardas, histórico) e `server/src/assistente/ferramentas/ferramentas-acoes.ts` /
`ferramentas-contas.ts` (as ferramentas). Valores em reais na entrada das ferramentas; centavos no resto.

| Ferramenta | Nível | O que faz |
|---|---|---|
| `ajustar_movimento` `{movimentoId, categoria?, natureza?, nota?, ignorar?}` | direta | Um movimento: categoria (nome, id ou apelido — "combustível" → Carro e combustível), natureza, nota, tirar das contas |
| `criar_conta_a_pagar` `{descricao, valor, vencimento, repete?, categoria?, textoNoExtrato?, nota?}` | direta | Conta a pagar com `origem: 'assistente'`; se o pagamento já está no extrato, nasce paga (conciliação) |
| `editar_conta_a_pagar` `{contaId, …só o que muda}` | direta | Muda valor, vencimento, nome, repetição, categoria, texto no extrato, nota |
| `marcar_conta_paga` `{contaId, data?, movimentoId?}` | direta | Paga (conta que repete ganha a próxima ocorrência) |
| `criar_regra_de_categoria` `{texto, categoria, sentido?}` | proposta | Regra de categoria — vale para TODO o histórico e para os próximos (regras são aplicadas na leitura). A proposta simula a regra nos movimentos de hoje: quantos mudam, quanto somam, o período, até 5 exemplos, os que ficam por terem categoria escolhida à mão e as regras antigas que vêm antes |
| `remover_regra` `{regraId}` | proposta | Quantos movimentos voltam para a categoria automática |
| `recategorizar_movimentos` `{categoria, movimentoIds? \| filtro?}` | proposta | Vários movimentos (até 500), por ids ou filtro (texto, mês, período, categoria atual, conta, sentido). A proposta guarda só os que de fato mudam |
| `definir_orcamento` `{categoria, limite}` | proposta | Limite mensal (0 = tirar), com o gasto do mês na prévia |
| `criar_meta` / `editar_meta` / `remover_meta` | proposta | Metas (prazo, caixinha pelo nome, valor que já tem); a prévia diz quanto guardar por mês |
| `remover_conta_a_pagar` `{contaId}` | proposta | Apagar uma conta a pagar |
| `confirmar_proposta` `{propostaId?}` | — | Executa a proposta quando a pessoa disse "sim" à resposta que a mostrou (ver Guardas). Sem id: a única pendente dessa resposta |
| `recusar_proposta` `{propostaId?}` | — | Quando a pessoa disse "não" |
| `desfazer_acao` `{acaoId?}` | — | Quando a pessoa pediu "desfaz" (sem id: a última feita) |
| `regras_de_categoria`, `contas_a_pagar` `{situacao?, de?, ate?}`, `acoes_da_conversa` | leitura | Para achar ids e conferir antes de agir |

**Direta**: roda na hora, aparece no chat como uma linha ("Movimento ajustado: … · Desfazer"), no máximo 10 por
resposta (mais que isso é sinal de que devia ser proposta — ou de texto de terceiro mandando). **Proposta**: não
muda nada; vira um cartão na resposta com o efeito, os exemplos, **Aprovar** / **Recusar** (e "ou responda
“sim”"); depois de aprovada mostra "Aprovado e feito" + **Desfazer**. No modo conversação, a proposta pendente
aparece em cima das legendas com botões grandes, e o assistente pergunta em voz alta ("Posso criar a regra? Isso
muda 14 movimentos.").

**Guardas** (`acoes/guardas.ts`, `acoes/servico-acoes.ts`):
- Aprovar/recusar/desfazer pela tela: `POST /api/assistente/propostas/:id/aprovar`, `…/recusar`,
  `POST /api/assistente/acoes/:id/desfazer` — atrás da `Seguranca` (sessão + `X-Fluxo: 1`). O token da ponte MCP
  só abre `/api/assistente/ferramentas/*`, então nenhum modelo chega nessas rotas.
- `confirmar_proposta` só executa se: a proposta é DESTA conversa, está pendente, tem menos de 24 h, foi mostrada
  na resposta logo antes da última mensagem da pessoa — a que ela está respondendo; nem a resposta em geração nem
  uma mais antiga contam (proposta antiga: o assistente propõe de novo, e a mesma proposta passa para a resposta
  atual) —, e essa última mensagem — escrita pela pessoa, nunca descrição de Pix ou anexo — é uma confirmação: sem acento e em
  minúsculas, tem "sim", "pode", "confirmo", "aprovado", "manda", "isso", "ok", "beleza", "fechado", "faz"…,
  não tem negação ("não", "nem", "espera", "cancela", "recuso", "deixa pra lá", "para" no começo), não tem "?" e
  tem até 140 caracteres. `desfazer_acao` exige "desfaz", "volta como estava", "reverte", "anula" sem negação, e
  só alcança o que a resposta anterior fez (ou, se ela não fez nada, a última ação da conversa); o resto, pelo botão.
- Proposta cuja resposta foi apagada (Repetir) ou com mais de 24 h vira `expirada`.

**Integridade**: cada decisão é síncrona do começo ao fim (SQLite síncrono, sem `await` no meio) e roda numa
transação só com o registro dela; a troca de situação é compare-and-set (o JSON gravado tem de ser o mesmo que
foi lido), então duplo clique, duas abas ou o "sim" junto com o botão fazem uma vez só (a segunda resposta é o
estado já aprovado). Na hora de executar, tudo é validado de novo (categoria existe, movimento/regra/meta/conta
existe, não é repetida); falha vira `falhou` com o motivo no cartão. **Desfazer** usa o "antes" e o "depois"
gravados: nunca desfaz por cima de uma mudança feita depois (recusa com o motivo); na recategorização em massa,
desfaz os que não mudaram e avisa quantos ficaram. Regra removida volta com o mesmo id e a mesma prioridade
(`Repositorio.restaurarRegra`); conta a pagar apagada volta com o mesmo id.

**Onde fica**: na tabela chave-valor `configuracoes`, uma linha por ação (`assistente:acao:<uuid>`, o JSON da
`AcaoGravada`: payload validado com zod, prévia, situação, datas e o `inverso` para desfazer). Sem tabela nova (a
migração desta rodada era de outra parte), no mesmo banco dos dados — por isso a mudança e o registro entram
na mesma transação. `Repositorio.configuracoes()` só lê as chaves que conhece. Apagar a conversa apaga o
histórico de ações dela (o que foi feito continua feito).

```ts
interface AcaoAssistente {            // GET /api/assistente/conversas/:id/acoes → AcaoAssistente[] (ordem de criação)
  id: string; conversaId: string;
  mensagemId: string | null;          // a resposta onde o cartão aparece
  tipo: 'ajustar_movimento' | 'recategorizar_movimentos' | 'criar_regra' | 'remover_regra' | 'definir_orcamento'
    | 'criar_meta' | 'editar_meta' | 'remover_meta' | 'criar_conta_a_pagar' | 'editar_conta_a_pagar'
    | 'marcar_conta_paga' | 'remover_conta_a_pagar';
  modo: 'direta' | 'proposta';
  titulo: string;                     // "Criar regra de categoria"
  descricao: string;                  // "Tudo que tiver “baratao” na descrição vai para Carro e combustível — …"
  efeito: string | null;              // "Muda 14 movimentos (R$ 2.310,00), de 03/02/2026 a 22/09/2026. …"
  exemplos: { data: string; descricao: string; valor: number /* centavos */; de: string | null; para: string | null }[];
  situacao: 'pendente' | 'aprovada' | 'recusada' | 'expirada' | 'falhou';
  erro: string | null; aviso: string | null;
  criadaEm: string; decididaEm: string | null; desfeitaEm: string | null;
  podeDesfazer: boolean;
}
```

| Método e rota | Resposta |
|---|---|
| `GET /conversas/:id/acoes` | `AcaoAssistente[]` |
| `POST /propostas/:id/aprovar` | `AcaoAssistente` (já aprovada → o mesmo estado, 200; recusada/expirada → 409; falha na execução → 200 com `situacao: 'falhou'` e `erro`) |
| `POST /propostas/:id/recusar` | `AcaoAssistente` (aprovada → 409 "use Desfazer") |
| `POST /acoes/:id/desfazer` | `AcaoAssistente` com `desfeitaEm` (já desfeita → o mesmo; mudou depois → 409 com o motivo) |

A tela relê `GET …/acoes` quando um passo de ferramenta de ação termina (o cartão aparece no meio da resposta)
e no fim da resposta; depois de uma decisão, invalida as consultas das outras telas (extrato, orçamento, metas,
contas). Na ponte MCP, cada ferramenta leva o `efeito` (`leitura` | `escrita` | `destrutiva`) →
`readOnlyHint`/`destructiveHint`; os três CLIs liberam as ferramentas do servidor "fluxo" mesmo sem
`readOnlyHint` (Claude `--allowedTools mcp__fluxo`, Gemini política de administrador `mcpName = "fluxo"` allow,
Codex `default_tools_approval_mode="approve"`), e o resto do travamento (sem shell, sem escrita, sem web) continua.
