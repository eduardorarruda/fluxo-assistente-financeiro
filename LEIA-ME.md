# Fluxo

Finanças pessoais conectadas ao Nubank pelo Open Finance (via Pluggy). Conta, cartão, faturas,
parcelas, caixinhas, orçamento, metas, assinaturas e o caminho do dinheiro — num app que roda
nesta máquina.

## Abrir

Procure **Fluxo** no menu do KDE. Ou, pelo terminal:

```bash
./fluxo.sh
```

| Opção | O que faz |
|---|---|
| `./fluxo.sh` | Sobe o servidor e abre a janela (Chrome em modo app) |
| `./fluxo.sh --navegador` | Abre numa aba do navegador padrão |
| `./fluxo.sh --servidor` | Só o servidor, sem janela (Ctrl+C para parar) |

Fechou a janela, o servidor percebe em até 90 s e desliga sozinho.

Sem a Pluggy configurada, o Fluxo abre no **modo demonstração**: um Nubank de mentira com 14
meses de histórico, para ver tudo funcionando. Ele sai sozinho quando você conecta o banco de verdade.

## Conectar o Nubank (uns 10 minutos)

O plano comercial da Pluggy começa em R$ 2.500/mês. O caminho gratuito para uso pessoal é o
**Meu Pluggy**, e tem uma armadilha de prazo: **só dá para conectar durante os 15 dias de teste**
da conta de desenvolvedor. Depois disso a conexão continua funcionando, mas não entra banco novo.
Então faça tudo de uma vez:

1. Crie a conta em **dashboard.pluggy.ai** (grátis, sem cartão). Os 15 dias começam aqui.
2. Em **Applications**, crie uma aplicação. Ela mostra o **Client ID** e o **Client Secret**.
3. Em **meu.pluggy.ai**, conecte o Nubank pelo Open Finance (a autorização é feita no app do Nubank).
4. Na pasta do Fluxo:
   ```bash
   cp .env.exemplo .env && chmod 600 .env
   ```
   Preencha `PLUGGY_CLIENT_ID` e `PLUGGY_CLIENT_SECRET` e reabra o Fluxo.
5. Em **Conexões → Conectar banco**, escolha **MeuPluggy** e entre com a conta do Meu Pluggy.

O Fluxo nunca vê a senha do banco e nunca movimenta dinheiro: só lê.

> **Não apague a conexão na Pluggy** depois do período de teste — com o Meu Pluggy, reconectar não
> é possível. Remover no Fluxo não apaga lá (a menos que você marque a opção, que avisa disso).

## Assistente (conversar com as suas finanças)

A tela **Assistente** (Alt+0) é um chat, no estilo do Claude: conversas à esquerda, a conversa no
meio, a caixa de texto embaixo. Ele usa o CLI de IA que **você já paga e já usa** neste computador —
**Claude Code**, **Gemini CLI** ou **Codex CLI (ChatGPT)** —, com o seu login. Alternativamente,
use uma **chave de API** paga (Anthropic, Google ou OpenAI) para chamar os provedores direto. As chaves
ficam em arquivo 0600 na máquina; o Fluxo nunca as envia a lugar nenhum.

1. Instale pelo menos um CLI e entre com a conta do seu plano (os comandos aparecem em
   **Ajustes → Assistente de IA**):
   - Claude Code: `curl -fsSL https://claude.ai/install.sh | bash`, depois `claude` e `/login`
   - Gemini CLI: `npm install -g @google/gemini-cli`, depois fazer login com sua conta Google
   - Codex CLI: `npm install -g @openai/codex`, depois fazer login com sua conta OpenAI
2. Em **Ajustes → Assistente de IA**, clique em **Testar**. Se o CLI estiver fora do PATH, informe o
   caminho. Dá para escolher o modelo e qual CLI é o padrão; em cada conversa dá para trocar.
3. (Opcional) **Busca inteligente**: baixa uma vez um modelo de ~120 MB que roda no seu computador e
   permite procurar por significado ("comida fora de casa", "gastos com o carro"). Sem ele, a busca
   continua funcionando por palavra.

