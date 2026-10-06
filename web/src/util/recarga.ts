/**
 * Cada compilação troca o nome dos arquivos das telas. Uma janela aberta antes dela ainda pede
 * os nomes antigos e a tela não carrega. Esses são os jeitos como os navegadores contam isso.
 */
const SINAIS_DE_VERSAO_VELHA = [
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /error loading dynamically imported module/i,
  /module script.*MIME type/i,
  /Unable to preload CSS/i,
];

const CHAVE = 'fluxo:recarregou-em';
const JANELA_SEM_REPETIR_MS = 30_000;

export function ehFalhaDeCarregamento(erro: unknown): boolean {
  const mensagem = erro instanceof Error ? erro.message : '';
  return SINAIS_DE_VERSAO_VELHA.some((sinal) => sinal.test(mensagem));
}

interface Recarga {
  agora?: number;
  armazenamento?: Pick<Storage, 'getItem' | 'setItem'>;
  recarregar?: () => void;
}

/**
 * Recarrega a página para pegar a versão nova — mas só uma vez a cada 30 s, para um arquivo
 * que realmente sumiu não virar um laço de recargas. Devolve se recarregou.
 */
export function recarregarUmaVez({
  agora = Date.now(),
  armazenamento,
  recarregar = () => location.reload(),
}: Recarga = {}): boolean {
  try {
    // Dentro do try: com o armazenamento bloqueado, só ler `sessionStorage` já lança.
    const sessao = armazenamento ?? sessionStorage;
    const ultima = sessao.getItem(CHAVE);
    if (ultima !== null && agora - Number(ultima) < JANELA_SEM_REPETIR_MS) return false;
    sessao.setItem(CHAVE, String(agora));
  } catch {
    // Sem sessionStorage (janela privada, bloqueio): recarrega mesmo assim.
  }
  recarregar();
  return true;
}
