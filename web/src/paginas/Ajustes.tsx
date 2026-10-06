import { motion } from 'motion/react';
import { api } from '../api/cliente';
import { useEscrita, useEstado, useRegras } from '../api/consultas';
import { useAvisar } from '../componentes/Avisos';
import { BotaoIcone, Carregando, Cartao, CategoriaIcone, Interruptor, Pagina } from '../componentes/ui';
import { Icone } from '../icones/Icone';
import { useCategoriaPorId } from '../util/categorias';
import { usePreferencias } from '../util/preferencias';
import { AjustesAssistente } from './assistente/AjustesAssistente';
import { AjustesGoogle } from './google/AjustesGoogle';

const ATALHOS = [
  ['Alt + 0…9', 'Ir para uma tela do menu'],
  ['Alt + N', 'Nova conversa no Assistente'],
  ['Alt + M', 'Ditar no Assistente (Esc para parar)'],
  ['Alt + V', 'Conversar por voz com o Assistente'],
  ['/', 'Buscar no extrato'],
  ['P', 'Esconder / mostrar valores'],
  ['T', 'Tema claro / escuro'],
  ['Esc', 'Fechar gaveta ou janela'],
  ['Enter', 'Enviar no Assistente (Shift + Enter quebra a linha)'],
];

export function Ajustes() {
  const { tema, alternarTema, privado, alternarPrivado } = usePreferencias();
  const { data: estado, isLoading } = useEstado();
  const regras = useRegras().data ?? [];
  const categoria = useCategoriaPorId();
  const avisar = useAvisar();
  const configurar = useEscrita((c: { caixinhasNoSaldo: boolean }) => api.put('/configuracoes', c));
  const apagarRegra = useEscrita((id: string) => api.delete(`/regras/${id}`));
  if (isLoading || !estado) return <Carregando />;

  return (
    <Pagina>
      <div className="grade grade--2">
        <Cartao titulo="Aparência" icone="sol">
          <div className="ajuste">
            <div><strong>Tema escuro</strong><p className="texto-3 pequeno">O claro também está caprichado.</p></div>
            <Interruptor ligado={tema === 'escuro'} aoMudar={alternarTema} rotulo="Tema escuro" />
          </div>
          <div className="ajuste">
            <div><strong>Modo privacidade</strong><p className="texto-3 pequeno">Embaça os valores até você passar o mouse. Bom para compartilhar a tela.</p></div>
            <Interruptor ligado={privado} aoMudar={alternarPrivado} rotulo="Modo privacidade" />
          </div>
        </Cartao>
        <Cartao titulo="Cálculo" icone="camadas">
          <div className="ajuste">
            <div>
              <strong>O saldo da conta já inclui as caixinhas</strong>
              <p className="texto-3 pequeno">
                Ligue se o saldo que aparece aqui for igual ao total do app do Nubank <em>com</em> as caixinhas. Assim o patrimônio não conta o mesmo dinheiro duas vezes.
              </p>
            </div>
            <Interruptor
              ligado={estado.configuracoes.caixinhasNoSaldo}
              aoMudar={(v) => configurar.mutate({ caixinhasNoSaldo: v }, { onSuccess: () => avisar('sucesso', 'Patrimônio recalculado.') })}
              rotulo="Caixinhas no saldo"
            />
          </div>
        </Cartao>
      </div>

      <AjustesGoogle />

      <AjustesAssistente />

      <Cartao titulo="Regras de categoria" icone="editar" acoes={<span className="texto-3 pequeno">Crie no extrato: abra um movimento e escolha a categoria</span>}>
        {regras.length === 0 ? (
          <p className="texto-3 pequeno">Nenhuma regra ainda. Quando você recategoriza um movimento e marca “sempre que aparecer…”, a regra aparece aqui.</p>
        ) : (
          <div className="regras">
            {regras.map((r, i) => {
              const cat = categoria(r.categoriaId);
              return (
                <motion.div key={r.id} className="regra" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
                  <span className="regra__ordem">{i + 1}</span>
                  <span className="regra__texto">“{r.texto}”</span>
                  <Icone nome="seta-dir" tamanho={15} className="texto-3" />
                  <CategoriaIcone categoria={cat} tamanho={28} />
                  <span>{cat.nome}</span>
                  {r.sentido && <span className="texto-3 pequeno">({r.sentido === 'SAIDA' ? 'só gastos' : 'só entradas'})</span>}
                  <span style={{ flex: 1 }} />
                  <BotaoIcone icone="lixo" rotulo="Apagar regra" onClick={() => apagarRegra.mutate(r.id, { onSuccess: () => avisar('sucesso', 'Regra apagada. As categorias foram recalculadas.') })} />
                </motion.div>
              );
            })}
          </div>
        )}
      </Cartao>

      <div className="grade grade--2">
        <Cartao titulo="Atalhos de teclado" icone="teclado">
          <dl className="atalhos">
            {ATALHOS.map(([tecla, acao]) => (
              <div key={tecla}><dt><kbd>{tecla}</kbd></dt><dd>{acao}</dd></div>
            ))}
          </dl>
        </Cartao>
        <Cartao titulo="Sobre o Fluxo" icone="info">
          <ul className="como-ler">
            <li><Icone nome="cadeado" tamanho={16} /> <span>Banco de dados local: <code>data/fluxo.db</code> (SQLite). Para fazer backup, copie esse arquivo.</span></li>
            <li><Icone nome="plug" tamanho={16} /> <span>Pluggy {estado.pluggyConfigurada ? 'configurada' : 'não configurada'} · {estado.conexoes.length} conexão(ões).</span></li>
            <li><Icone nome="fluxo" tamanho={16} /> <span>NestJS + React, um processo só. Código em <code>server/</code> e <code>web/</code>.</span></li>
          </ul>
        </Cartao>
      </div>
    </Pagina>
  );
}
