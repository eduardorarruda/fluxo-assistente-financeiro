import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useId, useRef, useState } from 'react';
import { useTestarConta } from '../../api/assistente';
import type { ContaIA, ProvedorInfo } from '../../api/tipos-assistente';
import { Botao, Interruptor, Modal, Selo } from '../../componentes/ui';
import { Icone } from '../../icones/Icone';
import { duracaoLegivel } from './comum';
import { DetalhesConta } from './DetalhesConta';
import { DetalhesContaApi } from './DetalhesContaApi';
import { contaPronta, ehApi } from './regras-contas';
import type { AcoesContas } from './useAcoesContas';

function SituacaoConta({ conta }: { conta: ContaIA }) {
  if (!conta.instalado) return <Selo tom="ruim" icone="alerta">{ehApi(conta) ? 'Sem chave' : 'Não encontrado'}</Selo>;
  if (!conta.ativo) return <Selo>Desligado</Selo>;
  return <Selo tom="bom" icone="check">{conta.versao ? `Pronto · v${conta.versao.replace(/^v/i, '')}` : 'Pronto'}</Selo>;
}

/** O que a linha embaixo do nome diz: a chave (API) ou de onde vem o login (CLI). */
function OrigemConta({ conta }: { conta: ContaIA }) {
  if (!ehApi(conta)) return <span className="texto-3 pequeno">{conta.pastaLogin ? 'pasta de login própria' : 'login padrão do CLI'}</span>;
  return (
    <>
      <Selo tom="info">API</Selo>
      <span className="texto-3 pequeno ajuste-conta__chave">
        {conta.chaveFinal ? <>Chave <code className="mono">{conta.chaveFinal}</code></> : 'sem chave'}
      </span>
    </>
  );
}

function ResultadoTeste({ teste, api }: { teste: ReturnType<typeof useTestarConta>; api: boolean }) {
  if (teste.isPending) return <p className="ajuste-conta__teste texto-3" role="status">{api ? 'Testando a chave…' : 'Testando…'}</p>;
  if (teste.isError) return <p className="ajuste-conta__teste ajuste-conta__teste--ruim" role="status">{teste.error.message}</p>;
  if (!teste.data) return null;
  const r = teste.data;
  return (
    <p className={`ajuste-conta__teste ${r.ok ? 'ajuste-conta__teste--bom' : 'ajuste-conta__teste--ruim'}`} role="status">
      <Icone nome={r.ok ? 'check' : 'alerta'} tamanho={15} />
      <span>{r.mensagem}</span>
      <span className="texto-3 numero">{duracaoLegivel(r.duracaoMs)}</span>
    </p>
  );
}

const EFEITO_REMOCAO = {
  cli: 'Nada muda no seu extrato nem no login do CLI.',
  api: 'A chave é apagada deste computador, mas continua valendo no console do provedor: revogue-a lá se não for mais usar.',
};

function ConfirmarRemocao({ conta, aberto, aoFechar, acoes }: { conta: ContaIA; aberto: boolean; aoFechar: () => void; acoes: AcoesContas }) {
  const [removendo, setRemovendo] = useState(false);
  const remover = async () => {
    setRemovendo(true);
    const ok = await acoes.remover(conta);
    setRemovendo(false);
    if (ok) aoFechar();
  };
  return (
    <Modal aberto={aberto} aoFechar={aoFechar} titulo={`Remover “${conta.nome}”?`}>
      <p className="texto-2">
        O Fluxo deixa de usar esta conta. As conversas que respondiam com ela passam para a conta padrão. {EFEITO_REMOCAO[ehApi(conta) ? 'api' : 'cli']}
      </p>
      <div className="modal__acoes">
        <Botao variante="fantasma" onClick={aoFechar}>Cancelar</Botao>
        <Botao variante="perigo" icone="lixo" carregando={removendo} onClick={() => void remover()}>Remover</Botao>
      </div>
    </Modal>
  );
}

