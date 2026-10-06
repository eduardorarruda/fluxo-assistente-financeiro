# Contas a pagar

"A conta de luz de R$ 150 vence dia 10": a pessoa (ou o Assistente) cadastra a conta; quando o débito
cai no extrato, o Fluxo marca como paga sozinho; se passar do dia, vira alerta. As faturas do cartão
aparecem ao lado, só para leitura, para a tela mostrar tudo o que vence.

## Onde mora

| Camada | Arquivo |
|---|---|
| Regras puras (situação, próxima ocorrência, conciliação, faturas do cartão) | `server/src/domain/contas-a-pagar.ts` |
| Tabela | `contas_a_pagar` em `server/src/db/schema.ts`, migração `server/drizzle/0007_contas_a_pagar.sql` |
| Persistência | `Repositorio.contasAPagar()`, `contaAPagar(id)`, `salvarContasAPagar(linhas, remover)` (transação; `mudou()`) |
| Serviço (o contrato abaixo) | `server/src/servicos/contas-a-pagar.ts` — `ContasAPagar`, provedor do `AppModule` |
| Rotas | `server/src/http/contas-a-pagar.controlador.ts`, zod em `server/src/http/validacao.ts` |
| Alertas | `gerarAlertas` (`domain/alertas.ts`), entrada `contasAPagar`, via `Financas.alertas()` |
| Tela | `web/src/paginas/ContasAPagar.tsx` + `web/src/paginas/contas-a-pagar/*`, rota `/contas-a-pagar`, Alt+C |
| Campos novos | `web/src/componentes/CampoData.tsx` (calendário), `CampoDinheiro.tsx` (máscara de real) |

## Contrato do serviço (o Assistente e a Agenda usam)

```ts
import { ContasAPagar, type ContaAPagar, type DadosContaAPagar } from '../servicos/contas-a-pagar';

type Repeticao = 'nao' | 'mensal' | 'anual';
type SituacaoConta = 'aberta' | 'paga' | 'atrasada';

interface ContaAPagar {
  id: string; descricao: string; valor: number /* centavos, > 0 */; vencimento: string /* AAAA-MM-DD */;
  repete: Repeticao; categoriaId: string | null; textoNoExtrato: string | null;
  situacao: SituacaoConta /* atrasada = aberta e vencimento < hoje, calculada */; pagaEm: string | null; movimentoId: string | null;
  origem: 'pessoa' | 'assistente'; nota: string | null; criadaEm: string; atualizadaEm: string;
}
interface DadosContaAPagar {
  descricao: string; valor: number; vencimento: string; repete?: Repeticao; categoriaId?: string | null;
  textoNoExtrato?: string | null; nota?: string | null; origem?: 'pessoa' | 'assistente';
}

class ContasAPagar {
  listar(f?: { de?: string; ate?: string; situacao?: SituacaoConta }): ContaAPagar[];   // por vencimento
  obter(id: string): ContaAPagar | null;
  criar(d: DadosContaAPagar): ContaAPagar;              // já roda a conciliação: pode nascer paga
  atualizar(id: string, parcial: Partial<DadosContaAPagar>): ContaAPagar;
  marcarPaga(id: string, p?: { movimentoId?: string | null; data?: string }): ContaAPagar;
  reabrir(id: string): ContaAPagar;
  remover(id: string): void;
  conciliar(): ContaAPagar[];                           // devolve as pagas agora
  aoMudar(cb: () => void): () => void;                  // devolve a função de cancelar
}
```

Seguido à risca. **Acréscimos** (nada foi mudado do contrato):

- `vencimentosDeCartao(): VencimentoDeCartao[]` — faturas a pagar (`{ contaId, cartao, mes, fechamento,
  vencimento, valor, situacao: 'ABERTA' | 'FECHADA' }`), para a Agenda pôr fechamento e vencimento do cartão.
- `candidatos(id): CandidatoAPagamento[]` — movimentos que podem ter pago a conta (ver abaixo).
- As rotas devolvem cada conta com um campo a mais, `movimento: { id, data, descricao, valor, conta } | null`
  (o débito que pagou, para a tela). O serviço devolve o `ContaAPagar` puro.

Comportamento:

- Erro de validação → `BadRequestException` (400) com mensagem em português (`"valor: o valor precisa ser
  maior que zero"`). Conta que não existe → `NaoEncontrado` (404). Validação no serviço: o Assistente chama
  direto, sem passar pela rota.
- `marcarPaga` com `movimentoId`: o movimento precisa existir, ser DESPESA e não ter pago outra conta; a data
  vira a do movimento (ou `data`, se vier). Sem nada: paga hoje. Marcar de novo troca o movimento/data.
- Conta que repete, ao ser paga (à mão ou pela conciliação), ganha **uma** ocorrência seguinte: mensal no
  mesmo dia (31 → 30/28 nos meses curtos, e volta ao 31 depois — o dia combinado fica em
  `dia_do_vencimento`); anual no mesmo dia do ano seguinte (29/02 → 28/02).
