import type { ArmazemDoJournal, ItemDoJournal } from "./journal-envio.ts";

const LOJA = "envios";

/** O IndexedDB da página, ou nada (navegador sem ele, ou que recusa o acesso: a leitura de `indexedDB` pode lançar). */
function idbDaPagina(): IDBFactory | undefined {
  try {
    return globalThis.indexedDB;
  } catch {
    return undefined;
  }
}

/**
 * O armazém do journal de envio (web/lib/journal-envio.ts) no IndexedDB, um banco por pessoa (`dono` = "<tenant>.<pessoa>"),
 * chave `idEnvio`. Sem IndexedDB, `null`: quem chama cai na fila offline do `localStorage` (o comportamento de antes).
 */
export function armazemDoJournalIndexedDb(dono: string, idb: IDBFactory | undefined = idbDaPagina()): ArmazemDoJournal | null {
  if (!idb) return null;
  let banco: Promise<IDBDatabase> | null = null;
  const abrir = (): Promise<IDBDatabase> => (banco ??= new Promise<IDBDatabase>((ok, falha) => {
    const pedido = idb.open(`nod-envios:${dono}`, 1);
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
    lerTodos: () => pedir("readonly", (l) => l.getAll() as IDBRequest<ItemDoJournal[]>),
    gravar: async (item) => void (await pedir("readwrite", (l) => l.put(item, item.idEnvio))),
    apagar: async (idEnvio) => void (await pedir("readwrite", (l) => l.delete(idEnvio))),
  };
}
