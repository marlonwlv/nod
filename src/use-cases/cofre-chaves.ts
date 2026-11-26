import type { ChavesDoTenant } from "../adapters/cofre/chaves-do-tenant.ts";
import type { ChaveDoCofreNaTela, DetalheDaChaveDto, ModoDeUsoDaChave, QuemUsaAChave, UsoDaChave } from "../contracts/cofre.ts";
import { appDoCofre, nomeDeVariavelDoCofre, TETO_DICAS_DA_CHAVE, type AppDoCofre } from "../domain/apps-do-cofre.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import type { ItemDoCofre } from "../repositories/cofre.repo.ts";
import { guardarItem, revogarItem } from "./cofre-envelope.ts";
import { valorDeCredencial } from "./guardar-credencial.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

/**
 * As chaves do Cofre na tela e no cartão (ADR-195, Entrega 3; Paper C1, C2, C3 e O1–O5). Tudo aqui lê e grava pelo cofre em
 * envelope (src/use-cases/cofre-envelope.ts); o valor entra por `guardarItem` e nunca volta. O teste da chave no app
 * conhecido roda na rota, FORA da transação (rede), e chega aqui como `testadaEm`.
 */

const MODOS: readonly ModoDeUsoDaChave[] = ["sempre", "perguntar"];
/** O "Uso recente" do C2 mostra poucas linhas: o registro inteiro fica em cofre_eventos. */
export const LINHAS_DE_USO = 8;
const TIPOS_DE_USO = new Set<UsoDaChave["tipo"]>(["guardado", "trocado", "pedido", "aprovado", "negado", "entregue", "revogado"]);

type Publico = { appId?: unknown; testadaEm?: unknown; dicas?: unknown; pedidaPor?: unknown };

function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function modo(v: unknown): ModoDeUsoDaChave {
  if (!MODOS.includes(v as ModoDeUsoDaChave)) throw new ErroDeDominio("entrada_invalida", { cause: "modo" });
  return v as ModoDeUsoDaChave;
}

/** As dicas da chave: uma linha curta (o bot as lê), sem caractere de controle. Vazia = sem dicas. */
export function dicasDaChave(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v !== "string") throw new ErroDeDominio("entrada_invalida", { cause: "dicas" });
  const limpa = v.replace(/\s+/g, " ").trim();
  if (!limpa) return null;
  if (Array.from(limpa).length > TETO_DICAS_DA_CHAVE) throw new ErroDeDominio("entrada_invalida", { cause: "dicas longas" });
  return limpa;
}

async function nomesDosBots(deps: Deps, ids: readonly string[]): Promise<Map<string, string>> {
  const unicos = [...new Set(ids)];
  if (!unicos.length) return new Map();
  return new Map((await deps.repos.agentes.buscarVarios(unicos, true)).map((a) => [a.id, a.nome]));
}

function naTela(i: ItemDoCofre, pessoaId: string, quem: QuemUsaAChave[], bots: Map<string, string>): ChaveDoCofreNaTela {
  const p = i.publico as Publico;
  const pedidaPor = texto(p.pedidaPor);
  return {
    id: i.id,
    nome: i.nome,
    app: i.app,
    appId: appDoCofre(p.appId)?.id ?? null,
    dono: i.dono,
    sua: i.ownerId === pessoaId,
    quem,
    ultimoUsoEm: i.ultimoUsoEm,
    guardadaEm: i.criadoEm,
    testadaEm: typeof p.testadaEm === "number" ? p.testadaEm : null,
    dicas: texto(p.dicas),
    pedidaPor: pedidaPor ? (bots.get(pedidaPor) ?? null) : null,
  };
}

/** As chaves vivas que a pessoa vê (as dela e as do time), com quem pode usar cada uma. */
export async function chavesNaTela(deps: Deps): Promise<ChaveDoCofreNaTela[]> {
  const itens = (await deps.repos.cofre.listarItens()).filter((i) => i.tipo === "chave");
  const concessoes = await deps.repos.cofre.concessoesDosItens(itens.map((i) => i.id));
  const bots = await nomesDosBots(deps, [...concessoes.map((c) => c.agenteId), ...itens.map((i) => texto((i.publico as Publico).pedidaPor) ?? "").filter(Boolean)]);
  return itens.map((i) => naTela(i, deps.escopo.pessoaId, concessoes.filter((c) => c.itemId === i.id && bots.has(c.agenteId)).map((c) => ({ agenteId: c.agenteId, nome: bots.get(c.agenteId)!, modo: c.modo })), bots));
}

/** A chave viva e visível, ou nao_encontrado (outro tipo, revogada, de outra pessoa sem ser do time). */
async function chaveViva(deps: Deps, itemId: string): Promise<ItemDoCofre> {
  const i = await deps.repos.cofre.buscarItem(itemId);
  if (!i || i.tipo !== "chave" || i.revogadoEm !== null) throw new ErroDeDominio("nao_encontrado");
  return i;
}

