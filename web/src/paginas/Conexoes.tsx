import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { api } from '../api/cliente';
import { useEscrita, useEstado, useSincronizacoes } from '../api/consultas';
import type { Conexao } from '../api/tipos';
import { useAvisar } from '../componentes/Avisos';
import { Botao, Carregando, Cartao, Interruptor, Modal, Pagina, Selo } from '../componentes/ui';
import { Icone } from '../icones/Icone';
import { dataCurta, haQuantoTempo, reais } from '../util/formato';
import { usePreferencias } from '../util/preferencias';

const SITUACOES: Record<string, { nome: string; tom: 'bom' | 'atencao' | 'ruim' | 'info' }> = {
  UPDATED: { nome: 'Em dia', tom: 'bom' },
  UPDATING: { nome: 'Atualizando', tom: 'info' },
  MERGING: { nome: 'Atualizando', tom: 'info' },
  WAITING_USER_INPUT: { nome: 'Esperando você', tom: 'atencao' },
  WAITING_USER_ACTION: { nome: 'Esperando você', tom: 'atencao' },
  LOGIN_ERROR: { nome: 'Precisa reconectar', tom: 'ruim' },
  OUTDATED: { nome: 'Desatualizada', tom: 'atencao' },
};

/**
 * Abre o widget oficial da Pluggy. O token é curto e gerado pelo servidor na
 * hora; o segredo da Pluggy nunca passa pelo navegador. `itemId` = modo de
 * atualização (reconectar uma conexão que caiu).
 */
async function abrirPluggy(tema: 'escuro' | 'claro', sandbox: boolean, itemId?: string): Promise<string | null> {
  const { token } = await api.post<{ token: string }>('/conexoes/token', itemId ? { itemId } : {});
  const { PluggyConnect } = await import('pluggy-connect-sdk');
  return new Promise((resolver, rejeitar) => {
    let concluido = false;
    const widget = new PluggyConnect({
      connectToken: token,
      language: 'pt',
      theme: tema === 'escuro' ? 'dark' : 'light',
      countries: ['BR'],
      includeSandbox: sandbox,
      updateItem: itemId,
      onSuccess: ({ item }) => {
        concluido = true;
        resolver(item.id);
      },
      onError: (erro) => {
        concluido = true;
        // Com "evitar duplicadas", a Pluggy recusa criar uma segunda conexão com o mesmo
        // banco e devolve a que já existe: essa é a que queremos.
        const existente = idExistente(erro.data);
        if (existente) return resolver(existente);
        console.warn('Pluggy Connect:', erro.message, erro.data);
        rejeitar(new Error(traduzirErro(erro.message)));
      },
      onClose: () => {
        if (!concluido) resolver(null);
      },
    });
    widget.init().catch(rejeitar);
  });
}

const ERROS_PLUGGY: Record<string, string> = {
  ITEM_USER_ALREADY_EXISTS:
    'Essa conexão já existe na Pluggy. Copie o Item ID dela no painel da Pluggy e cole em "Já tenho o Item ID".',
};

