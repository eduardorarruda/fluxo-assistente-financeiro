import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Compositor } from './Compositor';
import type { AnexoLocal, ControleAnexos } from './useAnexos';

function anexos(p: Partial<ControleAnexos> = {}): ControleAnexos {
  return { itens: [], enviando: false, idsProntos: [], adicionar: vi.fn(), remover: vi.fn(), esvaziar: vi.fn(), ...p };
}

const item = (p: Partial<AnexoLocal> = {}): AnexoLocal => ({
  chave: 'k1', nome: 'fatura.pdf', tamanho: 2048, previa: null, progresso: 0.4, estado: 'enviando', anexo: null, erro: null, ...p,
});

function montar(p: Partial<Parameters<typeof Compositor>[0]> = {}) {
  const aoEnviar = vi.fn(async () => true);
  const aoParar = vi.fn();
  render(<Compositor anexos={anexos()} gerando={false} enviando={false} parando={false} aoEnviar={aoEnviar} aoParar={aoParar} {...p} />);
  return { aoEnviar: (p.aoEnviar as typeof aoEnviar | undefined) ?? aoEnviar, aoParar, caixa: screen.getByRole('textbox', { name: 'Mensagem' }) };
}

describe('Compositor', () => {
  it('Enter envia o texto aparado e limpa a caixa', async () => {
    const usuario = userEvent.setup();
    const { aoEnviar, caixa } = montar();
    await usuario.type(caixa, '  quanto gastei?  {Enter}');
    expect(aoEnviar).toHaveBeenCalledWith('quanto gastei?');
    expect(caixa).toHaveValue('');
  });

  it('Shift+Enter quebra a linha em vez de enviar', async () => {
    const usuario = userEvent.setup();
    const { aoEnviar, caixa } = montar();
    await usuario.type(caixa, 'linha 1{Shift>}{Enter}{/Shift}linha 2');
    expect(caixa).toHaveValue('linha 1\nlinha 2');
    expect(aoEnviar).not.toHaveBeenCalled();
  });

  it('Enter durante a composição (IME/acentos) não envia', () => {
    const { aoEnviar, caixa } = montar();
    fireEvent.change(caixa, { target: { value: 'ação' } });
    fireEvent.keyDown(caixa, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(caixa, { key: 'Enter', keyCode: 229 });
    expect(aoEnviar).not.toHaveBeenCalled();
    fireEvent.keyDown(caixa, { key: 'Enter' });
    expect(aoEnviar).toHaveBeenCalledWith('ação');
  });

  it('se o envio falha, o texto fica na caixa', async () => {
    const usuario = userEvent.setup();
    const { caixa } = montar({ aoEnviar: vi.fn(async () => false) });
    await usuario.type(caixa, 'oi{Enter}');
    expect(caixa).toHaveValue('oi');
  });

  it('não envia vazio nem enquanto um anexo sobe, e mostra o progresso', async () => {
    const usuario = userEvent.setup();
    const { aoEnviar, caixa } = montar({ anexos: anexos({ itens: [item()], enviando: true }) });
    const enviar = screen.getByRole('button', { name: 'Enviar mensagem' });
    expect(enviar).toBeDisabled();
    await usuario.type(caixa, 'veja o anexo{Enter}');
    expect(aoEnviar).not.toHaveBeenCalled();
    expect(enviar).toHaveAttribute('title', 'Espere os anexos terminarem de subir');
    expect(screen.getByRole('progressbar', { name: 'Enviando fatura.pdf' })).toHaveAttribute('aria-valuenow', '40');
    expect(screen.getByText('Enviando… 40%')).toBeInTheDocument();
  });

  it('só anexo pronto, sem texto, já pode enviar', async () => {
    const usuario = userEvent.setup();
    const pronto = item({ estado: 'enviado', progresso: 1, anexo: { id: 'a1', nome: 'fatura.pdf', mime: 'application/pdf', tamanho: 2048, tipo: 'pdf', situacao: 'indexando', erro: null, origem: 'pessoa', criadoEm: '' } });
    const { aoEnviar } = montar({ anexos: anexos({ itens: [pronto], idsProntos: ['a1'] }) });
    expect(screen.getByText('Lendo o arquivo…')).toBeInTheDocument();
    await usuario.click(screen.getByRole('button', { name: 'Enviar mensagem' }));
    expect(aoEnviar).toHaveBeenCalledWith('');
  });

  it('com resposta em andamento, o botão vira Parar', async () => {
    const usuario = userEvent.setup();
    const { aoParar, aoEnviar, caixa } = montar({ gerando: true });
    expect(screen.queryByRole('button', { name: 'Enviar mensagem' })).not.toBeInTheDocument();
    await usuario.type(caixa, 'outra{Enter}');
    expect(aoEnviar).not.toHaveBeenCalled();
    await usuario.click(screen.getByRole('button', { name: 'Parar resposta' }));
    expect(aoParar).toHaveBeenCalledOnce();
  });

  it('remover um anexo chama o controle com a chave dele', async () => {
    const usuario = userEvent.setup();
    const controle = anexos({ itens: [item({ estado: 'falhou', erro: 'Arquivo grande demais' })] });
    montar({ anexos: controle });
    expect(screen.getByText('Arquivo grande demais')).toBeInTheDocument();
    await usuario.click(screen.getByRole('button', { name: 'Remover fatura.pdf' }));
    expect(controle.remover).toHaveBeenCalledWith('k1');
  });

  it('escolher arquivos e colar imagem entregam os arquivos ao controle', async () => {
    const usuario = userEvent.setup();
    const controle = anexos();
    const { caixa } = montar({ anexos: controle });
    const pdf = new File(['%PDF'], 'extrato.pdf', { type: 'application/pdf' });
    await usuario.upload(screen.getByTestId('seletor-anexos'), pdf);
    expect(controle.adicionar).toHaveBeenCalledWith([pdf]);
    const imagem = new File(['png'], 'print.png', { type: 'image/png' });
    fireEvent.paste(caixa, { clipboardData: { files: [imagem] } });
    expect(controle.adicionar).toHaveBeenLastCalledWith([imagem]);
  });
});
