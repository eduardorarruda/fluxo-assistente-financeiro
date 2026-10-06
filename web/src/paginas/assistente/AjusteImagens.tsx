import { type FormEvent, useState } from 'react';
import { useConfigImagens, useMudarImagens, useRemoverChaveImagens } from '../../api/imagens-assistente';
import type { ConfigImagens, ModeloImagem } from '../../api/tipos-assistente';
import { useAvisar } from '../../componentes/Avisos';
import { Seletor, type OpcaoSeletor } from '../../componentes/Seletor';
import { Botao, Esqueleto, Selo } from '../../componentes/ui';
import { Icone } from '../../icones/Icone';
import { BotaoCopiar } from './comum';

const ONDE_GERAR = 'https://aistudio.google.com/apikey';
/** Mesmo formato frouxo do servidor: só caracteres de chave. */
const FORMATO_CHAVE = /^[A-Za-z0-9_.-]{20,200}$/;

const MODELOS: readonly OpcaoSeletor[] = [
  { valor: 'gemini-3.1-flash-image', rotulo: 'Nano Banana 2', descricao: '≈ US$ 0,067 por imagem · bom e rápido', selo: 'Padrão' },
  { valor: 'gemini-3-pro-image', rotulo: 'Nano Banana Pro', descricao: '≈ US$ 0,134 por imagem · texto e detalhes melhores' },
  { valor: 'gemini-3.1-flash-lite-image', rotulo: 'Nano Banana 2 Lite', descricao: '≈ US$ 0,034 por imagem · o mais barato' },
];

const LIMITES = [5, 10, 20, 30, 50, 100, 200];
const opcoesDeLimite = (atual: number): OpcaoSeletor[] =>
  [...new Set([...LIMITES, atual])].sort((a, b) => a - b).map((n) => ({ valor: String(n), rotulo: `${n} por dia` }));

const mensagemDe = (e: unknown) => (e instanceof Error ? e.message : 'Algo deu errado.');

/** Colar a chave: campo de senha, nunca preenchido com a chave salva (o servidor nem a devolve). */
function CampoChave({ aoCancelar }: { aoCancelar?: () => void }) {
  const [chave, setChave] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const mudar = useMudarImagens();
  const avisar = useAvisar();
  const salvar = (e: FormEvent) => {
    e.preventDefault();
    const limpa = chave.trim();
    if (!FORMATO_CHAVE.test(limpa)) return setErro('Isso não parece uma chave do Gemini. Copie a chave inteira no Google AI Studio.');
    setErro(null);
    mudar.mutate({ chave: limpa }, {
      onSuccess: () => {
        setChave('');
        avisar('sucesso', 'Chave do Gemini salva neste computador.');
        aoCancelar?.();
      },
      onError: (x) => setErro(mensagemDe(x)),
    });
  };
  return (
    <form className="ajuste-imagens__chave" onSubmit={salvar}>
      <label className="campo">
        <span>Chave da API do Gemini</span>
        <input
          className="entrada mono"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="Cole aqui (começa com AIza…)"
          value={chave}
          onChange={(e) => setChave(e.target.value)}
          aria-invalid={erro ? true : undefined}
          aria-describedby={erro ? 'ajuste-imagens-erro' : undefined}
        />
      </label>
      {erro && <p id="ajuste-imagens-erro" className="ajuste-rag__erro" role="alert"><Icone nome="alerta" tamanho={15} /> {erro}</p>}
      <div className="ajuste-rag__acoes">
        <Botao pequeno variante="primario" icone="cadeado" type="submit" carregando={mudar.isPending} disabled={!chave.trim()}>Salvar chave</Botao>
        {aoCancelar && <Botao pequeno type="button" onClick={aoCancelar}>Cancelar</Botao>}
      </div>
    </form>
  );
}