/** A chave que só quem guardou muda (trocar, dar acesso, remover): de outra pessoa (mesmo do time) é nao_permitido. */
async function chaveDaPessoa(deps: Deps, itemId: string): Promise<ItemDoCofre> {
  const i = await chaveViva(deps, itemId);
  if (i.ownerId !== deps.escopo.pessoaId) throw new ErroDeDominio("nao_permitido");
  return i;
}

/** GET /cofre/chaves/:id (Paper C2): a chave, quem pode usar e o uso recente. */
export const detalheDaChave: CasoDeUso<{ itemId: string }, DetalheDaChaveDto> = async (deps, input) => {
  const i = await chaveViva(deps, input.itemId);
  const [concessoes, eventos] = await Promise.all([deps.repos.cofre.concessoesDosItens([i.id]), deps.repos.cofre.eventosRecentes(i.id, LINHAS_DE_USO)]);
  const pedidaPor = texto((i.publico as Publico).pedidaPor);
  const bots = await nomesDosBots(deps, [...concessoes.map((c) => c.agenteId), ...eventos.map((e) => e.agenteId ?? ""), pedidaPor ?? ""].filter(Boolean));
  const quem = concessoes.filter((c) => bots.has(c.agenteId)).map((c) => ({ agenteId: c.agenteId, nome: bots.get(c.agenteId)!, modo: c.modo }));
  const uso: UsoDaChave[] = eventos.filter((e) => TIPOS_DE_USO.has(e.tipo as UsoDaChave["tipo"])).map((e) => {
    const peloCartao = e.tipo === "guardado" && typeof e.detalhe.pedidaPor === "string" ? bots.get(e.detalhe.pedidaPor) : undefined;
    const onde = typeof e.detalhe.onde === "string" ? e.detalhe.onde : undefined;
    return { tipo: e.tipo as UsoDaChave["tipo"], agente: e.agenteId ? (bots.get(e.agenteId) ?? null) : null, quando: e.criadoEm, ...(onde ? { onde } : {}), ...(peloCartao ? { peloCartaoDe: peloCartao } : {}) };
  });
  return { data: { chave: naTela(i, deps.escopo.pessoaId, quem, bots), uso } };
};

export type EntradaNovaChave = {
  appId?: unknown;
  app?: unknown;
  nome?: unknown;
  valor?: unknown;
  quem?: unknown;
  dicas?: unknown;
  /** Quando o app conhecido aceitou o valor (o teste rodou na rota, antes da transação). */
  testadaEm?: number | null;
  /** O bot do cartão que pediu (alvo "app"), para o "guardada pelo cartão do Chico". */
  pedidaPor?: string | null;
  chaves: ChavesDoTenant;
};

/** O app conhecido, ou null; um appId que não é do catálogo é entrada_invalida (não vira "outro app" calado). */
export function appDaEntrada(v: unknown): AppDoCofre | null {
  if (v == null || v === "") return null;
  const app = appDoCofre(v);
  if (!app) throw new ErroDeDominio("entrada_invalida", { cause: "app desconhecido" });
  return app;
}

function quemDaEntrada(v: unknown): { agenteId: string; modo: ModoDeUsoDaChave }[] {
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > 50) throw new ErroDeDominio("entrada_invalida", { cause: "quem" });
  const vistos = new Set<string>();
  return v.map((q: unknown) => {
    const o = (typeof q === "object" && q !== null ? q : {}) as { agenteId?: unknown; modo?: unknown };
    const agenteId = typeof o.agenteId === "string" && /^[0-9a-f-]{36}$/.test(o.agenteId) ? o.agenteId : null;
    if (!agenteId || vistos.has(agenteId)) throw new ErroDeDominio("entrada_invalida", { cause: "quem" });
    vistos.add(agenteId);
    return { agenteId, modo: modo(o.modo) };
  });
}

/**
 * POST /cofre/chaves (Paper C3) e o cartão do alvo "app" (Paper O1–O4). Chave nova com o nome de uma que já existe é
 * estado_invalido: trocar é pelo "Trocar" da chave aberta, que mostra quem perde a de antes.
 */
