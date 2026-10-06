import { useState } from 'react';
import { api } from '../../api/cliente';
import { useCategorias, useEscrita } from '../../api/consultas';
import type { ContaAPagar, Dia, Repeticao } from '../../api/tipos';
import { useAvisar } from '../../componentes/Avisos';
import { CampoData } from '../../componentes/CampoData';
import { CampoDinheiro } from '../../componentes/CampoDinheiro';
import { opcoesDeCategoria } from '../../componentes/opcoes';
import { Seletor, type OpcaoSeletor } from '../../componentes/Seletor';
import { Botao, Modal } from '../../componentes/ui';
import { Icone } from '../../icones/Icone';

/** Conta nova pode vir pré-preenchida (ex.: "Transformar em conta a pagar" das Recorrências). */
export type ContaEmEdicao = ContaAPagar | { nova: true; descricao?: string; valor?: number; vencimento?: Dia; categoriaId?: string | null; repete?: Repeticao } | null;

interface Rascunho {
  descricao: string;
  valor: number | null;
  vencimento: Dia;
  repete: Repeticao;
  categoriaId: string;
  textoNoExtrato: string;
  nota: string;
}

const OPCOES_REPETICAO: OpcaoSeletor[] = [
  { valor: 'nao', rotulo: 'Não repete', descricao: 'uma vez só', icone: <Icone nome="check" tamanho={16} /> },
  { valor: 'mensal', rotulo: 'Todo mês', descricao: 'no mesmo dia', icone: <Icone nome="repetir" tamanho={16} /> },
  { valor: 'anual', rotulo: 'Todo ano', descricao: 'IPVA, IPTU, seguro…', icone: <Icone nome="calendario" tamanho={16} /> },
];

function rascunhoDe(conta: ContaEmEdicao): Rascunho {
  if (conta && 'id' in conta) {
    return {
      descricao: conta.descricao, valor: conta.valor, vencimento: conta.vencimento, repete: conta.repete,
      categoriaId: conta.categoriaId ?? '', textoNoExtrato: conta.textoNoExtrato ?? '', nota: conta.nota ?? '',
    };
  }
  return {
    descricao: conta?.descricao ?? '', valor: conta?.valor ?? null, vencimento: conta?.vencimento ?? '',
    repete: conta?.repete ?? 'nao', categoriaId: conta?.categoriaId ?? '', textoNoExtrato: '', nota: '',
  };
}

export function FormularioConta({ conta, hoje, aoFechar }: { conta: ContaEmEdicao; hoje: Dia; aoFechar: () => void }) {
  const categorias = useCategorias().data ?? [];
  const avisar = useAvisar();
  const [r, setR] = useState<Rascunho>(() => rascunhoDe(conta));
  // A última conta aberta continua na tela enquanto o diálogo sai.
  const [mostrada, setMostrada] = useState<ContaEmEdicao>(conta);
  const [aberto, setAberto] = useState(conta !== null);
  // Cada abertura (ou outra conta) começa do rascunho dela.
  const abrindo = conta !== null && (!aberto || conta !== mostrada);
  if ((conta !== null) !== aberto) setAberto(conta !== null);
  if (abrindo) {
    setMostrada(conta);
    setR(rascunhoDe(conta));
  }
  const editando = mostrada !== null && 'id' in mostrada ? mostrada : null;
  const salvar = useEscrita((corpo: object) =>
    editando ? api.patch<ContaAPagar>(`/contas-a-pagar/${editando.id}`, corpo) : api.post<ContaAPagar>('/contas-a-pagar', corpo),
  );
  const valido = r.descricao.trim().length > 0 && r.valor !== null && r.valor > 0 && Boolean(r.vencimento);
  const opcoesCategoria: OpcaoSeletor[] = [
    { valor: '', rotulo: 'Sem categoria', icone: <Icone nome="pontos" tamanho={16} /> },
    ...opcoesDeCategoria(categorias.filter((c) => c.grupo === 'DESPESA')),
  ];

  const enviar = () => {
    if (!valido) return;
    salvar.mutate(
      {
        descricao: r.descricao.trim(),
        valor: r.valor,
        vencimento: r.vencimento,
        repete: r.repete,
        categoriaId: r.categoriaId || null,
        textoNoExtrato: r.textoNoExtrato.trim() || null,
        nota: r.nota.trim() || null,
      },
      {
        onSuccess: (salva) => {
          const conta = salva as ContaAPagar;
          const ja = !editando && conta.situacao === 'paga' ? ' O débito já está no extrato: ficou como paga.' : '';
          avisar('sucesso', `${editando ? 'Conta atualizada.' : 'Conta criada.'}${ja}`);
          aoFechar();
        },
        onError: (e) => avisar('erro', (e as Error).message),
      },
    );
  };

  return (
    <Modal aberto={conta !== null} aoFechar={aoFechar} titulo={editando ? 'Editar conta' : 'Nova conta a pagar'}>
      <form className="form-conta" onSubmit={(e) => (e.preventDefault(), enviar())}>
        <label className="campo">
          <span>Descrição</span>
          <input className="entrada" value={r.descricao} maxLength={80} placeholder="Ex.: Conta de luz" onChange={(e) => setR({ ...r, descricao: e.target.value })} />
        </label>
        <div className="grade grade--2 form-conta__linha">
          <label className="campo">
            <span>Valor</span>
            <CampoDinheiro valor={r.valor} aoMudar={(valor) => setR({ ...r, valor })} aria-label="Valor" />
          </label>
          <div className="campo">
            <span>Vencimento</span>
            <CampoData rotulo="Vencimento" valor={r.vencimento} hoje={hoje} aoMudar={(vencimento) => setR({ ...r, vencimento })} />
          </div>
        </div>
        <div className="grade grade--2 form-conta__linha">
          <div className="campo">
            <span>Repete</span>
            <Seletor rotulo="Repete" valor={r.repete} opcoes={OPCOES_REPETICAO} aoMudar={(repete) => setR({ ...r, repete: repete as Repeticao })} />
          </div>
          <div className="campo">
            <span>Categoria</span>
            <Seletor rotulo="Categoria" valor={r.categoriaId} opcoes={opcoesCategoria} aoMudar={(categoriaId) => setR({ ...r, categoriaId })} />
          </div>
        </div>
        <label className="campo">
          <span>Como aparece no extrato (opcional)</span>
          <input className="entrada" value={r.textoNoExtrato} maxLength={60} placeholder="Ex.: ENEL" onChange={(e) => setR({ ...r, textoNoExtrato: e.target.value })} />
          <small className="form-conta__dica">
            <Icone nome="info" tamanho={13} />
            Um trecho do nome do débito. Quando ele cair no extrato com valor parecido (até 10% de diferença), a conta
            é marcada como paga sozinha. Em branco, o Fluxo procura pelas palavras da descrição.
          </small>
        </label>
        <label className="campo">
          <span>Nota (opcional)</span>
          <input className="entrada" value={r.nota} maxLength={500} placeholder="Ex.: débito automático" onChange={(e) => setR({ ...r, nota: e.target.value })} />
        </label>
        <div className="editor__rodape" style={{ position: 'static' }}>
          <span style={{ flex: 1 }} />
          <Botao variante="fantasma" onClick={aoFechar}>Cancelar</Botao>
          <Botao type="submit" variante="primario" icone="check" disabled={!valido} carregando={salvar.isPending}>
            {editando ? 'Salvar' : 'Criar conta'}
          </Botao>
        </div>
      </form>
    </Modal>
  );
}
