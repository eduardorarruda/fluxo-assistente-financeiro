import { type FormEvent, type ReactNode, useId, useState } from 'react';
import type { ContaIA, MudancaConta, ProvedorInfo } from '../../api/tipos-assistente';
import { CampoSugestoes } from '../../componentes/CampoSugestoes';
import { Botao } from '../../componentes/ui';
import { Icone } from '../../icones/Icone';
import { sugestoesDeModelo } from './catalogo';
import { Comando } from './comum';
import { LIMITE_MODELO, pastaValida, problemaNoModelo } from './regras-contas';
import type { AcoesContas } from './useAcoesContas';

const nulo = (s: string) => s.trim() || null;

/** Só o que mudou, já no formato do PATCH. */
function mudancas(conta: ContaIA, campos: { nome: string; caminho: string; modelo: string; pasta: string }): MudancaConta {
  const m: MudancaConta = {};
  if (campos.nome.trim() && campos.nome.trim() !== conta.nome) m.nome = campos.nome.trim();
  if (nulo(campos.caminho) !== conta.caminho) m.caminho = nulo(campos.caminho);
  if (nulo(campos.modelo) !== conta.modelo) m.modelo = nulo(campos.modelo);
  if (nulo(campos.pasta) !== conta.pastaLogin) m.pastaLogin = nulo(campos.pasta);
  return m;
}

/** Explica a pasta de login numa linha: vazia = login padrão; separada = outra conta ou plano. */
export function DicaPasta({ id, info }: { id: string; info: ProvedorInfo }) {
  return (
    <small id={id} className="campo-ia__dica">
      Vazia = o login padrão do {info.nome}. Uma pasta separada permite usar outra conta ou plano (ex.: pessoal e trabalho); o Fluxo a passa em{' '}
      <code>{info.variavelDeConta}</code>.
    </small>
  );
}

export function ErroCampo({ id, texto }: { id: string; texto: string | null }) {
  if (!texto) return null;
  return <small id={id} className="campo-ia__erro" role="alert">{texto}</small>;
}

/** Campo com rótulo próprio: a dica e o erro ficam fora do rótulo, ligados por aria-describedby. */
export function Campo({ id, rotulo, children, depois, className = '' }: { id: string; rotulo: string; children: ReactNode; depois?: ReactNode; className?: string }) {
  return (
    <div className={`campo ${className}`}>
      <label htmlFor={id} className="campo-ia__rotulo">{rotulo}</label>
      {children}
      {depois}
    </div>
  );
}

interface Props {
  conta: ContaIA;
  info: ProvedorInfo;
  acoes: AcoesContas;
  /** Conta recém-criada: o comando de entrar vem em destaque, com a instrução. */
  destacarEntrada: boolean;
}

export function DetalhesConta({ conta, info, acoes, destacarEntrada }: Props) {
  const [nome, setNome] = useState(conta.nome);
  const [caminho, setCaminho] = useState(conta.caminho ?? '');
  const [modelo, setModelo] = useState(conta.modelo ?? '');
  const [pasta, setPasta] = useState(conta.pastaLogin ?? '');
  const id = useId();

  const erroModelo = modelo.trim() ? problemaNoModelo(modelo) : null;
  const erroPasta = pastaValida(pasta) ? null : 'Use o caminho completo da pasta (começando com /).';
  const erroNome = nome.trim() ? null : 'Dê um nome para a conta.';
  const mudanca = mudancas(conta, { nome, caminho, modelo, pasta });
  const mudou = Object.keys(mudanca).length > 0;
  const valido = !erroModelo && !erroPasta && !erroNome;

  const aoSalvar = (e: FormEvent) => {
    e.preventDefault();
    if (!mudou || !valido) return;
    void acoes.mudar(conta, mudanca, `${mudanca.nome ?? conta.nome} atualizada.`);
  };

  return (
    <form className="ajuste-conta__detalhes" onSubmit={aoSalvar} noValidate>
      <Campo id={`${id}-nome`} rotulo="Nome da conta" depois={<ErroCampo id={`${id}-nome-erro`} texto={erroNome} />}>
        <input id={`${id}-nome`} className="entrada" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={60} aria-invalid={Boolean(erroNome)} aria-describedby={erroNome ? `${id}-nome-erro` : undefined} />
      </Campo>
      <Campo id={`${id}-modelo`} rotulo="Modelo padrão" depois={<ErroCampo id={`${id}-modelo-erro`} texto={erroModelo} />}>
        <CampoSugestoes
          id={`${id}-modelo`}
          valor={modelo}
          aoMudar={setModelo}
          sugestoes={sugestoesDeModelo(info)}
          placeholder="O padrão do CLI"
                    maxLength={LIMITE_MODELO}
          invalido={Boolean(erroModelo)}
          aria-describedby={erroModelo ? `${id}-modelo-erro` : undefined}
                />
      </Campo>
      <Campo id={`${id}-caminho`} rotulo="Caminho do programa">
        <input id={`${id}-caminho`} className="entrada mono" value={caminho} onChange={(e) => setCaminho(e.target.value)} placeholder={conta.caminhoDetectado ?? 'Procurar sozinho no PATH'} spellCheck={false} />
      </Campo>
      <Campo
        id={`${id}-pasta`}
        rotulo="Pasta de login"
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
          onChange={(e) => setPasta(e.target.value)}
          placeholder="Login padrão do CLI"
          spellCheck={false}
          aria-invalid={Boolean(erroPasta)}
          aria-describedby={`${id}-pasta-dica${erroPasta ? ` ${id}-pasta-erro` : ''}`}
        />
      </Campo>
      <div className="ajuste-conta__salvar">
        <Botao type="submit" pequeno variante="primario" icone="check" disabled={!mudou || !valido} carregando={acoes.salvando && mudou}>Salvar</Botao>
      </div>
      <div className="ajuste-conta__entrar">
        {destacarEntrada && (
          <p className="ajuste-conta__aviso" role="status">
            <Icone nome="info" tamanho={16} />
            <span><strong>Agora entre nesta conta:</strong> copie o comando, rode num terminal e faça login.</span>
          </p>
        )}
        <Comando rotulo="Para entrar nesta conta" comando={conta.comoEntrar} destaque={destacarEntrada} />
      </div>
    </form>
  );
}
