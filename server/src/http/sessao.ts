import { Logger } from '@nestjs/common';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const COOKIE_SESSAO = 'fluxo_sessao';
export const CABECALHO_SESSAO = 'x-fluxo-sessao';

function aleatorio(): string {
  return randomBytes(32).toString('base64url');
}

function igual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function gravarPrivado(caminho: string, conteudo: string): void {
  writeFileSync(caminho, conteudo, { mode: 0o600 });
  chmodSync(caminho, 0o600); // se o arquivo já existia com outra permissão
}

/**
 * Quem pode falar com a API. Além do Host/Origin (que só barram navegadores),
 * toda chamada precisa do token da sessão — assim outro programa desta máquina
 * (um app em sandbox, um container na rede do host) não lê o extrato.
 *
 * - O token mora em `data/.sessao` (0600) e vira cookie HttpOnly/SameSite=Strict.
 * - O atalho do menu entra por `/entrar?c=<código>`: o código é de uso único,
 *   fica em `data/.entrada` (0600) e é trocado a cada uso.
 * - Em desenvolvimento o proxy do Vite lê `data/.sessao` e manda no cabeçalho.
 */
export class Sessao {
  private readonly log = new Logger('Sessao');
  readonly token: string;
  private codigo: string;

  constructor(private readonly pasta: string | null, tokenFixo?: string) {
    this.token = tokenFixo || this.lerOuCriarToken();
    this.codigo = aleatorio();
    this.gravarCodigo();
  }

  private lerOuCriarToken(): string {
    if (!this.pasta) return aleatorio();
    const arquivo = join(this.pasta, '.sessao');
    if (existsSync(arquivo)) {
      const salvo = readFileSync(arquivo, 'utf8').trim();
      if (salvo.length >= 32) {
        chmodSync(arquivo, 0o600);
        return salvo;
      }
    }
    const novo = aleatorio();
    gravarPrivado(arquivo, novo);
    return novo;
  }

  private gravarCodigo(): void {
    if (!this.pasta) return;
    try {
      gravarPrivado(join(this.pasta, '.entrada'), this.codigo);
    } catch (e) {
      this.log.warn(`Não consegui gravar o código de entrada: ${(e as Error).message}`);
    }
  }

  /** Troca o código de uso único pelo direito de receber o cookie. */
  usarCodigo(recebido: unknown): boolean {
    if (typeof recebido !== 'string' || !igual(recebido, this.codigo)) return false;
    this.codigo = aleatorio();
    this.gravarCodigo();
    return true;
  }

  /** Só para os testes, que não têm pasta de dados. */
  codigoAtual(): string {
    return this.codigo;
  }

  valida(recebido: string | undefined): boolean {
    return typeof recebido === 'string' && igual(recebido, this.token);
  }
}

/** Lê um cookie do cabeçalho sem precisar de biblioteca. */
export function lerCookie(cabecalho: string | undefined, nome: string): string | undefined {
  for (const parte of (cabecalho ?? '').split(';')) {
    const [chave, ...valor] = parte.trim().split('=');
    if (chave === nome) return decodeURIComponent(valor.join('='));
  }
  return undefined;
}
