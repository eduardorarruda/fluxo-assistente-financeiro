import { useCriarConta, useMudarConfig, useMudarConta, useRemoverConta } from '../../api/assistente';
import type { ConfigAssistente, ContaIA, MudancaConta, NovaConta } from '../../api/tipos-assistente';
import { useAvisar } from '../../componentes/Avisos';

const mensagemDe = (e: unknown) => (e instanceof Error ? e.message : 'Algo deu errado.');

/** Criou: o id da conta nova (null se não deu para achar). Não criou: a mensagem do servidor, para mostrar no formulário. */
export type ResultadoCriacao = { ok: true; contaId: string | null } | { ok: false; erro: string };

/** O que os cartões de conta dos Ajustes podem fazer. Erros viram aviso (ou voltam, para o formulário mostrar); o retorno diz se deu certo. */
export interface AcoesContas {
  ocupado: boolean;
  salvando: boolean;
  trocandoChave: boolean;
  totalContas: number;
  contaPadrao: string | null;
  definirPadrao: (conta: ContaIA) => void;
  mudar: (conta: ContaIA, mudanca: MudancaConta, sucesso?: string) => Promise<boolean>;
  remover: (conta: ContaIA) => Promise<boolean>;
  criar: (corpo: NovaConta) => Promise<ResultadoCriacao>;
  /** Devolve null se trocou, ou a mensagem do erro (o campo mostra ali mesmo). */
  trocarChave: (conta: ContaIA, chave: string) => Promise<string | null>;
}

/** A conta que apareceu na resposta e não estava antes; sem isso, a do mesmo provedor e tipo com o mesmo nome. */
function idDaNova(antes: ContaIA[], depois: ContaIA[], corpo: NovaConta): string | null {
  const conhecidas = new Set(antes.map((c) => c.id));
  const tipo = corpo.tipo ?? 'cli';
  const nova = depois.find((c) => !conhecidas.has(c.id)) ?? depois.find((c) => c.provedor === corpo.provedor && (c.tipo ?? 'cli') === tipo && c.nome === corpo.nome);
  return nova?.id ?? null;
}

export function useAcoesContas(config: ConfigAssistente | undefined): AcoesContas {
  const avisar = useAvisar();
  const padrao = useMudarConfig();
  const criar = useCriarConta();
  const mudar = useMudarConta();
  const chave = useMudarConta();
  const remover = useRemoverConta();

  async function comAviso<T>(promessa: Promise<T>, sucesso?: string): Promise<T | null> {
    try {
      const r = await promessa;
      if (sucesso) avisar('sucesso', sucesso);
      return r;
    } catch (e) {
      avisar('erro', mensagemDe(e));
      return null;
    }
  }

  return {
    ocupado: padrao.isPending || criar.isPending || mudar.isPending || chave.isPending || remover.isPending,
    salvando: mudar.isPending,
    trocandoChave: chave.isPending,
    totalContas: config?.contas.length ?? 0,
    contaPadrao: config?.contaPadrao ?? null,
    definirPadrao: (conta) => void comAviso(padrao.mutateAsync({ contaPadrao: conta.id }), `${conta.nome} agora é a conta padrão.`),
    mudar: async (conta, mudanca, sucesso) => (await comAviso(mudar.mutateAsync({ contaId: conta.id, ...mudanca }), sucesso)) !== null,
    remover: async (conta) => (await comAviso(remover.mutateAsync(conta.id), `${conta.nome} foi removida.`)) !== null,
    criar: async (corpo) => {
      const antes = config?.contas ?? [];
      try {
        const depois = await criar.mutateAsync(corpo);
        return { ok: true, contaId: idDaNova(antes, depois.contas, corpo) };
      } catch (e) {
        return { ok: false, erro: mensagemDe(e) };
      } finally {
        // O corpo (que pode ter a chave) sai do cache de mutações.
        criar.reset();
      }
    },
    trocarChave: async (conta, nova) => {
      try {
        await chave.mutateAsync({ contaId: conta.id, chave: nova });
        avisar('sucesso', `Chave de ${conta.nome} trocada.`);
        return null;
      } catch (e) {
        return mensagemDe(e);
      } finally {
        chave.reset();
      }
    },
  };
}
