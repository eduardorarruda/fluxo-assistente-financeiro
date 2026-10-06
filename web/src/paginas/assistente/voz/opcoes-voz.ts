import type { OpcaoSeletor } from '../../../componentes/Seletor';
import type { EstadoVozNatural, VozNatural } from '../../../api/voz-natural';
import { grupoDaVoz, melhorVoz, ordenarVozes } from './fala';
import { opcoesDaFala } from './fala-piper';
import type { PreferenciasVoz } from './preferencias-voz';

/** Valor da opção "automática" no Seletor (a preferência guarda null). */
export const VOZ_AUTOMATICA = '';

type VozListavel = Pick<SpeechSynthesisVoice, 'voiceURI' | 'name' | 'lang' | 'localService'>;

/** Nome sem o prefixo do fabricante repetido ("Google português do Brasil" fica como está). */
const nomeDaVoz = (v: VozListavel) => v.name.replace(/^Microsoft\s+/, '').replace(/\s+-\s+.*$/, '');

/** As vozes para o Seletor: "Automática" no topo, depois pt-BR, outros portugueses e o resto. */
export function opcoesDeVoz(vozes: readonly VozListavel[]): OpcaoSeletor[] {
  const melhor = melhorVoz(vozes);
  const automatica: OpcaoSeletor = {
    valor: VOZ_AUTOMATICA,
    rotulo: 'Automática',
    descricao: melhor ? `Agora: ${nomeDaVoz(melhor)}` : 'A melhor voz em português que houver',
  };
  return [
    automatica,
    ...ordenarVozes(vozes).map((v) => ({
      valor: v.voiceURI,
      rotulo: nomeDaVoz(v),
      descricao: `${v.lang.replace('_', '-')} · ${v.localService ? 'no computador' : 'online'}`,
      grupo: grupoDaVoz(v),
    })),
  ];
}

// ---------- com as vozes naturais (Piper)

/** Valor no Seletor de uma voz natural: "natural:faber". O resto é `voiceURI` do navegador. */
export const PREFIXO_NATURAL = 'natural:';
const GRUPO_NATURAL = 'Voz natural (no computador)';
const GRUPO_NAVEGADOR = 'Voz do navegador';

type VozNaturalListavel = Pick<VozNatural, 'id' | 'nome' | 'genero' | 'qualidade' | 'instalada'>;

/** As naturais instaladas no topo; depois as do navegador, com o grupo dizendo de onde vêm. */
export function opcoesDeVozComNaturais(vozes: readonly VozListavel[], naturais: readonly VozNaturalListavel[]): OpcaoSeletor[] {
  const instaladas = naturais.filter((v) => v.instalada);
  if (instaladas.length === 0) return opcoesDeVoz(vozes);
  return [
    ...instaladas.map((v) => ({
      valor: `${PREFIXO_NATURAL}${v.id}`,
      rotulo: v.nome,
      descricao: `Natural · ${v.genero} · qualidade ${v.qualidade}`,
      grupo: GRUPO_NATURAL,
    })),
    ...opcoesDeVoz(vozes).map((o) =>
      o.valor === VOZ_AUTOMATICA ? { ...o, rotulo: 'Automática', grupo: GRUPO_NAVEGADOR } : { ...o, grupo: `${GRUPO_NAVEGADOR} · ${o.grupo}` },
    ),
  ];
}

/** O valor escolhido hoje no Seletor. */
export function valorDaVoz(prefs: PreferenciasVoz, estado: EstadoVozNatural | null): string {
  const natural = opcoesDaFala(prefs, estado);
  return natural.motor === 'piper' && natural.vozNatural ? `${PREFIXO_NATURAL}${natural.vozNatural}` : (prefs.voz ?? VOZ_AUTOMATICA);
}

/** Escolher no Seletor → a mudança nas preferências (natural liga o Piper; do navegador, desliga). */
export function mudancaDaVoz(valor: string): Partial<PreferenciasVoz> {
  if (valor.startsWith(PREFIXO_NATURAL)) return { motorFala: 'piper', vozNatural: valor.slice(PREFIXO_NATURAL.length) };
  return { motorFala: 'navegador', voz: valor || null };
}
