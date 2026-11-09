# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Datas no fuso de São Paulo.

## [Não lançado]

### Segurança
- A sessão não pode mais ser pulada mudando maiúsculas ou codificando a URL (`/API/estado`, `/%61pi/...`).
  O Express casa rotas sem diferenciar caixa, e a checagem agora compara contra o caminho normalizado.
- O programa do CLI do Assistente precisa ser seu (ou do sistema), e nem ele nem a pasta dele podem ser graváveis por outros usuários.
- Limites por minuto nas ferramentas da ponte (120), em aprovar, recusar e desfazer (30) e na entrada (20).
- Cabeçalho `Permissions-Policy`: só microfone e área de transferência, só para o próprio Fluxo.
- Stacks gravados no log passam por `ocultarSegredos`.
- Dependências de produção sem vulnerabilidade conhecida (`npm audit --omit=dev`: 0).
- CI: actions fixadas por SHA, gitleaks no histórico inteiro, `npm audit` das dependências de produção, cobertura e SBOM CycloneDX.

### Adicionado
- "Baixar todos os meus dados (JSON)" em Ajustes (`GET /api/exportacao`).
- Cópia automática do banco antes de cada migração (`data/copias/`, últimas 5).
- Índices nas chaves estrangeiras (contas, caixinhas, investimentos, faturas, anexos, conversas), na migração 0008.
- Teto de tokens de saída por passo nas contas de API.
- Página "Esta página não existe", título da aba por tela, `noindex` e `robots.txt`.
- Testes de acessibilidade com axe (WCAG 2.2 AA) em todas as telas.
- `docs/OPERACAO.md` (dados, retenção, cópias, rotinas, incidente) e `docs/DECISOES.md` (ADRs).

### Corrigido
- Clique duplo (ou Enter repetido) em "Criar conta" criava duas contas a pagar: o formulário trava depois do primeiro envio e manda uma chave `Idempotency-Key`, e o servidor cria uma só.
- O log não cresce mais sem fim: um arquivo por dia em `~/.cache/fluxo/`, apagado depois de 90 dias.
- Total da fatura na ferramenta do Assistente somado em centavos, não em reais com ponto flutuante.
- Valores positivos ganham "+" além da cor (a cor não é mais o único sinal).
- As animações do motion respeitam o "menos movimento" do sistema.
- `fluxo.sh` compila de novo quando o código é mais novo que o build (antes, depois de um `git pull`, seguia rodando a versão velha).

## 2026-10-19
- fix: a busca por significado volta a carregar o modelo só do disco.

## 2026-10-16
- feat: avisos dispensáveis, transferências entre bancos conectados e FGTS como receita.

## 2026-10-08
- feat: sincroniza ao abrir o Fluxo e a cada 30 min; Meu Pluggy sem erro no Atualizar.

## 2026-10-06
- Primeira versão pública: Visão geral, Fluxo, Extrato, Cartão, Caixinhas, Orçamento, Metas, Recorrências,
  Contas a pagar, Insights, Conexões (Pluggy) e Assistente.
