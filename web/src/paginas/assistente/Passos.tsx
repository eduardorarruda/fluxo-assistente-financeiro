import { AnimatePresence, motion } from 'motion/react';
import { useId, useState } from 'react';
import { FERRAMENTAS_DE_ACAO } from '../../api/acoes-assistente';
import type { PassoFerramenta } from '../../api/tipos-assistente';
import { Icone } from '../../icones/Icone';

function resumo(passos: PassoFerramenta[]): string {
  const rodando = passos.find((p) => p.situacao === 'rodando');
  if (rodando) return `${rodando.rotulo}…`;
  const acoes = passos.filter((p) => FERRAMENTAS_DE_ACAO.has(p.nome)).length;
  const n = passos.length - acoes;
  const erros = passos.filter((p) => p.situacao === 'erro').length;
  const partes = [
    n ? `Consultou ${n} ${n === 1 ? 'fonte' : 'fontes'}` : '',
    acoes ? `${n ? '' : 'Usou '}${acoes} ${acoes === 1 ? 'ação' : 'ações'}` : '',
    erros ? `${erros} com erro` : '',
  ];
  return partes.filter(Boolean).join(' · ');
}

function IconeSituacao({ situacao }: { situacao: PassoFerramenta['situacao'] }) {
  if (situacao === 'rodando') return <Icone nome="sincronizar" tamanho={14} className="girando" titulo="Em andamento" />;
  if (situacao === 'erro') return <Icone nome="alerta" tamanho={14} titulo="Falhou" />;
  return <Icone nome="check" tamanho={14} traco={2.2} titulo="Concluído" />;
}

function LinhaPasso({ passo }: { passo: PassoFerramenta }) {
  const [aberto, setAberto] = useState(false);
  const idDetalhe = useId();
  const temEntrada = Object.keys(passo.entrada).length > 0;
  return (
    <li className={`ferramenta ferramenta--${passo.situacao}`}>
      <button type="button" className="ferramenta__linha" aria-expanded={aberto} aria-controls={idDetalhe} onClick={() => setAberto((a) => !a)}>
        <span className="ferramenta__icone"><IconeSituacao situacao={passo.situacao} /></span>
        <span className="ferramenta__rotulo">{passo.rotulo}</span>
        {/* Ferramenta sem rótulo amigável: o rótulo já é o nome, não repete. */}
        {passo.nome !== passo.rotulo && <code className="ferramenta__nome">{passo.nome}</code>}
        <Icone nome="chevron-baixo" tamanho={14} className={`ferramenta__seta ${aberto ? 'ferramenta__seta--aberta' : ''}`} />
      </button>
      {aberto && (
        <div className="ferramenta__detalhe" id={idDetalhe}>
          <span className="ferramenta__titulo-detalhe">Pedido</span>
          <pre>{temEntrada ? JSON.stringify(passo.entrada, null, 2) : '(sem parâmetros)'}</pre>
          <span className="ferramenta__titulo-detalhe">Resposta</span>
          <pre>{passo.resultado ?? (passo.situacao === 'rodando' ? 'Aguardando…' : '(vazia)')}</pre>
        </div>
      )}
    </li>
  );
}

/** Linha do tempo compacta das ferramentas que o agente usou. Começa fechada. */
export function Passos({ passos }: { passos: PassoFerramenta[] }) {
  const [aberto, setAberto] = useState(false);
  const idLista = useId();
  if (!passos.length) return null;
  const rodando = passos.some((p) => p.situacao === 'rodando');
  const comErro = !rodando && passos.some((p) => p.situacao === 'erro');
  return (
    <div className="ferramentas">
      <button
        type="button"
        className={`ferramentas__resumo ${comErro ? 'ferramentas__resumo--erro' : ''}`}
        aria-expanded={aberto}
        aria-controls={idLista}
        onClick={() => setAberto((a) => !a)}
      >
        <Icone nome={rodando ? 'sincronizar' : comErro ? 'alerta' : 'camadas'} tamanho={14} className={rodando ? 'girando' : ''} />
        <span>{resumo(passos)}</span>
        <Icone nome="chevron-baixo" tamanho={14} className={`ferramenta__seta ${aberto ? 'ferramenta__seta--aberta' : ''}`} />
      </button>
      <AnimatePresence initial={false}>
        {aberto && (
          <motion.ol
            id={idLista}
            className="ferramentas__lista"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            {passos.map((p) => (
              <LinhaPasso key={p.id} passo={p} />
            ))}
          </motion.ol>
        )}
      </AnimatePresence>
    </div>
  );
}
