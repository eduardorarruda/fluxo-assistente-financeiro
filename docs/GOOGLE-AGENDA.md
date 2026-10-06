# Google Agenda

O Fluxo põe numa agenda própria do Google, chamada **Fluxo**, o fechamento e o vencimento da fatura
de cada cartão, as contas a pagar e um alerta diário para o que atrasar. O Google Agenda avisa no
celular. Código em `server/src/google/` e `web/src/paginas/google/`.

## Escopos OAuth

| Escopo | Por quê |
|---|---|
| `https://www.googleapis.com/auth/calendar.app.created` | Criar agendas secundárias e ver/criar/alterar/apagar eventos **só nelas**. O Fluxo não enxerga a agenda principal nem outras agendas. Aceito por `calendars.insert/get/delete` e `events.*` (conferido na referência da Calendar API v3, 2026-10). |
| `openid`, `email` | Só para mostrar em Ajustes com qual conta o Fluxo está conectado (vem no `id_token`). |

`calendar.app.created` é escopo **sensível**: app sem verificação mostra a tela "O Google não verificou
este app" e fica limitado a 100 usuários — o que não importa para um app de uso pessoal (regra de
"personal use" do Google: menos de 100 usuários podem passar pelo aviso, sem verificação).

## Fluxo da conexão

1. A pessoa cria o próprio cliente OAuth (tipo **App para computador**) e cola client ID + secret em
   Ajustes → `PUT /api/google/cliente`.
2. "Conectar" abre uma janelinha (`window.open` no clique, para não cair no bloqueador) e pede
   `POST /api/google/conectar`, que devolve a URL de consentimento com **PKCE S256**, `state` aleatório
   de 256 bits, `access_type=offline` e `prompt=consent` (`google/oauth.ts`).
3. O Google redireciona para `http://127.0.0.1:<porta>/api/google/retorno?code&state` (loopback —
   cliente "App para computador" aceita qualquer porta sem cadastro).
4. O retorno troca o código em `https://oauth2.googleapis.com/token` (com o `code_verifier`), confere
   que o escopo da agenda foi concedido (o consentimento é granular: dá para desmarcar), guarda o
   refresh token e dispara a primeira sincronização.
5. A página de retorno avisa a janela do Fluxo por `BroadcastChannel('fluxo-google')` e por
   `opener.postMessage(…, location.origin)`; como o Google pode cortar o `opener`, a tela de Ajustes
   também consulta `GET /api/google/estado` a cada 1,5 s enquanto espera.

### Por que o retorno não usa a sessão

O cookie da sessão é `SameSite=Strict`, e o redirecionamento vem de `accounts.google.com` (navegação
iniciada por outro site): o navegador **não manda o cookie**. Por isso a `Seguranca` tem uma exceção
estreita: `GET /api/google/retorno` passa sem sessão **somente** quando o `state` da URL é de um pedido
em aberto (`ServicoGoogle.retornoValido`, que só confere). O controlador então **consome** o pedido —
uso único, validade de 10 minutos, preso ao verificador PKCE e ao client ID daquele momento. Host
continua conferido. Qualquer outra rota `/api/google/*` exige a sessão normal; um `state` repetido,
vencido ou inventado dá 401 (ou, com a sessão, a página "link já usado").

A página de retorno tem CSP própria (`default-src 'none'`, script liberado só pelo **hash**, sem
`unsafe-inline`), `no-store`, `no-referrer`, e tira o `code` da barra de endereço.

## Onde ficam os segredos

`<pasta de dados>/google/` (ao lado do banco; `PASTA_GOOGLE` troca o lugar), pasta 0700, arquivos
0600, gravação atômica (`gravarChavePrivada`):

| Arquivo | Conteúdo |
|---|---|
| `cliente.json` | client ID e client secret |
| `token.json` | refresh token, e-mail, escopos concedidos |
| `estado.json` | id da agenda "Fluxo", última sincronização/reconciliação, erro, preferências |
| `eventos.json` | chave estável → id do evento no Google + hash do conteúdo |

Nada disso vai para o banco, para o log ou para resposta da API (o estado devolve só o começo do
client ID). O token de acesso vive só na memória. "Desconectar" revoga em
`https://oauth2.googleapis.com/revoke`, apaga `token.json` e `eventos.json` e, se a pessoa marcar,
apaga antes a agenda "Fluxo" inteira.

## Eventos

Agenda secundária "Fluxo" (fuso America/Sao_Paulo), criada uma vez e recriada se a pessoa apagar.
Janela: de 30 dias atrás a 120 dias à frente. Todos com `transparency: transparent` (não ocupam a
agenda) e `extendedProperties.private` = `{ fluxo: '1', fluxoChave, fluxoHash }`.

