import { idExistente } from './Conexoes';

describe('idExistente (ITEM_USER_ALREADY_EXISTS)', () => {
  const id = '3f2b8c1e-9a4d-4e7f-b1c2-0d9e8f7a6b5c';
  it('lê a lista de ids que a Pluggy devolve', () => expect(idExistente({ items: [id] })).toBe(id));
  it('lê a lista de itens', () => expect(idExistente({ items: [{ id }] })).toBe(id));
  it('lê o item único', () => expect(idExistente({ item: { id } })).toBe(id));
  it('ignora o que não é id', () => expect(idExistente({ items: ['x'], errorId: id })).toBeNull());
  it('sem dados', () => expect(idExistente(undefined)).toBeNull());
});
