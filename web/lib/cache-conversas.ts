import type { ConversaDto } from "../../src/contracts/api.ts";

/**
 * Item 5 do chat (trocar de bot sem "carregando conversa"): o cache por conversa, com stale-while-revalidate.
 *
 * - Memória: a conversa aberta mora em `estado.conversas` (o reducer); este módulo guarda, além dela, um espelho do que
 *   está no IndexedDB, lido uma vez ao entrar na sessão, para a leitura ser síncrona (pintar no mesmo quadro do clique).
 * - IndexedDB: um banco por pessoa (`nod-conversas:<tenant>.<pessoa>`), chave `conversa:<id>`, as últimas 200 mensagens.
 *   Vale depois de recarregar a página.
 * - Revalidação: quem abre a conversa pinta o guardado e chama `revalidar` com a leitura de hoje (GET da conversa); a
 *   resposta é guardada e o reducer a aplica por cima, e a timeline troca só os blocos que mudaram (web/lib/regioes.ts).
 * - Despejo: 30 conversas no máximo; sai a usada há mais tempo (LRU, pela ordem de uso, que vai junto no registro).
 *
 * O armazém do IndexedDB mora em web/lib/cache-conversas-idb.ts (este arquivo fica sem DOM: o tsconfig do servidor, que
 * checa os testes, não tem `lib: dom`). Tudo é melhor esforço: o armazém que falha (aba privada, cota) só deixa de guardar.
 */

export const LIMITE_DE_CONVERSAS = 30;
export const LIMITE_DE_MENSAGENS = 200;
/** Sem cache nenhum, a conversa anterior fica na tela até 80 ms; depois, só o spinner. */
export const ESPERA_DO_SPINNER_MS = 80;
/** O mouse parado 150 ms numa linha da barra busca a conversa daquele bot antes do clique. */
export const ESPERA_DO_PREFETCH_MS = 150;

export type RegistroDaConversa = { conversa: ConversaDto; usadaEm: number };

/** O mínimo que o cache pede do lugar onde guarda (o IndexedDB na página; um mapa nos testes). */
export interface ArmazemDeConversas {
  lerTodos(): Promise<[string, RegistroDaConversa][]>;
  gravar(chave: string, registro: RegistroDaConversa): Promise<void>;
  apagar(chave: string): Promise<void>;
}

export const chaveDaConversa = (id: string): string => `conversa:${id}`;
const idDaChave = (chave: string): string | null => (chave.startsWith("conversa:") ? chave.slice(9) : null);

/**
 * O que vai para o cache: o DTO da conversa sem o que é só da memória (pendentes, carregadaEm) e sem o que envelhece
 * errado (turnos em curso ou na fila: guardados, voltariam "trabalhando" depois de terminar), com as últimas 200 mensagens.
 */
export function paraGuardar(c: ConversaDto & { carregadaEm?: number; pendentes?: unknown; enviadas?: unknown }, maximo = LIMITE_DE_MENSAGENS): ConversaDto {
  const { carregadaEm: _carregadaEm, pendentes: _pendentes, enviadas: _enviadas, ...dto } = c;
  return { ...dto, mensagens: dto.mensagens.length > maximo ? dto.mensagens.slice(-maximo) : dto.mensagens, turnosEmCurso: [], turnosPendentes: [] };
}

export type CacheDeConversas = {
  /** Resolve quando o espelho do armazém foi lido (antes disso, `ler` só acha o que esta página guardou). */
  readonly pronto: Promise<void>;
  /** Síncrono: a conversa guardada (e ela passa a ser a mais usada), ou null. */
  ler(id: string): ConversaDto | null;
  /** Guarda (memória e armazém) e despeja a menos usada além do limite. */
  guardar(c: ConversaDto): void;
  apagar(id: string): void;
  /** Stale-while-revalidate: busca a versão de hoje, guarda e devolve. A falha sobe (quem chama decide), o guardado fica. */
  revalidar(id: string, buscar: () => Promise<ConversaDto>): Promise<ConversaDto>;
  /** Os ids, da menos usada à mais usada (testes e diagnóstico). */
  ids(): string[];
};

