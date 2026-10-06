/**
 * PDF mínimo e válido, escrito à mão: uma página por texto, fonte Helvetica,
 * tabela xref com as posições certas. Só ASCII sem parênteses nem barra
 * invertida nos textos (é o que a string literal do PDF aceita sem escape).
 */
export function pdfDeTeste(paginas: readonly string[]): Buffer {
  const kids = paginas.map((_, i) => `${4 + i * 2} 0 R`).join(' ');
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids}] /Count ${paginas.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  paginas.forEach((texto, i) => {
    const conteudo = texto ? `BT /F1 12 Tf 72 720 Td (${texto}) Tj ET` : '';
    objetos.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
      `<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream`,
    );
  });
  let corpo = '%PDF-1.4\n';
  const posicoes: number[] = [];
  objetos.forEach((o, i) => {
    posicoes.push(corpo.length);
    corpo += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = corpo.length;
  corpo += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  corpo += posicoes.map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('');
  corpo += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(corpo, 'latin1');
}
