# CLAUDE.md — Fluxo

Personal finance app for one user, reading Nubank via Pluggy (Open Finance). Monolith: NestJS 12
(`server/`) serves the API and the built React 19 front (`web/`) from one process on 127.0.0.1:8778.
UI strings and identifiers are Portuguese (pt-BR). ECC (`ecc@ecc`) is enabled for this project and its
rules live in `.claude/rules/ecc/`.

## Commands

```bash
npm run dev                                   # Nest (watch, swc) + Vite; dev token comes from data/.sessao
npm test                                      # server (vitest + supertest) then web (vitest + RTL)
cd server && npx vitest run src/domain        # just the money rules
cd server && npx drizzle-kit generate --name <x>   # after editing src/db/schema.ts
npm run build && ./fluxo.sh --servidor        # production path, no window
```

## Invariants — do not break

- Money is integer cents; dates are local `AAAA-MM-DD`, months `AAAA-MM`. Pluggy calendar dates
  arrive as midnight UTC: always go through `diaDoProvedor`.
- A movement's `Natureza` decides what counts. Only DESPESA, RECEITA and ESTORNO touch spend/income.
  Card bill payments, caixinha moves, investments and transfers between the user's own accounts never do —
  as long as both ends are in Fluxo. A self-transfer whose other side is outside Fluxo (e.g., salary deposited
  to another bank account, then sent to Nubank) is RECEITA (`salario`) / DESPESA; only round trips (same value
  out and back within 5 days) or pairs across connected accounts stay TRANSFERENCIA (`transferenciasDeFora`).
  A Pix from the user's own company (CNPJ whose name contains the holder's name) is also classified as `salario`.
- Keyword detection in `domain/classificacao.ts` is anchored to the start of the description and
  skipped for third-party Pix/TED: the counterparty controls that text. Exception: prefixes the
  Nubank itself writes (the Pluggy description is `<Nubank operation>|<name>`), e.g. "Valor adicionado
  na conta por cartão de crédito", "Reembolso recebido pelo Pix", "Parcelamento de Fatura".
- On the card the description is the merchant's text, never proof of anything. A Pix no crédito charge is
  recognized only by its pair in the account ("Valor adicionado na conta por cartão de crédito", same day,
  charge > added ≤ 1.5×; `parearPixNoCredito`). What a bill charges ignores user edits (`creditoNoCartao`).
- Nubank specifics seen in real data: every card `otherCreditsType` is "OTHER"; caixinhas arrive as
  Nu Financeira CDB lots (not `reservedBalances`); "Pagamento recebido" carries the NEXT bill's `billId`,
  so a bill's paid amount comes from the bank bill, never from matching payments by `faturaId`.
- Competência: installment k belongs to purchase month + (k−1), minus whatever the provider already shifted.
- Sync (`dados/repositorio.ts#aplicarSincronizacao`) deletes only inside a window the provider
  guaranteed (item UPDATED) and actually covered; user edits (`ajustes`) are re-attached when Pluggy
  changes a transaction id, and never guessed when ambiguous.
- Everything the user creates (ajustes, regras, orçamentos, metas, configurações) is never touched by sync.
- Contas a pagar (docs/CONTAS-A-PAGAR.md): `ContasAPagar` service is the contract the assistant and the Agenda
  use — keep its signatures. Auto-reconciliation links a bill to a movement only when unambiguous (DESPESA,
  never PAGAMENTO_FATURA/TRANSFERENCIA/INVESTIMENTO; ±10% value, exact under R$ 10; due −10/+15 days; text
  via `textoNoExtrato`); a reopened bill's movement is "recusado" and never auto-picked again. Card bills
  are only shown, never stored as contas a pagar.
