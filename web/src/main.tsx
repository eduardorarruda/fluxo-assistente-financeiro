// Só os alfabetos latinos: português não precisa de cirílico nem vietnamita.
import '@fontsource/ibm-plex-sans/latin-300.css';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-sans/latin-700.css';
import '@fontsource/ibm-plex-sans/latin-ext-400.css';
import '@fontsource/ibm-plex-sans/latin-ext-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import './estilos/base.css';
import './estilos/layout.css';
import './estilos/componentes.css';
import './estilos/seletores.css';
import './estilos/graficos.css';
import './estilos/paginas.css';
import './estilos/assistente.css';
import './estilos/contas-ia.css';
import './estilos/relatorios.css';
import './estilos/voz.css';
import './estilos/acoes-assistente.css';
import './estilos/contas-a-pagar.css';
import './estilos/google.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { ProvedorPreferencias } from './util/preferencias';
import { ProvedorAvisos } from './componentes/Avisos';
import { recarregarUmaVez } from './util/recarga';

// Janela aberta antes de uma compilação nova pede arquivos que não existem mais: recarrega
// para pegar a versão nova. Se acabou de recarregar, deixa o erro seguir até o LimiteDeErro.
window.addEventListener('vite:preloadError', (evento) => {
  if (recarregarUmaVez()) evento.preventDefault();
});

const consultas = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 20_000, refetchOnWindowFocus: true, retry: 1 },
  },
});

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <QueryClientProvider client={consultas}>
      {/* "user": quem pediu menos movimento no sistema recebe menos movimento aqui. */}
      <MotionConfig reducedMotion="user">
        <ProvedorPreferencias>
          <ProvedorAvisos>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </ProvedorAvisos>
        </ProvedorPreferencias>
      </MotionConfig>
    </QueryClientProvider>
  </StrictMode>,
);
