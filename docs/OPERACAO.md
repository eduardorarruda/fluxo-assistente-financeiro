# Operação do Fluxo: dados, cópias, incidentes e rotinas

Guia para o uso do dia a dia (uma pessoa, um computador). Complementa o [LEIA-ME](../LEIA-ME.md) e o
[SECURITY.md](../SECURITY.md).

## 1. Mapa dos dados

| Dado | Onde fica | Para que serve | Sai da máquina para |
|---|---|---|---|
| Extrato, saldos, faturas, caixinhas, investimentos | `data/fluxo.db` (SQLite, 0600) | As telas e os cálculos | Ninguém (chega **da** Pluggy) |
| Nomes e documentos de terceiros (Pix/TED) | Descrições em `data/fluxo.db` | Mostrar o movimento | O provedor de IA da conversa, **só** quando o Assistente lê aquele movimento |
| Suas edições, regras, orçamentos, metas, contas a pagar | `data/fluxo.db` | O que você criou (a sincronização nunca mexe) | Google Agenda: as contas a pagar, no calendário "Fluxo" |
| Conversas, mensagens, anexos, imagens geradas | `data/fluxo.db` + `data/assistente/` (0700) | Histórico do Assistente | O provedor de IA da conta usada na conversa |
| Índice de busca (FTS5 e vetores) | `data/fluxo.db` (`trechos*`) | Busca do Assistente | Ninguém (embeddings locais) |
| Credenciais da Pluggy | `.env` (0600) | Ler o banco | Pluggy (HTTPS) |
| Segredo do cliente Google, token de atualização | `data/google/` (0600, pasta 0700) | Agenda | Google (HTTPS) |
| Chaves de API de IA, chave do Gemini (imagens) | `data/assistente/chaves/`, `chave-gemini` (0600) | Contas por API | O próprio provedor (HTTPS) |
| Sessão local | `data/.sessao`, `data/.entrada` (0600) | Só quem abre pelo atalho usa a API | Ninguém |
| Log | `~/.cache/fluxo/fluxo-AAAA-MM-DD.log`, um por dia (0600, pasta 0700); `~/.cache/fluxo.log` aponta para o de hoje | Diagnóstico | Ninguém |
| Cópias antes de migrar | `data/copias/` (0600, pasta 0700) | Voltar atrás depois de uma atualização | Ninguém |

Chaves e tokens nunca ficam no banco, numa resposta da API ou no log; as mensagens de erro e os
stacks passam por `ocultarSegredos`.

**LGPD**: uso pessoal, sem fim econômico, está fora da lei (art. 4º, I). Por isso não há banner de cookies,
portal do titular, DPO nem termos de uso.

## 2. Retenção

| O quê | Quanto tempo | Como apagar |
|---|---|---|
| Movimentos e faturas | Enquanto a conexão existir | Remover a conexão em **Conexões** apaga as contas, os movimentos e as faturas dela (cascata) |
| Conversas, anexos, imagens, trechos de busca | Até você apagar | Apagar a conversa: some do banco, do índice e da pasta de anexos |
| Cópias antes de migrar | As 5 mais recentes | Apagar os arquivos em `data/copias/` |
| Log | 90 dias: a cada abertura do Fluxo, os arquivos com mais de 90 dias são apagados (`scripts/rotacionar-log.sh`) | Apagar arquivos em `~/.cache/fluxo/` |

## 3. Cópias e restauração

- **Automática**: antes de cada migração do banco (atualização do Fluxo que muda o formato), o servidor faz
  `VACUUM INTO data/copias/fluxo-antes-de-migrar-<instante>.db` e guarda as 5 últimas.
- **Manual**: com o Fluxo fechado, `cp data/fluxo.db <destino>`. Para levar as chaves junto, copie a pasta
  `data/` inteira **para um destino criptografado**: as chaves estão em texto nos arquivos 0600.
- **Exportação aberta**: em Ajustes, "Baixar todos os meus dados (JSON)".
- **Metas (uso pessoal)**: RPO de até uma cópia. Os dados do banco voltam da Pluggy; perde-se só o que você
  criou depois da última cópia. RTO de 10 minutos.

**Restaurar**

