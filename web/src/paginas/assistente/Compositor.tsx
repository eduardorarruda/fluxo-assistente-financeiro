import { AnimatePresence, motion } from 'motion/react';
import { type ClipboardEvent, type FormEvent, type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icone } from '../../icones/Icone';
import { ACEITOS, ehImagem, tamanhoLegivel } from './regras-anexos';
import type { AnexoLocal, ControleAnexos } from './useAnexos';
import { BotaoConversa, BotaoDitado, OndaMini } from './voz/BotoesVoz';
import { type ControleDitado, useDitado } from './voz/useDitado';

/** Altura máxima da caixa (≈10 linhas); passou disso, ela rola. */
const ALTURA_MAX = 240;

function legendaAnexo(i: AnexoLocal): string {
  if (i.estado === 'enviando') return `Enviando… ${Math.round(i.progresso * 100)}%`;
  if (i.estado === 'falhou') return i.erro ?? 'Falhou';
  switch (i.anexo?.situacao) {
    case 'pendente':
    case 'indexando':
      return 'Lendo o arquivo…';
    case 'sem_texto':
      return 'Sem texto: vai como arquivo';
    case 'erro':
      return i.anexo.erro ?? 'Não deu para ler';
    default:
      return tamanhoLegivel(i.tamanho);
  }
}

