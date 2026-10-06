import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { useConfigAssistente } from '../../api/assistente';
import { Botao, Cartao, Esqueleto } from '../../componentes/ui';
import { AjusteImagens } from './AjusteImagens';
import { AjusteRag } from './AjusteRag';
import { AjusteVoz } from './AjusteVoz';
import { ContasAssistente } from './ContasAssistente';

const mensagemDe = (e: unknown) => (e instanceof Error ? e.message : 'Algo deu errado.');

/** Cartão "Assistente de IA" dos Ajustes. `/ajustes#assistente` rola até ele. */
export function AjustesAssistente() {
  const { hash } = useLocation();
  const config = useConfigAssistente();
  const pronto = Boolean(config.data);

  useEffect(() => {
    if (hash !== '#assistente' || !pronto) return;
    const t = setTimeout(() => document.getElementById('assistente')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    return () => clearTimeout(t);
  }, [hash, pronto]);

  return (
    <Cartao id="assistente" titulo="Assistente de IA" icone="assistente" className="ajustes-ia">
      <p className="texto-3 pequeno ajustes-ia__intro">
        O Assistente conversa de dois jeitos: <strong>pelo plano</strong> que você já paga (Claude Code, Gemini CLI ou Codex, com o seu login neste
        computador) ou por uma <strong>chave de API</strong>, cobrada por uso na conta do provedor. Nos dois, o agente só consegue <strong>ler</strong> os
        seus dados — não navega na internet nem escreve arquivos. Dá para ter várias contas (pessoal e trabalho, por exemplo) e escolher a conta e o
        modelo em cada conversa.
      </p>
      {config.isLoading && (
        <div className="ajustes-ia__lista">
          <Esqueleto altura={64} raio={14} />
          <Esqueleto altura={64} raio={14} />
        </div>
      )}
      {config.isError && !config.data && (
        <div className="ajustes-ia__erro" role="alert">
          <span>Não deu para ler os ajustes do assistente: {mensagemDe(config.error)}</span>
          <Botao pequeno icone="sincronizar" onClick={() => void config.refetch()}>Tentar de novo</Botao>
        </div>
      )}
      {config.data && (
        <>
          <ContasAssistente config={config.data} />
          <AjusteRag rag={config.data.rag} />
          <AjusteImagens />
          <AjusteVoz />
        </>
      )}
    </Cartao>
  );
}
