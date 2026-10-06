import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import type { ContaIA, ModeloIA, ProvedorInfo, TipoConta } from '../../api/tipos-assistente';
import { Icone } from '../../icones/Icone';
import { CampoSugestoes } from '../../componentes/CampoSugestoes';
import { Seletor, type OpcaoSeletor } from '../../componentes/Seletor';
import { catalogoApiDe, padraoDaApi } from './catalogo';
import { MarcaProvedor } from './comum';
import { contaPronta, ehApi, LIMITE_MODELO, problemaNoModelo } from './regras-contas';
import { useCatalogoDaConta } from './useCatalogoDaConta';

export interface Escolha {
  contaId: string;
  modelo: string | null;
}

export interface PropsSeletor {
  contas: ContaIA[];
  provedores: ProvedorInfo[];
  escolha: Escolha;
  aoMudar: (e: Escolha) => void;
  desabilitado: boolean;
}

const MODELO_PADRAO = '';
/** Nenhum modelo válido começa com '*': não colide com um nome de verdade. */
const MODELO_OUTRO = '*outro';
const MODELO_MAIS = '*mais';

const TIPOS: readonly TipoConta[] = ['cli', 'api'];

/** Contas prontas, agrupadas por CLI e depois por API ("Claude Code", …, "API da Anthropic", …), na ordem dos provedores. */
function gruposDe(contas: ContaIA[], provedores: ProvedorInfo[]) {
  return TIPOS.flatMap((tipo) =>
    provedores.map((info) => ({
      info,
      tipo,
      nome: tipo === 'api' ? (info.api?.nome ?? info.nome) : info.nome,
      contas: contas.filter((c) => c.provedor === info.provedor && (ehApi(c) ? 'api' : 'cli') === tipo && contaPronta(c)),
    })),
  ).filter((g) => g.contas.length > 0);
}

interface PropsLivre {
  inicial: string | null;
  sugestoes: readonly ModeloIA[];
  desabilitado: boolean;
  aoSalvar: (modelo: string) => void;
  aoCancelar: () => void;
}

/** "Outro modelo…": nome livre, conferido aqui com a mesma regra do servidor. Enter salva, Esc desiste. */
function ModeloLivre({ inicial, sugestoes, desabilitado, aoSalvar, aoCancelar }: PropsLivre) {
  const [valor, setValor] = useState(inicial ?? '');
  const [tentou, setTentou] = useState(false);
  const idErro = useId();
  const erro = tentou ? problemaNoModelo(valor) : null;
  const confirmar = () => {
    setTentou(true);
    if (problemaNoModelo(valor) === null) aoSalvar(valor.trim());
  };
  const aoTeclar = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    e.stopPropagation();
    aoCancelar();
  };
  return (
    <div className={`seletor-ia__livre ${erro ? 'seletor-ia__livre--erro' : ''}`}>
      <CampoSugestoes
        aria-label="Nome do modelo"
        placeholder="nome do modelo"
        valor={valor}
        aoMudar={setValor}
        aoConfirmar={confirmar}
        sugestoes={sugestoes.map((m) => ({ valor: m.id, rotulo: m.nome, descricao: m.id }))}
        onKeyDown={aoTeclar}
        maxLength={LIMITE_MODELO}
        autoFocus
        disabled={desabilitado}
        invalido={Boolean(erro)}
        aria-describedby={erro ? idErro : undefined}
      />
      <button type="button" className="acao-mini" onClick={confirmar} disabled={desabilitado} aria-label="Usar este modelo" title="Usar este modelo">
        <Icone nome="check" tamanho={15} />
      </button>
      <button type="button" className="acao-mini" onClick={aoCancelar} aria-label="Cancelar" title="Cancelar">
        <Icone nome="fechar" tamanho={15} />
      </button>
      {erro && <span id={idErro} className="seletor-ia__erro" role="alert">{erro}</span>}
    </div>
  );
}

