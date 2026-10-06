import { AnimatePresence, motion } from 'motion/react';
import { type DragEvent, useCallback, useEffect, useRef, useState } from 'react';
import {
  useCancelarExecucao, useConversa, useCriarConversa, useEnviarMensagem, useMudarConversa, useRepetirMensagem,
} from '../../api/assistente';
import { ErroApi } from '../../api/cliente';
import { useEventosExecucao } from '../../api/eventos-execucao';
import type { ConfigAssistente } from '../../api/tipos-assistente';
import { useAvisar } from '../../componentes/Avisos';
import { Botao, Esqueleto, Vazio } from '../../componentes/ui';
import { Icone } from '../../icones/Icone';
import { Cabecalho } from './Cabecalho';
import { Compositor } from './Compositor';
import { ListaMensagens } from './ListaMensagens';
import type { Escolha } from './SeletorConta';
import { useAnexos } from './useAnexos';
import { BoasVindas, SemCli } from './Vazios';
import { ModoConversa } from './voz/ModoConversa';
import type { ResultadoEnvioVoz } from './voz/useConversaPorVoz';

const mensagemDe = (e: unknown) => (e instanceof Error ? e.message : 'Algo deu errado.');

interface Props {
  conversaId: string | undefined;
  config: ConfigAssistente;
  aoCriada: (id: string) => void;
  aoNova: () => void;
  listaAberta: boolean;
  aoAlternarLista: () => void;
}

