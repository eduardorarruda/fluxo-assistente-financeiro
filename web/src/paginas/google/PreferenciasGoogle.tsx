import type { CSSProperties } from 'react';
import { usePreferenciasGoogle, type EstadoGoogle, type PreferenciasGoogle as Preferencias } from '../../api/google';
import { useAvisar } from '../../componentes/Avisos';
import { Seletor, type OpcaoSeletor } from '../../componentes/Seletor';
import { Interruptor } from '../../componentes/ui';

const HORAS: readonly OpcaoSeletor[] = Array.from({ length: 16 }, (_, i) => i + 6).map((h) => ({
  valor: String(h),
  rotulo: `${h}h`,
  selo: h === 9 ? 'Padrão' : undefined,
}));

const ANTECEDENCIAS = [
  { dias: 7, rotulo: '1 semana antes' },
  { dias: 5, rotulo: '5 dias antes' },
  { dias: 3, rotulo: '3 dias antes' },
  { dias: 2, rotulo: '2 dias antes' },
  { dias: 1, rotulo: 'Na véspera' },
] as const;

/** As cores que o Google Agenda usa para cada tipo (paleta "event": uva, mirtilo, pavão, grafite, tomate). */
const LEGENDA = [
  { cor: '#8e24aa', exemplo: 'Cartão Nubank: fecha a fatura', quando: 'no fechamento' },
  { cor: '#3f51b5', exemplo: 'Cartão Nubank: vence a fatura · R$ 1.234,56', quando: 'no vencimento' },
  { cor: '#039be5', exemplo: 'Pagar: Energia · R$ 150,00', quando: 'conta a pagar' },
  { cor: '#616161', exemplo: '✓ Paga: Energia · R$ 150,00', quando: 'depois de paga' },
  { cor: '#d50000', exemplo: '⚠ Em atraso: Internet · R$ 99,90', quando: 'todo dia, até pagar' },
] as const;

interface Props {
  estado: EstadoGoogle;
}

/** O que vai para a agenda e quando o Google avisa. Vale já antes de conectar. */
export function PreferenciasGoogle({ estado }: Props) {
  const mudar = usePreferenciasGoogle();
  const avisar = useAvisar();
  const p = estado.preferencias;
  const salvar = (m: Partial<Preferencias>) => mudar.mutate(m, { onError: (e) => avisar('erro', e.message) });
  const alternarDia = (dias: number) =>
    salvar({ antecedencias: p.antecedencias.includes(dias) ? p.antecedencias.filter((d) => d !== dias) : [...p.antecedencias, dias] });

  return (
    <div className="preferencias-google">
      <h3 className="painel-google__titulo">O que vai para a agenda</h3>
      <div className="ajuste">
        <div><strong>Cartão de crédito</strong><p className="texto-3 pequeno">Fechamento e vencimento de cada fatura, com o valor quando ela fecha.</p></div>
        <Interruptor ligado={p.cartao} aoMudar={(v) => salvar({ cartao: v })} rotulo="Cartão de crédito na agenda" />
      </div>
      <div className="ajuste">
        <div>
          <strong>Contas a pagar</strong>
          <p className="texto-3 pequeno">
            {estado.contasDisponiveis ? 'As contas cadastradas no Fluxo. Ao pagar, o evento vira “✓ Paga”.' : 'As contas a pagar ainda não estão disponíveis nesta versão.'}
          </p>
        </div>
        <Interruptor ligado={p.contas && estado.contasDisponiveis} aoMudar={(v) => salvar({ contas: v })} rotulo="Contas a pagar na agenda" />
      </div>
      <div className="ajuste">
        <div><strong>Alertas de atraso</strong><p className="texto-3 pequeno">Venceu e não pagou: um aviso por dia, no horário abaixo, até o Fluxo ver o pagamento.</p></div>
        <Interruptor ligado={p.atrasos} aoMudar={(v) => salvar({ atrasos: v })} rotulo="Alertas de atraso na agenda" />
      </div>

      <h3 className="painel-google__titulo painel-google__titulo--espaco">Quando o Google avisa</h3>
      <div className="lembretes-google">
        <div className="campo lembretes-google__hora">
          <span>Horário</span>
          <Seletor rotulo="Horário dos avisos" valor={String(p.hora)} opcoes={HORAS} aoMudar={(v) => salvar({ hora: Number(v) })} desabilitado={mudar.isPending} />
        </div>
        <div className="campo">
          <span id="antecedencia-google">Antes do vencimento</span>
          <div className="chips" role="group" aria-labelledby="antecedencia-google">
            {ANTECEDENCIAS.map((a) => (
              <button
                key={a.dias}
                type="button"
                className={`chip ${p.antecedencias.includes(a.dias) ? 'chip--ativo' : ''}`}
                aria-pressed={p.antecedencias.includes(a.dias)}
                onClick={() => alternarDia(a.dias)}
                disabled={mudar.isPending}
              >
                {a.rotulo}
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className="texto-3 pequeno lembretes-google__nota">
        Os vencimentos são eventos de dia inteiro, e o Google só deixa um evento assim avisar <em>até a véspera</em>. No dia seguinte ao vencimento,
        se ainda não estiver pago, chega o alerta de atraso. Os eventos não ocupam a agenda (aparecem como “disponível”).
      </p>

      <h3 className="painel-google__titulo painel-google__titulo--espaco">Como aparece</h3>
      <ul className="legenda-google" aria-label="Exemplos de eventos na agenda Fluxo">
        {LEGENDA.map((l) => (
          <li key={l.exemplo} style={{ '--cor-evento': l.cor } as CSSProperties}>
            <span className="legenda-google__evento">{l.exemplo}</span>
            <span className="texto-3 pequeno">{l.quando}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
