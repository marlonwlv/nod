import type { FilaOffline, ItemDaFila } from "./fila-offline.ts";

/**
 * O journal de envio (definido em 2026-11-12, por cima da ADR-171): toda fala comum da conversa entra no journal pelo
 * `idEnvio` ANTES do POST e sai quando o servidor confirma. O servidor já deduplica por `idEnvio`, então repetir é seguro:
 *   - falhou por rede (sem resposta, `status` 0, `TypeError` do fetch) ou 5xx: até 5 reenvios, pela MESMA chave, esperando
 *     1, 2, 5, 12 e 30 s; esgotou, a fala fica no journal (vira "falhou" na tela) e volta no próximo boot ou no `online`;
 *   - recusa (4xx): não repete, sai do journal e vira o "falhou" que a fala pendente já tem (o "Tentar de novo" a põe de volta);
 *   - boot (depois da sessão): `reconciliar` devolve o que ficou à conversa certa e reenvia, uma fala por vez por conversa
 *     (na ordem em que foram ditas).
 *
 * O armazém é injetável: o IndexedDB (web/lib/journal-envio-idb.ts) na página; sem ele, a fila offline do `localStorage`
 * (web/lib/fila-offline.ts, `armazemDaFila`), que é o que a página fazia antes. Este arquivo fica sem DOM (o tsconfig do
 * servidor checa os testes).
 */
export type ItemDoJournal = ItemDaFila;

export interface ArmazemDoJournal {
  lerTodos(): Promise<ItemDoJournal[]>;
  gravar(item: ItemDoJournal): Promise<void>;
  apagar(idEnvio: string): Promise<void>;
}

/** As esperas antes de cada reenvio (1 s a 30 s, crescentes): cinco reenvios depois do primeiro POST. */
export const ESPERAS_DO_REENVIO_MS: readonly number[] = [1000, 2000, 5000, 12000, 30000];

export type TipoDaFalha = "rede" | "servidor" | "recusa";

/** Rede (sem resposta) e 5xx repetem; o resto (4xx, erro de programa) não. AbortError (a sessão trocou) conta como rede. */
export function tipoDaFalha(erro: unknown): TipoDaFalha {
  const e = erro as { status?: unknown; name?: unknown } | null;
  if (!e || typeof e !== "object") return "recusa";
  if (e.name === "TypeError" || e.name === "AbortError") return "rede";
  if (typeof e.status !== "number") return "recusa";
  if (e.status === 0) return "rede";
  return e.status >= 500 ? "servidor" : "recusa";
}

export type Desfecho = { ok: true; resposta: unknown } | { ok: false; erro: unknown; tipo: TipoDaFalha };

export type Journal = {
  /**
   * Põe no journal (antes do POST) e envia, repetindo na rede e no 5xx. Resolve com a resposta do servidor; rejeita com o
   * erro final (a recusa logo; a rede e o 5xx depois do último reenvio). A mesma chave já em voo devolve o mesmo envio.
   * `aoFalharPrimeira`: o primeiro POST falhou e vai repetir (quem enviou solta a trava do campo).
   */
  enviar(item: ItemDoJournal, o?: { aoFalharPrimeira?: (erro: unknown) => void }): Promise<unknown>;
  /** Boot: o que ficou no armazém (fora de voo) volta (`aoVoltar`, na ordem em que foi dito) e é reenviado; `aoTerminar` diz como acabou. */
  reconciliar(aoVoltar: (item: ItemDoJournal) => void, aoTerminar: (item: ItemDoJournal, d: Desfecho) => void): Promise<void>;
  /** As falas no journal desta página (em voo ou esgotadas), para a conversa que carrega depois as mostrar. */
  itens(): readonly { item: ItemDoJournal; falhou: boolean }[];
  /** A pessoa descartou a fala: sai do journal e os reenvios dela param. */
  esquecer(idEnvio: string): void;
  /** Outra sessão: os reenvios param e nada é apagado (volta no boot desta pessoa). */
  encerrar(): void;
};

export class JournalEncerrado extends Error {
  constructor() {
    super("journal encerrado");
    this.name = "JournalEncerrado";
  }
}