function ChaveSalva({ config }: { config: ConfigImagens }) {
  const [trocando, setTrocando] = useState(false);
  const remover = useRemoverChaveImagens();
  const avisar = useAvisar();
  if (trocando) return <CampoChave aoCancelar={() => setTrocando(false)} />;
  return (
    <div className="ajuste-imagens__salva">
      <span className="ajuste-imagens__final">
        <Icone nome="cadeado" tamanho={15} />
        Chave configurada <code className="numero">{config.final}</code>
      </span>
      <div className="ajuste-rag__acoes">
        <Botao pequeno icone="editar" onClick={() => setTrocando(true)}>Trocar</Botao>
        <Botao
          pequeno
          icone="lixo"
          carregando={remover.isPending}
          onClick={() => remover.mutate(undefined, { onSuccess: () => avisar('info', 'Chave do Gemini removida.'), onError: (e) => avisar('erro', e.message) })}
        >
          Remover
        </Botao>
      </div>
    </div>
  );
}

function Preferencias({ config }: { config: ConfigImagens }) {
  const mudar = useMudarImagens();
  const avisar = useAvisar();
  const salvar = (m: { modelo?: ModeloImagem; limiteDiario?: number }) => mudar.mutate(m, { onError: (e) => avisar('erro', e.message) });
  return (
    <div className="ajuste-imagens__preferencias">
      <div className="campo">
        <span>Modelo (o máximo que o assistente pode usar)</span>
        <Seletor rotulo="Modelo de imagem" valor={config.modelo} opcoes={MODELOS} aoMudar={(v) => salvar({ modelo: v as ModeloImagem })} desabilitado={mudar.isPending} />
      </div>
      <div className="campo">
        <span>Limite de imagens</span>
        <Seletor rotulo="Limite diário de imagens" valor={String(config.limiteDiario)} opcoes={opcoesDeLimite(config.limiteDiario)} aoMudar={(v) => salvar({ limiteDiario: Number(v) })} desabilitado={mudar.isPending} />
      </div>
      <p className="pequeno texto-2 numero ajuste-imagens__hoje">Hoje: {config.geradasHoje} de {config.limiteDiario} imagens</p>
    </div>
  );
}

/** "Imagens com Nano Banana": a chave paga do Gemini, o modelo e o limite por dia. */
export function AjusteImagens() {
  const config = useConfigImagens();
  return (
    <section className="ajuste-rag ajuste-imagens" aria-labelledby="ajuste-imagens-titulo">
      <div className="ajuste-rag__topo">
        <h3 id="ajuste-imagens-titulo"><Icone nome="imagem" tamanho={15} /> Imagens com Nano Banana</h3>
        {config.data && (config.data.configurada ? <Selo tom="bom" icone="check">Configurada</Selo> : <Selo>Sem chave</Selo>)}
      </div>
      <p className="texto-3 pequeno">
        O assistente pode criar ilustrações e infográficos com o Nano Banana, o gerador de imagens do Gemini — só quando você pedir. Para gráficos com os
        seus números ele usa os gráficos do próprio Fluxo, que são de graça. Imagem exige uma <strong>chave paga</strong> da API do Gemini (não há cota
        grátis para imagens): cada uma custa de ≈ US$ 0,03 a 0,13, cobrados na sua conta Google. Quem assina o Google AI Pro ou Ultra recebe créditos
        mensais do Google Cloud que servem para isso.
      </p>
      <p className="texto-3 pequeno ajuste-imagens__onde">
        Gere a chave em <code>{ONDE_GERAR}</code> <BotaoCopiar texto={ONDE_GERAR} rotulo="Copiar endereço" />. Ela fica só neste computador, num arquivo
        protegido: nem esta tela nem o assistente conseguem lê-la de volta. Atenção: a descrição de cada imagem — que pode trazer números das suas
        finanças, num infográfico — vai para o Google junto com o pedido.
      </p>
      {config.isLoading && <Esqueleto altura={64} raio={14} />}
      {config.isError && !config.data && <p className="ajuste-rag__erro" role="alert"><Icone nome="alerta" tamanho={15} /> {mensagemDe(config.error)}</p>}
      {config.data && (
        <>
          {config.data.configurada ? <ChaveSalva config={config.data} /> : <CampoChave />}
          <Preferencias config={config.data} />
        </>
      )}
    </section>
  );
}
