import type { ConversaComCursor, RespostaMensagensDesde } from "../../src/contracts/estado-vivo.ts";

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
 * - Gravação com 2 s de atraso por conversa (várias releituras seguidas gravam uma vez); a aba que some grava o que
 *   esperava (`descarregar`).
 * - A réplica parada há 10 min sai da memória (o IndexedDB fica, e `carregar` a traz de volta ao abrir); a aberta e a
 *   com turno vivo ficam (quem chama diz quais, em `manter`).
 * - A barra em dia: `criarRevalidacaoEmSegundoPlano` relê, uma por vez, as conversas da barra que já têm réplica.
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
/** A gravação no IndexedDB espera 2 s parada, por conversa: várias releituras seguidas gravam uma vez (a última). */
export const ATRASO_DA_GRAVACAO_MS = 2000;
/** A réplica sem uso há 10 min sai da MEMÓRIA (o IndexedDB fica); a conversa aberta e a com turno vivo nunca. */
export const PARADA_MS = 10 * 60_000;

export type RegistroDaConversa = { conversa: ConversaComCursor; usadaEm: number };

/** O mínimo que o cache pede do lugar onde guarda (o IndexedDB na página; um mapa nos testes). */
export interface ArmazemDeConversas {
  lerTodos(): Promise<[string, RegistroDaConversa][]>;
  /** Um registro só (a réplica que saiu da memória volta por aqui); sem ele, `lerTodos` serve. */
  ler?(chave: string): Promise<RegistroDaConversa | undefined>;
  gravar(chave: string, registro: RegistroDaConversa): Promise<void>;
  apagar(chave: string): Promise<void>;
}

/** O relógio de agendar (o `setTimeout` da página; o de mentira do vitest nos testes). */
export type Temporizador = { agendar(fn: () => void, ms: number): unknown; cancelar(h: unknown): void };
const temporizadorPadrao: Temporizador = {
  agendar: (fn, ms) => setTimeout(fn, ms),
  cancelar: (h) => clearTimeout(h as Parameters<typeof clearTimeout>[0]),
};

export const chaveDaConversa = (id: string): string => `conversa:${id}`;
const idDaChave = (chave: string): string | null => (chave.startsWith("conversa:") ? chave.slice(9) : null);

/** Aplica a resposta incremental mantendo a posição das editadas e anexando as mensagens novas. */
export function juntarMudancasDaConversa(anterior: ConversaComCursor, resposta: RespostaMensagensDesde): ConversaComCursor | null {
  if (resposta.cursor_velho !== false || !resposta.cursor) return null;
  if (resposta.mensagens.length === 0) return { ...anterior, cursor: resposta.cursor };
  const mudadas = new Map(resposta.mensagens.map((m) => [m.id, m]));
  const ids = new Set(anterior.mensagens.map((m) => m.id));
  const mensagens = anterior.mensagens.map((m) => mudadas.get(m.id) ?? m);
  for (const m of resposta.mensagens) if (!ids.has(m.id)) mensagens.push(m);
  return { ...anterior, mensagens, cursor: resposta.cursor };
}

/**
 * O que vai para o cache: o DTO da conversa sem o que é só da memória (pendentes, carregadaEm) e sem o que envelhece
 * errado (turnos em curso ou na fila: guardados, voltariam "trabalhando" depois de terminar), com as últimas 200 mensagens.
 */
export function paraGuardar(c: ConversaComCursor & { carregadaEm?: number; pendentes?: unknown; enviadas?: unknown }, maximo = LIMITE_DE_MENSAGENS): ConversaComCursor {
  const { carregadaEm: _carregadaEm, pendentes: _pendentes, enviadas: _enviadas, ...dto } = c;
  return { ...dto, mensagens: dto.mensagens.length > maximo ? dto.mensagens.slice(-maximo) : dto.mensagens, turnosEmCurso: [], turnosPendentes: [] };
}

export type CacheDeConversas = {
  /** Resolve quando o espelho do armazém foi lido (antes disso, `ler` só acha o que esta página guardou). */
  readonly pronto: Promise<void>;
  /** O espelho do armazém já foi lido (antes disso, não dá para dizer que uma conversa nunca foi aberta). */
  estaPronto(): boolean;
  /** Síncrono: a conversa guardada na memória (e ela passa a ser a mais usada), ou null. */
  ler(id: string): ConversaComCursor | null;
  /** Há réplica desta conversa (na memória ou só no armazém). */
  temGuardada(id: string): boolean;
  /** A réplica que saiu da memória volta do armazém (e passa a ser a mais usada); null se não há. */
  carregar(id: string): Promise<ConversaComCursor | null>;
  /** Guarda (memória já; armazém 2 s depois, por conversa) e despeja a menos usada além do limite. */
  guardar(c: ConversaComCursor): void;
  apagar(id: string): void;
  /**
   * Stale-while-revalidate: busca a versão de hoje, guarda e devolve. A falha sobe (quem chama decide), o guardado fica.
   * `emSegundoPlano` (a barra em dia): não conta como uso nem traz para a memória a réplica que já tinha saído dela.
   */
  revalidar(id: string, buscar: (anterior: ConversaComCursor | null) => Promise<ConversaComCursor>, o?: { emSegundoPlano?: boolean }): Promise<ConversaComCursor>;
  /** Grava agora o que esperava os 2 s (a aba que some não pode perder a última releitura). */
  descarregar(): void;
  /** Tira da memória as réplicas sem uso há `parada` ms, salvo as que `manter` segura; devolve os ids. O armazém fica. */
  despejarParadas(manter: (id: string) => boolean, parada?: number): string[];
  /** Os ids na memória, da menos usada à mais usada (testes e diagnóstico). */
  ids(): string[];
};

