/** Ajudantes de teste: um PNG mínimo e um `fetch` falso que responde em sequência (nada de rede). */

export const CHAVE_TESTE = 'AIzaSyTESTE-chave_falsa-0123456789AbCd';
export const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(120, 7)]);
export const PNG64 = PNG.toString('base64');

export interface RespostaFalsa {
  status: number;
  corpo: unknown;
}

export function fetchFalso(respostas: RespostaFalsa[]) {
  const pedidos: { url: string; init: RequestInit; corpo: Record<string, any> }[] = [];
  let i = 0;
  const buscar = vi.fn(async (url: string | URL, init?: RequestInit) => {
    pedidos.push({ url: String(url), init: init ?? {}, corpo: JSON.parse(String(init?.body ?? '{}')) });
    const r = respostas[Math.min(i++, respostas.length - 1)]!;
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { buscar, pedidos };
}

export const respostaComImagem = (): RespostaFalsa => ({ status: 200, corpo: { output_image: { mime_type: 'image/png', data: PNG64 } } });
export const erroGoogle = (status: number, message: string, statusTexto = ''): RespostaFalsa => ({
  status,
  corpo: { error: { code: status, message, status: statusTexto } },
});
