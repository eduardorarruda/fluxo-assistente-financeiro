import type { ModeloIA } from '../cli/modelos';
import type { ProvedorIA } from '../cli/tipos';

/**
 * As contas por API: em vez do CLI (que usa o plano da pessoa), o Fluxo chama
 * a API do provedor com a chave dela, pagando por uso. Mesmos ids de
 * provedor: claude → Anthropic, gemini → Gemini API, codex → OpenAI.
 *
 * Os ids dos modelos são os que as APIs aceitam (conferidos nas uniões de
 * tipos de @ai-sdk/anthropic 4.0.71, @ai-sdk/google 4.0.87 e @ai-sdk/openai
 * 4.0.83). O primeiro "principal" é o padrão da conta sem modelo escolhido:
 * o de melhor custo-benefício, já que aqui cada resposta custa dinheiro.
 * A lista ao vivo (GET /contas/:id/modelos) completa com o que a chave enxerga.
 */

export interface InfoApi {
  nome: string;
  /** Onde a pessoa cria a chave (página oficial do provedor). */
  ondeCriarChave: string;
  modelos: readonly ModeloIA[];
}

export const PROVEDORES_API: Record<ProvedorIA, InfoApi> = {
  claude: {
    nome: 'API da Anthropic',
    ondeCriarChave: 'https://console.anthropic.com/settings/keys',
    modelos: [
      { id: 'claude-sonnet-5', nome: 'Sonnet 5', descricao: 'Equilibrado, ótimo para o dia a dia', principal: true },
      { id: 'claude-opus-5-5', nome: 'Opus 5.5', descricao: 'O mais capaz, para análises complexas (custa mais)', principal: true, selo: 'Novo' },
      { id: 'claude-haiku-4-5', nome: 'Haiku 4.5', descricao: 'O mais rápido e barato, para respostas curtas', principal: true },
      { id: 'claude-fable-5-1', nome: 'Fable 5.1', descricao: 'Para as tarefas mais difíceis e longas' },
      { id: 'claude-opus-5', nome: 'Opus 5', descricao: 'Geração anterior do Opus' },
      { id: 'claude-fable-5', nome: 'Fable 5', descricao: 'Geração anterior do Fable' },
      { id: 'claude-opus-4-8', nome: 'Opus 4.8', descricao: 'Modelo anterior' },
      { id: 'claude-sonnet-4-6', nome: 'Sonnet 4.6', descricao: 'Modelo anterior' },
    ],
  },
  gemini: {
    nome: 'API do Gemini',
    ondeCriarChave: 'https://aistudio.google.com/apikey',
    modelos: [
      { id: 'gemini-3.8-flash', nome: '3.8 Flash', descricao: 'Ajuda para tudo, rápido e barato', principal: true, selo: 'Novo' },
      { id: 'gemini-3.1-pro-preview', nome: '3.1 Pro', descricao: 'Raciocínio avançado (custa mais)', principal: true },
      { id: 'gemini-3.5-flash-lite', nome: '3.5 Flash Lite', descricao: 'O mais rápido e econômico', principal: true },
      { id: 'gemini-3.7-flash', nome: '3.7 Flash', descricao: 'Geração anterior do Flash' },
      { id: 'gemini-3.5-flash', nome: '3.5 Flash', descricao: 'Geração anterior do Flash' },
      { id: 'gemini-3-pro-preview', nome: '3 Pro', descricao: 'Geração anterior do Pro' },
      { id: 'gemini-2.5-pro', nome: '2.5 Pro', descricao: 'Modelo estável mais antigo' },
      { id: 'gemini-2.5-flash', nome: '2.5 Flash', descricao: 'Modelo estável mais antigo' },
    ],
  },
  codex: {
    nome: 'API da OpenAI',
    ondeCriarChave: 'https://platform.openai.com/api-keys',
    modelos: [
      { id: 'gpt-6.1-sol', nome: 'GPT-6.1 Sol', descricao: 'O principal, para o dia a dia', principal: true, selo: 'Novo' },
      { id: 'gpt-6-luna', nome: 'GPT-6 Luna', descricao: 'Rápido e econômico', principal: true },
      { id: 'gpt-6-astra', nome: 'GPT-6 Astra', descricao: 'Inteligência de ponta para o mais difícil (custa mais)', principal: true },
      { id: 'gpt-6-sol', nome: 'GPT-6 Sol', descricao: 'Geração anterior' },
      { id: 'gpt-5.6-sol', nome: 'GPT-5.6 Sol', descricao: 'Geração mais antiga' },
      { id: 'gpt-5.6-terra', nome: 'GPT-5.6 Terra', descricao: 'Geração mais antiga, equilibrado' },
      { id: 'gpt-5.6-luna', nome: 'GPT-5.6 Luna', descricao: 'Geração mais antiga, rápido' },
      { id: 'gpt-5.5', nome: 'GPT-5.5', descricao: 'Modelo legado' },
    ],
  },
};

/** O modelo de uma conta por API sem modelo escolhido: o primeiro principal do catálogo. */
export function modeloPadraoDaApi(provedor: ProvedorIA): string {
  const modelos = PROVEDORES_API[provedor].modelos;
  return (modelos.find((m) => m.principal) ?? modelos[0]!).id;
}
