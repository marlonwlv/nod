import { armazemEmMemoria, type ArmazemDeConversas, type RegistroDaConversa } from "./cache-conversas.ts";

const LOJA = "conversas";

/** O IndexedDB da página, ou nada (navegador sem ele, ou que recusa o acesso: a leitura de `indexedDB` pode lançar). */
function idbDaPagina(): IDBFactory | undefined {
  try {
    return globalThis.indexedDB;
  } catch {
    return undefined;
  }
}

/**
 * Item 5 do chat: o armazém do cache de conversas (web/lib/cache-conversas.ts) no IndexedDB do navegador; um banco por
 * pessoa (`dono` = "<tenant>.<pessoa>"), a conversa de uma não vaza para a outra. Sem IndexedDB, um mapa (só a memória).
 */
export function armazemIndexedDb(dono: string, idb: IDBFactory | undefined = idbDaPagina()): ArmazemDeConversas {
  if (!idb) return armazemEmMemoria();
  let banco: Promise<IDBDatabase> | null = null;
  const abrir = (): Promise<IDBDatabase> => (banco ??= new Promise<IDBDatabase>((ok, falha) => {
    const pedido = idb.open(`nod-conversas:${dono}`, 1);
    pedido.onupgradeneeded = () => { if (!pedido.result.objectStoreNames.contains(LOJA)) pedido.result.createObjectStore(LOJA); };
    pedido.onsuccess = () => ok(pedido.result);
    pedido.onerror = () => falha(pedido.error);
    pedido.onblocked = () => falha(new Error("IndexedDB bloqueado"));
  }));
  const pedir = <T>(modo: IDBTransactionMode, fazer: (loja: IDBObjectStore) => IDBRequest<T>): Promise<T> => abrir().then((db) => new Promise<T>((ok, falha) => {
    const pedido = fazer(db.transaction(LOJA, modo).objectStore(LOJA));
    pedido.onsuccess = () => ok(pedido.result);
    pedido.onerror = () => falha(pedido.error);
  }));
  return {
    async lerTodos() {
      const [chaves, valores] = await Promise.all([pedir("readonly", (l) => l.getAllKeys()), pedir("readonly", (l) => l.getAll() as IDBRequest<RegistroDaConversa[]>)]);
      return chaves.map((k, i) => [String(k), valores[i]!] as [string, RegistroDaConversa]);
    },
    ler: (chave) => pedir("readonly", (l) => l.get(chave) as IDBRequest<RegistroDaConversa | undefined>),
    gravar: async (chave, registro) => void (await pedir("readwrite", (l) => l.put(registro, chave))),
    apagar: async (chave) => void (await pedir("readwrite", (l) => l.delete(chave))),
  };
}
