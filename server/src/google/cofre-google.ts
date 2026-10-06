import { Logger } from '@nestjs/common';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { gravarChavePrivada } from '../assistente/chaves/arquivo-privado';

/**
 * Tudo que o Fluxo guarda sobre o Google Agenda mora em `<pasta de dados>/google/`
 * (pasta 0700, arquivos 0600, gravação atômica): nunca no banco, nunca numa
 * resposta da API, nunca no log.
 *
 * - `cliente.json`  — o client ID e o client secret do app que a pessoa criou no Google Cloud.
 * - `token.json`    — o refresh token (o que mantém a conexão) e o e-mail da conta.
 * - `estado.json`   — id da agenda "Fluxo", última sincronização, erro e preferências (não é segredo, mas fica junto).
 * - `eventos.json`  — chave estável de cada item → id do evento no Google + hash do conteúdo.
 */

/** "123456789012-abc…xyz.apps.googleusercontent.com" — o formato que o Google entrega desde sempre. */
export const FORMATO_CLIENT_ID = /^\d{6,30}-[a-z0-9]{10,64}\.apps\.googleusercontent\.com$/;
/** "GOCSPX-…" hoje; formato frouxo (só caracteres de segredo), porque o Google já mudou antes. */
export const FORMATO_CLIENT_SECRET = /^[A-Za-z0-9_-]{10,100}$/;

export const HORAS_DE_LEMBRETE = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21] as const;
export const DIAS_DE_ANTECEDENCIA = [1, 2, 3, 5, 7] as const;

const esquemaCliente = z.object({
  clientId: z.string().regex(FORMATO_CLIENT_ID),
  clientSecret: z.string().regex(FORMATO_CLIENT_SECRET),
});

const esquemaToken = z.object({
  refreshToken: z.string().min(10).max(2048),
  email: z.string().max(320).nullable(),
  escopos: z.array(z.string().max(200)).max(20),
  conectadoEm: z.string(),
});

export const esquemaPreferencias = z.object({
  /** Fechamento e vencimento da fatura de cada cartão. */
  cartao: z.boolean(),
  /** Contas a pagar cadastradas no Fluxo. */
  contas: z.boolean(),
  /** Um evento com aviso no dia seguinte ao vencimento (e em cada dia depois) enquanto não for paga. */
  atrasos: z.boolean(),
  /** Hora dos lembretes (e dos alertas de atraso). */
  hora: z.number().int().refine((h) => (HORAS_DE_LEMBRETE as readonly number[]).includes(h), 'hora inválida'),
  /** Quantos dias antes do vencimento avisar, às `hora` horas. */
  antecedencias: z.array(z.number().int().refine((d) => (DIAS_DE_ANTECEDENCIA as readonly number[]).includes(d), 'antecedência inválida')).max(DIAS_DE_ANTECEDENCIA.length),
});

const esquemaEstado = z.object({
  agendaId: z.string().max(300).nullable(),
  ultimaSincronizacao: z.string().nullable(),
  ultimaReconciliacao: z.string().nullable(),
  erro: z.string().max(500).nullable(),
  precisaReconectar: z.boolean(),
  preferencias: esquemaPreferencias,
});

const esquemaMapa = z.record(z.string().max(300), z.object({ id: z.string().max(1024), hash: z.string().max(64) }));

export type ClienteOAuth = z.infer<typeof esquemaCliente>;
export type TokenGoogle = z.infer<typeof esquemaToken>;
export type PreferenciasGoogle = z.infer<typeof esquemaPreferencias>;
export type EstadoGoogle = z.infer<typeof esquemaEstado>;
export type MapaDeEventos = z.infer<typeof esquemaMapa>;

/**
 * Padrão: tudo ligado, lembretes 2 dias antes e na véspera, às 9h. Evento de
 * dia inteiro só aceita lembrete ANTES da meia-noite em que ele começa (o
 * Google limita os minutos a 0…40320), então "no dia, às 9h" não existe —
 * quem cobre o dia seguinte ao vencimento é o alerta de atraso.
 */
export const PREFERENCIAS_PADRAO: PreferenciasGoogle = { cartao: true, contas: true, atrasos: true, hora: 9, antecedencias: [2, 1] };

export const ESTADO_INICIAL: EstadoGoogle = {
  agendaId: null,
  ultimaSincronizacao: null,
  ultimaReconciliacao: null,
  erro: null,
  precisaReconectar: false,
  preferencias: PREFERENCIAS_PADRAO,
};

const ARQUIVOS = { cliente: 'cliente.json', token: 'token.json', estado: 'estado.json', eventos: 'eventos.json' } as const;

export class CofreGoogle {
  private readonly log = new Logger('CofreGoogle');

  constructor(readonly pasta: string) {}

  /** Lê e valida; arquivo ausente ou adulterado conta como vazio. Nunca registra o conteúdo, só o motivo. */
  private ler<T>(arquivo: string, esquema: z.ZodType<T>): T | null {
    let texto: string;
    try {
      texto = readFileSync(join(this.pasta, arquivo), 'utf8');
    } catch (e) {
      const codigo = (e as NodeJS.ErrnoException).code;
      if (codigo !== 'ENOENT') this.log.warn(`Não consegui ler ${arquivo} (${codigo ?? 'erro'}).`);
      return null;
    }
    try {
      const r = esquema.safeParse(JSON.parse(texto));
      if (r.success) return r.data;
    } catch {
      // cai no aviso abaixo
    }
    this.log.warn(`${arquivo} está num formato que o Fluxo não reconhece; foi ignorado.`);
    return null;
  }

  private gravar(arquivo: string, valor: unknown): void {
    gravarChavePrivada(this.pasta, arquivo, JSON.stringify(valor));
  }

  private remover(arquivo: string): void {
    rmSync(join(this.pasta, arquivo), { force: true });
  }

  cliente(): ClienteOAuth | null {
    return this.ler(ARQUIVOS.cliente, esquemaCliente);
  }

  salvarCliente(cliente: ClienteOAuth): void {
    this.gravar(ARQUIVOS.cliente, esquemaCliente.parse(cliente));
  }

  removerCliente(): void {
    this.remover(ARQUIVOS.cliente);
  }

  token(): TokenGoogle | null {
    return this.ler(ARQUIVOS.token, esquemaToken);
  }

  salvarToken(token: TokenGoogle): void {
    this.gravar(ARQUIVOS.token, esquemaToken.parse(token));
  }

  removerToken(): void {
    this.remover(ARQUIVOS.token);
  }

  estado(): EstadoGoogle {
    return this.ler(ARQUIVOS.estado, esquemaEstado) ?? ESTADO_INICIAL;
  }

  /** Mescla e grava; devolve o estado novo. */
  mudarEstado(mudanca: Partial<EstadoGoogle>): EstadoGoogle {
    const novo = { ...this.estado(), ...mudanca };
    this.gravar(ARQUIVOS.estado, esquemaEstado.parse(novo));
    return novo;
  }

  eventos(): MapaDeEventos {
    return this.ler(ARQUIVOS.eventos, esquemaMapa) ?? {};
  }

  salvarEventos(mapa: MapaDeEventos): void {
    this.gravar(ARQUIVOS.eventos, mapa);
  }

  /** Desconectar: some o token, o mapa e o estado da conta; ficam o cliente e as preferências. */
  esquecerConta(): void {
    const { preferencias } = this.estado();
    this.removerToken();
    this.remover(ARQUIVOS.eventos);
    this.mudarEstado({ ...ESTADO_INICIAL, preferencias });
  }
}