export function criarCacheDeConversas(armazem: ArmazemDeConversas, o: { limite?: number; maxMensagens?: number; relogio?: () => number } = {}): CacheDeConversas {
  const limite = o.limite ?? LIMITE_DE_CONVERSAS;
  const maxMensagens = o.maxMensagens ?? LIMITE_DE_MENSAGENS;
  const relogio = o.relogio ?? Date.now;
  // A ordem do Map é a ordem de uso: tocar = tirar e pôr de novo no fim; o primeiro é o próximo a sair.
  let memoria = new Map<string, RegistroDaConversa>();
  let ultimoUso = 0;
  const marcarUso = (): number => (ultimoUso = Math.max(relogio(), ultimoUso + 1));
  const engolir = (p: Promise<unknown>): void => void p.catch(() => undefined);

  function despejar(): void {
    while (memoria.size > limite) {
      const velho = memoria.keys().next().value as string;
      memoria.delete(velho);
      engolir(armazem.apagar(chaveDaConversa(velho)));
    }
  }

  const pronto = armazem.lerTodos().then((todos) => {
    // O que esta página já guardou enquanto o armazém abria é mais novo: fica por cima (e por último na ordem).
    const lidos = todos
      .map(([chave, r]) => [idDaChave(chave), r] as const)
      .filter((x): x is readonly [string, RegistroDaConversa] => x[0] !== null && !memoria.has(x[0]) && !!x[1]?.conversa)
      .sort((a, b) => a[1].usadaEm - b[1].usadaEm);
    for (const [, r] of lidos) ultimoUso = Math.max(ultimoUso, r.usadaEm);
    memoria = new Map([...lidos, ...memoria]);
    despejar();
  }, () => undefined);

  function guardar(c: ConversaDto): void {
    const id = c.conversa.id;
    const registro = { conversa: paraGuardar(c, maxMensagens), usadaEm: marcarUso() };
    memoria.delete(id);
    memoria.set(id, registro);
    engolir(armazem.gravar(chaveDaConversa(id), registro));
    despejar();
  }

  return {
    pronto,
    ler(id) {
      const r = memoria.get(id);
      if (!r) return null;
      // Tocar muda só a ordem na memória; o armazém ganha a ordem nova no próximo `guardar` (a revalidação de quem abriu).
      memoria.delete(id);
      memoria.set(id, { ...r, usadaEm: marcarUso() });
      return r.conversa;
    },
    guardar,
    apagar(id) {
      memoria.delete(id);
      engolir(armazem.apagar(chaveDaConversa(id)));
    },
    async revalidar(id, buscar) {
      const nova = await buscar();
      if (nova.conversa.id === id) guardar(nova);
      return nova;
    },
    ids: () => [...memoria.keys()],
  };
}

/** O armazém num mapa: o que a página usa sem IndexedDB (nada sobrevive ao recarregar) e o que os testes injetam. */
export function armazemEmMemoria(inicial: Iterable<[string, RegistroDaConversa]> = []): ArmazemDeConversas & { dados: Map<string, RegistroDaConversa> } {
  const dados = new Map(inicial);
  return {
    dados,
    lerTodos: async () => [...dados.entries()],
    gravar: async (chave, registro) => void dados.set(chave, registro),
    apagar: async (chave) => void dados.delete(chave),
  };
}

/**
 * Sem cache nenhum: até 80 ms a conversa anterior fica na tela; depois, a área limpa e só o spinner. Puro (o relógio e o
 * agendar vêm de fora): `segurar(chave, agora)` diz se a timeline ainda deve ficar como está. A espera começa na primeira
 * vez que a tela pede uma conversa sem nada para pintar, e agenda um redesenho para quando acabar; `soltar` a encerra.
 */
export function criarEsperaDoSpinner(agendar: (fn: () => void, ms: number) => void, redesenhar: () => void, espera = ESPERA_DO_SPINNER_MS): { segurar(chave: string, agora: number): boolean; soltar(): void } {
  let atual: { chave: string; desde: number } | null = null;
  return {
    /** A conversa chegou (ou a tela é outra): a próxima conversa sem cache espera de novo. */
    soltar() {
      atual = null;
    },
    segurar(chave, agora) {
      if (atual?.chave !== chave) {
        atual = { chave, desde: agora };
        agendar(redesenhar, espera);
      }
      return agora - atual.desde < espera;
    },
  };
}