- Every `/api` route except `/api/saude` requires the local session (cookie or `x-fluxo-sessao`);
  writes also need `X-Fluxo: 1`. Keep new routes behind `Seguranca`. Sole session exception:
  `GET /api/google/retorno` (Google's OAuth redirect arrives without the SameSite=Strict cookie), allowed
  only with the `state` of an open connect request — single-use, 10 min, bound to the PKCE verifier.
- Google Agenda (docs/GOOGLE-AGENDA.md): scope `calendar.app.created` (+ `openid email`) touches only the
  app's own "Fluxo" calendar. Client secret, refresh token and the event map live in `<data dir>/google/`
  (0600, dir 0700) — never in the DB, a route response or the log. Plain `fetch` to fixed Google URLs;
  tests use `google/testing/google-falso.ts` via `FETCH_GOOGLE`, never the real Google.

## Assistente (AI chat) — see docs/ASSISTENTE.md

- The model is the user's own CLI (Claude Code / Gemini CLI / Codex CLI), spawned without a shell
  (`assistente/execucao/`), or the provider's API for API-key accounts (below). A CLI reads data ONLY
  through the MCP bridge `dist/assistente/mcp/ponte.js`, which proxies to `/api/assistente/ferramentas/*`
  with a per-run token (`x-fluxo-ponte`, checked in `Seguranca`, never the session). `gerar_imagem`
  (Nano Banana) only adds an image attachment to the current conversation; its Gemini key lives in
  `<pastaAssistente>/chave-gemini` (0600) and is never returned, logged or passed to a CLI.
- Tools may now change data, in two tiers (`assistente/acoes/`, `ferramentas/ferramentas-acoes.ts`). DIRECT
  (small, run at once, always undoable, max 10 per answer): `ajustar_movimento` (one movement),
  `criar_/editar_conta_a_pagar`, `marcar_conta_paga`. PROPOSAL (change nothing; a card with Aprovar/Recusar):
  rules (applied retroactively — the proposal simulates them on today's movements and shows the count),
  `recategorizar_movimentos`, budget, metas, removing a bill. Only the PERSON approves: the session-only routes
  `POST /api/assistente/propostas/:id/aprovar|recusar` and `/acoes/:id/desfazer` (the bridge token never opens
  them), or `confirmar_proposta`/`desfazer_acao`, which run only if the person's OWN latest message is a
  confirmation/undo (`acoes/guardas.ts`: accent-insensitive, no negation, no "?") and the proposal is from this
  conversation, pending, < 24 h old and was shown in the answer right before that message (an older one must be
  proposed again; undo by chat only reaches what that answer did, else the last action). Third-party text (Pix, attachments) can at
  most make the model propose or do a small undoable change; it can never approve. Every execution re-validates,
  runs in one SQLite transaction with its record (compare-and-set: double clicks do it once) and never undoes
  over a later change. Records live in `configuracoes` (`assistente:acao:<id>`, JSON) — no table of their own.
- Each adapter (`assistente/cli/*.ts`) locks its CLI down: no shell, no file writes, no web. Never add
  `--dangerously-*`, `--yolo`, `bypassPermissions` or API keys to the child env (`cli/ambiente.ts`).
  The bridge token goes only through env/files outside the model's reach — never argv.
- Transaction descriptions and attachments are third-party text (prompt injection): the CLI lockdown plus
  the person-only approval above is what keeps that harmless. Model names are validated so they can't become CLI options.
- Claude runs with `--settings` excluding CLAUDE.md/.claude/rules (so these dev notes don't leak into
  the finance assistant). Gemini gets an empty `.env` in the conversation folder: it walks up looking
  for `.env`, and the project root's `.env` holds the Pluggy secret.
- Accounts ("contas"): several logins per CLI, told apart by a login folder passed through the CLI's own
  variable (`variavelDeConta`: CLAUDE_CONFIG_DIR / GEMINI_CLI_HOME / CODEX_HOME). Sessions are keyed by
  (conversation, account). The three default accounts have id = provider and use the CLI's default login.
- `gerar_imagem` (Nano Banana, paid key) only runs when the person's own last message asks for an image
  (`pediuImagem`): third-party text (Pix descriptions, attachments) must never be able to spend their key.
- Before trusting a new Gemini/Codex CLI version: run a real conversation asking the model to read a
  file outside the conversation folder (e.g. `data/.sessao`) and confirm it's refused — their file
  confinement is the CLI's job, verified for Claude only (`--restricted`).
- API-key accounts (`tipo: 'api'`): the same providers via their paid APIs (AI SDK 7, `execucao/executor-api.ts`),
  tools called in-process through `Ferramentas.executar` (no MCP bridge, no CLI session). The key lives only in
  `<pastaAssistente>/chaves/<contaId>` (0600, dir 0700, `apis/chaves-de-api.ts`); routes return just `chaveFinal`
  ("…AbCd"). Never log AI SDK error objects (they carry `requestBodyValues`); keep the fixed base URLs in
  `apis/fabrica-de-modelos.ts`. Tests never call real APIs: inject `FABRICA_DE_MODELOS` (mock model from `ai/test`)
  and a fake fetch into `ModelosAoVivo`.
- Search: SQLite FTS5 (`trechos_fts`, migration 0004) + sqlite-vec (`trechos_vec`, created at runtime
  if the extension loads). Embeddings are local (multilingual-e5-small, downloaded on user request).
- Verified 2026-10 with the real DB copy (before actions existed): bridge lists 15 tools and `resumo_do_mes` matches the screen
  to the cent; the real Claude CLI's expired login surfaces as a friendly error. Gemini/Codex adapters
  are built from their source (0.62 / 0.160) and contract-tested, not yet run against a real login.

## Verified with real data (2026-10)

Production tests against a real Nubank account via Pluggy: `creditCardMetadata.billForecastDate` is the bill's due month
(high agreement with `billId`). The server pins `TZ=America/Sao_Paulo` (`src/fuso.ts`); the app window runs Chrome on X11 because
Chrome on KDE Wayland delivers no animation frames to it (see `fluxo.sh`).