export const criarChave: CasoDeUso<EntradaNovaChave, ChaveDoCofreNaTela> = async (deps, input) => {
  const app = appDaEntrada(input.appId);
  const nome = typeof input.nome === "string" ? input.nome.trim() : "";
  if (!nomeDeVariavelDoCofre(nome)) throw new ErroDeDominio("entrada_invalida", { cause: "nome da variável" });
  const outro = app ? null : texto(input.app);
  if (outro !== null && Array.from(outro).length > 60) throw new ErroDeDominio("entrada_invalida", { cause: "app" });
  const valor = valorDeCredencial(input.valor);
  const quem = quemDaEntrada(input.quem);
  const dicas = dicasDaChave(input.dicas);
  if (await deps.repos.cofre.itemVivo({ tipo: "chave", nome, dono: "pessoa" })) throw new ErroDeDominio("estado_invalido", { cause: "ja_existe" });
  const publico: Record<string, unknown> = {
    ...(app ? { appId: app.id } : {}),
    ...(input.testadaEm ? { testadaEm: input.testadaEm } : {}),
    ...(dicas ? { dicas } : {}),
    ...(input.pedidaPor ? { pedidaPor: input.pedidaPor } : {}),
  };
  const { item } = await guardarItem(deps, input.chaves, { tipo: "chave", nome, app: app?.nome ?? outro, publico, valor, dono: "pessoa", ...(input.pedidaPor ? { detalheDoEvento: { pedidaPor: input.pedidaPor } } : {}) });
  for (const q of quem) {
    if (!(await deps.repos.cofre.conceder({ itemId: item.id, agenteId: q.agenteId, modo: q.modo }))) throw new ErroDeDominio("entrada_invalida", { cause: "bot" });
  }
  return { data: (await chavesNaTela(deps)).find((c) => c.id === item.id)! };
};

/**
 * Trocar (Paper C2): a versão nova da mesma chave, com o mesmo nome, app, dicas e quem pode usar. O valor de antes fica
 * revogado na mesma transação (guardarItem).
 */
export const trocarChave: CasoDeUso<{ itemId: string; valor?: unknown; testadaEm?: number | null; chaves: ChavesDoTenant }, ChaveDoCofreNaTela> = async (deps, input) => {
  const antes = await chaveDaPessoa(deps, input.itemId);
  const valor = valorDeCredencial(input.valor);
  const p = antes.publico as Publico;
  const publico: Record<string, unknown> = { ...antes.publico };
  delete publico.testadaEm;
  if (input.testadaEm) publico.testadaEm = input.testadaEm;
  // A chave de um app conhecido só troca testada: quem chama (a rota) testa antes; sem teste, nada muda.
  if (appDoCofre(p.appId) && !input.testadaEm) throw new ErroDeDominio("estado_invalido", { cause: "sem teste" });
  const { item } = await guardarItem(deps, input.chaves, { tipo: "chave", nome: antes.nome, app: antes.app, publico, valor, dono: antes.dono });
  return { data: (await chavesNaTela(deps)).find((c) => c.id === item.id)! };
};

/** Sempre, Perguntar antes ou tirar o acesso (`modo: null`) de um bot (Paper C2, "Quem pode usar" e "Dar a outro bot"). */
export const mudarAcessoDaChave: CasoDeUso<{ itemId: string; agenteId: string; modo: unknown }, ChaveDoCofreNaTela> = async (deps, input) => {
  // O modo se confere antes da busca: corpo errado é 400 mesmo com a chave de outra pessoa.
  const novo = input.modo === null ? null : modo(input.modo);
  const i = await chaveDaPessoa(deps, input.itemId);
  if (novo === null) {
    if (!(await deps.repos.cofre.revogarConcessao(i.id, input.agenteId))) throw new ErroDeDominio("nao_encontrado", { cause: "acesso" });
  } else if (!(await deps.repos.cofre.conceder({ itemId: i.id, agenteId: input.agenteId, modo: novo }))) {
    throw new ErroDeDominio("nao_encontrado", { cause: "bot" });
  }
  return { data: (await chavesNaTela(deps)).find((c) => c.id === i.id)! };
};

/** "Remover chave" (Paper C2): revoga a versão viva; os bots que usavam passam a pedir pelo cartão de novo. */
export const removerChave: CasoDeUso<{ itemId: string }, { ok: true }> = async (deps, input) => {
  await chaveDaPessoa(deps, input.itemId);
  await revogarItem(deps, { itemId: input.itemId });
  return { data: { ok: true } };
};

/**
 * O cartão do alvo "app" (Paper O4): a chave testada vai para o Cofre e o bot que pediu passa a usar SEMPRE. Já havia a
 * chave (a pessoa troca pelo cartão, como diz a legenda "Já conectada"): vira versão nova, e quem já usava continua.
 */
export const guardarChaveDoCartao: CasoDeUso<{ app: AppDoCofre; agenteId: string; valor: string; testadaEm: number; chaves: ChavesDoTenant }, { itemId: string }> = async (deps, input) => {
  const existente = await deps.repos.cofre.itemVivo({ tipo: "chave", nome: input.app.variavel, dono: "pessoa" });
  const id = existente
    ? (await trocarChave(deps, { itemId: existente.id, valor: input.valor, testadaEm: input.testadaEm, chaves: input.chaves })).data.id
    : (await criarChave(deps, { appId: input.app.id, nome: input.app.variavel, valor: input.valor, testadaEm: input.testadaEm, pedidaPor: input.agenteId, chaves: input.chaves })).data.id;
  if (!(await deps.repos.cofre.conceder({ itemId: id, agenteId: input.agenteId, modo: "sempre" }))) throw new ErroDeDominio("nao_encontrado", { cause: "bot" });
  return { data: { itemId: id } };
};