**Mais de uma conta e escolha do modelo.** Em **Ajustes → Assistente de IA → Adicionar conta** dá para
ter várias contas do mesmo CLI (ex.: "Claude pessoal" e "Claude trabalho", cada uma com o seu plano).
Cada conta tem a sua **pasta de login**; o Fluxo mostra o comando para entrar nela, por exemplo
`CLAUDE_CONFIG_DIR='~/.config/fluxo/contas/claude-trabalho' claude` e depois `/login`. Cada conta tem
um modelo padrão, e no topo de cada conversa você escolhe a conta e o modelo (das sugestões ou
digitando qualquer nome que o CLI aceite).

Pode anexar imagens (nota, print), PDF (fatura, extrato, contrato), CSV, OFX, TXT e JSON — até 15 MB
cada, 20 por conversa. O texto dos PDFs e planilhas é extraído e indexado para o assistente consultar.

**O que o assistente pode e não pode:** ele **lê** os seus dados por ferramentas do Fluxo (resumo
do mês, movimentos, cartão, orçamento, metas, assinaturas, caixinhas, anexos) e pode **executar ações**:
- **Diretas** (na hora, sempre reversíveis): ajustar categoria de um movimento, criar/marcar conta a pagar
- **Propostas** (você aprova antes): regras de categoria, orçamento, metas — o assistente não faz nada sem sua confirmação

O CLI roda travado: sem terminal, sem gravar arquivos e sem internet. O segredo da Pluggy nunca chega a ele.
Mesmo que a descrição de um Pix traga um texto malicioso, ele não tem poder para mexer em dados sem aprovação.
As respostas usam a cota do seu plano do CLI (ou da API, se usar chave).

**Falar em vez de digitar.** Na caixa de texto há dois botões de voz:

- **Microfone** (Alt+M): você fala e o texto aparece na caixa, ao vivo, onde estiver o cursor. Esc ou
  outro clique para; depois é só revisar e enviar.
- **Conversa por voz** (Alt+V): abre uma esfera no lugar da conversa. Você fala, e quando para de falar
  (1,2 s de silêncio, ajustável) a pergunta é enviada; o assistente responde curto e em voz alta, frase a
  frase, e volta a ouvir. Toque na esfera (ou Espaço) para interromper; M pausa o microfone; Esc encerra.
  Tudo o que foi dito fica salvo na conversa, como se tivesse sido digitado.

Em **Ajustes → Assistente de IA → Voz** dá para escolher a voz, a velocidade e o tempo de silêncio. Na
primeira vez, a janela pede permissão para o microfone (se negar sem querer: menu ⋮ da janela →
"Informações do app" → Microfone). **Privacidade:** o reconhecimento "Pelo Google" manda o áudio da sua voz
para o Google transcrever; o "No computador" não manda nada, mas depende de o Chrome oferecer o pacote de
português nesta máquina (no Linux, por enquanto, ele não oferece).

