import type { ContaIA, ProvedorIA } from '../../api/tipos-assistente';

/** As mesmas regras do servidor para o nome do modelo: letras, números, `. _ - : / @`, sem começar com `-`. */
const MODELO_VALIDO = /^[A-Za-z0-9][\w.:/@-]*$/;
export const LIMITE_MODELO = 100;

/** Nome livre de modelo: devolve o motivo da recusa, ou null se está bom. */
export function problemaNoModelo(modelo: string): string | null {
  const m = modelo.trim();
  if (!m) return 'Escreva o nome do modelo.';
  if (m.length > LIMITE_MODELO) return `No máximo ${LIMITE_MODELO} caracteres.`;
  if (!MODELO_VALIDO.test(m)) return 'Use só letras, números e . _ - : / @ (sem espaço; começa com letra ou número).';
  return null;
}

/** A pasta de login precisa ser caminho absoluto (o servidor recusa o resto). */
export const pastaValida = (pasta: string) => pasta.trim() === '' || /^(\/|[A-Za-z]:[\\/])/.test(pasta.trim());

/** "Claude trabalho" → "claude-trabalho" (sem acento, só letras, números e hífen). */
export function slug(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Pasta sugerida para a conta nova: `<base>/<provedor>-<slug do nome>`. */
export function sugerirPasta(base: string, provedor: ProvedorIA, nome: string): string {
  const s = slug(nome);
  const raiz = base.replace(/[\\/]+$/, '');
  // "Claude 2" → claude-2 (sem repetir o CLI quando o nome já começa com ele).
  const nomeDaPasta = !s ? provedor : s.startsWith(provedor) ? s : `${provedor}-${s}`;
  return `${raiz}/${nomeDaPasta}`;
}

const usadosEm = (contas: ContaIA[]) => new Set(contas.map((c) => c.nome.trim().toLowerCase()));

/** Primeiro nome livre na sequência "Claude 2", "Claude 3"… */
export function sugerirNome(base: string, contas: ContaIA[]): string {
  const usados = usadosEm(contas);
  for (let n = 2; ; n += 1) {
    const nome = `${base} ${n}`;
    if (!usados.has(nome.toLowerCase())) return nome;
  }
}

/** O próprio nome se estiver livre ("Claude (API)"); senão "Claude (API) 2", "… 3"… */
export function sugerirNomeLivre(base: string, contas: ContaIA[]): string {
  return usadosEm(contas).has(base.toLowerCase()) ? sugerirNome(base, contas) : base;
}

/** Nome de conta: obrigatório e sem repetir outro (sem diferenciar maiúsculas). */
export function problemaNoNome(nome: string, contas: ContaIA[], ignorarId?: string): string | null {
  const n = nome.trim().toLowerCase();
  if (!n) return 'Dê um nome para a conta.';
  if (contas.some((c) => c.id !== ignorarId && c.nome.trim().toLowerCase() === n)) return 'Já existe uma conta com esse nome.';
  return null;
}

/** As mesmas regras do servidor para a chave de API, depois de aparada: 20–300 caracteres ASCII visíveis, sem espaço. */
export const LIMITE_CHAVE = { min: 20, max: 300 } as const;
const CHAVE_VALIDA = /^[\x21-\x7E]+$/;

/** Chave de API: devolve o motivo da recusa (em linguagem de gente), ou null se está boa. */
export function problemaNaChave(chave: string): string | null {
  const c = chave.trim();
  if (!c) return 'Cole a chave da API.';
  if (/\s/.test(c)) return 'A chave não tem espaços nem quebras de linha. Copie de novo, inteira.';
  if (!CHAVE_VALIDA.test(c)) return 'A chave só tem letras sem acento, números e símbolos simples. Copie de novo do site do provedor.';
  if (c.length < LIMITE_CHAVE.min) return `Curta demais: a chave tem pelo menos ${LIMITE_CHAVE.min} caracteres. Copie a chave inteira.`;
  if (c.length > LIMITE_CHAVE.max) return `Longa demais: no máximo ${LIMITE_CHAVE.max} caracteres.`;
  return null;
}

/** Conta conectada por chave de API (servidor antigo, sem `tipo`, só tinha CLI). */
export const ehApi = (c: Pick<ContaIA, 'tipo'> | undefined | null) => c?.tipo === 'api';

export const contaPronta = (c: ContaIA) => c.ativo && c.instalado;
