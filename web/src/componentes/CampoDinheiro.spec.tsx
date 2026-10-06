import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { CampoDinheiro, centavosDosAlgarismos } from './CampoDinheiro';

function Controlado({ inicial = null, aoMudar }: { inicial?: number | null; aoMudar?: (c: number | null) => void }) {
  const [valor, setValor] = useState<number | null>(inicial);
  return <CampoDinheiro aria-label="Valor" valor={valor} aoMudar={(c) => (setValor(c), aoMudar?.(c))} />;
}

const semEspacoDuro = (t: string) => t.replace(/\s/g, ' ');

describe('CampoDinheiro', () => {
  it('algarismos entram pela direita, como numa maquininha', async () => {
    const usuario = userEvent.setup();
    const aoMudar = vi.fn();
    render(<Controlado aoMudar={aoMudar} />);
    const campo = screen.getByRole('textbox', { name: 'Valor' });
    await usuario.type(campo, '15000');
    expect(semEspacoDuro((campo as HTMLInputElement).value)).toBe('R$ 150,00');
    expect(aoMudar).toHaveBeenLastCalledWith(15000);
    await usuario.type(campo, '{Backspace}');
    expect(semEspacoDuro((campo as HTMLInputElement).value)).toBe('R$ 15,00');
  });

  it('apagar tudo deixa vazio (nulo), e letras são ignoradas', async () => {
    const usuario = userEvent.setup();
    const aoMudar = vi.fn();
    render(<Controlado inicial={5} aoMudar={aoMudar} />);
    const campo = screen.getByRole('textbox', { name: 'Valor' });
    await usuario.type(campo, '{Backspace}');
    expect(aoMudar).toHaveBeenLastCalledWith(null);
    expect((campo as HTMLInputElement).value).toBe('');
    await usuario.type(campo, 'abc');
    expect((campo as HTMLInputElement).value).toBe('');
  });

  it('colar entende reais escritos de vários jeitos', () => {
    const aoMudar = vi.fn();
    render(<Controlado aoMudar={aoMudar} />);
    const campo = screen.getByRole('textbox', { name: 'Valor' });
    fireEvent.paste(campo, { clipboardData: { getData: () => 'R$ 1.234,56' } });
    expect(aoMudar).toHaveBeenLastCalledWith(123456);
    fireEvent.paste(campo, { clipboardData: { getData: () => '150' } });
    expect(aoMudar).toHaveBeenLastCalledWith(15000);
  });

  it('centavosDosAlgarismos ignora zeros à esquerda e o que não é algarismo', () => {
    expect(centavosDosAlgarismos('R$ 0,05')).toBe(5);
    expect(centavosDosAlgarismos('R$ 0,00')).toBeNull();
    expect(centavosDosAlgarismos('')).toBeNull();
  });
});
