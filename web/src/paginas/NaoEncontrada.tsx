import { Link } from 'react-router';

/** Endereço que não existe: diz isso em vez de mostrar outra tela no lugar. */
export function NaoEncontrada() {
  return (
    <section className="sem-sessao" aria-labelledby="nao-encontrada">
      <h2 id="nao-encontrada">Esta página não existe</h2>
      <p>O endereço pode ter mudado ou ter sido digitado errado.</p>
      <p>
        <Link to="/">Voltar para a visão geral</Link>
      </p>
    </section>
  );
}
