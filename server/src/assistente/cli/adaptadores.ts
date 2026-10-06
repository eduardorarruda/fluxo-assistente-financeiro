import { adaptadorClaude } from './claude';
import { adaptadorCodex } from './codex';
import { adaptadorGemini } from './gemini';
import type { AdaptadorCli, ProvedorIA } from './tipos';

export const ADAPTADORES: Readonly<Record<ProvedorIA, AdaptadorCli>> = {
  claude: adaptadorClaude,
  gemini: adaptadorGemini,
  codex: adaptadorCodex,
};
