import type { ProvedorIA } from './tipos';

/**
 * Os modelos que o seletor oferece em cada CLI: os principais aparecem logo
 * (com atalho 1, 2, 3…), o resto fica em "Mais modelos". Os ids vêm dos
 * próprios CLIs (Claude Code 2.1.268, Gemini CLI 0.62, `codex debug models
 * --bundled` 0.160). A pessoa sempre pode digitar outro nome em "Outro modelo…".
 */

export interface ModeloIA {
  /** O que vai em `--model`. */
  id: string;
  /** Nome curto para a tela ("Opus 5.5"). */
  nome: string;
  descricao: string;
  /** Selo pequeno ("Novo"). */
  selo?: string;
  /** Aparece na lista principal; os outros ficam em "Mais modelos". */
  principal?: boolean;
}

export const MODELOS: Record<ProvedorIA, readonly ModeloIA[]> = {
  claude: [
    { id: 'claude-opus-5-5', nome: 'Opus 5.5', descricao: 'O mais capaz, para análises complexas', principal: true, selo: 'Novo' },
    { id: 'claude-fable-5-1', nome: 'Fable 5.1', descricao: 'Para as tarefas mais difíceis e longas', principal: true },
    { id: 'claude-haiku-4-5', nome: 'Haiku 4.5', descricao: 'O mais rápido, para respostas curtas', principal: true },
    { id: 'claude-sonnet-5', nome: 'Sonnet 5', descricao: 'Equilibrado, ótimo para o dia a dia' },
    { id: 'claude-opus-5', nome: 'Opus 5', descricao: 'Geração anterior do Opus' },
    { id: 'claude-fable-5', nome: 'Fable 5', descricao: 'Pode usar créditos extras do plano' },
    { id: 'claude-opus-4-8', nome: 'Opus 4.8', descricao: 'Modelo anterior' },
    { id: 'claude-opus-4-7', nome: 'Opus 4.7', descricao: 'Modelo anterior' },
    { id: 'claude-opus-4-6', nome: 'Opus 4.6', descricao: 'Modelo anterior' },
    { id: 'claude-sonnet-4-6', nome: 'Sonnet 4.6', descricao: 'Modelo anterior' },
  ],
  gemini: [
    { id: 'gemini-3.5-flash-lite', nome: '3.5 Flash Lite', descricao: 'Respostas mais rápidas', principal: true },
    { id: 'gemini-3.8-flash', nome: '3.8 Flash', descricao: 'Ajuda para tudo', principal: true, selo: 'Novo' },
    { id: 'gemini-3.1-pro-preview', nome: '3.1 Pro', descricao: 'Raciocínio avançado', principal: true },
    { id: 'gemini-3-pro-preview', nome: '3 Pro', descricao: 'Geração anterior do Pro' },
    { id: 'gemini-3.5-flash', nome: '3.5 Flash', descricao: 'Geração anterior do Flash' },
    { id: 'gemini-3.1-flash-lite', nome: '3.1 Flash Lite', descricao: 'Geração anterior do Flash Lite' },
    { id: 'gemini-2.5-pro', nome: '2.5 Pro', descricao: 'Modelo estável mais antigo' },
    { id: 'gemini-2.5-flash', nome: '2.5 Flash', descricao: 'Modelo estável mais antigo' },
  ],
  codex: [
    { id: 'gpt-6.1-sol', nome: 'GPT-6.1 Sol', descricao: 'O principal, para o dia a dia', principal: true, selo: 'Novo' },
    { id: 'gpt-6-astra', nome: 'GPT-6 Astra', descricao: 'Inteligência de ponta para o mais difícil', principal: true },
    { id: 'gpt-6-luna', nome: 'GPT-6 Luna', descricao: 'Rápido e econômico', principal: true },
    { id: 'gpt-6-sol', nome: 'GPT-6 Sol', descricao: 'Geração anterior' },
    { id: 'gpt-5.6-sol', nome: 'GPT-5.6 Sol', descricao: 'Geração mais antiga' },
    { id: 'gpt-5.6-terra', nome: 'GPT-5.6 Terra', descricao: 'Geração mais antiga, equilibrado' },
    { id: 'gpt-5.6-luna', nome: 'GPT-5.6 Luna', descricao: 'Geração mais antiga, rápido' },
    { id: 'gpt-5.5', nome: 'GPT-5.5', descricao: 'Modelo legado' },
  ],
};