function traduzirErro(mensagem: string | undefined): string {
  if (!mensagem) return 'A Pluggy não conseguiu conectar.';
  return ERROS_PLUGGY[mensagem.trim()] ?? mensagem;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * No ITEM_USER_ALREADY_EXISTS a API da Pluggy manda a(s) conexão(ões) que já existem em
 * `data.items`, mas o widget (pluggy-connect-sdk 2.10) só repassa `message` e `codeDescription`
 * ao onError. Fica aqui para quando ele repassar; até lá o caminho é "Já tenho o Item ID".
 */
export function idExistente(dados: unknown): string | null {
  const d = (dados ?? {}) as { item?: { id?: unknown }; items?: unknown[] };
  const candidatos = [d.item?.id, ...(Array.isArray(d.items) ? d.items : []).map((x) => (typeof x === 'string' ? x : (x as { id?: unknown })?.id))];
  const achado = candidatos.find((c): c is string => typeof c === 'string' && UUID.test(c));
  return achado ?? null;
}

/** Plano B: a conexão já foi criada (no widget ou no painel da Pluggy) e só falta o Fluxo conhecê-la. */
function PorItemId({ aoRegistrar, ocupado }: { aoRegistrar: (id: string) => void; ocupado: boolean }) {
  const [aberto, setAberto] = useState(false);
  const [id, setId] = useState('');
  const valido = UUID.test(id.trim());
  if (!aberto) {
    return (
      <button type="button" className="link" onClick={() => setAberto(true)}>
        Já tenho o Item ID
      </button>
    );
  }
  return (
    <form
      className="item-id"
      onSubmit={(e) => {
        e.preventDefault();
        if (valido) aoRegistrar(id.trim());
      }}
    >
      <p className="texto-3 pequeno">
        No <b>dashboard.pluggy.ai</b>, abra a sua aplicação → <b>Ir para Demo</b> → menu ⋮ da conexão → <b>Copiar Item ID</b>.
      </p>
      <div className="item-id__linha">
        <input className="entrada mono" placeholder="00000000-0000-0000-0000-000000000000" value={id} onChange={(e) => setId(e.target.value)} aria-label="Item ID da Pluggy" autoFocus />
        <Botao variante="primario" icone="link" type="submit" disabled={!valido} carregando={ocupado}>Conectar</Botao>
      </div>
    </form>
  );
}

function Passos() {
  const passos = [
    {
      titulo: 'Crie a conta de desenvolvedor na Pluggy',
      texto: (
        <>Em <b>dashboard.pluggy.ai</b>. É grátis e não pede cartão. <b>Atenção:</b> a partir daqui começam 15 dias de teste — faça os passos 2 a 4 no mesmo dia.</>
      ),
    },
    { titulo: 'Crie uma aplicação', texto: <>No painel, em <b>Applications</b>. Ela mostra o <b>Client ID</b> e o <b>Client Secret</b>.</> },
    {
      titulo: 'Conecte o Nubank no Meu Pluggy',
      texto: (
        <>Em <b>meu.pluggy.ai</b>, conecte o Nubank pelo Open Finance (a autorização é feita no app do Nubank). É o <b>Meu Pluggy</b> que torna o acesso gratuito para uso pessoal — a conexão continua valendo depois do teste.</>
      ),
    },
    {
      titulo: 'Coloque as credenciais no Fluxo',
      texto: (
        <>Copie <code>.env.exemplo</code> para <code>.env</code> na pasta do Fluxo, preencha <code>PLUGGY_CLIENT_ID</code> e <code>PLUGGY_CLIENT_SECRET</code> e reabra o Fluxo.</>
      ),
    },
    { titulo: 'Clique em “Conectar banco” e escolha “MeuPluggy”', texto: <>Ainda dentro dos 15 dias. Depois disso, é só usar.</> },
  ];
  return (
    <ol className="passos">
      {passos.map((p, i) => (
        <motion.li key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 + i * 0.07 }}>
          <span className="passos__numero">{i + 1}</span>
          <div>
            <strong>{p.titulo}</strong>
            <p className="texto-2 pequeno">{p.texto}</p>
          </div>
        </motion.li>
      ))}
    </ol>
  );
}

function CartaoConexao({ c, aoReconectar, aoRemover }: { c: Conexao; aoReconectar: () => void; aoRemover: () => void }) {
  const avisar = useAvisar();
  const sincronizar = useEscrita(() => api.post(`/conexoes/${encodeURIComponent(c.id)}/sincronizar`, { pedirAoBanco: c.provedor === 'pluggy' }));
  const s = SITUACOES[c.situacao] ?? { nome: c.situacao, tom: 'info' as const };
  const ocupado = c.sincronizando || sincronizar.isPending;
  const cor = c.cor ?? '#820AD1';
  return (
    <Cartao className="conexao" style={{ '--cor': cor } as React.CSSProperties}>
      <div className="conexao__faixa" />
      <div className="conexao__topo">
        <span className="conexao__logo" style={{ background: cor }}>
          {c.logoUrl ? <img src={c.logoUrl} alt="" /> : <Icone nome="banco" tamanho={22} />}
        </span>
        <div className="linha__texto">
          <h3>{c.nome}</h3>
          <span className="texto-3 pequeno">
            {c.provedor === 'demo' ? 'Dados de demonstração' : 'Open Finance via Pluggy'} · atualizado {haQuantoTempo(c.ultimaSincronizacao)}
          </span>
        </div>
        <Selo tom={ocupado ? 'info' : s.tom} icone={ocupado ? 'sincronizar' : undefined}>{ocupado ? 'Sincronizando' : s.nome}</Selo>
      </div>
      {c.erro && (
        <div className="aviso-inline aviso-inline--atencao">
          <Icone nome="alerta" tamanho={15} /> {c.erro}
        </div>
      )}
      <ul className="conexao__contas">
        {c.contas.map((k) => (
          <li key={k.id}>
            <Icone nome={k.tipo === 'CARTAO' ? 'cartao' : 'banco'} tamanho={16} />
            <span>{k.nome}{k.numero ? <small className="texto-3"> · {k.numero}</small> : null}</span>
            <strong className="numero valor-privado">{k.tipo === 'CARTAO' ? `fatura ${reais(k.saldo)}` : reais(k.saldo)}</strong>
          </li>
        ))}
      </ul>
      {c.consentimentoExpira && (
        <p className="texto-3 pequeno">Autorização do Open Finance vale até {dataCurta(c.consentimentoExpira.slice(0, 10))}.</p>
      )}
      <div className="conexao__acoes">
        <Botao
          pequeno
          icone="sincronizar"
          carregando={ocupado}
          onClick={() => sincronizar.mutate(undefined, { onSuccess: () => avisar('sucesso', `${c.nome} atualizado.`), onError: (e) => avisar('erro', (e as Error).message) })}
        >
          Sincronizar
        </Botao>
        {c.provedor === 'pluggy' && <Botao pequeno icone="link" onClick={aoReconectar}>Reconectar</Botao>}
        <span style={{ flex: 1 }} />
        <Botao pequeno variante="fantasma" icone="lixo" onClick={aoRemover}>{c.provedor === 'demo' ? 'Remover demonstração' : 'Remover'}</Botao>
      </div>
    </Cartao>
  );
}