interface Props {
  conta: ContaIA;
  info: ProvedorInfo;
  acoes: AcoesContas;
  /** Acabou de ser criada: CLI abre os detalhes com o comando de entrar em destaque; API já testa a chave. */
  recemCriada: boolean;
}

export function AjusteConta({ conta, info, acoes, recemCriada }: Props) {
  const api = ehApi(conta);
  const [aberto, setAberto] = useState((recemCriada && !api) || (!conta.instalado && conta.ativo));
  const [confirmando, setConfirmando] = useState(false);
  const teste = useTestarConta();
  const testouAoCriar = useRef(false);
  const pronto = contaPronta(conta);
  const unica = acoes.totalContas <= 1;
  const idDetalhes = useId();
  const raiz = useRef<HTMLDivElement>(null);

  // A conta aparece no cache antes de ser marcada como nova: abre quando a marca chega.
  // Conta de API recém-criada: testa a chave sozinho, uma vez, e o resultado aparece no cartão.
  useEffect(() => {
    if (!recemCriada) return;
    if (!api) setAberto(true);
    raiz.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    if (api && !testouAoCriar.current) {
      testouAoCriar.current = true;
      teste.mutate(conta.id);
    }
  }, [recemCriada]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={raiz} className={`ajuste-conta ${pronto ? 'ajuste-conta--pronta' : ''} ${recemCriada ? 'ajuste-conta--nova' : ''}`}>
      <div className="ajuste-conta__linha">
        <div className="ajuste-conta__nome">
          <strong>{conta.nome}</strong>
          <SituacaoConta conta={conta} />
          <OrigemConta conta={conta} />
        </div>
        <label className={`ajuste-conta__padrao ${pronto ? '' : 'ajuste-conta__padrao--off'}`} title={pronto ? undefined : api ? 'Ligue e salve a chave para poder usar como padrão' : 'Ligue e instale para poder usar como padrão'}>
          <input
            type="radio"
            name="assistente-conta-padrao"
            checked={acoes.contaPadrao === conta.id}
            disabled={!pronto || acoes.ocupado}
            onChange={() => acoes.definirPadrao(conta)}
          />
          <span>Usar como padrão</span>
        </label>
        <Interruptor ligado={conta.ativo} rotulo={`Ligar ${conta.nome}`} aoMudar={(v) => void acoes.mudar(conta, { ativo: v })} />
      </div>
      <div className="ajuste-conta__acoes">
        <Botao
          pequeno
          variante="fantasma"
          icone="chevron-baixo"
          className="ajuste-conta__alternar"
          onClick={() => setAberto((a) => !a)}
          aria-expanded={aberto}
          aria-controls={idDetalhes}
        >
          {aberto ? 'Esconder detalhes' : 'Detalhes'}
        </Botao>
        <Botao pequeno icone="play" onClick={() => teste.mutate(conta.id)} carregando={teste.isPending} disabled={!conta.instalado}>
          Testar
        </Botao>
        <Botao
          pequeno
          variante="fantasma"
          icone="lixo"
          onClick={() => setConfirmando(true)}
          disabled={unica}
          title={unica ? 'É a única conta: precisa sobrar pelo menos uma' : undefined}
        >
          Remover
        </Botao>
        <ResultadoTeste teste={teste} api={api} />
      </div>
      <AnimatePresence initial={false}>
        {aberto && (
          <motion.div id={idDetalhes} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.18 }} style={{ overflow: 'hidden' }}>
            {api ? <DetalhesContaApi conta={conta} info={info} acoes={acoes} /> : <DetalhesConta conta={conta} info={info} acoes={acoes} destacarEntrada={recemCriada} />}
          </motion.div>
        )}
      </AnimatePresence>
      <ConfirmarRemocao conta={conta} aberto={confirmando} aoFechar={() => setConfirmando(false)} acoes={acoes} />
    </div>
  );
}
