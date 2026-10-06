# Política de segurança

O Fluxo guarda dados financeiros de quem usa. Levamos falhas de segurança a sério e agradecemos
quem as reporta com responsabilidade.

## Como reportar

**Não abra issue pública para vulnerabilidade.** Use o canal privado do GitHub:

1. Vá em [**Security → Report a vulnerability**](https://github.com/eduardorarruda/fluxo-assistente-financeiro/security/advisories/new)
   neste repositório (GitHub Security Advisories).
2. Descreva o problema, a versão (commit) afetada e os passos para reproduzir.
3. Se puder, diga o impacto que você enxerga e uma sugestão de correção.

A ideia é responder em até 7 dias, combinar a correção com você e só então publicar o aviso,
com o crédito que você quiser.

## O que está no escopo

- **Servidor local:** qualquer forma de alcançar a API sem estar em `127.0.0.1`, de um site no
  navegador chamar o Fluxo (CSRF, DNS rebinding, CORS) ou de contornar a validação de entrada.
- **Sessão:** reaproveitar o código de entrada de uso único, roubar ou forjar o cookie de sessão,
  abrir uma rota `/api` sem sessão (a única exceção prevista é o retorno do OAuth do Google).
- **Guarda das chaves:** segredo da Pluggy, chaves de API dos provedores de IA, chave do Gemini e
  token do Google aparecendo no banco, no log, numa resposta da API ou no ambiente de um CLI.
- **Ponte MCP:** usar o token da ponte fora de `/api/assistente/ferramentas/*`, depois do fim da
  resposta, ou para aprovar uma proposta.
- **Ações do assistente:** texto de terceiros (descrição de Pix, anexo) que consiga aprovar uma
  proposta, desfazer algo, gastar a chave de imagens ou fazer o CLI ler arquivos, rodar comandos ou
  acessar a web.
- **Sincronização:** dado do banco que apague ou sobrescreva edições da pessoa.

Fora do escopo: ataques que exigem acesso de administrador à máquina ou à conta do sistema de quem
usa (quem já lê `data/` lê tudo), e falhas dos serviços de terceiros (Pluggy, Google, provedores de
IA) — reporte-as a eles.

## O que **não** enviar

- **Nunca mande dados financeiros reais** — extratos, prints de tela com valores, nomes, CPF, CNPJ,
  números de conta ou de cartão. Reproduza com o **modo demonstração** (sem credenciais da Pluggy)
  ou com dados inventados.
- Nunca mande chaves de API, segredos da Pluggy, tokens do Google, o conteúdo de `data/.sessao` ou
  `data/.entrada`, nem o arquivo `data/fluxo.db`.
- Se algo sensível vazar por engano no relato, avise logo para apagarmos.

## Versões suportadas

O Fluxo ainda não tem versões numeradas: corrigimos sempre a ponta da branch `main`.
