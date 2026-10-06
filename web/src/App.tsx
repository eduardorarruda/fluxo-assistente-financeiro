import { AnimatePresence, motion } from 'motion/react';
import { lazy, Suspense, useEffect } from 'react';
import { Route, Routes, useLocation, useNavigate } from 'react-router';
import { api, ErroApi } from './api/cliente';
import { useEstado } from './api/consultas';
import { Marca } from './componentes/Marca';
import { Fundo } from './componentes/Fundo';
import { Navegacao, ROTAS } from './componentes/Navegacao';
import { Topo } from './componentes/Topo';
import { LimiteDeErro } from './componentes/LimiteDeErro';
import { Carregando } from './componentes/ui';
import { usePreferencias } from './util/preferencias';
import { VisaoGeral } from './paginas/VisaoGeral';

// A visão geral vem junto (é a primeira tela); o resto carrega sob demanda.
const Fluxo = lazy(() => import('./paginas/Fluxo').then((m) => ({ default: m.Fluxo })));
const Extrato = lazy(() => import('./paginas/Extrato').then((m) => ({ default: m.Extrato })));
const Cartao = lazy(() => import('./paginas/Cartao').then((m) => ({ default: m.Cartao })));
const Caixinhas = lazy(() => import('./paginas/Caixinhas').then((m) => ({ default: m.Caixinhas })));
const Orcamento = lazy(() => import('./paginas/Orcamento').then((m) => ({ default: m.Orcamento })));
const Metas = lazy(() => import('./paginas/Metas').then((m) => ({ default: m.Metas })));
const Recorrencias = lazy(() => import('./paginas/Recorrencias').then((m) => ({ default: m.Recorrencias })));
const ContasAPagar = lazy(() => import('./paginas/ContasAPagar').then((m) => ({ default: m.ContasAPagar })));
const Insights = lazy(() => import('./paginas/Insights').then((m) => ({ default: m.Insights })));
const Conexoes = lazy(() => import('./paginas/Conexoes').then((m) => ({ default: m.Conexoes })));
const Ajustes = lazy(() => import('./paginas/Ajustes').then((m) => ({ default: m.Ajustes })));
const Assistente = lazy(() => import('./paginas/assistente/Assistente').then((m) => ({ default: m.Assistente })));

/** Sinal de vida para o servidor saber que a janela continua aberta. */
function useSinalDeVida() {
  useEffect(() => {
    const enviar = () => void api.post('/ping').catch(() => undefined);
    enviar();
    const t = setInterval(enviar, 20_000);
    return () => clearInterval(t);
  }, []);
}

/** Alt+0…9 (e Alt+C, Contas a pagar) navegam; P esconde valores; T troca o tema. Nunca dentro de campos de texto. */
function useAtalhos() {
  const navegar = useNavigate();
  const { alternarPrivado, alternarTema } = usePreferencias();
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement;
      if (alvo.closest('input, textarea, select, [contenteditable]')) return;
      // Letras pela tecla física (e.code): Alt+letra muda o caractere em alguns teclados.
      const letra = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3) : null;
      const rotaDaLetra = e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && letra ? ROTAS.find((r) => r.atalho === letra) : undefined;
      if (rotaDaLetra) {
        e.preventDefault();
        navegar(rotaDaLetra.caminho);
        return;
      }
      if (e.altKey && /^[0-9]$/.test(e.key)) {
        const rota = ROTAS.find((r) => r.atalho === e.key);
        if (rota) {
          e.preventDefault();
          navegar(rota.caminho);
        }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'p' || e.key === 'P') alternarPrivado();
      if (e.key === 't' || e.key === 'T') alternarTema();
      if (e.key === '/') {
        e.preventDefault();
        navegar('/extrato?focar=1');
      }
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [navegar, alternarPrivado, alternarTema]);
}

/** Sem sessão (aberto por fora do atalho): explica em vez de mostrar telas vazias. */
function SemSessao() {
  return (
    <div className="sem-sessao">
      <Marca tamanho={56} comTexto={false} />
      <h1>Abra o Fluxo pelo atalho</h1>
      <p>
        Por segurança, só quem abre pelo menu do sistema (ou pelo <code>./fluxo.sh</code>) entra. Assim nenhum outro
        programa deste computador consegue ler o seu extrato.
      </p>
    </div>
  );
}

/** O Assistente ocupa a altura toda e rola só a lista de mensagens; trocar de conversa não refaz a transição de tela. */
const ehAssistente = (caminho: string) => caminho === '/assistente' || caminho.startsWith('/assistente/');

export function App() {
  const local = useLocation();
  const cheio = ehAssistente(local.pathname);
  const estado = useEstado();
  useSinalDeVida();
  useAtalhos();
  if (estado.error instanceof ErroApi && estado.error.status === 401) return <SemSessao />;
  return (
    <div className="app">
      <Fundo />
      <Navegacao />
      <div className="app__principal">
        <Topo />
        <main className={`app__conteudo ${cheio ? 'app__conteudo--cheio' : ''}`} id="conteudo">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={cheio ? '/assistente' : local.pathname}
              className={cheio ? 'app__tela-cheia' : undefined}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8, transition: { duration: 0.12 } }}
              transition={{ type: 'spring', stiffness: 300, damping: 32 }}
            >
              <LimiteDeErro>
                <Suspense fallback={<Carregando />}>
                  <Routes location={local}>
                    <Route path="/" element={<VisaoGeral />} />
                    <Route path="/fluxo" element={<Fluxo />} />
                    <Route path="/extrato" element={<Extrato />} />
                    <Route path="/cartao" element={<Cartao />} />
                    <Route path="/caixinhas" element={<Caixinhas />} />
                    <Route path="/orcamento" element={<Orcamento />} />
                    <Route path="/metas" element={<Metas />} />
                    <Route path="/recorrencias" element={<Recorrencias />} />
                    <Route path="/contas-a-pagar" element={<ContasAPagar />} />
                    <Route path="/insights" element={<Insights />} />
                    <Route path="/conexoes" element={<Conexoes />} />
                    <Route path="/ajustes" element={<Ajustes />} />
                    <Route path="/assistente/:conversaId?" element={<Assistente />} />
                    <Route path="*" element={<VisaoGeral />} />
                  </Routes>
                </Suspense>
              </LimiteDeErro>
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
