# Fluxo — assistente financeiro

Um aplicativo pessoal de finanças que roda no seu computador e lê o Nubank pelo Open Finance (via Pluggy): conta, cartão, faturas, parcelas, caixinhas, orçamento, metas, recorrências, contas a pagar — e um assistente de IA que conversa (por texto ou voz) sobre os seus números usando o Claude, o Gemini ou o ChatGPT que você já usa. Feito e testado com o Nubank, no Linux.

Fluxo é NestJS 12 + React 19 + SQLite rodando num só processo em `127.0.0.1:8778`, aberto como uma janela do Chrome. Os dados ficam num arquivo no seu computador; só saem para os serviços que você mesmo configurar (veja [Privacidade e segurança](#privacidade-e-segurança)).

## Destaques

**Finança**
- Sincronização do Nubank via Pluggy (Open Finance), a cada hora com o app aberto
- Extrato com busca por palavra e significado (RAG local com `sqlite-vec`)
- Orçamento por categoria, metas poupança, assinaturas/recorrências
- Visão de caixa e fluxo (Sankey: de onde vem → para onde vai)
- Contas a pagar com vencimento e avisos (integra com Agenda Google)
- Faturas do cartão: parcelas, competência vs. caixa

**Assistente de IA**
- Chat com seu próprio CLI (Claude Code, Gemini CLI, Codex CLI) ou API Keys
- Lê dados via ferramentas locais MCP (sem acesso a arquivos/web)
- Ações simples na hora (ajustar movimento, criar conta a pagar)
- Propostas para mudanças maiores (regra de categoria, orçamento — você aprova)
- Anexos: imagens, PDFs, CSVs — texto extraído, indexado, buscável
- Imagens geradas (Nano Banana via Gemini) presas à conversa
- Voz: ditado, conversa por voz, respostas faladas (vozes naturais Piper locais)

**Privacidade**
- Servidor apenas em `127.0.0.1` — nenhum outro programa da máquina acessa
- Sessão local com token único (cookie HttpOnly, SameSite=Strict)
- Chaves de API em arquivos 0600 — nunca no banco, log ou resposta da API
- Nada sai do computador sem você configurar: Pluggy, Google Agenda e o provedor de IA são escolhas suas
- Modo demonstração sem nenhuma credencial, com 14 meses de histórico fake

## Como funciona / arquitetura

```
┌─────────────────────────────────────────────────────────────────┐
│  Chrome (UI, React 19)                                          │
│  ├─ Telas: Visão geral, Fluxo, Extrato, Cartão, Caixinhas, ... │
│  └─ Assistente: chat com SSE, anexos, voz                       │
├─────────────────────────────────────────────────────────────────┤
│  NestJS 12 (API, lógica, sincronização)                         │
│  ├─ Serviços: dados, Pluggy, Google, Assistente                │
│  ├─ Domínio: classificação, orçamento, fluxo, Sankey            │
│  └─ SQLite (FTS5 + sqlite-vec): um arquivo                      │
├─────────────────────────────────────────────────────────────────┤
│  Provedores: Pluggy (real) ou Demo (testes/modo demonstração)   │
└─────────────────────────────────────────────────────────────────┘
```

Sincronização a cada 1 hora enquanto o app está aberto. O assistente roda o CLI do seu plano (Claude, Gemini, Codex) travado — sem terminal, sem web, sem ler arquivos fora da conversa — ou a API do provedor com a sua chave; nos dois casos ele só alcança os dados pelas ferramentas do Fluxo.

## Requisitos

- **Linux testado** (construído e desenvolvido em Linux; teoricamente funciona em macOS/Windows, não verificado)
- **Node.js 22+** (ver `.nvmrc`)
- **Chrome ou Chromium** para a janela do app
- Opcional: **IA CLIs** instalados com login (Claude Code, Gemini CLI, Codex CLI) OU chaves de API (Anthropic, Google, OpenAI)

## Início rápido

1. **Clone o repositório:**
   ```bash
   git clone https://github.com/eduardorarruda/fluxo-assistente-financeiro.git
   cd fluxo-assistente-financeiro
   ```

2. **Instale dependências:**
   ```bash
   npm install
   ```

3. **Configure credenciais (opcional; começará em modo demonstração se pulado):**
   ```bash
   cp .env.exemplo .env
   chmod 600 .env
   # Edite .env: PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET (de dashboard.pluggy.ai)
   ```

4. **Compile e abra:**
   ```bash
   npm run build
   ./fluxo.sh
   ```

5. **Instale o atalho do menu (opcional):**
   ```bash
   scripts/instalar-atalho.sh
   # Procure "Fluxo" no menu de aplicativos
   ```

**Modo demonstração:** sem credenciais, o Fluxo abre com um Nubank fictício (14 meses de histórico fake). Sai automaticamente quando você conecta um banco real.

## Configuração

| Variável | Padrão | O quê |
|---|---|---|
| `PLUGGY_CLIENT_ID` | — | Pluggy / MeuPluggy (de `dashboard.pluggy.ai → Applications`) |
| `PLUGGY_CLIENT_SECRET` | — | Idem |
| `PLUGGY_INCLUIR_SANDBOX` | `0` | Mostrar bancos de teste no widget (experimenta sem banco real) |
| `PORTA` | `8778` | Porta local — mude se 8778 estiver em uso |

## Desenvolvimento

```bash
npm run dev        # NestJS (8778, watch) + Vite (5173, reload); pega token de data/.sessao
npm test           # testes do server e web
npm run typecheck  # verifica tipos
npm run build      # produção: web/dist + server/dist
```

**Testes:** em `server/` rodam com `vitest` + `supertest` (integração); em `web/` com `vitest` + React Testing Library. Testes nunca usam dados reais nem chamam APIs de verdade.

**Estrutura:**

```
fluxo/
├── fluxo.sh / fluxo.desktop / scripts/instalar-atalho.sh  atalho e menu
├── .env.exemplo                                            credenciais
├── data/                                                   banco, sessão (não no git)
├── server/src/
│   ├── domain/                                             classificação, orçamento, fluxo, Sankey (funções puras)
│   ├── provedores/                                         Pluggy (real) e Demo (mesmo formato)
│   ├── dados/                                              SQLite: leitura, sincronização, edições
│   ├── servicos/                                           dados montados para cada tela
│   ├── http/                                               API, validação, segurança
│   └── assistente/                                         chat: CLIs, ponte MCP, ferramentas, anexos, RAG, voz
└── web/src/
    ├── paginas/                                            Visão geral, Fluxo, Extrato, Cartão, ...
    ├── graficos/                                           Sankey, área, barras, rosca (SVG + motion)
    └── icones/                                             conjunto de ícones
```

## Privacidade e segurança

- **Banco de dados:** `data/fluxo.db` (SQLite), só você lê (0600). Backup = copiar o arquivo.
- **Servidor:** só aceita `127.0.0.1`; toda API exige sessão local (token único → cookie HttpOnly/SameSite=Strict).
- **O que sai do computador** (só se você configurar):
  - **Pluggy:** a sincronização com o banco. O segredo da Pluggy fica no servidor; o navegador só recebe um token de 30 min para conectar.
  - **Provedor de IA** (Anthropic, Google ou OpenAI, pelo CLI ou pela API): as suas perguntas e os dados que o assistente consulta para responder vão para ele, nas regras da sua conta lá.
  - **Google Agenda:** os eventos de vencimento na agenda "Fluxo".
  - **Gemini (Nano Banana):** a descrição das imagens que você pedir.
  - **Reconhecimento de voz "Pelo Google":** o áudio do ditado e do modo conversação (no modo "No computador", nada sai).
- **Google Calendar:** se conectado, apenas a agenda "Fluxo" é tocada (escopos: `calendar.app.created`, `openid`, `email`). Refresh token em arquivo 0600, nunca no banco.
- **Assistente:**
  - CLIs rodam sem terminal, arquivo ou web (`--restricted` no Claude, políticas restritivas em Gemini/Codex).
  - Chaves de API em arquivo 0600 (`data/assistente/chaves/`), nunca no banco nem log.
  - Ferramentas: apenas leitura em dados do Fluxo; ações pequenas (ajuste) ou propostas (aprovação).
  - Token MCP vale só para `/api/assistente/ferramentas/*` e morre ao fim da resposta.
  - Modelo local de embeddings (~120 MB, baixado uma vez) para busca semântica.
- **Voz:** no computador (processamento local) não envia áudio; "Pelo Google" usa Web Speech API do Chrome. Respostas faladas com vozes naturais Piper (local) não saem da máquina.

## Limitações

- **Pluggy / MeuPluggy:** conta de dev com 15 dias de teste; depois disso, reconectar não é possível (não remova a conexão na Pluggy).
- **Nubank-specific:** algumas regras de classificação são tuning do Nubank (ex.: reconhecer "Valor adicionado na conta por cartão de crédito"). Outros bancos podem precisar de ajustes.
- **Linux-first:** testado em Linux com KDE. macOS/Windows: não verificado; `fluxo.sh` e caminho do Node podem precisar ajustes.
- **Google Calendar:** app em modo "Teste" — autorização cai a cada 7 dias (remova a conexão e reconecte; ou ponha em "Produção" conforme guia em `LEIA-ME.md` → **Google Agenda**).

## Aviso

- Fluxo não é afiliado a Nubank, Pluggy, Google, Anthropic, OpenAI ou Gemini.
- **Não é aconselhamento financeiro.** Use para acompanhamento pessoal apenas.
- O banco é um arquivo SQLite na sua máquina. Backup é copiar `data/fluxo.db`; não há sincronização na nuvem.

## Licença

MIT — veja `LICENSE`.

## Começar

Leia `LEIA-ME.md` para a documentação completa (manual do usuário). Design docs em `docs/`.

---

**Contribuições:** veja `CONTRIBUTING.md`.