/** Quem responde nesta conversa: a conta (só as ligadas e instaladas) e o modelo, separados. */
export function SeletorConta({ contas, provedores, escolha, aoMudar, desabilitado }: PropsSeletor) {
  const [livre, setLivre] = useState(false);
  const devolverFoco = useRef(false);
  const caixa = useRef<HTMLDivElement>(null);
  const atual = contas.find((c) => c.id === escolha.contaId);
  const info = provedores.find((p) => p.provedor === atual?.provedor);
  // Conta de API: a lista ao vivo do provedor (o catálogo fixo enquanto carrega); CLI: o catálogo do CLI.
  const catalogo = useCatalogoDaConta(atual, info).modelos;
  const dica = desabilitado ? 'Espere a resposta terminar para trocar' : undefined;

  useEffect(() => {
    if (livre || !devolverFoco.current) return;
    devolverFoco.current = false;
    caixa.current?.querySelector<HTMLElement>('[aria-label="Modelo"]')?.focus();
  }, [livre]);

  const fecharLivre = () => {
    devolverFoco.current = true;
    setLivre(false);
  };

  const aoEscolherModelo = (valor: string) => {
    if (valor === MODELO_OUTRO) return setLivre(true);
    aoMudar({ contaId: escolha.contaId, modelo: valor === MODELO_PADRAO ? null : valor });
  };

  return (
    <div ref={caixa} className="seletor-ia" role="group" aria-label="Quem responde nesta conversa">
      <Seletor
        rotulo="Conta"
        variante="pilula"
        className="seletor-ia__conta"
        valor={escolha.contaId}
        opcoes={opcoesDeConta(contas, provedores, escolha.contaId)}
        aoMudar={(contaId) => aoMudar({ contaId, modelo: null })}
        desabilitado={desabilitado}
        titulo={dica ?? 'Conta que responde nesta conversa'}
      />
      {livre ? (
        <ModeloLivre
          inicial={escolha.modelo}
          sugestoes={catalogo}
          desabilitado={desabilitado}
          aoCancelar={fecharLivre}
          aoSalvar={(modelo) => {
            fecharLivre();
            if (modelo !== escolha.modelo) aoMudar({ contaId: escolha.contaId, modelo });
          }}
        />
      ) : (
        <Seletor
          rotulo="Modelo"
          variante="pilula"
          // Fica na ponta direita do cabeçalho: a lista cresce para a esquerda e não sai da tela.
          alinhar="fim"
            className="seletor-ia__modelo"
          prefixo={<Icone nome="faisca" tamanho={14} />}
          valor={escolha.modelo ?? MODELO_PADRAO}
          opcoes={opcoesDeModelo(catalogo, semEscolha(atual, info), atual?.modelo ?? null, escolha.modelo)}
          aoMudar={aoEscolherModelo}
          desabilitado={desabilitado}
          titulo={dica ?? 'Modelo usado nesta conversa'}
        />
      )}
    </div>
  );
}

/** Contas prontas agrupadas por CLI; a atual aparece mesmo se desligada (marcada), para não sumir do botão. */
function opcoesDeConta(contas: ContaIA[], provedores: ProvedorInfo[], atualId: string): OpcaoSeletor[] {
  const opcoes = gruposDe(contas, provedores).flatMap((g) =>
    g.contas.map((c) => ({
      valor: c.id,
      rotulo: c.nome,
      grupo: g.nome,
      // Conta de API custa por uso: o selo e a descrição avisam antes de a pessoa escolher.
      selo: g.tipo === 'api' ? 'API' : undefined,
      descricao: [origemDe(c), c.modelo ? `modelo ${c.modelo}` : null].filter(Boolean).join(' · '),
      icone: <MarcaProvedor provedor={c.provedor} tamanho={22} />,
    })),
  );
  if (opcoes.some((o) => o.valor === atualId)) return opcoes;
  const atual = contas.find((c) => c.id === atualId);
  return [
    { valor: atualId, rotulo: atual ? `${atual.nome} (desligada)` : 'Conta removida', desabilitada: true, icone: <MarcaProvedor provedor={atual?.provedor ?? null} tamanho={22} /> },
    ...opcoes,
  ];
}

/** O que "Modelo padrão" quer dizer quando nem a conta escolhe: o CLI decide; na API, o primeiro principal do catálogo. */
function semEscolha(conta: ContaIA | undefined, info: ProvedorInfo | undefined): string {
  if (!ehApi(conta)) return 'o que o CLI escolher';
  const padrao = padraoDaApi(catalogoApiDe(info));
  return padrao ? `o do Fluxo: ${padrao.nome}` : 'o padrão do Fluxo';
}

const origemDe = (c: ContaIA) => (ehApi(c) ? 'por uso' : c.pastaLogin ? 'login próprio' : 'login padrão');

function opcoesDeModelo(catalogo: readonly ModeloIA[], semEscolhaDaConta: string, padraoDaConta: string | null, atual: string | null): OpcaoSeletor[] {
  const nomeDe = (id: string | null) => (id ? (catalogo.find((m) => m.id === id)?.nome ?? id) : null);
  const paraOpcao = (m: ModeloIA, atalho?: number): OpcaoSeletor => ({
    valor: m.id, rotulo: m.nome, descricao: m.descricao, selo: m.selo, atalho: atalho ? String(atalho) : undefined,
  });
  const principais = catalogo.filter((m) => m.principal);
  const outros = catalogo.filter((m) => !m.principal);
  const opcoes: OpcaoSeletor[] = [
    { valor: MODELO_PADRAO, rotulo: 'Modelo padrão', descricao: padraoDaConta ? `o da conta: ${nomeDe(padraoDaConta)}` : semEscolhaDaConta },
    ...principais.map((m, i) => paraOpcao(m, i + 1)),
  ];
  // Um nome digitado em "Outro modelo…" que não está no catálogo continua aparecendo (e marcado).
  if (atual && !catalogo.some((m) => m.id === atual)) opcoes.push({ valor: atual, rotulo: atual, descricao: 'modelo digitado' });
  if (outros.length) opcoes.push({ valor: MODELO_MAIS, rotulo: 'Mais modelos', separadorAntes: true, submenu: outros.map((m) => paraOpcao(m)) });
  opcoes.push({ valor: MODELO_OUTRO, rotulo: 'Outro modelo…', descricao: 'digitar o nome', icone: <Icone nome="editar" tamanho={15} />, separadorAntes: !outros.length });
  return opcoes;
}
