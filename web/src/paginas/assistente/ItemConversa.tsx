import { AnimatePresence, motion } from 'motion/react';
import { type KeyboardEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { ResumoConversa } from '../../api/tipos-assistente';
import { Icone } from '../../icones/Icone';
import { CampoRenomear } from './CampoRenomear';

interface Props {
  conversa: ResumoConversa;
  ativa: boolean;
  aoAbrir: () => void;
  aoFixar: (fixada: boolean) => void;
  aoRenomear: (titulo: string) => void;
  aoExcluir: () => void;
}

/** Menu de ações (⋯): setas navegam, Esc fecha e devolve o foco ao botão. */
function MenuAcoes({ fixada, aoFixar, aoRenomear, aoExcluir, aoFechar }: { fixada: boolean; aoFixar: () => void; aoRenomear: () => void; aoExcluir: () => void; aoFechar: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [acima, setAcima] = useState(false);
  // Antes de pintar: se o menu passaria do fim da lista que rola, ele abre para cima.
  useLayoutEffect(() => {
    const menu = ref.current;
    const limite = menu?.closest('.lista-conversas__rolagem')?.getBoundingClientRect().bottom ?? window.innerHeight;
    if (menu && menu.getBoundingClientRect().bottom > limite) setAcima(true);
  }, []);
  useEffect(() => ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus(), []);
  useEffect(() => {
    const fora = (e: MouseEvent) => ref.current && !ref.current.parentElement?.contains(e.target as Node) && aoFechar();
    window.addEventListener('mousedown', fora);
    return () => window.removeEventListener('mousedown', fora);
  }, [aoFechar]);
  const aoTeclar = (e: KeyboardEvent<HTMLDivElement>) => {
    const itens = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    const i = itens.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      aoFechar();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const passo = e.key === 'ArrowDown' ? 1 : -1;
      itens[(i + passo + itens.length) % itens.length]?.focus();
    } else if (e.key === 'Tab') {
      aoFechar();
    }
  };
  return (
    <motion.div
      ref={ref}
      className={`menu-conversa ${acima ? 'menu-conversa--acima' : ''}`}
      role="menu"
      aria-label="Ações da conversa"
      onKeyDown={aoTeclar}
      initial={{ opacity: 0, y: acima ? 4 : -4, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: acima ? 4 : -4, scale: 0.97 }}
      transition={{ duration: 0.12 }}
    >
      <button type="button" role="menuitem" onClick={aoFixar}>
        <Icone nome="fixar" tamanho={15} /> {fixada ? 'Desafixar' : 'Fixar'}
      </button>
      <button type="button" role="menuitem" onClick={aoRenomear}>
        <Icone nome="editar" tamanho={15} /> Renomear
      </button>
      <button type="button" role="menuitem" className="menu-conversa__perigo" onClick={aoExcluir}>
        <Icone nome="lixo" tamanho={15} /> Excluir
      </button>
    </motion.div>
  );
}

export function ItemConversa({ conversa, ativa, aoAbrir, aoFixar, aoRenomear, aoExcluir }: Props) {
  const [menu, setMenu] = useState(false);
  const [renomeando, setRenomeando] = useState(false);
  const botaoMenu = useRef<HTMLButtonElement>(null);
  const fecharMenu = useCallback(() => {
    setMenu(false);
    botaoMenu.current?.focus();
  }, []);
  const escolher = (acao: () => void) => () => {
    setMenu(false);
    acao();
  };

  if (renomeando) {
    return (
      <li className="conversa conversa--editando">
        <CampoRenomear
          inicial={conversa.titulo}
          aoSalvar={(t) => {
            setRenomeando(false);
            aoRenomear(t);
          }}
          aoCancelar={() => setRenomeando(false)}
        />
      </li>
    );
  }

  return (
    <li className={`conversa ${ativa ? 'conversa--ativa' : ''} ${menu ? 'conversa--menu' : ''}`}>
      <Link to={`/assistente/${encodeURIComponent(conversa.id)}`} className="conversa__link" aria-current={ativa ? 'page' : undefined} onClick={aoAbrir} title={conversa.titulo}>
        <Icone nome={`ia-${conversa.provedor}`} tamanho={13} className={`conversa__cli conversa__cli--${conversa.provedor}`} />
        {conversa.fixada && <Icone nome="fixar" tamanho={13} className="conversa__fixada" titulo="Fixada" />}
        <span className="conversa__titulo">{conversa.titulo}</span>
        {conversa.gerando && <Icone nome="sincronizar" tamanho={14} className="girando conversa__gerando" titulo="Respondendo" />}
      </Link>
      <button
        ref={botaoMenu}
        type="button"
        className="conversa__mais"
        aria-label={`Ações de “${conversa.titulo}”`}
        aria-haspopup="menu"
        aria-expanded={menu}
        onClick={() => setMenu((m) => !m)}
      >
        <Icone nome="pontos" tamanho={16} />
      </button>
      <AnimatePresence>
        {menu && (
          <MenuAcoes
            fixada={conversa.fixada}
            aoFechar={fecharMenu}
            aoFixar={escolher(() => aoFixar(!conversa.fixada))}
            aoRenomear={escolher(() => setRenomeando(true))}
            aoExcluir={escolher(aoExcluir)}
          />
        )}
      </AnimatePresence>
    </li>
  );
}