| Item | Chave | Título | Cor |
|---|---|---|---|
| Fechamento da fatura | `cartao:<conta>:<mês>:fecha` | `Cartão Nubank: fecha a fatura` | 3 (uva) |
| Vencimento a pagar | `cartao:<conta>:<mês>:vence` | `Cartão Nubank: vence a fatura · R$ 1.234,56` (sem valor enquanto aberta) | 9 (mirtilo) |
| Conta a pagar | `conta:<id>:<vencimento>` | `Pagar: Energia · R$ 150,00` | 7 (pavão) |
| Paga | (mesma) | `✓ Paga: Energia · R$ 150,00` — sem lembretes | 8 (grafite) |
| Atrasada | (mesma) | `⚠ Atrasada: Energia · R$ 150,00` — sem lembretes | 11 (tomate) |
| Alerta de atraso | `atraso:<chave do item>` | `⚠ Em atraso: Energia · R$ 150,00 (venceu 28/09)` | 11 (tomate) |

Pago **não é apagado**: vira "✓ Paga" no mesmo evento (o histórico do mês fica visível). Meses sem
fatura ainda entram pelas datas do ciclo do cartão (`cicloDoCartao`); o fechamento vem da fatura do
banco quando há. Cartão sem ciclo conhecido não gera nada. "Cartão Nubank" quando só há um cartão
daquele banco; senão o nome de cada cartão.

### Lembretes

Vencimentos são eventos de **dia inteiro**: o lembrete é em minutos *antes da meia-noite* em que o
evento começa, e o Google só aceita 0…40.320. Logo, "N dias antes às H horas" = `N×1440 − H×60`
(véspera às 9h = 900; 2 dias antes às 9h = 2.340) e **não existe** "no próprio dia às 9h" para evento
de dia inteiro. Padrão: **2 dias antes e na véspera, às 9h**, em popup (configurável em Ajustes:
horário de 6h a 21h; 1, 2, 3, 5 ou 7 dias antes).

Quem cobre o dia seguinte é o **alerta de atraso**: um evento *com hora*, no próximo "hoje às H"
(hoje, se ainda não deu a hora; senão amanhã), com aviso de 0 minutos. A cada sincronização ele anda
para o dia seguinte, então toca uma vez por dia até o Fluxo ver o pagamento. Vale para contas
atrasadas (mesmo de antes da janela) e para fatura fechada vencida com saldo.

## Sincronização

`ServicoGoogle.sincronizar` — uma por vez; chamadas no meio viram uma só logo depois.

1. Token de acesso: renova com o refresh token quando falta menos de 1 min (guarda o novo refresh
   token se o Google girar).
2. Garante a agenda (`GET calendars/{id}`; 404/410 → cria outra e zera o mapa).
3. Reconcilia (lista os eventos com `privateExtendedProperty=fluxo=1` e refaz o mapa) na conexão, no
   "Sincronizar agora", com o mapa vazio e uma vez por dia — evento apagado à mão volta; evento que a
   pessoa criou na agenda "Fluxo" nunca é tocado; chave duplicada é apagada.
4. Diferença (`google/sincronia.ts`): novo → `POST`; hash diferente → `PUT` (404 → recria); sumiu →
   `DELETE`; igual → nada. O mapa é salvo a cada mudança: queda no meio não duplica nada.

Gatilhos: depois de conectar, no fim de cada sincronização do banco (`Sincronizador.aoTerminar`), em
`ContasAPagar.aoMudar` (agrupados em 5 s), 15 s depois de subir, de hora em hora e no botão.

Falhas nunca derrubam o servidor: viram `erro` no estado. 401 → renova e tenta de novo uma vez.
429/403 de limite e 5xx → espera (Retry-After, senão 1/2/4 s) até 4 tentativas, com 120 ms entre
chamadas. Rede/limite → nova tentativa em 15 min. `invalid_grant` (revogado, ou os 7 dias do app em
"Teste") → apaga o refresh token, `precisaReconectar` e alerta **crítico** no sino do Fluxo
(`Financas.registrarAlertas`, destino `/ajustes#google`). API desativada no projeto → mensagem
apontando o passo 2 do guia.

## Testes

Nenhum teste fala com o Google: `google/testing/google-falso.ts` é um servidor de token + Calendar API
em memória atrás de um `fetch` falso (`FETCH_GOOGLE`), e `ESPERA_GOOGLE` tira as esperas.
`google/*.spec.ts` (PKCE/state, token, cofre, eventos, API com 401/429/403, diferença/mapa) e
`google.e2e.spec.ts` (rotas com supertest, a exceção da Seguranca, conexão ponta a ponta).
