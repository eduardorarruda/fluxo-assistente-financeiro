import { AnimatePresence, motion } from 'motion/react';
import { type ReactNode, useId, useState } from 'react';
import { Icone } from '../../icones/Icone';
import { BotaoCopiar } from '../assistente/comum';

interface Passo {
  titulo: string;
  link?: { url: string; rotulo: string };
  texto: ReactNode;
}

/** As páginas exatas do Google Cloud Console (a "Plataforma de autenticação do Google"). */
export const PAGINAS_DO_CONSOLE = {
  projeto: 'https://console.cloud.google.com/projectcreate',
  api: 'https://console.cloud.google.com/apis/library/calendar-json.googleapis.com',
  marca: 'https://console.cloud.google.com/auth/branding',
  publico: 'https://console.cloud.google.com/auth/audience',
  cliente: 'https://console.cloud.google.com/auth/clients/create',
} as const;

function passos(enderecoDeRetorno: string): Passo[] {
  return [
    {
      titulo: 'Crie um projeto no Google Cloud',
      link: { url: PAGINAS_DO_CONSOLE.projeto, rotulo: 'Novo projeto' },
      texto: <>Entre com a mesma conta Google da agenda. Nome do projeto: <strong>Fluxo</strong>. É de graça — não pede cartão.</>,
    },
    {
      titulo: 'Ative a Google Calendar API',
      link: { url: PAGINAS_DO_CONSOLE.api, rotulo: 'Calendar API' },
      texto: <>Confira se o projeto <strong>Fluxo</strong> está escolhido no topo da página e clique em <strong>Ativar</strong>.</>,
    },
    {
      titulo: 'Configure a tela de consentimento',
      link: { url: PAGINAS_DO_CONSOLE.marca, rotulo: 'Branding' },
      texto: (
        <>
          Clique em <strong>Começar</strong>. Nome do app: <strong>Fluxo</strong>; e-mail de suporte: o seu. Em <em>Público</em>, escolha{' '}
          <strong>Externo</strong>. Em <em>Dados de contato</em>, o seu e-mail. Aceite a política e clique em <strong>Criar</strong>.
        </>
      ),
    },
    {
      titulo: 'Publique o app (senão a conexão cai a cada 7 dias)',
      link: { url: PAGINAS_DO_CONSOLE.publico, rotulo: 'Público' },
      texto: (
        <>
          Em <em>Status de publicação</em>, clique em <strong>Publicar app</strong> e confirme <strong>Em produção</strong>. Enquanto o app fica em{' '}
          <em>Teste</em>, o Google derruba a autorização depois de 7 dias. Não precisa pedir verificação: um app de uso pessoal (menos de 100 pessoas)
          funciona sem ela — na hora de conectar, o Google avisa que <em>o app não foi verificado</em>; clique em <strong>Avançado</strong> e depois em{' '}
          <strong>Acessar Fluxo (não seguro)</strong>. É o seu próprio app. Prefere deixar em Teste? Adicione o seu Gmail em <em>Usuários de teste</em>{' '}
          e reconecte toda semana.
        </>
      ),
    },
    {
      titulo: 'Crie o cliente OAuth',
      link: { url: PAGINAS_DO_CONSOLE.cliente, rotulo: 'Criar cliente' },
      texto: (
        <>
          Tipo de aplicativo: <strong>App para computador</strong>. Nome: <strong>Fluxo</strong>. Clique em <strong>Criar</strong> e copie o{' '}
          <strong>ID do cliente</strong> e a <strong>Chave secreta do cliente</strong> (ou baixe o JSON). Não precisa cadastrar endereço de
          redirecionamento: app para computador já aceita o retorno em <code className="guia-google__codigo">{enderecoDeRetorno}</code>{' '}
          <BotaoCopiar texto={enderecoDeRetorno} rotulo="Copiar endereço de retorno" />
        </>
      ),
    },
    {
      titulo: 'Cole aqui e conecte',
      texto: (
        <>
          Cole os dois campos abaixo, salve e clique em <strong>Conectar com o Google</strong>. Escolha a sua conta e deixe marcada a permissão de{' '}
          <em>criar agendas secundárias e gerenciar os eventos delas</em> — é tudo o que o Fluxo pede (mais o seu e-mail, só para mostrar aqui).
        </>
      ),
    },
  ];
}

/** O passo a passo do Google Cloud, recolhível. Começa aberto até as credenciais estarem salvas. */
export function GuiaGoogle({ enderecoDeRetorno, abertoNoInicio }: { enderecoDeRetorno: string; abertoNoInicio: boolean }) {
  const [aberto, setAberto] = useState(abertoNoInicio);
  const id = useId();
  return (
    <section className="guia-google" aria-labelledby={`${id}-titulo`}>
      <button type="button" className="guia-google__topo" aria-expanded={aberto} aria-controls={id} onClick={() => setAberto((a) => !a)}>
        <span className="guia-google__selo"><Icone nome="lampada" tamanho={15} /></span>
        <span id={`${id}-titulo`} className="guia-google__titulo">
          Como criar as credenciais no Google Cloud <span className="texto-3">· uns 5 minutos, uma vez só</span>
        </span>
        <Icone nome="chevron-baixo" tamanho={16} className={`guia-google__seta ${aberto ? 'guia-google__seta--aberta' : ''}`} />
      </button>
      <AnimatePresence initial={false}>
        {aberto && (
          <motion.ol
            id={id}
            className="guia-google__passos"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
          >
            {passos(enderecoDeRetorno).map((p, i) => (
              <li key={p.titulo} className="guia-google__passo">
                <span className="guia-google__numero" aria-hidden>{i + 1}</span>
                <div className="guia-google__conteudo">
                  <div className="guia-google__linha">
                    <strong>{p.titulo}</strong>
                    {p.link && (
                      <a className="guia-google__link" href={p.link.url} target="_blank" rel="noreferrer noopener">
                        {p.link.rotulo} <span aria-hidden>↗</span>
                        <span className="oculto-leitor"> (abre o Google Cloud em outra janela)</span>
                      </a>
                    )}
                  </div>
                  <p className="texto-2 pequeno">{p.texto}</p>
                </div>
              </li>
            ))}
          </motion.ol>
        )}
      </AnimatePresence>
    </section>
  );
}
