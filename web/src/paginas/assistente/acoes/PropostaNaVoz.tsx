import { AnimatePresence, motion } from 'motion/react';
import { useAcoesDaConversa } from '../../../api/acoes-assistente';
import { CartaoProposta } from './CartaoAcao';

/**
 * No modo conversação, a proposta que espera a pessoa aparece em cima das
 * legendas, com botões grandes. Dizer "sim" também aprova (pelo turno normal:
 * o assistente chama `confirmar_proposta`, que confere a fala dela).
 */
export function PropostaNaVoz({ conversaId }: { conversaId: string | undefined }) {
  const { data } = useAcoesDaConversa(conversaId);
  const pendente = data?.findLast((a) => a.situacao === 'pendente');
  return (
    <AnimatePresence>
      {pendente && (
        <motion.div
          key={pendente.id}
          className="modo-voz__proposta"
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.98 }}
          transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
        >
          <CartaoProposta acao={pendente} grande />
          <p className="modo-voz__proposta-dica">Diga “sim” para aprovar, ou toque num botão.</p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