1. Feche o Fluxo. Fechada a janela, o servidor desliga sozinho em até 90 s.
2. `cp data/fluxo.db data/fluxo.db.quebrado && rm -f data/fluxo.db-wal data/fluxo.db-shm`
3. `cp data/copias/<cópia>.db data/fluxo.db && chmod 600 data/fluxo.db`
4. Se a cópia é de antes de uma atualização, volte o código também: `git checkout <versão anterior>`.
5. Abra o Fluxo e confira a Visão geral.

## 4. Atualizar

1. `git pull`
2. Abra o Fluxo normalmente. O `fluxo.sh` vê que o código é mais novo que o build e compila de novo, e o
   servidor copia o banco antes de migrar.
3. Se não abrir: veja `~/.cache/fluxo.log`, volte o código (`git checkout <anterior>`), restaure a cópia de
   `data/copias/` (seção 3) e abra de novo.

## 5. Rotinas

**Login da Pluggy expirou, ou o banco pede uma ação**: o aviso aparece em Conexões, com um marcador no menu.
Abra Conexões e clique em **Reconectar**; o widget da Pluggy pede o login de novo.

**Sincronização travada** (fica em "Atualizando…"): feche o Fluxo, espere 90 s e abra de novo. A sincronização
grava numa transação, então uma interrompida não deixa dados pela metade. Se repetir, procure `Sincroniz` em
`~/.cache/fluxo.log`.

**Login do CLI do Assistente expirou**: a conversa mostra o erro de login. Faça o login de novo no próprio CLI
(`claude`, `gemini` ou `codex` no terminal), com a mesma pasta de login da conta.

**Trocar a sessão local**: feche o Fluxo, rode `rm data/.sessao data/.entrada` e abra de novo pelo atalho. O token
novo invalida qualquer cookie ou cópia do token antigo.

**Trocar chaves**

| Segredo | Revogar | Pôr a nova |
|---|---|---|
| Pluggy (client id/secret) | dashboard.pluggy.ai → a aplicação → gerar um segredo novo | Editar o `.env` e reabrir o Fluxo |
| Google (OAuth) | myaccount.google.com/permissions → remover o app; no Cloud Console, trocar o segredo do cliente | Na Agenda (Ajustes), desconectar e conectar de novo |
| Chave de API de IA | Console do provedor (Anthropic, OpenAI, Google AI Studio) → revogar | Assistente → Ajustes → a conta → trocar a chave |
| Chave do Gemini (imagens) | Google AI Studio → revogar | Assistente → Ajustes → Imagens |

## 6. Plano de incidente pessoal

**Computador perdido ou roubado.** Assuma que `data/` e o `.env` foram lidos, mesmo com o disco criptografado.

1. Pluggy: gere um segredo novo e apague a conexão no Meu Pluggy. Revogue também o consentimento no app do
   banco (Open Finance → consentimentos).
2. Google: remova o acesso do app em myaccount.google.com/permissions.
3. Revogue todas as chaves de API de IA e a chave do Gemini.
4. Encerre as sessões das CLIs (Claude Code, Gemini, Codex) pela página de cada conta.
5. Em outro computador: clone o repositório, restaure uma cópia (se tiver) e configure segredos novos.

**Um segredo vazou** (num log, num print, num commit): revogue só esse segredo (tabela da seção 5). Se ele foi
para o git, reescreva o histórico ou trate o repositório como comprometido. O CI roda o gitleaks a cada push.

**Suspeita de outro programa usando a API**: troque a sessão (seção 5). Sem o token, toda a `/api` (menos a
saúde) responde 401, inclusive com a URL em maiúsculas ou codificada.

## 7. Decisões de segurança registradas

- **HSTS: não se aplica.** O Fluxo é `http://127.0.0.1` por natureza, e o tráfego não sai da máquina. HSTS
  num endereço local forçaria HTTPS em todo serviço da mesma porta.
- **Criptografia em repouso: o disco do sistema** (LUKS, FileVault ou BitLocker), mais as permissões 0600/0700.
  O SQLCipher foi descartado porque a chave teria de morar na mesma máquina, ao lado do banco. Seria uma
  dependência nativa a mais sem proteger de quem já lê os seus arquivos. Cópias que saem do computador
  precisam ir para um destino criptografado.
- **Tráfego externo: só HTTPS**, para URLs fixas (Pluggy, Google, provedores de IA), com a verificação de
  certificado padrão do Node, nunca desligada.
