import { useMemo } from 'react';
import { Esqueleto } from '../../../componentes/ui';
import { Icone } from '../../../icones/Icone';
import { BotaoCopiar } from '../comum';
import { corDaSerie, formatarValor, lerGrafico, paraCsv, resumoAcessivel, type EspecGrafico } from './especGrafico';
import { GraficoPizza } from './GraficoPizza';
import { GraficoSeries } from './GraficoSeries';

const ALTURA = 260;

/** Enquanto o JSON ainda está chegando: o espaço do gráfico já reservado, sem pular a tela. */
function GraficoChegando() {
  return (
    <div className="grafico-ia grafico-ia--chegando" role="status" aria-label="Montando o gráfico…">
      <Esqueleto altura={18} largura="45%" />
      <Esqueleto altura={ALTURA - 40} raio={12} />
    </div>
  );
}

/** O modelo escreveu um gráfico que não dá para desenhar: avisa, sem quebrar a resposta, e deixa o JSON à mão. */
function GraficoInvalido({ motivo, codigo }: { motivo: string; codigo: string }) {
  return (
    <div className="grafico-ia grafico-ia--invalido" role="note">
      <p className="grafico-ia__aviso">
        <Icone nome="alerta" tamanho={15} />
        <span>Não consegui desenhar este gráfico ({motivo}).</span>
      </p>
      <details className="grafico-ia__detalhes">
        <summary>Ver o JSON</summary>
        <pre>{codigo}</pre>
      </details>
    </div>
  );
}

function Legenda({ espec }: { espec: EspecGrafico }) {
  if (espec.tipo === 'pizza' || espec.series.length < 2) return null;
  return (
    <ul className="grafico-ia__legenda" aria-hidden="true">
      {espec.series.map((s, j) => (
        <li key={j}><i style={{ background: corDaSerie(s, j) }} />{s.nome}</li>
      ))}
    </ul>
  );
}

/** Os mesmos números em tabela (para leitor de tela, e para quem quer conferir). */
function TabelaDosDados({ espec }: { espec: EspecGrafico }) {
  return (
    <details className="grafico-ia__detalhes">
      <summary>Ver os dados em tabela</summary>
      <div className="md__tabela">
        <table>
          <caption className="oculto-leitor">{espec.titulo}</caption>
          <thead>
            <tr>
              <th scope="col">Item</th>
              {espec.series.map((s, j) => <th key={j} scope="col">{s.nome}</th>)}
            </tr>
          </thead>
          <tbody>
            {espec.rotulos.map((r, i) => (
              <tr key={i}>
                <th scope="row">{r}</th>
                {espec.series.map((s, j) => <td key={j} className="numero">{formatarValor(s.valores[i] ?? 0, espec.unidade)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function Grafico({ espec }: { espec: EspecGrafico }) {
  const descricao = resumoAcessivel(espec);
  return (
    <figure className="grafico-ia" aria-label={espec.titulo}>
      <header className="grafico-ia__topo">
        <span className="grafico-ia__icone"><Icone nome="grafico" tamanho={16} /></span>
        <figcaption className="grafico-ia__titulos">
          <strong>{espec.titulo}</strong>
          {espec.subtitulo && <span>{espec.subtitulo}</span>}
        </figcaption>
        <BotaoCopiar texto={() => paraCsv(espec)} rotulo="Copiar dados" comTexto className="grafico-ia__copiar" />
      </header>
      <Legenda espec={espec} />
      {espec.tipo === 'pizza' ? <GraficoPizza espec={espec} descricao={descricao} /> : <GraficoSeries espec={espec} descricao={descricao} altura={ALTURA} />}
      <TabelaDosDados espec={espec} />
    </figure>
  );
}

/**
 * Bloco ```grafico da resposta. Enquanto a resposta chega o JSON pode estar pela
 * metade: mostra o esqueleto. Depois, ou desenha, ou explica que não deu.
 */
export function BlocoGrafico({ codigo, gerando }: { codigo: string; gerando: boolean }) {
  const leitura = useMemo(() => lerGrafico(codigo.trim()), [codigo]);
  if (leitura.tipo === 'ok') return <Grafico espec={leitura.espec} />;
  if (leitura.tipo === 'json' && gerando) return <GraficoChegando />;
  return <GraficoInvalido motivo={leitura.motivo} codigo={codigo} />;
}
