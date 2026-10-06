import { decodificarTexto, identificarArquivo } from './tipo-arquivo';

const bytes = (...partes: (number[] | string)[]) =>
  Buffer.concat(partes.map((p) => (typeof p === 'string' ? Buffer.from(p, 'latin1') : Buffer.from(p))));

const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'resto');
const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0], 'resto');
const PDF = bytes('%PDF-1.7\n...');

describe('identificarArquivo', () => {
  it('reconhece imagens pelos bytes', () => {
    expect(identificarArquivo(PNG, 'a.png')).toEqual({ tipo: 'imagem', mime: 'image/png', extensao: 'png' });
    expect(identificarArquivo(JPEG, 'a.jpg')).toEqual({ tipo: 'imagem', mime: 'image/jpeg', extensao: 'jpg' });
    expect(identificarArquivo(bytes('GIF89a...'), 'a.gif')).toEqual({ tipo: 'imagem', mime: 'image/gif', extensao: 'gif' });
    expect(identificarArquivo(bytes('RIFF', [1, 2, 3, 4], 'WEBPVP8 '), 'a.webp')).toEqual({ tipo: 'imagem', mime: 'image/webp', extensao: 'webp' });
  });

  it('reconhece PDF pelos bytes', () => {
    expect(identificarArquivo(PDF, 'extrato.pdf')).toEqual({ tipo: 'pdf', mime: 'application/pdf', extensao: 'pdf' });
  });

  it('o conteúdo manda, não a extensão', () => {
    expect(identificarArquivo(PDF, 'foto.png')).toMatchObject({ tipo: 'pdf', extensao: 'pdf' });
    expect(identificarArquivo(PNG, 'notas.txt')).toMatchObject({ tipo: 'imagem', extensao: 'png' });
  });

  it('aceita texto com as extensões conhecidas', () => {
    expect(identificarArquivo(bytes('data;valor\n2026-09-01;10,00'), 'gastos.csv')).toEqual({ tipo: 'texto', mime: 'text/csv', extensao: 'csv' });
    expect(identificarArquivo(bytes('# Plano'), 'plano.md')).toEqual({ tipo: 'texto', mime: 'text/markdown', extensao: 'md' });
    expect(identificarArquivo(bytes('{"a":1}'), 'dados.json')).toEqual({ tipo: 'texto', mime: 'application/json', extensao: 'json' });
    expect(identificarArquivo(bytes('OFXHEADER:100'), 'extrato.OFX')).toEqual({ tipo: 'texto', mime: 'application/x-ofx', extensao: 'ofx' });
    expect(identificarArquivo(bytes('olá'), 'nota.txt')).toEqual({ tipo: 'texto', mime: 'text/plain', extensao: 'txt' });
  });

  it('recusa binário disfarçado de texto', () => {
    expect(identificarArquivo(bytes('MZ', [0, 0, 0], 'programa'), 'leia.txt')).toBeNull();
    expect(identificarArquivo(bytes([0x7f], 'ELF', [2, 1, 1, 0]), 'x.csv')).toBeNull();
  });

  it('recusa texto com extensão desconhecida e arquivos vazios', () => {
    expect(identificarArquivo(bytes('<script>'), 'pagina.html')).toBeNull();
    expect(identificarArquivo(bytes('echo oi'), 'script.sh')).toBeNull();
    expect(identificarArquivo(Buffer.alloc(0), 'vazio.txt')).toBeNull();
  });
});

describe('decodificarTexto', () => {
  it('lê UTF-8, inclusive com BOM', () => {
    expect(decodificarTexto(Buffer.from('﻿Ação', 'utf8'))).toBe('Ação');
  });

  it('cai para Windows-1252 quando não é UTF-8 válido (OFX e CSV de banco)', () => {
    expect(decodificarTexto(Buffer.from([0x41, 0xe7, 0xe3, 0x6f]))).toBe('Ação');
  });
});