function ChipEnvio({ item, aoRemover }: { item: AnexoLocal; aoRemover: () => void }) {
  const ruim = item.estado === 'falhou' || item.anexo?.situacao === 'erro';
  return (
    <motion.li
      layout
      className={`anexo-envio ${ruim ? 'anexo-envio--erro' : ''}`}
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.92 }}
      transition={{ duration: 0.15 }}
    >
      {item.previa ? (
        <img className="anexo-envio__previa" src={item.previa} alt="" />
      ) : (
        <span className="anexo-envio__icone"><Icone nome={ehImagem({ type: '', name: item.nome }) ? 'imagem' : 'arquivo'} tamanho={16} /></span>
      )}
      <span className="anexo-envio__texto">
        <span className="anexo-envio__nome" title={item.nome}>{item.nome}</span>
        <span className="anexo-envio__sub" role={ruim ? 'alert' : undefined}>{legendaAnexo(item)}</span>
      </span>
      {item.estado === 'enviando' && (
        <span className="anexo-envio__progresso" role="progressbar" aria-label={`Enviando ${item.nome}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(item.progresso * 100)}>
          <span style={{ transform: `scaleX(${item.progresso})` }} />
        </span>
      )}
      <button type="button" className="anexo-envio__remover" onClick={aoRemover} aria-label={`Remover ${item.nome}`} title="Remover">
        <Icone nome="fechar" tamanho={13} traco={2.2} />
      </button>
    </motion.li>
  );
}

interface Props {
  anexos: ControleAnexos;
  /** Há uma resposta sendo gerada: o botão vira "Parar". */
  gerando: boolean;
  enviando: boolean;
  parando: boolean;
  aoEnviar: (texto: string) => Promise<boolean>;
  aoParar: () => void;
  /** Abre o modo conversação por voz (sem isto, o botão não aparece). */
  aoConversar?: () => void;
  /** O modo conversação está aberto por cima: os atalhos de voz daqui ficam quietos. */
  vozAberta?: boolean;
}

/** A caixa cresce com o texto até ≈10 linhas; passou disso, rola. */
function ajustarAltura(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, ALTURA_MAX)}px`;
  el.style.overflowY = el.scrollHeight > ALTURA_MAX ? 'auto' : 'hidden';
}

/** Alt+M liga/desliga o ditado; Alt+V abre o modo conversação. Valem até dentro da caixa de texto. */
function useAtalhosDeVoz(ditado: ControleDitado, aoConversar: (() => void) | undefined, quieto: boolean) {
  useEffect(() => {
    if (quieto) return;
    const tecla = (e: globalThis.KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      // Pela posição da tecla (vale em qualquer layout); sem `code` (teclado virtual), pela letra.
      const qual = e.code || `Key${e.key.toUpperCase()}`;
      if (qual === 'KeyM') {
        e.preventDefault();
        ditado.alternar();
      } else if (qual === 'KeyV' && aoConversar) {
        e.preventDefault();
        ditado.soltar();
        aoConversar();
      }
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [ditado, aoConversar, quieto]);
}

/** Erro do ditado (permissão, sem microfone, rede) logo abaixo da caixa, com como resolver. */
function ErroDitado({ mensagem, aoFechar }: { mensagem: string; aoFechar: () => void }) {
  return (
    <motion.p className="compositor__aviso compositor__aviso--erro" role="alert" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
      <Icone nome="alerta" tamanho={14} />
      <span>{mensagem}</span>
      <button type="button" onClick={aoFechar} aria-label="Fechar aviso do ditado" title="Fechar">
        <Icone nome="fechar" tamanho={12} traco={2.2} />
      </button>
    </motion.p>
  );
}

export function Compositor({ anexos, gerando, enviando, parando, aoEnviar, aoParar, aoConversar, vozAberta = false }: Props) {
  const [texto, setTexto] = useState('');
  const caixa = useRef<HTMLTextAreaElement>(null);
  const seletor = useRef<HTMLInputElement>(null);
  const ditado = useDitado({ texto, setTexto, caixa });
  useAtalhosDeVoz(ditado, aoConversar, vozAberta);
  const erroDitado = ditado.escuta.erro;

  useLayoutEffect(() => ajustarAltura(caixa.current), [texto]);
  // A largura muda (a tela entra deslizando, a lista abre e fecha): a altura das linhas muda junto.
  useEffect(() => {
    const el = caixa.current;
    if (!el) return;
    let largura = el.clientWidth;
    const observador = new ResizeObserver(() => {
      if (el.clientWidth === largura) return;
      largura = el.clientWidth;
      ajustarAltura(el);
    });
    observador.observe(el);
    return () => observador.disconnect();
  }, []);

  const temConteudo = texto.trim().length > 0 || anexos.idsProntos.length > 0;
  const podeEnviar = temConteudo && !anexos.enviando && !enviando && !gerando;
  const motivo = anexos.enviando ? 'Espere os anexos terminarem de subir' : 'Enviar (Enter)';

  const enviar = async () => {
    if (!podeEnviar) return;
    // O que estava sendo ditado vai junto; o que o reconhecimento entregar depois não volta para a caixa.
    ditado.soltar();
    if (await aoEnviar(texto.trim())) setTexto('');
    caixa.current?.focus();
  };

  const aoTeclar = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    // Durante a composição (acentos, IME) o Enter confirma o caractere, não envia.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    void enviar();
  };

  const aoColar = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const arquivos = Array.from(e.clipboardData.files);
    if (!arquivos.length) return;
    e.preventDefault();
    anexos.adicionar(arquivos);
  };

  const aoSubmeter = (e: FormEvent) => {
    e.preventDefault();
    void enviar();
  };

  return (
    <form className="compositor" onSubmit={aoSubmeter} aria-label="Escrever mensagem">
      <div className="compositor__caixa">
        {anexos.itens.length > 0 && (
          <ul className="compositor__anexos" aria-label="Anexos">
            <AnimatePresence initial={false}>
              {anexos.itens.map((i) => <ChipEnvio key={i.chave} item={i} aoRemover={() => anexos.remover(i.chave)} />)}
            </AnimatePresence>
          </ul>
        )}
        <textarea
          ref={caixa}
          className="compositor__texto"
          rows={1}
          value={texto}
          onChange={(e) => {
            // Digitou durante o ditado: a caixa passa a ser da pessoa (o ditado para, o texto fica).
            ditado.soltar();
            setTexto(e.target.value);
          }}
          onKeyDown={aoTeclar}
          onPaste={aoColar}
          placeholder="Pergunte sobre o seu dinheiro…"
          aria-label="Mensagem"
          autoFocus
        />
        <div className="compositor__barra">
          <button type="button" className="compositor__anexar" onClick={() => seletor.current?.click()} aria-label="Anexar arquivos" title="Anexar arquivos (imagem, PDF, TXT, MD, CSV, OFX, JSON — até 15 MB)">
            <Icone nome="clipe" tamanho={18} />
          </button>
          <input
            ref={seletor}
            type="file"
            multiple
            accept={ACEITOS}
            hidden
            tabIndex={-1}
            data-testid="seletor-anexos"
            onChange={(e) => {
              anexos.adicionar(Array.from(e.target.files ?? []));
              e.target.value = '';
            }}
          />
          {ditado.ouvindo ? (
            <span className="compositor__dica-tecla compositor__ouvindo" aria-live="polite">
              <OndaMini nivel={ditado.nivel} ativa={ditado.ouvindo} />
              Ouvindo…<span className="compositor__ouvindo-texto"> <kbd>Esc</kbd> para parar</span>
            </span>
          ) : (
            <span className="compositor__dica-tecla">Shift + Enter quebra a linha</span>
          )}
          <BotaoDitado
            ouvindo={ditado.ouvindo}
            suportado={ditado.escuta.suportado}
            local={ditado.escuta.local}
            nivel={ditado.nivel}
            aoClicar={ditado.alternar}
          />
          {aoConversar && (
            <BotaoConversa
              desabilitado={vozAberta}
              aoClicar={() => {
                ditado.soltar();
                aoConversar();
              }}
            />
          )}
          {gerando ? (
            <button type="button" className="compositor__acao compositor__acao--parar" onClick={aoParar} disabled={parando} aria-label="Parar resposta" title="Parar resposta">
              <Icone nome="parar" tamanho={16} />
            </button>
          ) : (
            <button type="submit" className="compositor__acao" disabled={!podeEnviar} aria-label="Enviar mensagem" title={motivo}>
              <Icone nome={enviando ? 'sincronizar' : 'enviar'} tamanho={17} traco={2.2} className={enviando ? 'girando' : ''} />
            </button>
          )}
        </div>
      </div>
      <AnimatePresence initial={false} mode="wait">
        {erroDitado ? (
          <ErroDitado key="erro" mensagem={erroDitado.mensagem} aoFechar={ditado.escuta.limparErro} />
        ) : (
          <p key="aviso" className="compositor__aviso">O assistente só muda algo quando você pede — e as mudanças grandes esperam a sua aprovação.</p>
        )}
      </AnimatePresence>
    </form>
  );
}
