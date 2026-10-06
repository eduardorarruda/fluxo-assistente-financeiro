import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { useEstadoGoogle } from '../../api/google';
import { Botao, Cartao, Esqueleto, Selo } from '../../componentes/ui';
import { Icone } from '../../icones/Icone';
import { ConexaoGoogle } from './ConexaoGoogle';
import { GuiaGoogle } from './GuiaGoogle';
import { PreferenciasGoogle } from './PreferenciasGoogle';

const mensagemDe = (e: unknown) => (e instanceof Error ? e.message : 'Algo deu errado.');

function SeloDoEstado({ conectado, precisaReconectar, configurado }: { conectado: boolean; precisaReconectar: boolean; configurado: boolean }) {
  if (conectado) return <Selo tom="bom" icone="check">Conectado</Selo>;
  if (precisaReconectar) return <Selo tom="ruim" icone="alerta">Reconecte</Selo>;
  return <Selo>{configurado ? 'Não conectado' : 'Não configurado'}</Selo>;
}

/** Cartão "Google Agenda" dos Ajustes. `/ajustes#google` (o alerta de reconexão) rola até ele. */
export function AjustesGoogle() {
  const { hash } = useLocation();
  const estado = useEstadoGoogle();
  const pronto = Boolean(estado.data);

  useEffect(() => {
    if (hash !== '#google' || !pronto) return;
    const t = setTimeout(() => document.getElementById('google')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    return () => clearTimeout(t);
  }, [hash, pronto]);

  const e = estado.data;
  return (
    <Cartao
      id="google"
      titulo="Google Agenda"
      icone="calendario"
      className="ajustes-google"
      acoes={e && <SeloDoEstado conectado={e.conectado} precisaReconectar={e.precisaReconectar} configurado={e.configurado} />}
    >
      <p className="texto-3 pequeno ajustes-google__intro">
        O Fluxo cria uma agenda só dele, chamada <strong>Fluxo</strong>, na sua conta Google, e mantém nela o fechamento e o vencimento da fatura do
        cartão, as contas a pagar e um alerta para o que atrasar. O Google Agenda avisa no celular e no computador. O Fluxo só consegue mexer nessa
        agenda: <strong>não vê nem altera os seus outros compromissos</strong>.
      </p>
      {estado.isLoading && <Esqueleto altura={180} raio={16} />}
      {estado.isError && !e && (
        <div className="ajustes-ia__erro" role="alert">
          <span><Icone nome="alerta" tamanho={15} /> Não deu para ler o estado do Google Agenda: {mensagemDe(estado.error)}</span>
          <Botao pequeno icone="sincronizar" onClick={() => void estado.refetch()}>Tentar de novo</Botao>
        </div>
      )}
      {e && (
        <>
          <div className="ajustes-google__grade">
            <ConexaoGoogle estado={e} />
            <PreferenciasGoogle estado={e} />
          </div>
          <GuiaGoogle key={String(e.configurado)} enderecoDeRetorno={e.enderecoDeRetorno} abertoNoInicio={!e.configurado} />
        </>
      )}
    </Cartao>
  );
}
