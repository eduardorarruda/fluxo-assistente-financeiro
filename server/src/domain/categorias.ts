/**
 * As categorias do Fluxo. O `icone` é o nome de um ícone do conjunto próprio
 * do front (web/src/icons). A cor é escolhida para ser distinguível das
 * vizinhas no Sankey e nas barras, tanto no tema escuro quanto no claro.
 */
export type GrupoCategoria = 'DESPESA' | 'RECEITA';

export interface Categoria {
  id: string;
  nome: string;
  grupo: GrupoCategoria;
  cor: string;
  icone: string;
}

export const CATEGORIAS: readonly Categoria[] = [
  { id: 'moradia', nome: 'Moradia', grupo: 'DESPESA', cor: '#F59E0B', icone: 'casa' },
  { id: 'contas', nome: 'Contas da casa', grupo: 'DESPESA', cor: '#FBBF24', icone: 'raio' },
  { id: 'mercado', nome: 'Mercado', grupo: 'DESPESA', cor: '#34D399', icone: 'sacola' },
  { id: 'restaurantes', nome: 'Restaurantes', grupo: 'DESPESA', cor: '#FB923C', icone: 'talheres' },
  { id: 'delivery', nome: 'Delivery', grupo: 'DESPESA', cor: '#F87171', icone: 'moto' },
  { id: 'transporte', nome: 'Transporte', grupo: 'DESPESA', cor: '#60A5FA', icone: 'onibus' },
  { id: 'carro', nome: 'Carro e combustível', grupo: 'DESPESA', cor: '#38BDF8', icone: 'carro' },
  { id: 'saude', nome: 'Saúde', grupo: 'DESPESA', cor: '#2DD4BF', icone: 'coracao' },
  { id: 'educacao', nome: 'Educação', grupo: 'DESPESA', cor: '#A3E635', icone: 'livro' },
  { id: 'assinaturas', nome: 'Assinaturas', grupo: 'DESPESA', cor: '#C084FC', icone: 'play' },
  { id: 'lazer', nome: 'Lazer', grupo: 'DESPESA', cor: '#F472B6', icone: 'ingresso' },
  { id: 'compras', nome: 'Compras', grupo: 'DESPESA', cor: '#818CF8', icone: 'pacote' },
  { id: 'vestuario', nome: 'Roupas', grupo: 'DESPESA', cor: '#E879F9', icone: 'camiseta' },
  { id: 'viagem', nome: 'Viagens', grupo: 'DESPESA', cor: '#22D3EE', icone: 'aviao' },
  { id: 'pets', nome: 'Pets', grupo: 'DESPESA', cor: '#FDBA74', icone: 'pata' },
  { id: 'cuidados', nome: 'Cuidados pessoais', grupo: 'DESPESA', cor: '#FDA4AF', icone: 'gota' },
  { id: 'pix-enviado', nome: 'Pix e transferências', grupo: 'DESPESA', cor: '#94A3B8', icone: 'setas' },
  { id: 'dividas', nome: 'Empréstimos', grupo: 'DESPESA', cor: '#EF4444', icone: 'corrente' },
  { id: 'juros', nome: 'Juros e encargos', grupo: 'DESPESA', cor: '#DC2626', icone: 'porcento' },
  { id: 'taxas', nome: 'Impostos e taxas', grupo: 'DESPESA', cor: '#B91C1C', icone: 'recibo' },
  { id: 'presentes', nome: 'Presentes e doações', grupo: 'DESPESA', cor: '#FB7185', icone: 'presente' },
  { id: 'outros', nome: 'Outros gastos', grupo: 'DESPESA', cor: '#64748B', icone: 'pontos' },
  { id: 'salario', nome: 'Salário', grupo: 'RECEITA', cor: '#10B981', icone: 'maleta' },
  { id: 'renda-extra', nome: 'Renda extra', grupo: 'RECEITA', cor: '#14B8A6', icone: 'faisca' },
  { id: 'rendimentos', nome: 'Rendimentos', grupo: 'RECEITA', cor: '#EAB308', icone: 'broto' },
  { id: 'reembolsos', nome: 'Reembolsos', grupo: 'RECEITA', cor: '#06B6D4', icone: 'volta' },
  { id: 'pix-recebido', nome: 'Pix recebidos', grupo: 'RECEITA', cor: '#22C55E', icone: 'setas' },
  // Dinheiro emprestado entra como receita (as parcelas saem em "Empréstimos"); separado para não passar por renda.
  { id: 'emprestimo', nome: 'Empréstimo recebido', grupo: 'RECEITA', cor: '#F43F5E', icone: 'corrente' },
  { id: 'outras-receitas', nome: 'Outras entradas', grupo: 'RECEITA', cor: '#4ADE80', icone: 'pontos' },
];

export const CATEGORIA_POR_ID: ReadonlyMap<string, Categoria> = new Map(CATEGORIAS.map((c) => [c.id, c]));

export function categoriaExiste(id: string): boolean {
  return CATEGORIA_POR_ID.has(id);
}
