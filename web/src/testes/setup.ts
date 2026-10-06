import '@testing-library/jest-dom/vitest';

// O jsdom não traz estas APIs de navegador; os componentes as usam para medir e animar.
class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
globalThis.ResizeObserver ??= ObservadorFalso as unknown as typeof ResizeObserver;
globalThis.IntersectionObserver ??= ObservadorFalso as unknown as typeof IntersectionObserver;
window.matchMedia ??= ((consulta: string) => ({
  matches: consulta.includes('reduce'),
  media: consulta,
  onchange: null,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;
Element.prototype.scrollIntoView ??= function scrollIntoView() {};
