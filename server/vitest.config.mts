import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// O Nest depende de metadados de decorator para a injeção de dependência. O
// esbuild do Vitest não os emite; o SWC emite — por isso o plugin.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/main.ts', 'src/**/testing/**'],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 75 },
    },
  },
});
