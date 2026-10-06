import { createHash } from 'node:crypto';

/**
 * A página que o Google abre na janelinha depois do consentimento. HTML
 * próprio (fora do React): ela só avisa a janela do Fluxo e se fecha.
 *
 * O script é fixo — nenhum dado entra nele (o resultado vai num atributo
 * `data-`, escapado) — e é liberado na CSP pelo hash, sem 'unsafe-inline'.
 * Ele avisa o Fluxo por três caminhos, porque nenhum é garantido:
 * BroadcastChannel (mesma origem), `opener.postMessage` restrito à própria
 * origem (o Google pode ter cortado o `opener`), e a tela de Ajustes ainda
 * consulta o estado enquanto espera.
 */

const SCRIPT = `(function(){var c=document.body.getAttribute('data-resultado');
try{history.replaceState(null,'',location.pathname)}catch(e){}
var m={tipo:'fluxo-google',resultado:c};
try{var b=new BroadcastChannel('fluxo-google');b.postMessage(m);b.close()}catch(e){}
try{if(window.opener)window.opener.postMessage(m,location.origin)}catch(e){}
var f=document.getElementById('fechar');if(f)f.addEventListener('click',function(){window.close()});
if(c==='ok')setTimeout(function(){window.close()},2500);})();`;

const HASH_DO_SCRIPT = `'sha256-${createHash('sha256').update(SCRIPT).digest('base64')}'`;

/** CSP só desta página: nada de fora, nenhum script além do de cima. */
export const CSP_DO_RETORNO = [
  "default-src 'none'",
  `script-src ${HASH_DO_SCRIPT}`,
  "style-src 'unsafe-inline'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

function escapar(texto: string): string {
  return texto.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export interface ConteudoDoRetorno {
  ok: boolean;
  titulo: string;
  texto: string;
}

export function paginaDeRetorno({ ok, titulo, texto }: ConteudoDoRetorno): string {
  const icone = ok
    ? '<path d="M5 12.5l4.5 4.5L19 7.5"/>'
    : '<path d="M12 8v5"/><path d="M12 16.5v.01"/><path d="M10.3 3.9L2.4 17.6A2 2 0 0 0 4.1 20.6h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>Fluxo · Google Agenda</title>
<style>
:root{--fundo:#07080d;--cartao:#10131d;--borda:rgba(148,163,214,.14);--texto:#eef1fa;--texto2:#b3bad0;--marca:#8b5cf6;--bom:#34d399;--ruim:#fb7185;color-scheme:dark}
@media (prefers-color-scheme:light){:root{--fundo:#f6f7fb;--cartao:#fff;--borda:rgba(30,41,82,.1);--texto:#141827;--texto2:#4b5470;--marca:#7c3aed;--bom:#059669;--ruim:#e11d48;color-scheme:light}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:var(--fundo);color:var(--texto);font:15px/1.55 'IBM Plex Sans',system-ui,sans-serif}
main{max-width:400px;width:100%;padding:32px 28px;border-radius:22px;background:var(--cartao);border:1px solid var(--borda);text-align:center;box-shadow:0 30px 80px -30px rgba(0,0,0,.5)}
.icone{width:56px;height:56px;margin:0 auto 16px;border-radius:50%;display:grid;place-items:center;background:color-mix(in srgb,var(--cor) 16%,transparent);color:var(--cor)}
.icone svg{width:28px;height:28px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
h1{margin:0 0 8px;font-size:19px;font-weight:600}p{margin:0;color:var(--texto2)}
button{margin-top:22px;height:40px;padding:0 18px;border-radius:12px;border:1px solid var(--borda);background:transparent;color:var(--texto);font:inherit;font-weight:500;cursor:pointer}
button:hover{border-color:var(--marca)}button:focus-visible{outline:2px solid var(--marca);outline-offset:2px}
</style></head>
<body data-resultado="${ok ? 'ok' : 'erro'}"><main role="${ok ? 'status' : 'alert'}">
<div class="icone" style="--cor:var(${ok ? '--bom' : '--ruim'})"><svg viewBox="0 0 24 24" aria-hidden="true">${icone}</svg></div>
<h1>${escapar(titulo)}</h1><p>${escapar(texto)}</p>
<button id="fechar" type="button">Fechar esta janela</button>
</main><script>${SCRIPT}</script></body></html>`;
}
