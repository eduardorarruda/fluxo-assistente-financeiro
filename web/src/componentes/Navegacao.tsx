import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { NavLink, useLocation } from 'react-router';
import { useEstado } from '../api/consultas';
import { Icone } from '../icones/Icone';
import { usePreferencias } from '../util/preferencias';
import { Marca } from './Marca';

export const ROTAS = [
  { caminho: '/', nome: 'Visão geral', icone: 'visao', atalho: '1' },
  { caminho: '/fluxo', nome: 'Fluxo', icone: 'fluxo', atalho: '2' },
  { caminho: '/extrato', nome: 'Extrato', icone: 'extrato', atalho: '3' },
  { caminho: '/cartao', nome: 'Cartão', icone: 'cartao', atalho: '4' },
  { caminho: '/caixinhas', nome: 'Caixinhas', icone: 'caixinha', atalho: '5' },
  { caminho: '/orcamento', nome: 'Orçamento', icone: 'orcamento', atalho: '6' },
  { caminho: '/metas', nome: 'Metas', icone: 'meta', atalho: '7' },
  { caminho: '/recorrencias', nome: 'Recorrências', icone: 'repetir', atalho: '8' },
  { caminho: '/contas-a-pagar', nome: 'Contas a pagar', icone: 'recibo', atalho: 'C' },
  { caminho: '/insights', nome: 'Insights', icone: 'lampada', atalho: '9' },
  { caminho: '/assistente', nome: 'Assistente', icone: 'assistente', atalho: '0' },
] as const;

const RODAPE = [
  { caminho: '/conexoes', nome: 'Conexões', icone: 'plug' },
  { caminho: '/ajustes', nome: 'Ajustes', icone: 'ajustes' },
] as const;

function Item({ caminho, nome, icone, recolhida }: { caminho: string; nome: string; icone: string; recolhida: boolean }) {
  const { pathname } = useLocation();
  const ativo = caminho === '/' ? pathname === '/' : pathname.startsWith(caminho);
  return (
    <NavLink to={caminho} className={`nav__item ${ativo ? 'nav__item--ativo' : ''}`} title={recolhida ? nome : undefined}>
      {ativo && <motion.span layoutId="nav-ativo" className="nav__pilula" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
      <span className="nav__icone"><Icone nome={icone} tamanho={19} /></span>
      <AnimatePresence initial={false}>
        {!recolhida && (
          <motion.span className="nav__nome" initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -6 }} transition={{ duration: 0.15 }}>
            {nome}
          </motion.span>
        )}
      </AnimatePresence>
    </NavLink>
  );
}

export function Navegacao() {
  const { recolhida, alternarRecolhida } = usePreferencias();
  const { data } = useEstado();
  const problema = data?.conexoes.some((c) => ['LOGIN_ERROR', 'OUTDATED', 'WAITING_USER_INPUT'].includes(c.situacao) || c.erro);

  return (
    <motion.nav className="nav" animate={{ width: recolhida ? 'var(--sidebar-recolhida)' : 'var(--sidebar)' }} transition={{ type: 'spring', stiffness: 380, damping: 36 }}>
      <div className="nav__topo">
        <Marca comTexto={!recolhida} />
      </div>
      <LayoutGroup id="nav">
        <div className="nav__lista">
          {ROTAS.map((r) => (
            <Item key={r.caminho} {...r} recolhida={recolhida} />
          ))}
        </div>
        <div className="nav__rodape">
          {data?.demonstracao && !recolhida && (
            <NavLink to="/conexoes" className="nav__demo">
              <span className="nav__demo-pulso" />
              Modo demonstração
            </NavLink>
          )}
          {RODAPE.map((r) => (
            <div key={r.caminho} className="nav__com-marcador">
              <Item {...r} recolhida={recolhida} />
              {r.caminho === '/conexoes' && problema && <span className="nav__marcador" title="Uma conexão precisa de atenção" />}
            </div>
          ))}
          <button type="button" className="nav__item nav__recolher" onClick={alternarRecolhida} aria-label={recolhida ? 'Expandir menu' : 'Recolher menu'}>
            <span className="nav__icone"><Icone nome="recolher" tamanho={19} /></span>
            {!recolhida && <span className="nav__nome">Recolher</span>}
          </button>
        </div>
      </LayoutGroup>
    </motion.nav>
  );
}
