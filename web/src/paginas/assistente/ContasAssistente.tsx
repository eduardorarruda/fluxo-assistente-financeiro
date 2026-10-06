import { useState } from 'react';
import type { ConfigAssistente, ContaIA, ProvedorIA, TipoConta } from '../../api/tipos-assistente';
import { Botao } from '../../componentes/ui';
import { Icone } from '../../icones/Icone';
import { GrupoApi } from './GrupoApi';
import { GrupoCli } from './GrupoCli';
import { NovaConta } from './NovaConta';
import { ehApi } from './regras-contas';
import { useAcoesContas } from './useAcoesContas';

/** Onde o formulário de conta nova abriu (um grupo, a seção de API vazia ou o fim da lista) e o que já veio escolhido. */
interface Abertura {
  onde: string;
  tipo: TipoConta | null;
  provedor: ProvedorIA | null;
  /** Quem abriu: recebe o foco de volta quando a pessoa desiste. */
  origem: HTMLElement | null;
  /** Muda a cada abertura: o formulário recomeça do zero. */
  vez: number;
}

/** Botões que somem enquanto o formulário ocupa o lugar deles: o foco volta para o novo pelo id. */
const ID_ADICIONAR = 'assistente-adicionar-conta';
const ID_CONECTAR_API = 'assistente-conectar-api';
const BOTAO_DO_LUGAR: Record<string, string> = { fim: ID_ADICIONAR, api: ID_CONECTAR_API };

const doTipo = (contas: ContaIA[], tipo: TipoConta) => contas.filter((c) => (ehApi(c) ? 'api' : 'cli') === tipo);

/** As contas do assistente nos Ajustes: as do plano (CLI) e as de chave de API, cada uma no seu grupo, e o "Adicionar conta". */
export function ContasAssistente({ config }: { config: ConfigAssistente }) {
  const acoes = useAcoesContas(config);
  const [recemCriada, setRecemCriada] = useState<string | null>(null);
  const [aberta, setAberta] = useState<Abertura | null>(null);
  const contasCli = doTipo(config.contas, 'cli');
  const contasApi = doTipo(config.contas, 'api');
  const comApi = config.provedores.filter((info) => info.api && contasApi.some((c) => c.provedor === info.provedor));
  const aceitaApi = config.provedores.some((info) => Boolean(info.api?.nome));

  const abrir = (onde: string, tipo: TipoConta | null = null, provedor: ProvedorIA | null = null) =>
    setAberta((a) => ({ onde, tipo, provedor, origem: document.activeElement as HTMLElement | null, vez: (a?.vez ?? 0) + 1 }));

  const cancelar = () => {
    const origem = aberta?.origem;
    const reserva = BOTAO_DO_LUGAR[aberta?.onde ?? ''] ?? ID_ADICIONAR;
    setAberta(null);
    // O botão volta a ficar habilitado (ou a existir) no próximo quadro: só então recebe o foco de volta.
    requestAnimationFrame(() => (origem?.isConnected ? origem.focus() : document.getElementById(reserva)?.focus()));
  };

  const formulario = (onde: string) =>
    aberta?.onde === onde ? (
      <NovaConta
        key={aberta.vez}
        provedores={config.provedores}
        contas={config.contas}
        pastaSugerida={config.pastaSugerida}
        acoes={acoes}
        inicio={{ tipo: aberta.tipo, provedor: aberta.provedor }}
        aoCancelar={cancelar}
        aoCriada={(id) => {
          setAberta(null);
          setRecemCriada(id);
        }}
      />
    ) : null;

  return (
    <div className="ajustes-ia__contas">
      <section className="ajustes-ia__secao" aria-labelledby="assistente-secao-cli">
        <div className="ajustes-ia__secao-topo">
          <h3 id="assistente-secao-cli">Pelo plano <span className="ajustes-ia__secao-tipo">CLI</span></h3>
          <p className="texto-3 pequeno">Usa a assinatura que você já paga, pelo CLI instalado neste computador e com o seu login.</p>
        </div>
        {config.provedores.map((info) => (
          <GrupoCli
            key={info.provedor}
            info={info}
            contas={contasCli.filter((c) => c.provedor === info.provedor)}
            acoes={acoes}
            recemCriada={recemCriada}
            adicionando={aberta?.onde === `cli-${info.provedor}`}
            aoAdicionar={() => abrir(`cli-${info.provedor}`, 'cli', info.provedor)}
          >
            {formulario(`cli-${info.provedor}`)}
          </GrupoCli>
        ))}
      </section>
      {aceitaApi && (
        <section className="ajustes-ia__secao" aria-labelledby="assistente-secao-api">
          <div className="ajustes-ia__secao-topo">
            <h3 id="assistente-secao-api">Pela chave de API <span className="ajustes-ia__secao-tipo">por uso</span></h3>
            <p className="texto-3 pequeno">Cobrado por uso na conta de API do provedor, sem instalar nada. A chave fica só neste computador e nunca é mostrada de volta.</p>
          </div>
          {comApi.map((info) => (
            <GrupoApi
              key={info.provedor}
              info={info}
              contas={contasApi.filter((c) => c.provedor === info.provedor)}
              acoes={acoes}
              recemCriada={recemCriada}
              adicionando={aberta?.onde === `api-${info.provedor}`}
              aoAdicionar={() => abrir(`api-${info.provedor}`, 'api', info.provedor)}
            >
              {formulario(`api-${info.provedor}`)}
            </GrupoApi>
          ))}
          {!comApi.length &&
            (formulario('api') ?? (
              <div className="ajustes-ia__vazio-api">
                <Icone nome="cadeado" tamanho={18} />
                <p className="texto-2 pequeno">
                  Nenhuma conta por chave de API. Com uma chave da Anthropic, do Gemini ou da OpenAI o assistente funciona sem CLI — e você paga só o que usar.
                </p>
                <Botao id={ID_CONECTAR_API} pequeno icone="mais" onClick={() => abrir('api', 'api')}>Conectar com chave de API</Botao>
              </div>
            ))}
        </section>
      )}
      {formulario('fim') ?? (
        <button type="button" id={ID_ADICIONAR} className="ajustes-ia__adicionar" onClick={() => abrir('fim')}>
          <Icone nome="mais" tamanho={16} />
          Adicionar conta{' '}
          <span className="texto-3">pelo plano ou por chave de API</span>
        </button>
      )}
    </div>
  );
}
