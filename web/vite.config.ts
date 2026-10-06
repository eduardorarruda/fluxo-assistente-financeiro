import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Em desenvolvimento o Vite serve o front na 5173 e repassa /api para o Nest.
// Em produção quem serve tudo é o Nest, na 8778 — um processo só.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    // PORT vem do lançador de desenvolvimento quando a 5173 está ocupada.
    port: Number(process.env.PORT ?? 5173),
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8778',
        changeOrigin: false,
        // Em desenvolvimento não há atalho para entregar o cookie: o proxy
        // apresenta o token da sessão, que o servidor grava em data/.sessao.
        configure: (proxy) =>
          proxy.on('proxyReq', (req) => {
            try {
              req.setHeader('x-fluxo-sessao', readFileSync(resolve(import.meta.dirname, '../data/.sessao'), 'utf8').trim());
            } catch {
              /* servidor ainda subindo */
            }
          }),
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/testes/setup.ts'],
    css: false,
    // A primeira tela paga a importação a frio de tudo (motion, d3); 5 s não bastam na máquina ocupada.
    testTimeout: 20_000,
  },
});
