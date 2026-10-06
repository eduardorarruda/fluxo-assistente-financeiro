import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { api } from '../api/cliente';
import { useEscrita, useEstado, useVisaoGeral } from '../api/consultas';
import { Icone } from '../icones/Icone';
import { haQuantoTempo, mesSemAno, nomeDoMes, somarMeses } from '../util/formato';
import { usePreferencias } from '../util/preferencias';
import { useMes } from '../util/useMes';
import { useAvisar } from './Avisos';
import { ROTAS } from './Navegacao';

const TITULOS: Record<string, string> = { '/conexoes': 'Conexões', '/ajustes': 'Ajustes' };

/** Telas em que o mês não faz sentido (mostram tudo). */
const SEM_MES = ['/cartao', '/caixinhas', '/metas', '/recorrencias', '/contas-a-pagar', '/conexoes', '/ajustes', '/assistente'];

function SeletorDeMes() {
  const { mes, mesAtual, meses, definirMes } = useMes();
  const [direcao, setDirecao] = useState(0);
  const primeiro = meses[meses.length - 1] ?? mesAtual;
  const ir = (n: number) => {
    const novo = somarMeses(mes, n);
    if (novo > mesAtual || novo < primeiro) return;
    setDirecao(n);
    definirMes(novo);
  };
  return (
    <div className="mes">
      <button type="button" className="mes__seta" onClick={() => ir(-1)} disabled={mes <= primeiro} aria-label="Mês anterior">
        <Icone nome="chevron-esq" tamanho={16} />
      </button>
      <div className="mes__rotulo" aria-live="polite">
        <AnimatePresence mode="popLayout" initial={false} custom={direcao}>
          <motion.span
            key={mes}
            custom={direcao}
            initial={{ opacity: 0, y: direcao >= 0 ? 14 : -14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: direcao >= 0 ? -14 : 14 }}
            transition={{ type: 'spring', stiffness: 500, damping: 36 }}
          >
            <strong>{mesSemAno(mes)}</strong> {mes.slice(0, 4)}
          </motion.span>
        </AnimatePresence>
      </div>
      <button type="button" className="mes__seta" onClick={() => ir(1)} disabled={mes >= mesAtual} aria-label="Próximo mês">
        <Icone nome="chevron-dir" tamanho={16} />
      </button>
      {mes !== mesAtual && (
        <motion.button type="button" className="mes__hoje" onClick={() => definirMes(mesAtual)} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} title={nomeDoMes(mesAtual)}>
          Hoje
        </motion.button>
      )}
    </div>
  );
}

function Sino() {
  const { mesAtual } = useMes();
  const { data } = useVisaoGeral(mesAtual);
  const [aberto, setAberto] = useState(false);
  const navegar = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const alertas = data?.alertas ?? [];
  const graves = alertas.filter((a) => a.gravidade !== 'INFO').length;

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setAberto(false);
    window.addEventListener('mousedown', fora);
    return () => window.removeEventListener('mousedown', fora);
  }, [aberto]);

  return (
    <div className="sino" ref={ref}>
      <motion.button
        type="button"
        className="botao-icone"
        aria-label={`Alertas (${alertas.length})`}
        onClick={() => setAberto((a) => !a)}
        animate={graves ? { rotate: [0, -14, 12, -8, 5, 0] } : {}}
        transition={{ duration: 0.9, repeat: graves ? Infinity : 0, repeatDelay: 6 }}
      >
        <Icone nome="sino" tamanho={18} />
        {alertas.length > 0 && <span className={`sino__contador ${graves ? 'sino__contador--grave' : ''}`}>{alertas.length}</span>}
      </motion.button>
      <AnimatePresence>
        {aberto && (
          <motion.div className="popover" initial={{ opacity: 0, y: -8, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.98 }} transition={{ type: 'spring', stiffness: 500, damping: 34 }}>
            <h3 className="popover__titulo">Precisa de atenção</h3>
            {alertas.length === 0 && <p className="popover__vazio">Tudo em ordem por aqui.</p>}
            {alertas.map((a, i) => (
              <motion.button
                type="button"
                key={a.id}
                className={`alerta alerta--${a.gravidade.toLowerCase()}`}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0, transition: { delay: i * 0.04 } }}
                onClick={() => {
                  setAberto(false);
                  navegar(a.destino);
                }}
              >
                <span className="alerta__ponto" />
                <span>
                  <strong>{a.titulo}</strong>
                  <small>{a.detalhe}</small>
                </span>
              </motion.button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Sincronizar() {
  const { data } = useEstado();
  const avisar = useAvisar();
  const sincronizando = data?.conexoes.some((c) => c.sincronizando);
  const escrita = useEscrita(async () => {
    const conexoes = data?.conexoes ?? [];
    for (const c of conexoes) await api.post(`/conexoes/${encodeURIComponent(c.id)}/sincronizar`, { pedirAoBanco: c.provedor === 'pluggy' });
    return conexoes.length;
  });
  const ultima = data?.conexoes.map((c) => c.ultimaSincronizacao).filter(Boolean).sort().at(-1) ?? null;
  const ocupado = escrita.isPending || sincronizando;
  return (
    <button
      type="button"
      className="sincronizar"
      disabled={ocupado || !data?.conexoes.length}
      onClick={() =>
        escrita.mutate(undefined, {
          onSuccess: (n) => avisar('sucesso', n ? 'Tudo atualizado.' : 'Nenhuma conexão para atualizar.'),
          onError: (e) => avisar('erro', (e as Error).message),
        })
      }
      title="Buscar dados novos no banco"
    >
      <Icone nome="sincronizar" tamanho={16} className={ocupado ? 'girando' : ''} />
      <span>{ocupado ? 'Atualizando…' : `Atualizado ${haQuantoTempo(ultima)}`}</span>
    </button>
  );
}

export function Topo() {
  const { pathname } = useLocation();
  const { tema, alternarTema, privado, alternarPrivado } = usePreferencias();
  const rota = ROTAS.find((r) => (r.caminho === '/' ? pathname === '/' : pathname.startsWith(r.caminho)));
  const titulo = rota?.nome ?? TITULOS[pathname] ?? '';
  const comMes = !SEM_MES.some((c) => pathname.startsWith(c));

  return (
    <header className="topo">
      <AnimatePresence mode="wait" initial={false}>
        <motion.h1 key={titulo} className="topo__titulo" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>
          {titulo}
        </motion.h1>
      </AnimatePresence>
      <div className="topo__meio">{comMes && <SeletorDeMes />}</div>
      <div className="topo__acoes">
        <Sincronizar />
        <button type="button" className="botao-icone" onClick={alternarPrivado} aria-label={privado ? 'Mostrar valores' : 'Esconder valores'} title={privado ? 'Mostrar valores (P)' : 'Esconder valores (P)'} aria-pressed={privado}>
          <Icone nome={privado ? 'olho-fechado' : 'olho'} tamanho={18} />
        </button>
        <motion.button type="button" className="botao-icone" onClick={alternarTema} aria-label="Trocar tema" title="Trocar tema (T)" whileTap={{ rotate: 180, scale: 0.9 }}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={tema} initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.2 }} style={{ display: 'grid' }}>
              <Icone nome={tema === 'escuro' ? 'lua' : 'sol'} tamanho={18} />
            </motion.span>
          </AnimatePresence>
        </motion.button>
        <Sino />
      </div>
    </header>
  );
}
