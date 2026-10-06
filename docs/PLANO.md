# Fluxo — plano

Sistema de finanças pessoais que lê o Nubank (e outros bancos) pelo Open Finance via
Pluggy. Substitui o sistema antigo baseado em planilha.

## Decisões

| Tema | Decisão | Por quê |
|---|---|---|
| Forma | Monolito: um processo Node (NestJS) serve a API **e** o React compilado | Um comando sobe tudo; nada de dois servidores em produção |
| Linguagem | TypeScript nos dois lados | É o JavaScript do NestJS; tipos protegem o dinheiro |
| Banco local | SQLite (better-sqlite3 + Drizzle) em `data/fluxo.db` | Zero serviço extra, um arquivo, backup = copiar |
| Fonte dos dados | Interface `FinanceProvider` com duas implementações: `PluggyProvider` (real) e `DemoProvider` (mesmos formatos da Pluggy) | A aplicação inteira lê só do SQLite; trocar demo por real é só credencial |
| Plano Pluggy | Conector **MeuPluggy** (gratuito para uso pessoal) | Plano comercial parte de R$ 2.500/mês |
| Rede | Servidor preso a 127.0.0.1, checagem de Host e Origin | Só esta máquina conversa com ele; a única saída é para api.pluggy.ai |
| Segredo | `PLUGGY_CLIENT_SECRET` só no servidor (`.env`); o navegador recebe apenas o connect token de 30 min | O segredo nunca chega ao front |

## As regras de dinheiro (o que não pode dar errado)

1. **Nada conta duas vezes.** Cada movimento recebe um *tipo*:
   `DESPESA`, `RECEITA`, `PAGAMENTO_FATURA`, `TRANSFERENCIA` (entre contas suas que estão no Fluxo; o que vem
   de conta sua fora dele — salário pela Caixa ou pela PJ — é `RECEITA`),
   `CAIXINHA` (guardar/resgatar), `ESTORNO`.
   Só `DESPESA`, `RECEITA` e `ESTORNO` entram em gastos/ganhos. Pagar a fatura não é gasto — as
   compras já foram contadas. Guardar na caixinha não é gasto — é dinheiro seu mudando de lugar.
2. **Dois olhares, nomeados.**
   - *Competência* (orçamento, categorias, "para onde foi"): a compra conta no mês em que foi feita;
     a parcela k de uma compra parcelada conta no mês da compra + (k−1).
   - *Caixa* (saldo, fluxo da conta): o cartão só sai do caixa quando a fatura é paga.
3. **Patrimônio** = contas + caixinhas + investimentos (sem repetir caixinha que também vier como
   investimento) − fatura em aberto.
4. **A Pluggy troca o id de uma transação** quando data/descrição/valor mudam muito. A
   sincronização apaga o que sumiu dentro da janela e **leva junto as edições do usuário** (categoria,
   nota) casando pela impressão digital (conta + data + valor + descrição normalizada).

## Telas

Visão geral · Fluxo (Sankey de onde vem → para onde vai) · Extrato · Cartão · Caixinhas ·
Orçamento · Metas · Recorrências · Insights · Conexões · Ajustes.

## Fases

1. Scaffold (workspaces, testes, lint) e regras ECC em `.claude/rules/ecc`.
2. Núcleo de domínio em funções puras, com TDD: classificação, competência, fluxo, Sankey,
   recorrências, orçamento, projeção de faturas.
3. Persistência, provedores (demo e Pluggy) e sincronização.
4. API NestJS + testes de integração.
5. Front: tokens, ícones próprios, casca animada, telas, gráficos.
6. Lançador do KDE, README.
7. Revisão de código e de segurança (agentes do ECC), verificação no navegador.

## Revisão (agentes do ECC)

Rodaram o `security-reviewer` e o `code-reviewer`/`typescript-reviewer` do ECC sobre o código pronto.
Todos os achados foram corrigidos, cada um com o teste que reproduz o cenário:

| Achado | Correção |
|---|---|
| Edição do usuário perdida quando a Pluggy recria a transação com outro valor | Edições órfãs procuram a nova dona (impressão exata, ou candidato único ±5 dias com mesmo valor/loja) |
| Caixinha contada duas vezes no gráfico de evolução | Investimentos marcados como duplicados ficam fora da série |
| Parcela no mês errado com 1 dia de diferença de fuso / sem data de compra | Deslocamento por diferença de meses; datas de compra inferidas pelas parcelas irmãs |
| Sincronização podendo apagar o que o banco não reenviou | Janela = a mais tardia entre a pedida e a transação mais antiga devolvida; nada é apagado sem item UPDATED ou com conta vazia |
| Categoria manual de gasto valendo numa receita | Só vale se for do mesmo grupo da natureza |
| "Pagamento recebido" na conta tratado como fatura; Tesouro/ações como gasto; rotativo como gasto | Regras de classificação corrigidas |
| Demonstração somando com os dados reais | Sai sozinha ao conectar o banco |
| API legível por outros programas da máquina | Sessão local (código de uso único → cookie HttpOnly/SameSite=Strict) |
| Texto de Pix de terceiros mudando a classificação | Palavras-chave ancoradas no começo e ignoradas em Pix/TED de terceiros |
| Porta de desenvolvimento aceita em produção; POST sem corpo | Porta do Vite só fora de produção; cabeçalho `X-Fluxo` obrigatório nas escritas |
| Arquivos legíveis por outros usuários | `umask 077`, pasta `data/` 0700, banco e sessão 0600 |
| Ids indo direto para a URL da API da Pluggy | Validados como UUID |
