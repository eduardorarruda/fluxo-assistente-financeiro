import { type FormEvent, useId, useState } from 'react';
import type { ContaIA, MudancaConta, ProvedorInfo } from '../../api/tipos-assistente';
import { CampoSugestoes } from '../../componentes/CampoSugestoes';
import { Botao, Selo } from '../../componentes/ui';
import { Icone } from '../../icones/Icone';
import { CampoChave } from './CampoChave';
import { catalogoApiDe, sugestoesDe, textoPadraoDaApi } from './catalogo';
import { Campo, ErroCampo } from './DetalhesConta';
import { LIMITE_MODELO, problemaNaChave, problemaNoModelo } from './regras-contas';
import type { AcoesContas } from './useAcoesContas';
import { useCatalogoDaConta } from './useCatalogoDaConta';

interface Props {
  conta: ContaIA;
  info: ProvedorInfo;
  acoes: AcoesContas;
}

/** De onde vem a lista de modelos, numa linha embaixo do campo. */
function OrigemDosModelos({ id, aoVivo, carregando, nomeApi }: { id: string; aoVivo: boolean; carregando: boolean; nomeApi: string }) {
  const texto = carregando ? `Buscando os modelos na ${nomeApi}…` : aoVivo ? `Lista atual da ${nomeApi}.` : 'Sugestões do Fluxo — qualquer modelo da API vale.';
  return (
    <small id={id} className="campo-ia__dica" aria-live="polite">
      {texto}
    </small>
  );
}

/** Nome e modelo padrão: o PATCH leva só o que mudou. */
function DadosDaConta({ conta, info, acoes }: Props) {
  const [nome, setNome] = useState(conta.nome);
  const [modelo, setModelo] = useState(conta.modelo ?? '');
  const catalogo = useCatalogoDaConta(conta, info);
  const id = useId();

  const erroNome = nome.trim() ? null : 'Dê um nome para a conta.';
  const erroModelo = modelo.trim() ? problemaNoModelo(modelo) : null;
  const mudanca: MudancaConta = {};
  if (nome.trim() && nome.trim() !== conta.nome) mudanca.nome = nome.trim();
  if ((modelo.trim() || null) !== conta.modelo) mudanca.modelo = modelo.trim() || null;
  const mudou = Object.keys(mudanca).length > 0;

  const aoSalvar = (e: FormEvent) => {
    e.preventDefault();
    if (!mudou || erroNome || erroModelo) return;
    void acoes.mudar(conta, mudanca, `${mudanca.nome ?? conta.nome} atualizada.`);
  };

  return (
    <form className="detalhes-api__dados" onSubmit={aoSalvar} noValidate aria-label={`Dados de ${conta.nome}`}>
      <Campo id={`${id}-nome`} rotulo="Nome da conta" depois={<ErroCampo id={`${id}-nome-erro`} texto={erroNome} />}>
        <input id={`${id}-nome`} className="entrada" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={60} aria-invalid={Boolean(erroNome)} aria-describedby={erroNome ? `${id}-nome-erro` : undefined} />
      </Campo>
      <Campo
        id={`${id}-modelo`}
        rotulo="Modelo padrão"
        depois={
          <>
            <ErroCampo id={`${id}-modelo-erro`} texto={erroModelo} />
            <OrigemDosModelos id={`${id}-modelo-origem`} aoVivo={catalogo.aoVivo} carregando={catalogo.carregando} nomeApi={info.api.nome} />
          </>
        }
      >
        <CampoSugestoes
          id={`${id}-modelo`}
          valor={modelo}
          aoMudar={setModelo}
          sugestoes={sugestoesDe(catalogo.modelos)}
          placeholder={textoPadraoDaApi(catalogoApiDe(info))}
          maxLength={LIMITE_MODELO}
          invalido={Boolean(erroModelo)}
          aria-describedby={`${id}-modelo-origem${erroModelo ? ` ${id}-modelo-erro` : ''}`}
        />
      </Campo>
      <div className="ajuste-conta__salvar">
        <Botao type="submit" pequeno variante="primario" icone="check" disabled={!mudou || Boolean(erroNome || erroModelo)} carregando={acoes.salvando && mudou}>Salvar</Botao>
      </div>
    </form>
  );
}

/**
 * A chave: só o final dela aparece ("…AbCd"). Trocar abre um campo de senha que
 * esvazia ao salvar; um erro do servidor (chave recusada) aparece ali mesmo.
 */
function TrocarChave({ conta, info, acoes }: Props) {
  const semChave = !conta.instalado;
  const [aberto, setAberto] = useState(semChave);
  const [chave, setChave] = useState('');
  const [tocada, setTocada] = useState(false);
  const [erroServidor, setErroServidor] = useState<string | null>(null);
  const id = useId();
  const problema = problemaNaChave(chave);
  const erro = erroServidor ?? (chave && (tocada || /\s/.test(chave.trim())) ? problema : null);

  const fechar = () => {
    setChave('');
    setTocada(false);
    setErroServidor(null);
    setAberto(false);
  };

  const aoSalvar = async (e: FormEvent) => {
    e.preventDefault();
    setTocada(true);
    if (problema || acoes.trocandoChave) return;
    const falha = await acoes.trocarChave(conta, chave.trim());
    if (falha) return setErroServidor(falha);
    fechar();
  };

  return (
    <div className="detalhes-api__chave">
      <div className="detalhes-api__chave-atual">
        <Icone nome="cadeado" tamanho={15} />
        {semChave ? (
          <Selo tom="ruim" icone="alerta">Sem chave salva</Selo>
        ) : (
          <span>
            Chave salva <code className="mono">{conta.chaveFinal ?? '…'}</code>
          </span>
        )}
        {!aberto && (
          <Botao pequeno icone="editar" onClick={() => setAberto(true)} className="detalhes-api__trocar">
            Trocar chave
          </Botao>
        )}
      </div>
      {aberto && (
        <form className="detalhes-api__nova-chave" onSubmit={(e) => void aoSalvar(e)} noValidate aria-label={`Chave de ${conta.nome}`}>
          <CampoChave
            id={`${id}-chave`}
            rotulo={semChave ? 'Chave da API' : 'Chave nova'}
            valor={chave}
            aoMudar={(v) => {
              setChave(v);
              setErroServidor(null);
            }}
            onBlur={() => setTocada(true)}
            erro={erro}
            ondeCriar={info.api.ondeCriarChave}
            placeholder={`Cole aqui a chave da ${info.api.nome}`}
            autoFocus={!semChave}
          />
          <div className="detalhes-api__acoes">
            {!semChave && <Botao pequeno variante="fantasma" onClick={fechar} disabled={acoes.trocandoChave}>Cancelar</Botao>}
            <Botao type="submit" pequeno variante="primario" icone="cadeado" carregando={acoes.trocandoChave} disabled={!chave.trim()}>
              Salvar chave
            </Botao>
          </div>
        </form>
      )}
    </div>
  );
}

/** Detalhes de uma conta de API: nome, modelo padrão (lista ao vivo) e a chave. */
export function DetalhesContaApi(props: Props) {
  return (
    <div className="ajuste-conta__detalhes detalhes-api">
      <DadosDaConta {...props} />
      <TrocarChave {...props} />
    </div>
  );
}