/** Arrastar arquivos para cima da conversa anexa (o contador evita piscar ao passar por filhos). */
function useSoltarArquivos(aoSoltar: (arquivos: File[]) => void) {
  const [arrastando, setArrastando] = useState(false);
  const contador = useRef(0);
  const temArquivos = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
  return {
    arrastando,
    eventos: {
      onDragEnter: (e: DragEvent) => {
        if (!temArquivos(e)) return;
        e.preventDefault();
        contador.current += 1;
        setArrastando(true);
      },
      onDragOver: (e: DragEvent) => {
        if (!temArquivos(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      },
      onDragLeave: (e: DragEvent) => {
        if (!temArquivos(e)) return;
        contador.current = Math.max(0, contador.current - 1);
        if (contador.current === 0) setArrastando(false);
      },
      onDrop: (e: DragEvent) => {
        if (!temArquivos(e)) return;
        e.preventDefault();
        contador.current = 0;
        setArrastando(false);
        aoSoltar(Array.from(e.dataTransfer.files));
      },
    },
  };
}

export function PainelConversa({ conversaId, config, aoCriada, aoNova, listaAberta, aoAlternarLista }: Props) {
  const avisar = useAvisar();
  const consulta = useConversa(conversaId);
  const conversa = consulta.data;
  useEventosExecucao(conversaId, conversa?.execucaoAtiva);

  const criar = useCriarConversa();
  const enviar = useEnviarMensagem();
  const cancelar = useCancelarExecucao();
  const repetir = useRepetirMensagem();
  const mudar = useMudarConversa();

  const [escolhaNova, setEscolhaNova] = useState<Escolha | null>(() => (config.contaPadrao ? { contaId: config.contaPadrao, modelo: null } : null));
  const idRef = useRef(conversaId);
  idRef.current = conversaId ?? idRef.current;
  const criacao = useRef<Promise<string> | null>(null);
  // A pessoa pode abrir outra conversa antes do POST voltar: aí o resultado não pode mais navegar.
  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const garantirConversa = useCallback(async (): Promise<string> => {
    if (idRef.current) return idRef.current;
    criacao.current ??= criar
      .mutateAsync({ contaId: escolhaNova?.contaId, modelo: escolhaNova?.modelo ?? null })
      .then((r) => {
        idRef.current = r.id;
        if (montado.current) aoCriada(r.id);
        return r.id;
      })
      .catch((e: unknown) => {
        criacao.current = null;
        throw e;
      });
    return criacao.current;
  }, [aoCriada, criar, escolhaNova]);

  const jaNaConversa = conversa?.mensagens.reduce((n, m) => n + m.anexos.length, 0) ?? 0;
  const anexos = useAnexos({ garantirConversa, jaNaConversa });
  const soltar = useSoltarArquivos(anexos.adicionar);

  const execucao = conversa?.execucaoAtiva ?? null;
  const semCli = config.contaPadrao === null;
  const escolha: Escolha | null = conversa ? { contaId: conversa.contaId, modelo: conversa.modelo } : escolhaNova;
  // A primeira mensagem leva a escolha junto: vale para a conversa que acabou de nascer.
  const primeira = (conversa?.mensagens.length ?? 0) === 0;

  const aoEnviar = async (texto: string): Promise<boolean> => {
    try {
      const id = await garantirConversa();
      const quem = primeira && escolha ? { contaId: escolha.contaId, modelo: escolha.modelo } : {};
      await enviar.mutateAsync({ conversaId: id, texto, anexos: anexos.idsProntos, ...quem });
      anexos.esvaziar();
      return true;
    } catch (e) {
      avisar('erro', e instanceof ErroApi && e.status === 409 ? 'Ainda há uma resposta em andamento nesta conversa.' : mensagemDe(e));
      return false;
    }
  };

  // Modo conversação: a mensagem falada vai pela mesma API, com `voz: true` (resposta curta e falável).
  const [vozAberta, setVozAberta] = useState(false);
  const aoEnviarVoz = async (texto: string): Promise<ResultadoEnvioVoz> => {
    try {
      const id = await garantirConversa();
      const quem = primeira && escolha ? { contaId: escolha.contaId, modelo: escolha.modelo } : {};
      const r = await enviar.mutateAsync({ conversaId: id, texto, anexos: [], voz: true, ...quem });
      return { execucaoId: r.execucaoId, respostaId: r.assistente.id };
    } catch (e) {
      return { erro: e instanceof ErroApi && e.status === 409 ? 'Ainda há uma resposta em andamento nesta conversa.' : mensagemDe(e) };
    }
  };
  const aoCancelarVoz = (execucaoId: string) => cancelar.mutate(execucaoId, { onError: (e) => avisar('erro', mensagemDe(e)) });
  const fecharVoz = useCallback(() => setVozAberta(false), []);
  const contaEscolhida = escolha ? config.contas.find((c) => c.id === escolha.contaId) : undefined;
  const quemResponde = contaEscolhida ? [contaEscolhida.nome, escolha?.modelo ?? contaEscolhida.modelo].filter(Boolean).join(' · ') : null;

  const aoParar = () => execucao && cancelar.mutate(execucao, { onError: (e) => avisar('erro', mensagemDe(e)) });
  const aoRepetir = (mensagemId: string) =>
    conversaId && repetir.mutate({ conversaId, mensagemId }, { onError: (e) => avisar('erro', mensagemDe(e)) });

  const aoEscolher = (e: Escolha) => {
    if (!conversaId) return setEscolhaNova(e);
    mudar.mutate({ conversaId, contaId: e.contaId, modelo: e.modelo }, { onError: (erro) => avisar('erro', mensagemDe(erro)) });
  };

  if (conversaId && consulta.isError && !conversa) {
    const sumiu = consulta.error instanceof ErroApi && consulta.error.status === 404;
    return (
      <section className="chat">
        <Vazio
          icone={sumiu ? 'busca' : 'alerta'}
          titulo={sumiu ? 'Conversa não encontrada' : 'Não deu para abrir a conversa'}
          texto={sumiu ? 'Ela pode ter sido excluída.' : mensagemDe(consulta.error)}
          acao={<Botao variante="primario" icone="nova-conversa" onClick={aoNova}>Nova conversa</Botao>}
        />
      </section>
    );
  }

  const carregando = Boolean(conversaId) && !conversa;
  const mensagens = conversa?.mensagens ?? [];
  return (
    <section className="chat" aria-label="Conversa" {...soltar.eventos}>
      <Cabecalho
        titulo={conversa?.titulo ?? 'Nova conversa'}
        podeRenomear={Boolean(conversa)}
        aoRenomear={(titulo) => conversaId && mudar.mutate({ conversaId, titulo }, { onError: (e) => avisar('erro', mensagemDe(e)) })}
        seletor={escolha && !semCli ? { contas: config.contas, provedores: config.provedores, escolha, aoMudar: aoEscolher, desabilitado: Boolean(execucao) || mudar.isPending } : null}
        listaAberta={listaAberta}
        aoAlternarLista={aoAlternarLista}
      />
      {carregando ? (
        <div className="chat__carregando" aria-label="Carregando conversa">
          <Esqueleto altura={44} largura="60%" raio={16} />
          <Esqueleto altura={120} raio={16} />
          <Esqueleto altura={44} largura="45%" raio={16} />
        </div>
      ) : mensagens.length === 0 ? (
        <div className="chat__vazio">
          <BoasVindas aoEscolher={(t) => void aoEnviar(t)} desabilitado={semCli || anexos.enviando || enviar.isPending || criar.isPending} />
        </div>
      ) : (
        <ListaMensagens conversaId={conversaId ?? ''} mensagens={mensagens} aoRepetir={aoRepetir} repetindo={repetir.isPending} />
      )}
      <div className="chat__rodape">
        {semCli ? (
          <SemCli />
        ) : (
          <Compositor
            anexos={anexos}
            gerando={Boolean(execucao)}
            enviando={enviar.isPending || criar.isPending}
            parando={cancelar.isPending}
            aoEnviar={aoEnviar}
            aoParar={aoParar}
            aoConversar={() => setVozAberta(true)}
            vozAberta={vozAberta}
          />
        )}
      </div>
      <AnimatePresence>
        {vozAberta && !semCli && (
          <ModoConversa conversa={conversa} quemResponde={quemResponde} aoEnviar={aoEnviarVoz} aoCancelar={aoCancelarVoz} aoFechar={fecharVoz} />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {soltar.arrastando && !semCli && (
          <motion.div className="chat__soltar" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
            <div className="chat__soltar-caixa">
              <Icone nome="clipe" tamanho={26} />
              <strong>Solte para anexar</strong>
              <span>Imagem, PDF, TXT, MD, CSV, OFX ou JSON · até 15 MB</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
