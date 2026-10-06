import { memo, useMemo } from 'react';
import { Link } from 'react-router';
import type { AcaoAssistente } from '../../api/acoes-assistente';
import type { Anexo, Mensagem as TMensagem, Uso } from '../../api/tipos-assistente';
import { Botao } from '../../componentes/ui';
import { Icone } from '../../icones/Icone';
import { inteiro } from '../../util/formato';
import { CartoesAcao } from './acoes/CartaoAcao';
import { BotaoCopiar, duracaoLegivel, MarcaProvedor, NOME_PROVEDOR } from './comum';
import { Markdown } from './Markdown';
import { Passos } from './Passos';
import { tamanhoLegivel } from './regras-anexos';
import { ContextoAnexos, ImagemDaResposta, urlDoAnexo } from './relatorio/ImagemDaResposta';

const ICONE_ANEXO: Record<Anexo['tipo'], string> = { imagem: 'imagem', pdf: 'arquivo', texto: 'nota' };

export function ChipAnexo({ anexo }: { anexo: Anexo }) {
  return (
    <span className="chip-anexo" title={`${anexo.nome} · ${tamanhoLegivel(anexo.tamanho)}`}>
      {anexo.tipo === 'imagem' && anexo.situacao !== 'erro' ? (
        <img className="chip-anexo__miniatura" src={urlDoAnexo(anexo.id)} alt="" loading="lazy" decoding="async" />
      ) : (
        <span className="chip-anexo__icone"><Icone nome={ICONE_ANEXO[anexo.tipo]} tamanho={15} /></span>
      )}
      <span className="chip-anexo__texto">
        <span className="chip-anexo__nome">{anexo.nome}</span>
        <span className="chip-anexo__sub">{anexo.situacao === 'erro' ? 'Não deu para ler' : tamanhoLegivel(anexo.tamanho)}</span>
      </span>
    </span>
  );
}

export const MensagemUsuario = memo(function MensagemUsuario({ mensagem }: { mensagem: TMensagem }) {
  return (
    <article className="msg msg--usuario" aria-label="Você disse">
      <div className="msg__corpo">
        {mensagem.anexos.length > 0 && (
          <div className="msg__anexos">
            {mensagem.anexos.map((a) => <ChipAnexo key={a.id} anexo={a} />)}
          </div>
        )}
        {mensagem.texto && <div className="msg__bolha">{mensagem.texto}</div>}
      </div>
      <div className="msg__acoes">
        {mensagem.texto && <BotaoCopiar texto={mensagem.texto} rotulo="Copiar mensagem" />}
      </div>
    </article>
  );
});

function linhaMeta(m: TMensagem): string[] {
  const partes: string[] = [];
  const quem = m.contaNome ?? (m.provedor ? NOME_PROVEDOR[m.provedor] : null);
  if (quem) partes.push(quem);
  if (m.modelo) partes.push(m.modelo);
  const uso: Uso | null = m.uso;
  if (uso?.duracaoMs != null) partes.push(duracaoLegivel(uso.duracaoMs));
  const tokens = (uso?.tokensEntrada ?? 0) + (uso?.tokensSaida ?? 0);
  if (tokens > 0) partes.push(`${inteiro(tokens)} tokens`);
  return partes;
}

/** O erro parece ser de CLI sem instalar, sem login ou mal configurado? Então vale apontar os Ajustes. */
const PROBLEMA_DE_CLI = /(login|entrar|autentic|auth|instal|não encontrad|nao encontrad|not found|enoent|configur|credencia|api key|chave)/i;

const TITULO_FALHA: Record<'erro' | 'cancelada' | 'interrompida', string> = {
  erro: 'A resposta falhou',
  cancelada: 'Você parou esta resposta',
  interrompida: 'A resposta parou no meio',
};
const TEXTO_FALHA: Record<'erro' | 'cancelada' | 'interrompida', string> = {
  erro: 'Algo deu errado ao gerar a resposta.',
  cancelada: 'O que chegou até aqui ficou guardado.',
  interrompida: 'O Fluxo foi fechado ou o CLI parou antes de terminar.',
};

