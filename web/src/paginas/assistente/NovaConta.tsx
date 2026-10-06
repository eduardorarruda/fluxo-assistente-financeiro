import { type FormEvent, type KeyboardEvent, useId, useState } from 'react';
import type { ContaIA, NovaConta as CorpoNovaConta, ProvedorIA, ProvedorInfo, TipoConta } from '../../api/tipos-assistente';
import { CampoSugestoes } from '../../componentes/CampoSugestoes';
import { Botao } from '../../componentes/ui';
import { Icone } from '../../icones/Icone';
import { CampoChave } from './CampoChave';
import { catalogoApiDe, sugestoesDe, sugestoesDeModelo, textoPadraoDaApi } from './catalogo';
import { MARCA_PROVEDOR, MarcaProvedor, NOME_PROVEDOR } from './comum';
import { Campo, DicaPasta, ErroCampo } from './DetalhesConta';
import { EscolhaCartoes, type OpcaoCartao } from './EscolhaCartoes';
import {
  LIMITE_MODELO, pastaValida, problemaNaChave, problemaNoModelo, problemaNoNome, sugerirNome, sugerirNomeLivre, sugerirPasta,
} from './regras-contas';
import type { AcoesContas } from './useAcoesContas';

/** O que já vem escolhido (o "Adicionar" de um grupo traz o tipo e o provedor dele). */
export interface InicioNovaConta {
  tipo: TipoConta | null;
  provedor: ProvedorIA | null;
}

interface Props {
  provedores: ProvedorInfo[];
  contas: ContaIA[];
  pastaSugerida: string;
  acoes: AcoesContas;
  inicio: InicioNovaConta;
  aoCancelar: () => void;
  aoCriada: (contaId: string) => void;
}

export const AVISO_CUSTO_API =
  'Cobrado por uso na sua conta da API — não usa o plano. Os dados do Fluxo enviados nas perguntas vão para a API do provedor.';

const temApi = (info: ProvedorInfo) => Boolean(info.api?.nome);

function opcoesDeTipo(algumaApi: boolean): OpcaoCartao<TipoConta>[] {
  return [
    {
      valor: 'cli',
      titulo: 'Pelo plano (CLI)',
      icone: <Icone nome="teclado" tamanho={18} />,
      selo: 'Sem custo extra',
      descricao: 'Usa a assinatura que você já paga. Precisa do CLI instalado neste computador e com o seu login.',
    },
    {
      valor: 'api',
      titulo: 'Pela chave de API',
      icone: <Icone nome="cadeado" tamanho={18} />,
      selo: 'Por uso',
      descricao: 'Paga por uso no console de API do provedor. Não precisa instalar nada: basta colar a chave.',
      desabilitada: !algumaApi,
      dica: 'Esta versão do Fluxo ainda não aceita chaves de API.',
    },
  ];
}

function opcoesDeProvedor(provedores: ProvedorInfo[], tipo: TipoConta): OpcaoCartao<ProvedorIA>[] {
  return provedores.map((info) => ({
    valor: info.provedor,
    titulo: MARCA_PROVEDOR[info.provedor],
    icone: <MarcaProvedor provedor={info.provedor} tamanho={30} />,
    descricao: tipo === 'api' ? (info.api?.nome ?? 'Sem API') : info.nome,
    desabilitada: tipo === 'api' && !temApi(info),
    dica: 'Ainda sem chave de API para este provedor.',
  }));
}

/** "Nova conta do Claude Code" / "Nova conta da API da Anthropic" / "Nova conta". */
function tituloDe(tipo: TipoConta | null, info: ProvedorInfo | undefined): string {
  if (!tipo || !info) return 'Nova conta';
  return tipo === 'api' ? `Nova conta da ${info.api.nome}` : `Nova conta do ${info.nome}`;
}

/** Nome sugerido: "Claude 2" (CLI, ao lado do "Claude pessoal"); "Claude (API)" (API). */
function nomeSugerido(tipo: TipoConta, provedor: ProvedorIA, contas: ContaIA[]): string {
  return tipo === 'api' ? sugerirNomeLivre(`${MARCA_PROVEDOR[provedor]} (API)`, contas) : sugerirNome(NOME_PROVEDOR[provedor], contas);
}

