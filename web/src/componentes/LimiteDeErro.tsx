import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ehFalhaDeCarregamento, recarregarUmaVez } from '../util/recarga';
import { Botao, Vazio } from './ui';

type Props = { children: ReactNode };
type Estado = { erro: unknown };

/**
 * Sem isto, qualquer erro numa tela desmonta o app inteiro e sobra só o fundo preto.
 * Versão velha do front: recarrega sozinho. Qualquer outro erro: mostra o aviso no lugar da tela.
 * Fica dentro da transição de rota, então trocar de tela já recomeça do zero.
 */
export class LimiteDeErro extends Component<Props, Estado> {
  state: Estado = { erro: null };

  static getDerivedStateFromError(erro: unknown): Estado {
    return { erro };
  }

  componentDidCatch(erro: unknown, info: ErrorInfo): void {
    if (ehFalhaDeCarregamento(erro) && recarregarUmaVez()) return;
    console.error('Tela com erro:', erro, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.erro === null) return this.props.children;
    const versaoVelha = ehFalhaDeCarregamento(this.state.erro);
    return (
      <Vazio
        icone="alerta"
        titulo={versaoVelha ? 'O Fluxo foi atualizado' : 'Esta tela tropeçou'}
        texto={
          versaoVelha
            ? 'Esta janela ainda está com a versão anterior. Recarregue para usar a nova.'
            : 'Algo deu errado ao montar esta tela. Os seus dados estão intactos; recarregar costuma resolver.'
        }
        acao={
          <Botao variante="primario" icone="sincronizar" onClick={() => location.reload()}>
            Recarregar
          </Botao>
        }
      />
    );
  }
}
