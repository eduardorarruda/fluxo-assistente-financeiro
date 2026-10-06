import { AnimatePresence, motion } from 'motion/react';
import { useId, useState } from 'react';
import {
  type AcaoAssistente, type TipoAcao, useAprovarProposta, useDesfazerAcao, useRecusarProposta,
} from '../../../api/acoes-assistente';
import { Botao } from '../../../componentes/ui';
import { Icone } from '../../../icones/Icone';
import { dataCurta, reais } from '../../../util/formato';

/**
 * Os cartões das ações do assistente dentro da resposta. Proposta: o que vai
 * mudar, o efeito, exemplos e Aprovar/Recusar; depois, "Feito" + Desfazer.
 * Ação direta: uma linha compacta com Desfazer.
 */

const ICONE: Record<TipoAcao, string> = {
  ajustar_movimento: 'editar', recategorizar_movimentos: 'camadas', criar_regra: 'filtro', remover_regra: 'filtro',
  definir_orcamento: 'orcamento', criar_meta: 'meta', editar_meta: 'meta', remover_meta: 'meta',
  criar_conta_a_pagar: 'calendario', editar_conta_a_pagar: 'calendario', marcar_conta_paga: 'check', remover_conta_a_pagar: 'calendario',
};

interface Estado {
  rotulo: string;
  classe: string;
  icone: string;
}

function estadoDe(a: AcaoAssistente): Estado {
  if (a.desfeitaEm) return { rotulo: 'Desfeito', classe: 'desfeita', icone: 'volta' };
  if (a.situacao === 'pendente') return { rotulo: 'Precisa da sua aprovação', classe: 'pendente', icone: 'info' };
  if (a.situacao === 'aprovada') return { rotulo: a.modo === 'direta' ? 'Feito' : 'Aprovado e feito', classe: 'feita', icone: 'check' };
  if (a.situacao === 'recusada') return { rotulo: 'Recusada', classe: 'recusada', icone: 'fechar' };
  if (a.situacao === 'expirada') return { rotulo: 'Expirou sem resposta', classe: 'expirada', icone: 'relogio' };
  return { rotulo: 'Não deu certo', classe: 'falhou', icone: 'alerta' };
}

/** O erro da última decisão, para mostrar no cartão (some na próxima tentativa). */
function useDecisoes() {
  const aprovar = useAprovarProposta();
  const recusar = useRecusarProposta();
  const desfazer = useDesfazerAcao();
  const erro = [aprovar, recusar, desfazer].find((m) => m.isError)?.error;
  return { aprovar, recusar, desfazer, ocupado: aprovar.isPending || recusar.isPending || desfazer.isPending, erro: erro instanceof Error ? erro.message : null };
}

