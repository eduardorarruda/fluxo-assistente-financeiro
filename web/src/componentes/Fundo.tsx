/**
 * Fundo vivo: três manchas de luz desfocadas que derivam devagar. Só CSS
 * (transform + opacity, que a GPU faz de graça); some com "menos movimento".
 */
export function Fundo() {
  return (
    <div className="fundo" aria-hidden="true">
      <div className="fundo__mancha fundo__mancha--a" />
      <div className="fundo__mancha fundo__mancha--b" />
      <div className="fundo__mancha fundo__mancha--c" />
      <div className="fundo__grao" />
    </div>
  );
}
