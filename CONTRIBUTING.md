# Contribuindo

Obrigado por querer contribuir! Siga as guidelines abaixo.

## Rodando testes

```bash
npm install
npm test           # server + web
npm run typecheck
npm run build
```

## Convenções

- **Identificadores:** português (pt-BR) — nomes de variáveis, funções, comentários
- **Dinheiro:** sempre em **centavos** (inteiros), nunca reais com decimais
  - Exceção: ferramentas da API do assistente retornam reais (2 casas)
- **Datas:** formato local `AAAA-MM-DD` no código; meses como `AAAA-MM`
- **Testes:** obrigatórios para features novas
  - Padrão AAA (Arrange, Act, Assert)
  - Cobertura mínima 80%
  - Nunca use dados reais: mock/fake (veja `domain/testing/`, `google/testing/`)

## Segurança

**Antes de enviar PR:**
- Nenhuma chave de API, token ou senha hardcoded
- Nenhum caminho local (`/home/user/...`) em código de produção
- Nenhum dado real (nomes, CPF, CNPJ, valores)

**Reportar vulnerabilidades:** use GitHub Security Advisories (não abra issue pública).

## Padrão de commit

```
type: descrição (até 50 caracteres)

Parágrafo explicando o porquê (se não óbvio).
```

Tipos: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`

## Dúvidas?

Abra uma issue. Obrigado!
