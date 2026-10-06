import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apagarAnexo, enviarAnexo } from '../../api/assistente';
import type { Anexo } from '../../api/tipos-assistente';
import { useAvisar } from '../../componentes/Avisos';
import { ehImagem, triarArquivos } from './regras-anexos';

export interface AnexoLocal {
  chave: string;
  nome: string;
  tamanho: number;
  previa: string | null;
  progresso: number;
  estado: 'enviando' | 'enviado' | 'falhou';
  anexo: Anexo | null;
  erro: string | null;
}

export interface ControleAnexos {
  itens: AnexoLocal[];
  enviando: boolean;
  idsProntos: string[];
  adicionar: (arquivos: File[]) => void;
  remover: (chave: string) => void;
  /** Depois de enviar a mensagem: os anexos agora pertencem a ela, só some da caixa. */
  esvaziar: () => void;
}

interface Opcoes {
  garantirConversa: () => Promise<string>;
  jaNaConversa: number;
}

let seq = 0;
const previaDe = (f: File) => (ehImagem(f) && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(f) : null);
const soltarPrevia = (i: AnexoLocal) => i.previa && typeof URL.revokeObjectURL === 'function' && URL.revokeObjectURL(i.previa);
const ehCancelamento = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

export function useAnexos({ garantirConversa, jaNaConversa }: Opcoes): ControleAnexos {
  const avisar = useAvisar();
  const [itens, setItens] = useState<AnexoLocal[]>([]);
  const itensRef = useRef<AnexoLocal[]>([]);
  const controles = useRef(new Map<string, AbortController>());
  itensRef.current = itens;

  const mudar = useCallback((chave: string, mudanca: Partial<AnexoLocal>) => {
    setItens((atual) => atual.map((i) => (i.chave === chave ? { ...i, ...mudanca } : i)));
  }, []);

  const subir = useCallback(
    async (conversaId: string, chave: string, arquivo: File) => {
      const controle = new AbortController();
      controles.current.set(chave, controle);
      try {
        const anexo = await enviarAnexo({ conversaId, arquivo, sinal: controle.signal, aoProgresso: (p) => mudar(chave, { progresso: p }) });
        mudar(chave, { estado: 'enviado', progresso: 1, anexo });
      } catch (e) {
        if (ehCancelamento(e)) return;
        const motivo = e instanceof Error ? e.message : 'falha desconhecida';
        mudar(chave, { estado: 'falhou', erro: motivo });
        avisar('erro', `Não deu para anexar “${arquivo.name}”: ${motivo}`);
      } finally {
        controles.current.delete(chave);
      }
    },
    [avisar, mudar],
  );

  const adicionar = useCallback(
    (arquivos: File[]) => {
      const ativos = itensRef.current.filter((i) => i.estado !== 'falhou').length;
      const { aceitos, erros } = triarArquivos(arquivos, jaNaConversa + ativos);
      for (const erro of erros) avisar('erro', erro);
      if (!aceitos.length) return;
      const novos = aceitos.map((arquivo) => ({
        arquivo,
        item: { chave: `anexo-${++seq}`, nome: arquivo.name, tamanho: arquivo.size, previa: previaDe(arquivo), progresso: 0, estado: 'enviando', anexo: null, erro: null } satisfies AnexoLocal,
      }));
      setItens((atual) => [...atual, ...novos.map((n) => n.item)]);
      garantirConversa().then(
        (conversaId) => novos.forEach((n) => void subir(conversaId, n.item.chave, n.arquivo)),
        (e: unknown) => {
          const motivo = e instanceof Error ? e.message : 'falha desconhecida';
          novos.forEach((n) => mudar(n.item.chave, { estado: 'falhou', erro: motivo }));
          avisar('erro', `Não deu para começar a conversa: ${motivo}`);
        },
      );
    },
    [avisar, garantirConversa, jaNaConversa, mudar, subir],
  );

  const remover = useCallback(
    (chave: string) => {
      const item = itensRef.current.find((i) => i.chave === chave);
      if (!item) return;
      controles.current.get(chave)?.abort();
      soltarPrevia(item);
      setItens((atual) => atual.filter((i) => i.chave !== chave));
      if (item.anexo) apagarAnexo(item.anexo.id).catch((e: unknown) => avisar('erro', e instanceof Error ? e.message : 'Não deu para remover o anexo.'));
    },
    [avisar],
  );

  const esvaziar = useCallback(() => {
    itensRef.current.forEach(soltarPrevia);
    setItens([]);
  }, []);

  useEffect(
    () => () => {
      controles.current.forEach((c) => c.abort());
      itensRef.current.forEach(soltarPrevia);
    },
    [],
  );

  return useMemo(
    () => ({
      itens,
      enviando: itens.some((i) => i.estado === 'enviando'),
      idsProntos: itens.flatMap((i) => (i.estado === 'enviado' && i.anexo ? [i.anexo.id] : [])),
      adicionar,
      remover,
      esvaziar,
    }),
    [itens, adicionar, remover, esvaziar],
  );
}
