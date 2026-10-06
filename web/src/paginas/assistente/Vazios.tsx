import { motion } from 'motion/react';
import { Link } from 'react-router';
import { cascata, surgir } from '../../componentes/ui';
import { Icone } from '../../icones/Icone';

export const SUGESTOES = [
  { icone: 'orcamento', texto: 'Para onde foi meu dinheiro este mês?' },
  { icone: 'talheres', texto: 'Quanto gastei com delivery nos últimos 3 meses?' },
  { icone: 'repetir', texto: 'Quais assinaturas eu posso cortar?' },
  { icone: 'cartao', texto: 'Como está minha fatura do cartão?' },
] as const;

function saudacao(agora = new Date()): string {
  const h = agora.getHours();
  if (h < 5) return 'Boa madrugada';
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

/** Conversa vazia: um cumprimento e quatro perguntas prontas, que já enviam ao clicar. */
export function BoasVindas({ aoEscolher, desabilitado }: { aoEscolher: (texto: string) => void; desabilitado: boolean }) {
  return (
    <motion.div className="boas-vindas" variants={cascata} initial="inicial" animate="visivel">
      <motion.div className="boas-vindas__marca" variants={surgir} aria-hidden>
        <Icone nome="assistente" tamanho={30} />
      </motion.div>
      <motion.h2 className="boas-vindas__titulo" variants={surgir}>{saudacao()}! O que você quer entender?</motion.h2>
      <motion.p className="boas-vindas__texto" variants={surgir}>
        Pergunte em português, do seu jeito. O assistente consulta o seu extrato, cartões, orçamento e metas para responder.
      </motion.p>
      <div className="boas-vindas__sugestoes">
        {SUGESTOES.map((s) => (
          <motion.button key={s.texto} type="button" className="sugestao-ia" variants={surgir} onClick={() => aoEscolher(s.texto)} disabled={desabilitado}>
            <span className="sugestao-ia__icone"><Icone nome={s.icone} tamanho={17} /></span>
            <span>{s.texto}</span>
          </motion.button>
        ))}
      </div>
    </motion.div>
  );
}

/** Nenhuma conta pronta (CLI ou API): em vez da caixa de texto, explica o que falta e leva aos Ajustes. */
export function SemCli() {
  return (
    <div className="sem-cli" role="note">
      <span className="sem-cli__icone"><Icone nome="plug" tamanho={20} /></span>
      <div>
        <strong>Falta ligar um assistente</strong>
        <p>
          O Fluxo usa o Claude Code, o Gemini CLI ou o Codex CLI que você já tem instalado, com o seu login — ou uma chave de API da Anthropic, do Gemini ou da OpenAI, paga por uso.
        </p>
      </div>
      <Link className="botao botao--primario botao--pequeno" to="/ajustes#assistente">
        <Icone nome="ajustes" tamanho={15} />
        <span>Configurar</span>
      </Link>
    </div>
  );
}