export function criarCacheDeConversas(armazem: ArmazemDeConversas, o: { limite?: number; maxMensagens?: number; relogio?: () => number; atrasoDaGravacao?: number; temporizador?: Temporizador } = {}): CacheDeConversas {
  const limite = o.limite ?? LIMITE_DE_CONVERSAS;
  const maxMensagens = o.maxMensagens ?? LIMITE_DE_MENSAGENS;
  const relogio = o.relogio ?? Date.now;
  const atraso = o.atrasoDaGravacao ?? ATRASO_DA_GRAVACAO_MS;
  const temporizador = o.temporizador ?? temporizadorPadrao;
  // A ordem do Map é a ordem de uso: tocar = tirar e pôr de novo no fim.
  let memoria = new Map<string, RegistroDaConversa>();
  // id → usadaEm do que está (ou vai estar, com a gravação esperando) no armazém, mesmo fora da memória.
  const noArmazem = new Map<string, number>();
  // A gravação que espera os 2 s, por conversa (a mais nova troca a anterior).
  const aGravar = new Map<string, { registro: RegistroDaConversa; h: unknown }>();
  let lido = false;
  let ultimoUso = 0;
  const marcarUso = (): number => (ultimoUso = Math.max(relogio(), ultimoUso + 1));
  const engolir = (p: Promise<unknown>): void => void p.catch(() => undefined);

  function gravarJa(id: string, registro: RegistroDaConversa): void {
    engolir(armazem.gravar(chaveDaConversa(id), registro));
  }
  function gravarDepois(id: string, registro: RegistroDaConversa): void {
    noArmazem.set(id, registro.usadaEm);
    const antes = aGravar.get(id);
    if (antes) temporizador.cancelar(antes.h);
    if (atraso <= 0) { aGravar.delete(id); gravarJa(id, registro); return; }
    const h = temporizador.agendar(() => {
      aGravar.delete(id);
      gravarJa(id, registro);
    }, atraso);
    aGravar.set(id, { registro, h });
  }
  function descarregarUma(id: string): void {
    const p = aGravar.get(id);
    if (!p) return;
    temporizador.cancelar(p.h);
    aGravar.delete(id);
    gravarJa(id, p.registro);
  }
  function esquecer(id: string): void {
    const p = aGravar.get(id);
    if (p) temporizador.cancelar(p.h);
    aGravar.delete(id);
    memoria.delete(id);
    noArmazem.delete(id);
    engolir(armazem.apagar(chaveDaConversa(id)));
  }

  /** O limite vale para tudo o que o cache conhece (memória e armazém): sai a usada há mais tempo, dos dois. */
  function despejar(): void {
    const todas = new Map(noArmazem);
    for (const [id, r] of memoria) todas.set(id, r.usadaEm);
    while (todas.size > limite) {
      let velho: string | null = null;
      let menor = Infinity;
      for (const [id, em] of todas) if (em < menor) { menor = em; velho = id; }
      if (velho === null) return;
      todas.delete(velho);
      esquecer(velho);
    }
  }

  const pronto = armazem.lerTodos().then((todos) => {
    // O que esta página já guardou enquanto o armazém abria é mais novo: fica por cima (e por último na ordem).
    const lidos = todos
      .map(([chave, r]) => [idDaChave(chave), r] as const)
      .filter((x): x is readonly [string, RegistroDaConversa] => x[0] !== null && !memoria.has(x[0]) && !!x[1]?.conversa)
      .sort((a, b) => a[1].usadaEm - b[1].usadaEm);
    for (const [id, r] of lidos) {
      ultimoUso = Math.max(ultimoUso, r.usadaEm);
      if (!noArmazem.has(id)) noArmazem.set(id, r.usadaEm);
    }
    memoria = new Map([...lidos, ...memoria]);
    despejar();
  }, () => undefined).finally(() => { lido = true; });

  function guardar(c: ConversaComCursor): void {
    const id = c.conversa.id;
    const registro = { conversa: paraGuardar(c, maxMensagens), usadaEm: marcarUso() };
    memoria.delete(id);
    memoria.set(id, registro);
    gravarDepois(id, registro);
    despejar();
  }

  async function lerDoArmazem(id: string): Promise<RegistroDaConversa | undefined> {
    const pendente = aGravar.get(id)?.registro;
    if (pendente) return pendente;
    const chave = chaveDaConversa(id);
    if (armazem.ler) return armazem.ler(chave);
    return (await armazem.lerTodos()).find(([k]) => k === chave)?.[1];
  }

  return {
    pronto,
    estaPronto: () => lido,
    ler(id) {
      const r = memoria.get(id);
      if (!r) return null;
      // Tocar muda só a ordem na memória; o armazém ganha a ordem nova no próximo `guardar` (a revalidação de quem abriu).
      memoria.delete(id);
      memoria.set(id, { ...r, usadaEm: marcarUso() });
      return r.conversa;
    },
    temGuardada: (id) => memoria.has(id) || noArmazem.has(id),
    async carregar(id) {
      const naMemoria = memoria.get(id);
      if (naMemoria) return naMemoria.conversa;
      if (!noArmazem.has(id)) return null;
      const r = await lerDoArmazem(id).catch(() => undefined);
      // Apagada (ou guardada de novo) enquanto o armazém respondia: vale o que a página tem agora.
      if (!noArmazem.has(id)) return null;
      if (memoria.has(id)) return memoria.get(id)!.conversa;
      if (!r?.conversa) return null;
      memoria.set(id, { conversa: r.conversa, usadaEm: marcarUso() });
      return r.conversa;
    },
    guardar,
    apagar: esquecer,
    async revalidar(id, buscar, op = {}) {
      const anterior = memoria.get(id)?.conversa ?? (noArmazem.has(id) ? (await lerDoArmazem(id))?.conversa ?? null : null);
      const nova = await buscar(anterior);
      if (nova.conversa.id !== id) return nova;
      if (!op.emSegundoPlano) { guardar(nova); return nova; }
      const naMemoria = memoria.get(id);
      const registro = { conversa: paraGuardar(nova, maxMensagens), usadaEm: naMemoria?.usadaEm ?? noArmazem.get(id) ?? 0 };
      // Sem mexer na ordem de uso: a releitura de fundo não é a pessoa abrindo a conversa.
      if (naMemoria) memoria.set(id, registro);
      gravarDepois(id, registro);
      despejar();
      return nova;
    },
    descarregar() {
      for (const id of [...aGravar.keys()]) descarregarUma(id);
    },
    despejarParadas(manter, parada = PARADA_MS) {
      const agora = relogio();
      const saem = [...memoria].filter(([id, r]) => agora - r.usadaEm >= parada && !manter(id)).map(([id]) => id);
      for (const id of saem) {
        // A última releitura vai para o armazém antes de a memória soltar: é de lá que a conversa volta.
        descarregarUma(id);
        noArmazem.set(id, memoria.get(id)!.usadaEm);
        memoria.delete(id);
      }
      return saem;
    },
    ids: () => [...memoria.keys()],
  };
}

