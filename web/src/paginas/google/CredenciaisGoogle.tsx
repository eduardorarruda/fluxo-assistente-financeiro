import { type FormEvent, useState } from 'react';
import { useSalvarCredenciaisGoogle } from '../../api/google';
import { useAvisar } from '../../componentes/Avisos';
import { Botao } from '../../componentes/ui';
import { Icone } from '../../icones/Icone';
import { CampoChave } from '../assistente/CampoChave';
import { PAGINAS_DO_CONSOLE } from './GuiaGoogle';

/** Os mesmos formatos do servidor (cofre-google.ts). */
const FORMATO_ID = /^\d{6,30}-[a-z0-9]{10,64}\.apps\.googleusercontent\.com$/;
const FORMATO_SEGREDO = /^[A-Za-z0-9_-]{10,100}$/;

const mensagemDe = (e: unknown) => (e instanceof Error ? e.message : 'Algo deu errado.');

/** O JSON que o Google Cloud deixa baixar ({"installed": {client_id, client_secret…}}): colado no campo do ID, preenche os dois. */
export function lerJsonDoCliente(texto: string): { clientId: string; clientSecret: string } | null {
  if (!texto.trim().startsWith('{')) return null;
  try {
    const dados = JSON.parse(texto) as Record<string, { client_id?: unknown; client_secret?: unknown } | undefined>;
    const c = dados.installed ?? dados.web;
    return typeof c?.client_id === 'string' && typeof c.client_secret === 'string' ? { clientId: c.client_id, clientSecret: c.client_secret } : null;
  } catch {
    return null;
  }
}

/**
 * Client ID + client secret do app que a pessoa criou. O secret é campo de
 * senha e nunca volta preenchido (o servidor nem o devolve).
 */
export function CredenciaisGoogle({ aoCancelar }: { aoCancelar?: () => void }) {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [erro, setErro] = useState<{ campo: 'id' | 'segredo' | 'geral'; texto: string } | null>(null);
  const salvar = useSalvarCredenciaisGoogle();
  const avisar = useAvisar();

  const mudarId = (valor: string) => {
    const doJson = lerJsonDoCliente(valor);
    if (doJson) {
      setClientId(doJson.clientId);
      setClientSecret(doJson.clientSecret);
      setErro(null);
      avisar('info', 'Li o JSON do Google: ID e chave secreta preenchidos.');
      return;
    }
    setClientId(valor);
  };

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    const id = clientId.trim();
    const segredo = clientSecret.trim();
    if (!FORMATO_ID.test(id)) return setErro({ campo: 'id', texto: 'O ID do cliente termina em .apps.googleusercontent.com. Copie o ID inteiro.' });
    if (!FORMATO_SEGREDO.test(segredo)) return setErro({ campo: 'segredo', texto: 'Isso não parece a chave secreta do cliente (começa com GOCSPX-).' });
    setErro(null);
    salvar.mutate({ clientId: id, clientSecret: segredo }, {
      onSuccess: () => {
        setClientId('');
        setClientSecret('');
        avisar('sucesso', 'Credenciais salvas neste computador. Agora é só conectar.');
        aoCancelar?.();
      },
      onError: (x) => setErro({ campo: 'geral', texto: mensagemDe(x) }),
    });
  };

  return (
    <form className="credenciais-google" onSubmit={enviar} noValidate>
      <label className="campo">
        <span>ID do cliente</span>
        <input
          className="entrada mono"
          value={clientId}
          onChange={(e) => mudarId(e.target.value)}
          placeholder="123456789012-abc….apps.googleusercontent.com"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-invalid={erro?.campo === 'id' ? true : undefined}
          aria-describedby={erro?.campo === 'id' ? 'credenciais-google-erro' : 'credenciais-google-dica'}
        />
      </label>
      <CampoChave
        id="credenciais-google-segredo"
        rotulo="Chave secreta do cliente"
        valor={clientSecret}
        aoMudar={setClientSecret}
        erro={erro?.campo === 'segredo' ? erro.texto : null}
        ondeCriar={PAGINAS_DO_CONSOLE.cliente}
        placeholder="GOCSPX-…"
      />
      <p id="credenciais-google-dica" className="texto-3 pequeno">
        Baixou o JSON do cliente? Cole o arquivo inteiro no campo do ID que o Fluxo separa os dois. Os dois ficam só neste computador, num arquivo
        protegido; esta tela não consegue ler a chave de volta.
      </p>
      {erro && erro.campo !== 'segredo' && (
        <p id="credenciais-google-erro" className="ajuste-rag__erro" role="alert"><Icone nome="alerta" tamanho={15} /> {erro.texto}</p>
      )}
      <div className="ajuste-rag__acoes">
        <Botao pequeno variante="primario" icone="cadeado" type="submit" carregando={salvar.isPending} disabled={!clientId.trim() || !clientSecret.trim()}>
          Salvar credenciais
        </Botao>
        {aoCancelar && <Botao pequeno type="button" onClick={aoCancelar}>Cancelar</Botao>}
      </div>
    </form>
  );
}
