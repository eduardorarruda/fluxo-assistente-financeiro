import { useReducedMotion } from 'motion/react';
import { useEffect, useRef } from 'react';
import { useQuadros } from './useQuadros';

/**
 * A esfera do modo conversação, desenhada num canvas a cada quadro.
 * - ouvindo: a borda ondula e cresce com o nível do microfone, com ondas saindo;
 * - pensando: respira devagar, com um brilho girando por dentro;
 * - falando: pulsa com o envelope da voz;
 * - pausado: quieta e acinzentada.
 * As cores vêm dos tokens do tema (e mudam junto quando o tema troca). Com
 * "reduzir movimento", a forma fica redonda e só a intensidade acompanha a voz.
 */

export type ModoOrbe = 'preparando' | 'ouvindo' | 'pensando' | 'falando' | 'pausado' | 'erro';

interface Props {
  modo: ModoOrbe;
  /** Nível 0–1 do que está soando agora (microfone ou voz). */
  nivel: () => number;
  /** Rótulo para leitores de tela (a esfera em si é decorativa). */
  rotulo: string;
}

type Rgb = [number, number, number];

interface Paleta {
  marca: Rgb;
  clara: Rgb;
  escura: Rgb;
  info: Rgb;
  entrada: Rgb;
  neutra: Rgb;
  critico: Rgb;
  claro: boolean;
}

const PONTOS = 120;
const TAU = Math.PI * 2;