function Exemplos({ acao }: { acao: AcaoAssistente }) {
  const [aberto, setAberto] = useState(false);
  const idLista = useId();
  if (!acao.exemplos.length) return null;
  return (
    <div className="cartao-acao__exemplos">
      <button type="button" className="cartao-acao__ver" aria-expanded={aberto} aria-controls={idLista} onClick={() => setAberto((x) => !x)}>
        {aberto ? 'Esconder exemplos' : `Ver ${acao.exemplos.length === 1 ? 'o exemplo' : `${acao.exemplos.length} exemplos`}`}
        <Icone nome="chevron-baixo" tamanho={13} className={`ferramenta__seta ${aberto ? 'ferramenta__seta--aberta' : ''}`} />
      </button>
      <AnimatePresence initial={false}>
        {aberto && (
          <motion.ul
            id={idLista}
            className="cartao-acao__lista"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            {acao.exemplos.map((e, i) => (
              <li key={`${e.data}-${i}`} className="cartao-acao__exemplo">
                <span className="cartao-acao__exemplo-data numero">{dataCurta(e.data)}</span>
                <span className="cartao-acao__exemplo-nome">{e.descricao}</span>
                <span className="cartao-acao__exemplo-valor numero">{reais(e.valor)}</span>
                {e.para && (
                  <span className="cartao-acao__exemplo-troca">
                    {e.de && <span className="cartao-acao__de">{e.de}</span>}
                    <Icone nome="seta-dir" tamanho={12} />
                    <span className="cartao-acao__para">{e.para}</span>
                  </span>
                )}
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Proposta (ou ação grande já decidida): o cartão completo. */
export function CartaoProposta({ acao, grande = false }: { acao: AcaoAssistente; grande?: boolean }) {
  const d = useDecisoes();
  const e = estadoDe(acao);
  const pendente = acao.situacao === 'pendente';
  return (
    <motion.div
      className={`cartao-acao cartao-acao--proposta cartao-acao--${e.classe} ${grande ? 'cartao-acao--grande' : ''}`}
      role="group"
      aria-label={`${acao.titulo}: ${e.rotulo}`}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="cartao-acao__cabeca">
        <span className="cartao-acao__icone" aria-hidden><Icone nome={ICONE[acao.tipo]} tamanho={16} /></span>
        <div className="cartao-acao__titulos">
          <strong className="cartao-acao__titulo">{acao.titulo}</strong>
          <span className="cartao-acao__estado"><Icone nome={e.icone} tamanho={12} traco={2.2} />{e.rotulo}</span>
        </div>
      </div>
      <p className="cartao-acao__descricao">{acao.descricao}</p>
      {acao.efeito && <p className="cartao-acao__efeito">{acao.efeito}</p>}
      <Exemplos acao={acao} />
      {acao.erro && <p className="cartao-acao__erro" role="alert">{acao.erro}</p>}
      {acao.aviso && <p className="cartao-acao__aviso">{acao.aviso}</p>}
      {d.erro && <p className="cartao-acao__erro" role="alert">{d.erro}</p>}
      {(pendente || acao.podeDesfazer) && (
        <div className="cartao-acao__botoes">
          {pendente ? (
            <>
              <Botao variante="primario" icone="check" pequeno={!grande} carregando={d.aprovar.isPending} disabled={d.ocupado} onClick={() => d.aprovar.mutate(acao)}>
                Aprovar
              </Botao>
              <Botao variante="fantasma" icone="fechar" pequeno={!grande} carregando={d.recusar.isPending} disabled={d.ocupado} onClick={() => d.recusar.mutate(acao)}>
                Recusar
              </Botao>
              {!grande && <span className="cartao-acao__dica">ou responda “sim”</span>}
            </>
          ) : (
            <Botao variante="fantasma" icone="volta" pequeno carregando={d.desfazer.isPending} disabled={d.ocupado} onClick={() => d.desfazer.mutate(acao)}>
              Desfazer
            </Botao>
          )}
        </div>
      )}
    </motion.div>
  );
}

/** Ação direta: uma linha — o que mudou e Desfazer. */
export function LinhaAcaoDireta({ acao }: { acao: AcaoAssistente }) {
  const d = useDecisoes();
  const e = estadoDe(acao);
  return (
    <motion.div
      className={`cartao-acao cartao-acao--direta cartao-acao--${e.classe}`}
      role="group"
      aria-label={`${acao.titulo}: ${e.rotulo}`}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <span className="cartao-acao__icone cartao-acao__icone--mini" aria-hidden><Icone nome={acao.desfeitaEm ? 'volta' : 'check'} tamanho={13} traco={2.2} /></span>
      <p className="cartao-acao__linha">
        <strong>{acao.desfeitaEm ? `${acao.titulo} (desfeito)` : acao.titulo}:</strong> {acao.descricao}
        {acao.aviso && <span className="cartao-acao__aviso-inline"> {acao.aviso}</span>}
        {d.erro && <span className="cartao-acao__erro-inline" role="alert"> {d.erro}</span>}
      </p>
      {acao.podeDesfazer && (
        <button type="button" className="cartao-acao__desfazer" onClick={() => d.desfazer.mutate(acao)} disabled={d.ocupado} aria-busy={d.desfazer.isPending || undefined}>
          <Icone nome={d.desfazer.isPending ? 'sincronizar' : 'volta'} tamanho={13} className={d.desfazer.isPending ? 'girando' : ''} />
          Desfazer
        </button>
      )}
    </motion.div>
  );
}

/** Todos os cartões de uma resposta. */
export function CartoesAcao({ acoes }: { acoes: readonly AcaoAssistente[] | undefined }) {
  if (!acoes?.length) return null;
  return (
    <div className="cartoes-acao">
      {acoes.map((a) => (a.modo === 'direta' ? <LinhaAcaoDireta key={a.id} acao={a} /> : <CartaoProposta key={a.id} acao={a} />))}
    </div>
  );
}
