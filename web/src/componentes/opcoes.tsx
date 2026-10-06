import type { Categoria } from '../api/tipos';
import { Icone } from '../icones/Icone';
import { nomeDoMes, somarMeses } from '../util/formato';
import type { OpcaoSeletor } from './Seletor';
import { CategoriaIcone } from './ui';

/** Opções prontas para o Seletor, usadas por mais de uma tela. */

const GRUPO: Record<Categoria['grupo'], string> = { DESPESA: 'Gastos', RECEITA: 'Receitas' };
const ANOS_DE_PRAZO = 10;

/** Categorias com o ícone e a cor delas, gastos antes das receitas. */
export function opcoesDeCategoria(categorias: readonly Categoria[]): OpcaoSeletor[] {
  const ordenadas = [...categorias].sort((a, b) => (a.grupo === b.grupo ? 0 : a.grupo === 'DESPESA' ? -1 : 1));
  return ordenadas.map((c) => ({ valor: c.id, rotulo: c.nome, grupo: GRUPO[c.grupo], icone: <CategoriaIcone categoria={c} tamanho={24} /> }));
}

const maiuscula = (texto: string) => texto.charAt(0).toUpperCase() + texto.slice(1);

/**
 * Prazo de uma meta: "Sem prazo" e os próximos dez anos, mês a mês, agrupados
 * por ano. Um prazo já vencido (meta antiga) continua aparecendo no topo.
 */
export function opcoesDePrazo(mesAtual: string, atual: string): OpcaoSeletor[] {
  const opcoes: OpcaoSeletor[] = [{ valor: '', rotulo: 'Sem prazo', icone: <Icone nome="relogio" tamanho={16} /> }];
  if (!mesAtual) return atual ? [...opcoes, { valor: atual, rotulo: maiuscula(nomeDoMes(atual)) }] : opcoes;
  if (atual && atual < mesAtual) opcoes.push({ valor: atual, rotulo: maiuscula(nomeDoMes(atual)), descricao: 'prazo que já passou' });
  for (let i = 0; i < ANOS_DE_PRAZO * 12; i++) {
    const mes = somarMeses(mesAtual, i);
    opcoes.push({ valor: mes, rotulo: maiuscula(nomeDoMes(mes)), grupo: mes.slice(0, 4) });
  }
  return opcoes;
}