/**
 * Conta nova em três passos na mesma tela: como conectar (plano ou chave de API),
 * o provedor e os campos daquele jeito. O nome (e a pasta, no CLI) acompanha as
 * escolhas até a pessoa mexer neles.
 */
export function NovaConta({ provedores, contas, pastaSugerida, acoes, inicio, aoCancelar, aoCriada }: Props) {
  const [tipo, setTipo] = useState<TipoConta | null>(inicio.tipo);
  const [provedor, setProvedor] = useState<ProvedorIA | null>(inicio.provedor);
  const [nomeEditado, setNomeEditado] = useState<string | null>(null);
  const [pastaEditada, setPastaEditada] = useState<string | null>(null);
  const [modelo, setModelo] = useState('');
  const [chave, setChave] = useState('');
  const [chaveTocada, setChaveTocada] = useState(false);
  const [erroServidor, setErroServidor] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const id = useId();

  const info = provedores.find((p) => p.provedor === provedor);
  const pronto = tipo !== null && info !== undefined;
  const nome = nomeEditado ?? (pronto ? nomeSugerido(tipo, info.provedor, contas) : '');
  const pasta = pastaEditada ?? (info ? sugerirPasta(pastaSugerida, info.provedor, nome) : '');
  const problemaChave = problemaNaChave(chave);
  const erroNome = problemaNoNome(nome, contas);
  const erroModelo = modelo.trim() ? problemaNoModelo(modelo) : null;
  const erroPasta = tipo === 'cli' && !pastaValida(pasta) ? 'Use o caminho completo da pasta (começando com /).' : null;
  const erroChave = tipo === 'api' && chave && (chaveTocada || /\s/.test(chave.trim())) ? problemaChave : null;
  const valido = pronto && !erroNome && !erroModelo && !erroPasta && (tipo === 'cli' || !problemaChave);

  const mudarTipo = (t: TipoConta) => {
    setTipo(t);
    setModelo('');
    setErroServidor(null);
    // A chave só existe no caminho da API: trocou de caminho, ela sai da memória.
    if (t === 'cli') setChave('');
    if (t === 'api' && provedor && !provedores.find((p) => p.provedor === provedor && temApi(p))) setProvedor(null);
  };

  const mudarProvedor = (p: ProvedorIA) => {
    setProvedor(p);
    setModelo('');
    setErroServidor(null);
  };

  const corpo = (): CorpoNovaConta | null => {
    if (!pronto) return null;
    const base = { provedor: info.provedor, nome: nome.trim(), modelo: modelo.trim() || null };
    return tipo === 'api' ? { tipo: 'api', ...base, chave: chave.trim() } : { ...base, pastaLogin: pasta.trim() || null };
  };

  const aoCriar = async (e: FormEvent) => {
    e.preventDefault();
    const c = corpo();
    if (!valido || criando || !c) return;
    setCriando(true);
    setErroServidor(null);
    const r = await acoes.criar(c);
    setCriando(false);
    if (!r.ok) return setErroServidor(r.erro);
    setChave('');
    if (r.contaId) aoCriada(r.contaId);
    else aoCancelar();
  };

  const aoTeclar = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key === 'Escape' && !e.defaultPrevented && !criando) aoCancelar();
  };

  const titulo = tituloDe(tipo, info);
  // O foco automático vai para o primeiro passo que falta, só ao abrir. Depois ele fica onde a pessoa está
  // (as setas trocam o tipo sem o foco pular para o grupo de provedores que aparece).
  const focarProvedor = inicio.tipo !== null && inicio.provedor === null;
  const focarNome = inicio.tipo !== null && inicio.provedor !== null;
  return (
    <form className="nova-conta" onSubmit={(e) => void aoCriar(e)} onKeyDown={aoTeclar} aria-label={titulo} noValidate>
      <strong className="nova-conta__titulo">{titulo}</strong>
      <EscolhaCartoes
        legenda="Como conectar?"
        passo={1}
        opcoes={opcoesDeTipo(provedores.some(temApi))}
        valor={tipo}
        aoMudar={mudarTipo}
        autoFocus={tipo === null}
      />
      {tipo && (
        <EscolhaCartoes
          legenda="Qual provedor?"
          passo={2}
          formato="compacto"
          opcoes={opcoesDeProvedor(provedores, tipo)}
          valor={provedor}
          aoMudar={mudarProvedor}
          autoFocus={focarProvedor}
        />
      )}
      {pronto && (
        <div className="nova-conta__campos" role="group" aria-label="Dados da conta">
          <Campo id={`${id}-nome`} rotulo="Nome" depois={<ErroCampo id={`${id}-nome-erro`} texto={erroNome} />}>
            <input
              id={`${id}-nome`}
              className="entrada"
              value={nome}
              onChange={(e) => setNomeEditado(e.target.value)}
              maxLength={60}
              autoFocus={focarNome}
              aria-invalid={Boolean(erroNome)}
              aria-describedby={erroNome ? `${id}-nome-erro` : undefined}
            />
          </Campo>
          <Campo id={`${id}-modelo`} rotulo={tipo === 'api' ? 'Modelo padrão (opcional)' : 'Modelo (opcional)'} depois={<ErroCampo id={`${id}-modelo-erro`} texto={erroModelo} />}>
            <CampoSugestoes
              id={`${id}-modelo`}
              valor={modelo}
              aoMudar={setModelo}
              sugestoes={tipo === 'api' ? sugestoesDe(catalogoApiDe(info)) : sugestoesDeModelo(info)}
              placeholder={tipo === 'api' ? textoPadraoDaApi(catalogoApiDe(info)) : 'O padrão do CLI'}
              maxLength={LIMITE_MODELO}
              invalido={Boolean(erroModelo)}
              aria-describedby={erroModelo ? `${id}-modelo-erro` : undefined}
            />
          </Campo>
          {tipo === 'api' ? (
            <>
              <div className="nova-conta__largo">
                <CampoChave
                  id={`${id}-chave`}
                  rotulo="Chave da API"
                  valor={chave}
                  aoMudar={(v) => {
                    setChave(v);
                    setErroServidor(null);
                  }}
                  onBlur={() => setChaveTocada(true)}
                  erro={erroChave}
                  ondeCriar={info.api.ondeCriarChave}
                  placeholder={`Cole aqui a chave da ${info.api.nome}`}
                />
              </div>
              <p className="nova-conta__aviso nova-conta__largo">
                <Icone nome="info" tamanho={15} />
                <span>{AVISO_CUSTO_API}</span>
              </p>
            </>
          ) : (
            <Campo
              id={`${id}-pasta`}
              rotulo="Pasta de login"
              className="nova-conta__largo"
              depois={
                <>
                  <ErroCampo id={`${id}-pasta-erro`} texto={erroPasta} />
                  <DicaPasta id={`${id}-pasta-dica`} info={info} />
                </>
              }
            >
              <input
                id={`${id}-pasta`}
                className="entrada mono"
                value={pasta}
                onChange={(e) => setPastaEditada(e.target.value)}
                placeholder="Login padrão do CLI"
                spellCheck={false}
                aria-invalid={Boolean(erroPasta)}
                aria-describedby={`${id}-pasta-dica${erroPasta ? ` ${id}-pasta-erro` : ''}`}
              />
            </Campo>
          )}
        </div>
      )}
      {erroServidor && (
        <p className="nova-conta__erro" role="alert">
          <Icone nome="alerta" tamanho={15} />
          <span>{erroServidor}</span>
        </p>
      )}
      <div className="nova-conta__acoes">
        <Botao variante="fantasma" pequeno onClick={aoCancelar} disabled={criando}>Cancelar</Botao>
        <Botao type="submit" variante="primario" pequeno icone={tipo === 'api' ? 'cadeado' : 'mais'} carregando={criando} disabled={!valido}>
          {tipo === 'api' ? 'Conectar conta' : 'Criar conta'}
        </Botao>
      </div>
    </form>
  );
}