function lerCor(estilo: CSSStyleDeclaration, nome: string, padrao: Rgb): Rgb {
  const valor = estilo.getPropertyValue(nome).trim();
  const hex = valor.match(/^#([0-9a-f]{6})$/i)?.[1];
  if (!hex) return padrao;
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
}

function lerPaleta(): Paleta {
  const estilo = getComputedStyle(document.documentElement);
  return {
    marca: lerCor(estilo, '--marca', [139, 92, 246]),
    clara: lerCor(estilo, '--marca-clara', [196, 181, 253]),
    escura: lerCor(estilo, '--marca-escura', [109, 40, 217]),
    info: lerCor(estilo, '--info', [96, 165, 250]),
    entrada: lerCor(estilo, '--entrada', [52, 211, 153]),
    neutra: lerCor(estilo, '--texto-3', [124, 132, 158]),
    critico: lerCor(estilo, '--critico', [244, 63, 94]),
    claro: document.documentElement.dataset.tema === 'claro',
  };
}

const misturar = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const rgba = (c: Rgb, a: number) => `rgba(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0}, ${Math.max(0, Math.min(1, a)).toFixed(3)})`;

function corDeDestaque(modo: ModoOrbe, p: Paleta): Rgb {
  switch (modo) {
    case 'ouvindo':
      return p.info;
    case 'falando':
      return misturar(p.clara, p.entrada, 0.45);
    case 'pausado':
    case 'preparando':
      return p.neutra;
    case 'erro':
      return p.critico;
    default:
      return p.clara;
  }
}

/** Estado que muda devagar entre quadros (para nada "pular" quando o modo troca). */
interface Suave {
  nivel: number;
  destaque: Rgb;
  cinza: number;
  agitacao: number;
}

function raio(theta: number, t: number, base: number, agitacao: number): number {
  const onda = Math.sin(3 * theta + t * 1.1) * 0.55 + Math.sin(5 * theta - t * 1.7) * 0.3 + Math.sin(2 * theta + t * 0.6) * 0.35;
  return base * (1 + agitacao * onda);
}

function desenhar(ctx: CanvasRenderingContext2D, lado: number, t: number, modo: ModoOrbe, s: Suave, p: Paleta, reduzir: boolean) {
  const c = lado / 2;
  const respiro = 0.5 + 0.5 * Math.sin(t * (modo === 'pensando' ? 1.9 : 1.2));
  const escala = reduzir ? 1 + s.nivel * 0.04 : 1 + s.nivel * 0.1 + (modo === 'pensando' ? respiro * 0.035 : 0);
  const base = lado * 0.28 * escala;
  const tempo = reduzir ? 0 : t;
  const corpo = misturar(p.marca, p.neutra, s.cinza);
  const clara = misturar(p.clara, p.neutra, s.cinza * 0.8);
  const escura = misturar(p.escura, p.neutra, s.cinza * 0.6);
  ctx.clearRect(0, 0, lado, lado);

  // Halo
  // O halo termina antes da borda do canvas: senão aparece o quadrado.
  const halo = ctx.createRadialGradient(c, c, base * 0.6, c, c, Math.min(c * 0.98, base * (1.6 + s.nivel * 0.3)));
  halo.addColorStop(0, rgba(s.destaque, (p.claro ? 0.22 : 0.34) * (0.55 + s.nivel)));
  halo.addColorStop(1, rgba(s.destaque, 0));
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, lado, lado);

  // Ondas saindo enquanto ouve
  if (modo === 'ouvindo' && !reduzir) {
    for (let i = 0; i < 2; i++) {
      const fase = (t * 0.55 + i * 0.5) % 1;
      ctx.beginPath();
      ctx.arc(c, c, Math.min(c - 2, base * (1.04 + fase * 0.6)), 0, TAU);
      ctx.strokeStyle = rgba(s.destaque, (1 - fase) * (0.12 + s.nivel * 0.4));
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  // Corpo: a forma ondulada
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i <= PONTOS; i++) {
    const theta = (i / PONTOS) * TAU;
    const r = raio(theta, tempo, base, reduzir ? 0 : s.agitacao);
    const x = c + Math.cos(theta) * r;
    const y = c + Math.sin(theta) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  const giro = tempo * 0.25;
  const fundo = ctx.createLinearGradient(c + Math.cos(giro) * base, c + Math.sin(giro) * base, c - Math.cos(giro) * base, c - Math.sin(giro) * base);
  fundo.addColorStop(0, rgba(clara, 1));
  fundo.addColorStop(0.55, rgba(corpo, 1));
  fundo.addColorStop(1, rgba(escura, 1));
  ctx.fillStyle = fundo;
  ctx.fill();
  ctx.clip();

  // Luzes que passeiam por dentro
  ctx.globalCompositeOperation = 'screen';
  const luzes: [number, number, Rgb, number][] = [
    [Math.sin(tempo * 0.7) * 0.45, Math.cos(tempo * 0.9) * 0.4, s.destaque, 0.85],
    [Math.cos(tempo * 0.5 + 2) * 0.5, Math.sin(tempo * 0.8 + 1) * 0.45, clara, 0.6],
    [Math.sin(tempo * 1.1 + 4) * 0.35, Math.cos(tempo * 0.6 + 3) * 0.5, misturar(s.destaque, clara, 0.5), 0.5],
  ];
  for (const [dx, dy, cor, forca] of luzes) {
    const x = c + dx * base;
    const y = c + dy * base;
    const luz = ctx.createRadialGradient(x, y, 0, x, y, base * (0.9 + s.nivel * 0.4));
    luz.addColorStop(0, rgba(cor, forca * (0.45 + s.nivel * 0.55) * (1 - s.cinza * 0.6)));
    luz.addColorStop(1, rgba(cor, 0));
    ctx.fillStyle = luz;
    ctx.fillRect(0, 0, lado, lado);
  }

  // Pensando: um brilho girando
  if (modo === 'pensando' && !reduzir && typeof ctx.createConicGradient === 'function') {
    const conico = ctx.createConicGradient(t * 1.6, c, c);
    conico.addColorStop(0, 'rgba(255, 255, 255, 0)');
    conico.addColorStop(0.12, 'rgba(255, 255, 255, 0.22)');
    conico.addColorStop(0.3, 'rgba(255, 255, 255, 0)');
    conico.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = conico;
    ctx.fillRect(0, 0, lado, lado);
  }
  ctx.globalCompositeOperation = 'source-over';

  // Reflexo no alto, à esquerda
  const reflexo = ctx.createRadialGradient(c - base * 0.38, c - base * 0.45, 0, c - base * 0.38, c - base * 0.45, base * 0.75);
  reflexo.addColorStop(0, 'rgba(255, 255, 255, 0.38)');
  reflexo.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = reflexo;
  ctx.fillRect(0, 0, lado, lado);
  ctx.restore();

  // Contorno sutil
  ctx.beginPath();
  for (let i = 0; i <= PONTOS; i++) {
    const theta = (i / PONTOS) * TAU;
    const r = raio(theta, tempo, base, reduzir ? 0 : s.agitacao);
    if (i === 0) ctx.moveTo(c + Math.cos(theta) * r, c + Math.sin(theta) * r);
    else ctx.lineTo(c + Math.cos(theta) * r, c + Math.sin(theta) * r);
  }
  ctx.strokeStyle = p.claro ? 'rgba(255, 255, 255, 0.5)' : 'rgba(255, 255, 255, 0.14)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function nivelAlvo(modo: ModoOrbe, medido: number, t: number): number {
  if (modo === 'ouvindo' || modo === 'falando') return medido;
  if (modo === 'pensando') return 0.12 + 0.1 * (0.5 + 0.5 * Math.sin(t * 1.9));
  return 0.03;
}

function agitacaoAlvo(modo: ModoOrbe, nivel: number): number {
  if (modo === 'ouvindo') return 0.018 + nivel * 0.075;
  if (modo === 'falando') return 0.022 + nivel * 0.065;
  if (modo === 'pensando') return 0.03;
  return 0.012;
}

export function Orbe({ modo, nivel, rotulo }: Props) {
  const tela = useRef<HTMLCanvasElement>(null);
  const reduzir = useReducedMotion() ?? false;
  const paleta = useRef<Paleta | null>(null);
  const suave = useRef<Suave | null>(null);
  const lado = useRef(0);
  const contexto = useRef<CanvasRenderingContext2D | null>(null);

  // Tamanho em pixels reais (nítido em tela HiDPI) e cores do tema atual.
  useEffect(() => {
    const el = tela.current;
    if (!el) return;
    paleta.current = lerPaleta();
    contexto.current = el.getContext('2d');
    const medir = () => {
      const css = el.clientWidth;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      lado.current = css;
      el.width = Math.round(css * dpr);
      el.height = Math.round(css * dpr);
      contexto.current?.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(el);
    const tema = new MutationObserver(() => (paleta.current = lerPaleta()));
    tema.observe(document.documentElement, { attributes: true, attributeFilter: ['data-tema'] });
    return () => {
      observador.disconnect();
      tema.disconnect();
    };
  }, []);

  useQuadros((t) => {
    const p = paleta.current;
    const ctx = contexto.current;
    if (!p || !ctx || lado.current === 0) return;
    const s = (suave.current ??= { nivel: 0, destaque: corDeDestaque(modo, p), cinza: 0, agitacao: 0.02 });
    const alvo = nivelAlvo(modo, nivel(), t);
    s.nivel += (alvo - s.nivel) * (alvo > s.nivel ? 0.35 : 0.1);
    s.destaque = misturar(s.destaque, corDeDestaque(modo, p), 0.06);
    s.cinza += ((modo === 'pausado' || modo === 'preparando' ? 0.75 : 0) - s.cinza) * 0.06;
    s.agitacao += (agitacaoAlvo(modo, s.nivel) - s.agitacao) * 0.12;
    desenhar(ctx, lado.current, t, modo, s, p, reduzir);
  }, true);

  return <canvas ref={tela} className={`orbe orbe--${modo}`} role="img" aria-label={rotulo} />;
}