export function Conexoes() {
  const { data, isLoading } = useEstado();
  const historico = useSincronizacoes().data ?? [];
  const { tema } = usePreferencias();
  const avisar = useAvisar();
  const [removendo, setRemovendo] = useState<Conexao | null>(null);
  const [revogar, setRevogar] = useState(false);
  const [conectando, setConectando] = useState(false);

  const registrar = useEscrita((itemId: string) => api.post('/conexoes', { itemId }));
  const sincronizar = useEscrita((itemId: string) => api.post(`/conexoes/${encodeURIComponent(itemId)}/sincronizar`, { pedirAoBanco: true }));
  const remover = useEscrita(({ id, revogar }: { id: string; revogar: boolean }) =>
    id === 'demo-nubank' ? api.delete('/demonstracao') : api.delete(`/conexoes/${encodeURIComponent(id)}${revogar ? '?revogar=1' : ''}`),
  );
  const demo = useEscrita(() => api.post('/demonstracao'));

  if (isLoading || !data) return <Carregando />;

  const conectar = async (itemId?: string) => {
    setConectando(true);
    try {
      const novo = await abrirPluggy(tema, data.pluggySandbox, itemId);
      if (!novo) return;
      avisar('info', 'Conectado! Trazendo os dados — o primeiro sincronismo pode levar um minuto.');
      if (itemId) await sincronizar.mutateAsync(itemId);
      else await registrar.mutateAsync(novo);
      avisar('sucesso', 'Pronto. Seus dados chegaram.');
    } catch (e) {
      avisar('erro', (e as Error).message);
    } finally {
      setConectando(false);
    }
  };

  const registrarPorId = (id: string) =>
    registrar.mutate(id, {
      onSuccess: () => avisar('sucesso', 'Conexão encontrada. Seus dados chegaram.'),
      onError: (e) => avisar('erro', (e as Error).message),
    });

  const reais_ = data.conexoes.filter((c) => c.provedor === 'pluggy');

  return (
    <Pagina>
      <div className="grade grade--12-8">
        <Cartao destaque className="conectar">
          <div className="conectar__cabeca">
            <span className="conectar__icone"><Icone nome="plug" tamanho={26} /></span>
            <div>
              <h2 className="conectar__titulo">Conecte seu Nubank</h2>
              <p className="texto-2">
                Pelo Open Finance, via Pluggy. O Fluxo lê conta, cartão, faturas, parcelas e caixinhas — nunca movimenta dinheiro e não vê a sua senha.
              </p>
            </div>
          </div>
          {data.pluggyConfigurada ? (
            <div className="conectar__acoes">
              <Botao variante="primario" icone="mais" carregando={conectando} onClick={() => conectar()}>Conectar banco</Botao>
              <span className="texto-3 pequeno">Escolha <b>MeuPluggy</b> na lista para usar o acesso gratuito.</span>
              <PorItemId ocupado={registrar.isPending} aoRegistrar={registrarPorId} />
            </div>
          ) : (
            <>
              <div className="aviso-inline aviso-inline--info">
                <Icone nome="info" tamanho={15} /> A Pluggy ainda não está configurada. Siga os passos abaixo (uns 10 minutos).
              </div>
              <Passos />
            </>
          )}
        </Cartao>
        <Cartao titulo="Seus dados" icone="escudo">
          <ul className="como-ler">
            <li><Icone nome="cadeado" tamanho={16} /> <span>Tudo fica neste computador, em <code>data/fluxo.db</code>. O Fluxo só atende a própria máquina (127.0.0.1).</span></li>
            <li><Icone nome="escudo" tamanho={16} /> <span>Do banco, o que sai para a internet é só a API da Pluggy, e só quando sincroniza. Assistente de IA e Google Agenda só falam com fora se você os configurar.</span></li>
            <li><Icone nome="olho-fechado" tamanho={16} /> <span>O segredo da Pluggy fica no servidor. O navegador só recebe um token de 30 minutos para abrir o widget.</span></li>
            <li><Icone nome="sincronizar" tamanho={16} /> <span>O Fluxo puxa da Pluggy ao abrir e a cada 30 minutos enquanto está aberto. No Meu Pluggy, quem busca no banco é o próprio Meu Pluggy (cerca de uma vez por dia); para forçar, use Atualizar em meu.pluggy.ai.</span></li>
          </ul>
        </Cartao>
      </div>

      <div className="grade grade--2">
        {data.conexoes.map((c) => (
          <CartaoConexao key={c.id} c={c} aoReconectar={() => conectar(c.id)} aoRemover={() => { setRevogar(false); setRemovendo(c); }} />
        ))}
        {!data.demonstracao && reais_.length === 0 && (
          <Cartao>
            <div className="demo-convite">
              <Icone nome="faisca" tamanho={22} />
              <div>
                <strong>Quer ver o Fluxo cheio antes de conectar?</strong>
                <p className="texto-3 pequeno">O modo demonstração cria um Nubank de mentira com 14 meses de histórico.</p>
              </div>
              <Botao carregando={demo.isPending} onClick={() => demo.mutate(undefined, { onSuccess: () => avisar('sucesso', 'Demonstração ativada.') })}>Ativar</Botao>
            </div>
          </Cartao>
        )}
      </div>

      {historico.length > 0 && (
        <Cartao titulo="Últimas sincronizações" icone="relogio">
          <div className="tabela tabela--sinc">
            <div className="tabela__cabeca"><span>Quando</span><span>Conexão</span><span>Resultado</span><span>Novas</span><span>Removidas</span></div>
            {historico.slice(0, 12).map((h) => (
              <div key={h.id} className="tabela__linha">
                <span>{haQuantoTempo(h.inicio)}</span>
                <span className="texto-3">{data.conexoes.find((c) => c.id === h.conexaoId)?.nome ?? h.conexaoId}</span>
                <span>{h.situacao === 'OK' ? <Selo tom="bom">ok</Selo> : h.situacao === 'ERRO' ? <Selo tom="ruim">{h.erro?.slice(0, 60) ?? 'erro'}</Selo> : <Selo tom="info">rodando</Selo>}</span>
                <span className="numero">{h.novas}</span>
                <span className="numero">{h.removidas}</span>
              </div>
            ))}
          </div>
        </Cartao>
      )}

      <Modal aberto={removendo !== null} aoFechar={() => setRemovendo(null)} titulo={removendo?.provedor === 'demo' ? 'Remover a demonstração?' : `Remover ${removendo?.nome}?`}>
        {removendo?.provedor === 'demo' ? (
          <p className="texto-2">Os dados de mentira saem de todas as telas. Metas, limites e regras que você criou continuam. Dá para reativar depois.</p>
        ) : (
          <>
            <p className="texto-2">As transações desta conexão saem do Fluxo. Metas, limites e regras continuam.</p>
            <label className="regra-toggle">
              <Interruptor ligado={revogar} aoMudar={setRevogar} rotulo="Também apagar na Pluggy" />
              <span>Também apagar a conexão na Pluggy</span>
            </label>
            <AnimatePresence>
              {revogar && (
                <motion.div className="aviso-inline aviso-inline--atencao" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                  <Icone nome="alerta" tamanho={15} /> Com o Meu Pluggy, reconectar depois do período de teste não é possível. Só apague lá se tiver certeza.
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
        <div className="editor__rodape" style={{ position: 'static' }}>
          <span style={{ flex: 1 }} />
          <Botao variante="fantasma" onClick={() => setRemovendo(null)}>Cancelar</Botao>
          <Botao
            variante="perigo"
            icone="lixo"
            carregando={remover.isPending}
            onClick={() =>
              remover.mutate(
                { id: removendo!.id, revogar },
                { onSuccess: () => { avisar('sucesso', 'Removido.'); setRemovendo(null); }, onError: (e) => avisar('erro', (e as Error).message) },
              )
            }
          >
            Remover
          </Botao>
        </div>
      </Modal>
    </Pagina>
  );
}