export function criarJournalDeEnvio(o: {
  armazem: ArmazemDoJournal;
  enviar: (item: ItemDoJournal) => Promise<unknown>;
  esperar?: (ms: number) => Promise<void>;
  esperas?: readonly number[];
}): Journal {
  const esperas = o.esperas ?? ESPERAS_DO_REENVIO_MS;
  const esperar = o.esperar ?? ((ms: number) => new Promise<void>((ok) => setTimeout(ok, ms)));
  const engolir = (p: Promise<unknown>): void => void p.catch(() => undefined);
  const emVoo = new Map<string, Promise<unknown>>();
  const conhecidos = new Map<string, { item: ItemDoJournal; falhou: boolean }>();
  const esquecidos = new Set<string>();
  let encerrado = false;

  function enviar(item: ItemDoJournal, op: { aoFalharPrimeira?: (erro: unknown) => void } = {}): Promise<unknown> {
    const ja = emVoo.get(item.idEnvio);
    if (ja) return ja;
    const id = item.idEnvio;
    esquecidos.delete(id);
    conhecidos.set(id, { item, falhou: false });
    const envio = (async () => {
      // Antes do POST: recarregou no meio, a fala volta no boot. O armazém que falha só deixa de guardar.
      await o.armazem.gravar(item).catch(() => undefined);
      for (let tentativa = 0; ; tentativa++) {
        if (encerrado) throw new JournalEncerrado();
        try {
          const resposta = await o.enviar(item);
          conhecidos.delete(id);
          engolir(o.armazem.apagar(id));
          return resposta;
        } catch (erro) {
          if (tipoDaFalha(erro) === "recusa") {
            conhecidos.delete(id);
            engolir(o.armazem.apagar(id));
            throw erro;
          }
          const espera = esperas[tentativa];
          if (espera === undefined || encerrado || esquecidos.has(id)) {
            if (!esquecidos.has(id)) conhecidos.set(id, { item, falhou: true });
            throw erro;
          }
          if (tentativa === 0) op.aoFalharPrimeira?.(erro);
          await esperar(espera);
          if (esquecidos.has(id)) throw erro;
        }
      }
    })().finally(() => emVoo.delete(id));
    emVoo.set(id, envio);
    return envio;
  }

  return {
    enviar,
    async reconciliar(aoVoltar, aoTerminar) {
      const guardados = await o.armazem.lerTodos().catch(() => [] as ItemDoJournal[]);
      const fora = guardados.filter((i) => !emVoo.has(i.idEnvio) && !esquecidos.has(i.idEnvio)).sort((a, b) => a.em - b.em);
      const porConversa = new Map<string, ItemDoJournal[]>();
      for (const i of fora) porConversa.set(i.conversaId, [...(porConversa.get(i.conversaId) ?? []), i]);
      for (const i of fora) {
        conhecidos.set(i.idEnvio, { item: i, falhou: false });
        aoVoltar(i);
      }
      await Promise.all([...porConversa.values()].map(async (itens) => {
        for (const i of itens) {
          if (encerrado) return;
          if (esquecidos.has(i.idEnvio)) continue;
          try {
            aoTerminar(i, { ok: true, resposta: await enviar(i) });
          } catch (erro) {
            if (erro instanceof JournalEncerrado) return;
            aoTerminar(i, { ok: false, erro, tipo: tipoDaFalha(erro) });
          }
        }
      }));
    },
    itens: () => [...conhecidos.values()],
    esquecer(idEnvio) {
      esquecidos.add(idEnvio);
      conhecidos.delete(idEnvio);
      engolir(o.armazem.apagar(idEnvio));
    },
    encerrar() {
      encerrado = true;
    },
  };
}

/** Sem IndexedDB: o journal guarda na fila offline do `localStorage` (o que a página já fazia), com a mesma forma de item. */
export function armazemDaFila(fila: FilaOffline): ArmazemDoJournal {
  return {
    lerTodos: async () => fila.listar(),
    gravar: async (item) => fila.guardar(item),
    apagar: async (idEnvio) => fila.tirar(idEnvio),
  };
}

/**
 * O IndexedDB com a fila do `localStorage` de reserva: o que a fila guardou antes do journal passa para o IndexedDB na
 * leitura do boot (e sai dela); o IndexedDB que falha (aba privada, cota) cai na fila, como a página fazia antes.
 */
export function armazemComReserva(principal: ArmazemDoJournal, reserva: ArmazemDoJournal): ArmazemDoJournal {
  return {
    async lerTodos() {
      for (const i of await reserva.lerTodos().catch(() => [] as ItemDoJournal[])) {
        try {
          await principal.gravar(i);
          await reserva.apagar(i.idEnvio);
        } catch { /* fica na reserva e é lido de lá */ }
      }
      const [a, b] = await Promise.all([principal.lerTodos().catch(() => [] as ItemDoJournal[]), reserva.lerTodos().catch(() => [] as ItemDoJournal[])]);
      const ids = new Set(a.map((i) => i.idEnvio));
      return [...a, ...b.filter((i) => !ids.has(i.idEnvio))];
    },
    gravar: (item) => principal.gravar(item).catch(() => reserva.gravar(item)),
    async apagar(idEnvio) {
      await Promise.all([principal.apagar(idEnvio).catch(() => undefined), reserva.apagar(idEnvio).catch(() => undefined)]);
    },
  };
}

/** O armazém num mapa (os testes). */
export function journalEmMemoria(inicial: readonly ItemDoJournal[] = []): ArmazemDoJournal & { dados: Map<string, ItemDoJournal> } {
  const dados = new Map(inicial.map((i) => [i.idEnvio, i] as const));
  return {
    dados,
    lerTodos: async () => [...dados.values()],
    gravar: async (item) => void dados.set(item.idEnvio, item),
    apagar: async (idEnvio) => void dados.delete(idEnvio),
  };
}