- `reabrir`: volta a aberta; o movimento que estava ligado vira **recusado** (a conciliação automática não
  o escolhe de novo; a pessoa ainda pode escolhê-lo à mão). A ocorrência seguinte gerada por aquele
  pagamento some se ainda estiver aberta e ninguém a editou.
- `aoMudar`: avisa depois de criar, editar, pagar, reabrir, remover e de toda conciliação que pagou algo.
  Junta mudanças seguidas num aviso só (150 ms). Ouvinte que lança erro não derruba os outros.

## Rotas (todas atrás da `Seguranca`; escrita com `X-Fluxo: 1`)

| Método | Caminho | Corpo / consulta |
|---|---|---|
| GET | `/api/contas-a-pagar` | `?de=AAAA-MM-DD&ate=AAAA-MM-DD&situacao=aberta\|paga\|atrasada` |
| POST | `/api/contas-a-pagar` | `DadosContaAPagar` → 201 |
| PATCH | `/api/contas-a-pagar/:id` | parcial |
| DELETE | `/api/contas-a-pagar/:id` | → 204 |
| POST | `/api/contas-a-pagar/:id/paga` | `{ movimentoId?, data? }` → 200 |
| POST | `/api/contas-a-pagar/:id/reabrir` | → 200 |
| GET | `/api/contas-a-pagar/:id/candidatos` | → `CandidatoAPagamento[]` |
| POST | `/api/contas-a-pagar/conciliar` | → as pagas agora (200) |
| GET | `/api/contas-a-pagar/faturas` | → `VencimentoDeCartao[]` (só leitura) |

## Conciliação: quando um débito paga a conta

Roda depois de toda sincronização que gravou dados (`Sincronizador.aoTerminar`), ao iniciar o servidor,
ao criar/editar uma conta, depois de um pagamento que gerou a ocorrência seguinte, e sob demanda.

Um movimento é candidato de uma conta aberta (ou atrasada) quando **tudo** vale:

1. **Natureza DESPESA** (e não ignorado: ignorar já transforma em transferência). Pagamento de fatura,
   transferência entre contas suas, investimento/caixinha, receita e estorno **nunca** pagam conta.
2. **Compra no cartão vale** (assinatura cobrada no cartão é conta paga). Movimento **pendente na conta**
   não vale (é agendamento, pode não acontecer); pendente no cartão vale (é compra real da fatura aberta).
3. **Valor** dentro de ±10% do valor da conta (arredondado para baixo). Contas **abaixo de R$ 10,00**
   exigem o valor **exato** — 10% de R$ 9,90 é troco, e assinatura pequena tem preço fixo.
4. **Data** entre `vencimento − 10 dias` e `vencimento + 15 dias`.
5. **Texto**: com `textoNoExtrato`, ele precisa estar contido em `descrição + estabelecimento +
   contraparte` do movimento, sem acento nem caixa (a mesma normalização de `porRegra` em
   `categorizacao.ts`). Sem `textoNoExtrato`, basta uma **palavra significativa** em comum com a descrição
   da conta (≥ 3 letras, não numérica, fora de uma lista de genéricas como "conta", "pagamento", "boleto",
   "fatura", "mensalidade", "pix"…). "Netflix" casa com "NETFLIX.COM"; "Conta de luz" não casa com nada
   — por isso o campo "Como aparece no extrato" ("ENEL").
6. Não está ligado a outra conta, e não foi recusado por esta (ver `reabrir`).

Liga automaticamente só quando **não há dúvida**: a conta tem um único candidato **e** esse movimento não é
candidato de nenhuma outra conta aberta. Dois ou mais → a conta fica aberta e a tela mostra os candidatos
(`GET /:id/candidatos`) para a pessoa escolher. A conta paga recebe `pagaEm` = data do movimento.

`candidatos` usa um modo **amplo** para a escolha à mão: texto **ou** valor, janela de ±30 dias, recusados
de volta, ordenados pelo mais provável (texto pesa mais que valor; depois o mais perto do vencimento), até
20. `forte: true` marca os que passam no critério estrito acima.

Se o banco trocar o id do movimento (a Pluggy às vezes troca), a conta continua paga; só o "pago com …"
some da tela.

## Alertas

Contas abertas entram em `gerarAlertas` (destino `/contas-a-pagar`, id `conta-a-pagar:<id>`):

- atrasada (vencimento < hoje): **CRITICO**, "<descrição> está atrasada", "R$ X · venceu há N dias (dd/mm)."
- vence hoje / amanhã / em 2–3 dias: **ATENCAO**, com "O saldo em conta não cobre." quando for o caso.

## Faturas do cartão

Não viram conta a pagar. `Financas.faturasAPagar()` pega as faturas do `visaoDoCartao` que estão
FECHADA com saldo a pagar (até 40 dias depois do vencimento; depois disso o saldo já rolou para a seguinte)
e a ABERTA. O fechamento vem da fatura do banco; sem ela, é estimado pelo ciclo do cartão (quantos dias
antes do vencimento ele fecha).
