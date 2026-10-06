/**
 * As vozes naturais (Piper) que o Fluxo sabe baixar. A lista é FIXA: o endereço,
 * o tamanho e o SHA-256 de cada pacote estão aqui, e nada vindo da tela vira
 * URL — a tela só escolhe um `id` desta lista.
 *
 * Os pacotes são os da release `tts-models` do sherpa-onnx (k2-fsa), que trazem
 * o modelo Piper (VITS, ONNX), os `tokens.txt` e o `espeak-ng-data` (a fonética
 * do português) — tudo o que a síntese precisa, sem nada instalado no sistema.
 * Tamanhos e SHA-256 conferidos em 2026-10 contra a API de releases do GitHub.
 */

export type GeneroVoz = 'feminina' | 'masculina';
export type QualidadeVoz = 'média' | 'alta';

export interface VozDoCatalogo {
  id: string;
  nome: string;
  genero: GeneroVoz;
  qualidade: QualidadeVoz;
  /** Uma linha sobre como ela soa, para o cartão. */
  descricao: string;
  /** Licença do modelo, como o autor publicou. */
  licenca: string;
  /** Crédito a quem gravou/treinou, para mostrar junto. */
  credito: string;
  /** Uso só pessoal/não comercial (o cartão avisa). */
  naoComercial: boolean;
  url: string;
  bytes: number;
  sha256: string;
  /** Pasta de dentro do pacote (é tirada na extração). */
  raiz: string;
}

const RELEASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models';

const OHF = {
  licenca: 'Dados CC0 · ajustada a partir da voz lessac (dados de pesquisa)',
  credito: 'Open Home Foundation (piper-voices)',
  naoComercial: false,
} as const;

const TIGRE_GOTICO = {
  licenca: 'CC BY-NC-ND 4.0 (uso pessoal, não comercial)',
  credito: 'TigreGotico Lda · OpenVoiceOS',
  naoComercial: true,
} as const;

export const CATALOGO_DE_VOZES: readonly VozDoCatalogo[] = [
  {
    id: 'faber',
    nome: 'Faber',
    genero: 'masculina',
    qualidade: 'média',
    descricao: 'Clara e calma. A mais natural das vozes oficiais do Piper em português do Brasil.',
    ...OHF,
    url: `${RELEASE}/vits-piper-pt_BR-faber-medium.tar.bz2`,
    bytes: 67_183_065,
    sha256: '7add3f923ad6bc25ca8a192805fd1a64d1b3893e4611c4a9719545a825039a83',
    raiz: 'vits-piper-pt_BR-faber-medium',
  },
  {
    id: 'dii',
    nome: 'Dii',
    genero: 'feminina',
    qualidade: 'alta',
    descricao: 'Feminina, expressiva. Modelo maior: começa a falar um pouco depois.',
    ...TIGRE_GOTICO,
    url: `${RELEASE}/vits-piper-pt_BR-dii-high.tar.bz2`,
    bytes: 67_238_016,
    sha256: '76bdf009bb29e69b12336de833d0d219ffa558f4281330eb141e4a0569c108a2',
    raiz: 'vits-piper-pt_BR-dii-high',
  },
  {
    id: 'cadu',
    nome: 'Cadu',
    genero: 'masculina',
    qualidade: 'média',
    descricao: 'Grave e firme.',
    ...OHF,
    url: `${RELEASE}/vits-piper-pt_BR-cadu-medium.tar.bz2`,
    bytes: 67_207_562,
    sha256: 'aba78157d4b89acc17ddef15a70f4b2474f4c189d4de6035002ac7fec9d5d303',
    raiz: 'vits-piper-pt_BR-cadu-medium',
  },
  {
    id: 'jeff',
    nome: 'Jeff',
    genero: 'masculina',
    qualidade: 'média',
    descricao: 'Jovem e leve.',
    ...OHF,
    url: `${RELEASE}/vits-piper-pt_BR-jeff-medium.tar.bz2`,
    bytes: 67_207_052,
    sha256: 'da4c870fc7b20600c74261b3e1dd1c816da2ce063e18c46e1f2cd86dea88f3f0',
    raiz: 'vits-piper-pt_BR-jeff-medium',
  },
  {
    id: 'miro',
    nome: 'Miro',
    genero: 'masculina',
    qualidade: 'alta',
    descricao: 'Masculina, expressiva. Modelo maior: começa a falar um pouco depois.',
    ...TIGRE_GOTICO,
    url: `${RELEASE}/vits-piper-pt_BR-miro-high.tar.bz2`,
    bytes: 67_207_707,
    sha256: '7f30d1c3421362a60381807543aeafd7e1cd0acbcb92c349a29908526c6f4e6f',
    raiz: 'vits-piper-pt_BR-miro-high',
  },
];

export const VOZ_PADRAO = 'faber';

export const IDS_DE_VOZ = CATALOGO_DE_VOZES.map((v) => v.id) as [string, ...string[]];

export function vozDoCatalogo(id: string): VozDoCatalogo | undefined {
  return CATALOGO_DE_VOZES.find((v) => v.id === id);
}