function CartaoFalha({ mensagem, aoRepetir, repetindo }: { mensagem: TMensagem; aoRepetir?: () => void; repetindo: boolean }) {
  const s = mensagem.situacao;
  if (s !== 'erro' && s !== 'cancelada' && s !== 'interrompida') return null;
  const texto = mensagem.erro ?? TEXTO_FALHA[s];
  return (
    <div className={`msg__falha msg__falha--${s}`} role={s === 'erro' ? 'alert' : undefined}>
      <Icone nome={s === 'cancelada' ? 'info' : 'alerta'} tamanho={16} />
      <div className="msg__falha-texto">
        <strong>{TITULO_FALHA[s]}</strong>
        <p>{texto}</p>
        <div className="msg__falha-acoes">
          {aoRepetir && (
            <Botao pequeno icone="sincronizar" carregando={repetindo} onClick={aoRepetir}>
              Tentar de novo
            </Botao>
          )}
          {s === 'erro' && PROBLEMA_DE_CLI.test(texto) && (
            <Link className="botao botao--fantasma botao--pequeno" to="/ajustes#assistente">
              <Icone nome="ajustes" tamanho={15} />
              <span>Abrir os ajustes do assistente</span>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

/** Imagem gerada que o modelo esqueceu de pôr no texto: aparece mesmo assim, depois da resposta. */
function ImagensForaDoTexto({ mensagem }: { mensagem: TMensagem }) {
  const soltas = mensagem.anexos.filter((a) => a.tipo === 'imagem' && a.origem === 'gerada' && !mensagem.texto.includes(`anexo:${a.id}`));
  if (!soltas.length) return null;
  return (
    <div className="msg__imagens">
      {soltas.map((a) => <ImagemDaResposta key={a.id} id={a.id} alt={a.nome.replace(/\.\w+$/, '')} />)}
    </div>
  );
}

interface PropsAssistente {
  mensagem: TMensagem;
  /** Só a última resposta pode ser refeita. */
  aoRepetir?: () => void;
  repetindo?: boolean;
  /** O que o assistente fez ou propôs nesta resposta (cartões com Aprovar/Desfazer). */
  acoes?: readonly AcaoAssistente[];
}

export const MensagemAssistente = memo(function MensagemAssistente({ mensagem, aoRepetir, repetindo = false, acoes }: PropsAssistente) {
  const gerando = mensagem.situacao === 'gerando';
  const pensando = gerando && !mensagem.texto && !mensagem.passos.some((p) => p.situacao === 'rodando');
  const meta = gerando ? [] : linhaMeta(mensagem);
  const podeRepetir = !gerando && aoRepetir;
  const anexos = useMemo(() => new Map(mensagem.anexos.map((a) => [a.id, a])), [mensagem.anexos]);
  return (
    <article className="msg msg--assistente" aria-label="Resposta do assistente" aria-busy={gerando || undefined}>
      <MarcaProvedor provedor={mensagem.provedor} />
      <div className="msg__conteudo">
        <div className="msg__corpo">
          <Passos passos={mensagem.passos} />
          <ContextoAnexos.Provider value={anexos}>
            {mensagem.texto && <Markdown texto={mensagem.texto} gerando={gerando} />}
            {!gerando && <ImagensForaDoTexto mensagem={mensagem} />}
          </ContextoAnexos.Provider>
          <CartoesAcao acoes={acoes} />
          {pensando && (
            <span className="pensando" role="status">
              <span className="pensando__ponto" /><span className="pensando__ponto" /><span className="pensando__ponto" />
              <span className="oculto-leitor">Pensando…</span>
            </span>
          )}
        </div>
        <CartaoFalha mensagem={mensagem} aoRepetir={podeRepetir ? aoRepetir : undefined} repetindo={repetindo} />
        {!gerando && (
          <div className="msg__rodape">
            {meta.length > 0 && <span className="msg__meta numero">{meta.join(' · ')}</span>}
            <div className="msg__acoes">
              {mensagem.texto && <BotaoCopiar texto={mensagem.texto} rotulo="Copiar resposta" />}
              {podeRepetir && mensagem.situacao === 'ok' && (
                <button type="button" className="acao-mini" onClick={aoRepetir} disabled={repetindo} aria-label="Repetir resposta" title="Repetir resposta">
                  <Icone nome="sincronizar" tamanho={15} className={repetindo ? 'girando' : ''} />
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </article>
  );
});
