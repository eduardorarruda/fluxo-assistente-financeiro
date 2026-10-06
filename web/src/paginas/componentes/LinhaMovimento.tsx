import type { Movimento } from '../../api/tipos';
import { CategoriaIcone, Selo } from '../../componentes/ui';
import { NATUREZAS, useCategoriaPorId } from '../../util/categorias';
import { reais } from '../../util/formato';

/** Uma linha de movimento, igual em todas as telas: ícone da categoria, nome, contexto e valor com sinal. */
export function LinhaMovimento({ m, sub, aoClicar }: { m: Movimento; sub?: string; aoClicar?: () => void }) {
  const categoria = useCategoriaPorId();
  const natureza = NATUREZAS[m.natureza];
  const cat = m.categoriaId ? categoria(m.categoriaId) : undefined;
  const entra = m.natureza === 'RECEITA' || m.natureza === 'ESTORNO' || (natureza && m.sentido === 'ENTRADA');
  const neutro = Boolean(natureza);
  const Tag = aoClicar ? 'button' : 'div';
  return (
    <Tag type={aoClicar ? 'button' : undefined} className={`linha linha-mov ${aoClicar ? 'linha-mov--clicavel' : ''}`} onClick={aoClicar}>
      <CategoriaIcone categoria={cat} icone={natureza?.icone} cor={natureza?.cor} tamanho={38} />
      <span className="linha__texto">
        <span className="linha__titulo">{m.estabelecimento && m.estabelecimento !== m.descricao ? m.estabelecimento : m.descricao}</span>
        <span className="linha__sub">
          {sub ?? m.conta}
          {cat && ` · ${cat.nome}`}
          {natureza && ` · ${natureza.nome}`}
        </span>
      </span>
      <span className="linha-mov__selos">
        {m.parcela && <Selo tom="marca">{m.parcela.numero}/{m.parcela.total}</Selo>}
        {m.pendente && <Selo icone="relogio">pendente</Selo>}
        {m.nota && <Selo icone="nota">nota</Selo>}
        {m.editado && <Selo tom="info" icone="editar">editado</Selo>}
      </span>
      <span className={`linha__valor numero valor-privado ${neutro ? 'texto-3' : entra ? 'valor--positivo' : ''}`}>
        {entra ? '+' : '−'} {reais(m.valor)}
      </span>
    </Tag>
  );
}