**Voz natural.** Para o assistente falar bonito (e não com a voz robótica do sistema), em **Ajustes →
Assistente de IA → Voz → Voz natural** clique em **Baixar** numa das vozes (~64 MB cada, uma vez só). São
vozes neurais [Piper](https://github.com/OHF-Voice/piper1-gpl) que rodam **no seu computador**, pelo próprio
Fluxo: nada do que o assistente fala sai da máquina. A recomendada é a **Faber**; a **Dii** é feminina. Cada
cartão mostra a licença: Faber, Cadu e Jeff têm dados CC0 (Open Home Foundation); Dii e Miro são
CC BY-NC-ND 4.0 da TigreGotico (uso pessoal, não comercial — que é o caso aqui). Sem nenhuma voz natural, o
Fluxo usa a voz do navegador (no Linux, ela precisa do `speech-dispatcher`; sem ele, as respostas aparecem
só escritas).

## Contas a pagar

A tela **Contas a pagar** (Alt+C) junta tudo o que vence: as contas que você cadastra e, logo abaixo, as
faturas do cartão (quando fecham, quando vencem e quanto falta).

- **Cadastrar:** "Nova conta" → descrição, valor, vencimento (no calendário), se repete todo mês ou todo
  ano e a categoria. Ou peça ao Assistente: *"a conta de luz de R$ 150 vence dia 10"*.
- **Como aparece no extrato** (opcional): um trecho do nome do débito, por exemplo `ENEL`. Quando um gasto
  com esse nome e valor parecido (até 10% de diferença; exato abaixo de R$ 10) cair entre 10 dias antes e
  15 dias depois do vencimento, a conta é marcada como **paga sozinha**, ligada ao movimento. Em branco, o
  Fluxo procura pelas palavras da descrição ("Netflix" acha "NETFLIX.COM"). Compra no cartão também paga
  (assinatura). Pagamento de fatura, transferência entre suas contas e caixinha nunca pagam conta.
- **Na dúvida, ele pergunta:** se dois gastos servem, a conta fica aberta e o botão **Paguei** mostra os
  candidatos (o provável vem marcado). Dá também para dizer que pagou por fora, com a data.
- **Repete:** ao pagar uma conta mensal, a do mês seguinte aparece sozinha (no mesmo dia; dia 31 vira 30 ou
  28 nos meses curtos). **Reabrir** desfaz o pagamento e o débito desligado não é escolhido de novo.
- **Avisos:** no sino, a conta que vence em até 3 dias (e se o saldo não cobre) e a atrasada, em vermelho.
- Em **Recorrências**, o botão de recibo ao lado de uma cobrança a transforma em conta a pagar.

## Google Agenda (avisos no celular)

O Fluxo pode manter uma agenda **só dele**, chamada **Fluxo**, na sua conta Google: o fechamento e o
vencimento da fatura do cartão, as contas a pagar e, se algo atrasar, um alerta por dia até pagar. O Google
Agenda avisa no celular. O Fluxo só mexe nessa agenda — não vê nem altera seus outros compromissos.

Uma vez só (uns 5 minutos), no **Google Cloud**, com a mesma conta Google da agenda:

1. **Crie um projeto** em `console.cloud.google.com/projectcreate` (nome: Fluxo; é grátis, não pede cartão).
2. **Ative a Google Calendar API** em `console.cloud.google.com/apis/library/calendar-json.googleapis.com`
   (confira que o projeto Fluxo está escolhido no topo) → **Ativar**.
3. **Tela de consentimento** em `console.cloud.google.com/auth/branding` → **Começar**: nome do app *Fluxo*,
   e-mail de suporte o seu; Público **Externo**; contato o seu e-mail; aceite e **Criar**.
4. **Publique o app** em `console.cloud.google.com/auth/audience` → **Publicar app** → **Em produção**.
   Enquanto o app fica em *Teste*, o Google derruba a autorização a cada **7 dias**. Não precisa de
   verificação: app de uso pessoal (menos de 100 pessoas) funciona sem ela. Ao conectar, o Google avisa
   que *o app não foi verificado*: clique em **Avançado** → **Acessar Fluxo (não seguro)** — é o seu app.
   (Prefere deixar em Teste? Adicione seu Gmail em *Usuários de teste* e reconecte toda semana.)
5. **Crie o cliente** em `console.cloud.google.com/auth/clients/create`: tipo **App para computador**,
   nome *Fluxo* → **Criar**. Copie o **ID do cliente** e a **Chave secreta do cliente** (ou baixe o JSON).
   Não precisa cadastrar endereço de redirecionamento: app para computador aceita o retorno em
   `http://127.0.0.1:8778/api/google/retorno` sozinho.
6. Em **Ajustes → Google Agenda**, cole os dois (ou o JSON inteiro no campo do ID), **Salvar credenciais** e
   **Conectar com o Google**. Escolha a conta e deixe marcada a permissão da agenda.

Pronto: aparece a agenda **Fluxo** no Google Agenda, e ela se atualiza sozinha (depois de cada sincronização
do banco, quando você mexe numa conta a pagar e de hora em hora). Em **Ajustes** você escolhe o que vai lá
e quando o Google avisa — padrão: **2 dias antes e na véspera, às 9h**. Os vencimentos são de dia inteiro, e o
Google só deixa um evento assim avisar até a véspera; no dia seguinte ao vencimento, se não estiver pago,
chega o alerta de atraso, todo dia no mesmo horário, até o Fluxo ver o pagamento. Conta paga vira
"✓ Paga" no mesmo evento.

O ID, a chave secreta e a autorização ficam em `data/google/` (só você lê). **Desconectar** devolve a
autorização ao Google e, se você marcar, apaga a agenda Fluxo.

## As regras de dinheiro

- **Nada conta duas vezes.** Pagar a fatura não é gasto (as compras já contaram). Guardar na
  caixinha não é gasto. Pix para outra conta sua não é gasto nem receita. Rotativo e parcelamento
  da fatura também não.
- **Dois olhares.** *Gastos, orçamento e fluxo* contam pelo mês da compra; cada parcela conta no mês
  dela. *O caixa da conta* só vê o cartão quando a fatura é paga.
- **Patrimônio** = contas + caixinhas + investimentos − fatura em aberto, sem repetir caixinha que
  também chegue como investimento. Se o seu banco já inclui as caixinhas no saldo, ajuste isso em **Ajustes**.
- **Suas edições sobrevivem.** Categoria, nota e "ignorar" continuam valendo quando a Pluggy troca o
  id de uma transação (pendente que efetivou com outro valor, por exemplo).

Recategorizou algo? Marque "sempre que aparecer…" e vira uma regra, aplicada no passado e no futuro.

## Privacidade e segurança

- **Banco de dados:** `data/fluxo.db` (SQLite, 0600), um arquivo — Backup = copiar. Conversas e anexos dentro.
  Modelo de embeddings e vozes naturais em `data/modelos/` (redownloadáveis).
- **Servidor:** só em `127.0.0.1`. Toda API exige **sessão local** (código único → cookie HttpOnly/SameSite=Strict).
  Nenhum outro programa acessa o Fluxo; nenhum site no navegador consegue chamá-lo.
- **Internet:** apenas
  - Pluggy (sincronização do banco) — segredo fica no servidor
  - Google Calendar (se conectado) — apenas a agenda "Fluxo"
  - Provedores de IA (Claude, Gemini, OpenAI) — se usar chaves de API
- **Chaves de API:** arquivo 0600, nunca no banco, log ou resposta.
- **Google Calendar:** se conectado, apenas agenda secundária "Fluxo" é tocada. Refresh token em arquivo 0600.
- **Voz:**
  - Ditado / conversa **"Pelo Google":** áudio vai do Chrome para Google transcrever
  - **"No computador":** sem envio (se pacote disponível no Linux)
  - Leitura: vozes "online" mandam texto para Google sintetizar; "no computador" não
  - **Voz natural (Piper):** inteira local, apenas servidor 127.0.0.1; internet só para baixar a voz (GitHub, tamanho e SHA-256 conferidos)

## Atalhos

| Tecla | Ação |
|---|---|
| Alt + 0…9 | Telas do menu (Alt+0 é o Assistente) |
| Alt + C | Contas a pagar |
| Alt + N | Nova conversa no Assistente |
| Enter / Shift+Enter | Enviar / quebrar linha no Assistente |
| Alt + M | Ditar no Assistente (Esc para parar) |
| Alt + V | Conversar por voz com o Assistente |
| `/` | Buscar no extrato |
| `P` | Esconder / mostrar valores |
| `T` | Tema claro / escuro |

## Desenvolvimento

```bash
npm install
npm run dev        # NestJS (8778, watch) + Vite (5173, reload)
npm test           # testes de server e web
npm run typecheck  # verificação de tipos
npm run build      # produção: web/dist + server/dist
```

```
fluxo/
├── fluxo.sh / fluxo.desktop   o atalho
├── data/                      banco local e sessão (fora do git)
├── server/src/
│   ├── domain/                as regras de dinheiro, em funções puras e testadas
│   ├── provedores/            Pluggy e demonstração (mesmo formato)
│   ├── dados/                 SQLite: leitura, sincronização, edições
│   ├── servicos/              cada tela montada a partir do domínio
│   ├── http/                  API, validação, sessão e segurança
│   └── assistente/            o chat: CLIs, ponte MCP, ferramentas, anexos e busca (RAG)
└── web/src/
    ├── paginas/               as 11 telas
    ├── graficos/              Sankey, área, barras, rosca, pote… (SVG + motion)
    └── icones/                o conjunto de ícones próprio
```

Detalhes das decisões em `docs/PLANO.md` e, do assistente, em `docs/ASSISTENTE.md`.