/** A barra em dia: de quanto em quanto tempo a próxima conversa da barra é relida, e por quanto a releitura vale. */
export const ESPACO_DA_REVALIDACAO_MS = 4000;
export const VALIDADE_DA_REVALIDACAO_MS = 5 * 60_000;

/**
 * As conversas da barra em dia, em segundo plano: com a aba visível, relê uma por vez (a próxima só depois que a anterior
 * voltou e passou o espaço) as candidatas — as da barra que já têm réplica, sem a aberta (quem chama filtra) —, cada uma
 * no máximo uma vez por `validade`. Puro: o agendar, o relógio, a visibilidade e a leitura vêm de fora.
 */
export function criarRevalidacaoEmSegundoPlano(o: {
  candidatas: () => readonly string[];
  revalidar: (id: string) => Promise<unknown>;
  visivel: () => boolean;
  agendar: (fn: () => void, ms: number) => void;
  relogio?: () => number;
  espaco?: number;
  validade?: number;
}): { iniciar(): void; parar(): void; emCurso(): string | null } {
  const relogio = o.relogio ?? Date.now;
  const espaco = o.espaco ?? ESPACO_DA_REVALIDACAO_MS;
  const validade = o.validade ?? VALIDADE_DA_REVALIDACAO_MS;
  const lidaEm = new Map<string, number>();
  let geracao = 0;
  let ligada = false;
  let atual: string | null = null;
  const seguir = (g: number): void => o.agendar(() => passo(g), espaco);
  function passo(g: number): void {
    if (g !== geracao || !ligada) return;
    const agora = relogio();
    const id = o.visivel() ? o.candidatas().find((c) => agora - (lidaEm.get(c) ?? -Infinity) >= validade) : undefined;
    if (id === undefined) return seguir(g);
    atual = id;
    lidaEm.set(id, agora);
    void o.revalidar(id).catch(() => undefined).finally(() => {
      if (g !== geracao) return;
      atual = null;
      seguir(g);
    });
  }
  return {
    iniciar() {
      if (ligada) return;
      ligada = true;
      seguir(++geracao);
    },
    parar() {
      ligada = false;
      geracao++;
      atual = null;
    },
    emCurso: () => atual,
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
