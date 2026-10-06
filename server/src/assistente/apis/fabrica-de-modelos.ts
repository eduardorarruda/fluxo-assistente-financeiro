import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import type { ProvedorIA } from '../cli/tipos';

export const FABRICA_DE_MODELOS = Symbol('FABRICA_DE_MODELOS');

/** Um modelo pronto do AI SDK — nunca um nome solto (que iria para o gateway da Vercel). */
export type ModeloDeLinguagem = Exclude<LanguageModel, string>;

/**
 * Cria o modelo de uma conta por API. Injetável: os testes passam o
 * MockLanguageModel do `ai/test` e nunca chamam API de verdade.
 */
export type FabricaDeModelos = (provedor: ProvedorIA, chave: string, modelo: string) => ModeloDeLinguagem;

/**
 * Endereços oficiais, fixos. Passados explicitamente porque, sem eles, os
 * provedores leem ANTHROPIC_BASE_URL / OPENAI_BASE_URL do ambiente — e a
 * chave iria para onde a variável apontasse.
 */
export const ENDERECOS_API: Record<ProvedorIA, string> = {
  claude: 'https://api.anthropic.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  codex: 'https://api.openai.com/v1',
};

/** A chave vai só no cabeçalho de autenticação de cada provedor (x-api-key, x-goog-api-key, Authorization). */
export const fabricaDeModelosReal: FabricaDeModelos = (provedor, chave, modelo) => {
  const baseURL = ENDERECOS_API[provedor];
  if (provedor === 'claude') return createAnthropic({ apiKey: chave, baseURL })(modelo);
  if (provedor === 'gemini') return createGoogleGenerativeAI({ apiKey: chave, baseURL })(modelo);
  return createOpenAI({ apiKey: chave, baseURL })(modelo);
};
