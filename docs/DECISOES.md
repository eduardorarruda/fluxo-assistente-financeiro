# Registros de decisão (ADRs)

Formato curto: contexto, decisão, consequências. O detalhe técnico fica em `PLANO.md` e `ASSISTENTE.md`.

## ADR-001: local e de uma pessoa só

- **Contexto**: o Fluxo guarda extrato, saldos e documentos de terceiros de uma pessoa. Não há venda, equipe
  nem acesso remoto.
- **Decisão**: um processo (NestJS servindo a API e o front já compilado) escutando só em `127.0.0.1`, com sessão
  local (token em `data/.sessao`, cookie HttpOnly + SameSite=Strict), checagem de Host/Origin e `X-Fluxo: 1`
  nas escritas. Sem cadastro, papéis, multiempresa, MFA ou recuperação de senha.
- **Consequências**: a fronteira de segurança é a máquina e o usuário do sistema operacional. Nada de RBAC,
  filas externas ou containers obrigatórios. Quem lê os arquivos do usuário lê os dados; daí o 0600/0700 e a
  recomendação de disco criptografado (`OPERACAO.md`, seção 7).

## ADR-002: SQLite (Drizzle) em arquivo

- **Contexto**: o volume é de um banco pessoal (milhares de movimentos por ano), e o app roda sem servidor de banco.
- **Decisão**: um arquivo SQLite com WAL, `foreign_keys=ON` e `busy_timeout`, e migrações do Drizzle versionadas
  em `server/drizzle/`. Antes de migrar, uma cópia via `VACUUM INTO` vai para `data/copias/`.
- **Consequências**: cópia, exportação e restauração são operações de arquivo. Registros pequenos e raros (ações
  do Assistente) ficam em `configuracoes` como JSON para não multiplicar tabelas; se crescerem, ganham tabela própria.

## ADR-003: a IA é a CLI do próprio usuário (ou a API dele)

- **Contexto**: um assistente que lê finanças não pode guardar chave nossa nem rodar com permissões amplas.
- **Decisão**: rodar o CLI que o usuário já tem (Claude Code, Gemini CLI, Codex CLI), sem shell, sem escrita e sem
  web, lendo dados só pela ponte MCP com um token por execução. Contas por chave de API usam o AI SDK com as
  ferramentas chamadas no próprio processo.
- **Consequências**: o custo e o login são do usuário. Cada versão nova de Gemini ou Codex precisa do teste de
  confinamento descrito no `CLAUDE.md`. LangChain não entra: as ferramentas têm schema Zod e o prompt é versionado
  em `execucao/prompt.ts`.

## ADR-004: mudanças relevantes viram proposta que só a pessoa aprova

- **Contexto**: descrições de Pix e anexos são texto de terceiros, ou seja, prompt injection possível.
- **Decisão**: dois níveis. Ações DIRETAS são pequenas, sempre desfazíveis, no máximo 10 por resposta. Todo o
  resto vira PROPOSTA, aprovada só pela sessão da pessoa ou por confirmação na última mensagem dela
  (`acoes/guardas.ts`). O token da ponte nunca abre aprovar, recusar ou desfazer.
- **Consequências**: no pior caso, o texto de um terceiro faz o modelo propor algo ou fazer uma mudança pequena e
  desfazível; ele nunca consegue aprovar. Cada execução revalida e grava o registro na mesma transação (compare-and-set).
