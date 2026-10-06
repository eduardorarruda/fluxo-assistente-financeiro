import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { CampoData, dataNoCampo, dataPorExtenso, semanasDoMes } from './CampoData';

function Controlado({ inicial = '', aoMudar }: { inicial?: string; aoMudar?: (d: string) => void }) {
  const [valor, setValor] = useState(inicial);
  return <CampoData rotulo="Vencimento" valor={valor} hoje="2026-10-02" aoMudar={(d) => (setValor(d), aoMudar?.(d))} />;
}

describe('CampoData', () => {
  it('abre no mês de hoje, escolhe um dia com o mouse e mostra por extenso', async () => {
    const usuario = userEvent.setup();
    const aoMudar = vi.fn();
    render(<Controlado aoMudar={aoMudar} />);
    await usuario.click(screen.getByRole('button', { name: /Vencimento: Escolha o dia/ }));
    expect(await screen.findByRole('dialog', { name: 'Outubro de 2026' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sexta, 2 de outubro de 2026' })).toHaveAttribute('aria-current', 'date');
    await usuario.click(screen.getByRole('button', { name: 'Sábado, 10 de outubro de 2026' }));
    expect(aoMudar).toHaveBeenCalledWith('2026-10-10');
    expect(screen.getByRole('button', { name: /Vencimento: Sábado, 10 de outubro de 2026/ })).toBeInTheDocument();
  });

  it('teclado: setas andam, PageDown troca de mês, Enter escolhe', async () => {
    const usuario = userEvent.setup();
    const aoMudar = vi.fn();
    render(<Controlado inicial="2026-01-31" aoMudar={aoMudar} />);
    await usuario.click(screen.getByRole('button', { name: /Vencimento:/ }));
    const dia = await screen.findByRole('button', { name: 'Sábado, 31 de janeiro de 2026' });
    fireEvent.keyDown(dia, { key: 'PageDown' });
    expect(await screen.findByRole('dialog', { name: 'Fevereiro de 2026' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowLeft' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Sexta, 27 de fevereiro de 2026' }), { key: 'Enter' });
    expect(aoMudar).toHaveBeenCalledWith('2026-02-27');
  });

  it('Esc fecha só o calendário (não deixa o evento chegar a quem está em volta)', async () => {
    const usuario = userEvent.setup();
    const deFora = vi.fn();
    window.addEventListener('keydown', deFora);
    render(<Controlado />);
    await usuario.click(screen.getByRole('button', { name: /Vencimento:/ }));
    const dialogo = await screen.findByRole('dialog');
    fireEvent.keyDown(dialogo, { key: 'Escape' });
    expect(deFora).not.toHaveBeenCalled();
    window.removeEventListener('keydown', deFora);
  });

  it('atalhos de Hoje e Amanhã', async () => {
    const usuario = userEvent.setup();
    const aoMudar = vi.fn();
    render(<Controlado aoMudar={aoMudar} />);
    await usuario.click(screen.getByRole('button', { name: /Vencimento:/ }));
    await usuario.click(await screen.findByRole('button', { name: 'Amanhã' }));
    expect(aoMudar).toHaveBeenCalledWith('2026-10-03');
  });

  it('semanas do mês começam no domingo e completam a última semana', () => {
    const semanas = semanasDoMes('2026-10');
    expect(semanas[0]).toEqual([null, null, null, null, '2026-10-01', '2026-10-02', '2026-10-03']);
    expect(semanas.at(-1)?.at(-1)).toBe('2026-10-31');
    expect(semanas.flat().filter(Boolean)).toHaveLength(31);
    expect(semanasDoMes('2026-11').at(-1)).toEqual(['2026-11-29', '2026-11-30', null, null, null, null, null]);
    expect(dataPorExtenso('2026-10-10')).toBe('Sábado, 10 de outubro de 2026');
    expect(dataNoCampo('2026-10-10')).toBe('Sáb, 10 out 2026');
  });
});
