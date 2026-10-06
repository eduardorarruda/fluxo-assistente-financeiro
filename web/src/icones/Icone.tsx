import type { CSSProperties } from 'react';
import { DESENHOS } from './desenhos';

interface Props {
  nome: string;
  tamanho?: number;
  traco?: number;
  titulo?: string;
  className?: string;
  style?: CSSProperties;
}

/** Ícone do conjunto próprio. Decorativo por padrão; com `titulo`, é anunciado ao leitor de tela. */
export function Icone({ nome, tamanho = 20, traco = 1.75, titulo, className, style }: Props) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={tamanho}
      height={tamanho}
      fill="none"
      stroke="currentColor"
      strokeWidth={traco}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={titulo ? undefined : true}
      role={titulo ? 'img' : undefined}
      className={className}
      style={style}
    >
      {titulo && <title>{titulo}</title>}
      {DESENHOS[nome] ?? DESENHOS.pontos}
    </svg>
  );
}
