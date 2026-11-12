import type { AjustesAprovacao, ListaRegra, NivelDeFerramenta, RegraRevisor, TetoModo } from "../contracts/ajustes-aprovacao.ts";
import type { Agente } from "../contracts/agente.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import {
  CARACTERES_POR_REGRA,
  conferirNovaRegra,
  ehListaRegra,
  ehNivelFerramenta,
  ehTetoModo,
  ehTipoNivel,
  REGRAS_POR_LISTA,
  regrasQueValem,
  type RegrasDoBot,
} from "../domain/ajustes-aprovacao.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { autoriaPessoa, evento } from "./autoria-evento.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

/**
 * Ajustes > Aprovações (definido em 2026-11-12, ADR-164). Tudo é da dona: as regras em texto do revisor (padrão e por bot),
 * o nível por ferramenta, o só leitura do bot. O teto do modo é do admin do time (NOD_ADMINS, a mesma lista das flags).
 * Nada daqui passa pelo chat: mudar o que o bot pode fazer sem a pessoa é dela (registro de ações, `chat: nunca`).
 */

/** O que o turno precisa saber do bot para decidir: os níveis, as regras que valem e o só leitura (efetivo). */
export async function ajustesDoBot(deps: Deps, agenteId: string): Promise<{ niveis: NivelDeFerramenta[]; regras: RegrasDoBot; soLeitura: boolean }> {
  const [niveis, regras, agente] = await Promise.all([deps.repos.ajustesAprovacao.niveis(), deps.repos.ajustesAprovacao.regras(), deps.repos.agentes.buscar(agenteId)]);
  return { niveis, regras: regrasQueValem(regras, agenteId), soLeitura: agente?.soLeitura === true };
}

/** A pessoa do escopo é admin do time? Pelo id ou pelo e-mail, na lista que a rota recebe (NOD_ADMINS). */
async function ehAdmin(deps: Deps, admins: readonly string[]): Promise<boolean> {
  if (admins.length === 0) return false;
  if (admins.includes(deps.escopo.pessoaId.toLowerCase())) return true;
  const email = (await deps.repos.pessoas.buscar(deps.escopo.pessoaId))?.email?.toLowerCase();
  return !!email && admins.includes(email);
}

/** O bot da dona (o "Vale para" escolhido), ou erro: só a dona ajusta as aprovações do bot dela. */
async function botDaDona(deps: Deps, agenteId: unknown): Promise<Agente> {
  if (typeof agenteId !== "string" || !/^[0-9a-f-]{36}$/i.test(agenteId)) throw new ErroDeDominio("entrada_invalida", { cause: "agente" });
  const agente = await deps.repos.agentes.buscar(agenteId);
  if (!agente) throw new ErroDeDominio("nao_encontrado");
  if (agente.ownerId !== deps.escopo.pessoaId) throw new ErroDeDominio("nao_permitido");
  return agente;
}

/** null/undefined/"" = o padrão (Todos os bots); senão o bot da dona. */
async function alcance(deps: Deps, agenteId: unknown): Promise<string | null> {
  if (agenteId === null || agenteId === undefined || agenteId === "") return null;
  return (await botDaDona(deps, agenteId)).id;
}

function eventoAjustes(deps: Deps, agenteId: string | null): RuntimeEvent {
  return evento(deps.escopo, { kind: "agente_atualizado", autoria: autoriaPessoa(deps.escopo), agora: deps.agora(), dados: { agente_id: agenteId, acao: "ajustes_aprovacao" } });
}

export const lerAjustesAprovacao: CasoDeUso<{ agenteId?: unknown; admins: readonly string[] }, AjustesAprovacao> = async (deps, input) => {
  const agenteId = await alcance(deps, input.agenteId);
  const agente = agenteId ? await deps.repos.agentes.buscar(agenteId) : null;
  const [regras, niveis, teto, admin, apps] = await Promise.all([
    deps.repos.ajustesAprovacao.regras(),
    deps.repos.ajustesAprovacao.niveis(),
    deps.repos.ajustesAprovacao.teto(),
    ehAdmin(deps, input.admins),
    deps.repos.conectores.listarHabilitados(),
  ]);
  return {
    data: {
      agenteId,
      modoPedido: agente ? (agente.modoPedido ?? agente.modoAprovacao ?? "manual") : null,
      modoEfetivo: agente ? (agente.modoAprovacao ?? "manual") : null,
      soLeitura: agente?.soLeituraPedido === true,
      teto,
      admin,
      revisorLigado: deps.services.revisor?.config.ligado === true,
      regras: { padrao: regras.filter((r) => r.agenteId === null), doBot: agenteId ? regras.filter((r) => r.agenteId === agenteId) : [] },
      niveis: niveis.filter((n) => n.agenteId === agenteId),
      apps: apps.map((c) => ({ slug: c.slug, nome: c.nome })),
      limites: { regrasPorLista: REGRAS_POR_LISTA, caracteresPorRegra: CARACTERES_POR_REGRA },
    },
  };
};

const ERRO_DA_REGRA = { texto_invalido: "texto", lista_cheia: "lista_cheia", repetida: "repetida" } as const;

/**
 * Cria uma regra. `origem: 'sugestao'` = salva do cartão de aprovação ("Salvar como regra"); a pessoa leu e pode ter
 * editado o texto, então vale como dela. O cartão salva no bot do cartão (`agenteId`); os Ajustes, no alcance escolhido.
 */
export const criarRegraRevisor: CasoDeUso<{ agenteId?: unknown; lista: unknown; texto: unknown; origem?: unknown }, { regra: RegraRevisor }> = async (deps, input) => {
  if (!ehListaRegra(input.lista)) throw new ErroDeDominio("entrada_invalida", { cause: "lista" });
  const agenteId = await alcance(deps, input.agenteId);
  const existentes = await deps.repos.ajustesAprovacao.regrasDaLista(agenteId, input.lista);
  const c = conferirNovaRegra(existentes, input.texto);
  if (!c.ok) throw new ErroDeDominio("entrada_invalida", { cause: ERRO_DA_REGRA[c.erro] });
  const regra = await deps.repos.ajustesAprovacao.criarRegra({ agenteId, lista: input.lista, texto: c.texto, origem: input.origem === "sugestao" ? "sugestao" : "pessoa" });
  return { data: { regra }, events: [eventoAjustes(deps, agenteId)] };
};

export const editarRegraRevisor: CasoDeUso<{ regraId: string; texto: unknown }, { regra: RegraRevisor }> = async (deps, input) => {
  const atual = await deps.repos.ajustesAprovacao.buscarRegra(input.regraId);
  if (!atual) throw new ErroDeDominio("nao_encontrado");
  const existentes = await deps.repos.ajustesAprovacao.regrasDaLista(atual.agenteId, atual.lista);
  const c = conferirNovaRegra(existentes, input.texto, atual.id);
  if (!c.ok) throw new ErroDeDominio("entrada_invalida", { cause: ERRO_DA_REGRA[c.erro] });
  const regra = await deps.repos.ajustesAprovacao.editarRegra(atual.id, c.texto);
  if (!regra) throw new ErroDeDominio("nao_encontrado");
  return { data: { regra }, events: [eventoAjustes(deps, atual.agenteId)] };
};

export const apagarRegraRevisor: CasoDeUso<{ regraId: string }, { apagada: boolean }> = async (deps, input) => {
  const atual = await deps.repos.ajustesAprovacao.buscarRegra(input.regraId);
  if (!atual) throw new ErroDeDominio("nao_encontrado");
  const apagada = await deps.repos.ajustesAprovacao.apagarRegra(atual.id);
  return { data: { apagada }, events: [eventoAjustes(deps, atual.agenteId)] };
};

const SLUG = /^[a-z0-9_-]{1,64}$/;

export const definirNivelFerramenta: CasoDeUso<{ agenteId?: unknown; conector: unknown; ferramenta?: unknown; tipo: unknown; nivel: unknown }, { nivel: NivelDeFerramenta }> = async (deps, input) => {
  if (typeof input.conector !== "string" || !SLUG.test(input.conector)) throw new ErroDeDominio("entrada_invalida", { cause: "conector" });
  const ferramenta = input.ferramenta === undefined || input.ferramenta === null ? "" : input.ferramenta;
  if (typeof ferramenta !== "string" || ferramenta.length > 128) throw new ErroDeDominio("entrada_invalida", { cause: "ferramenta" });
  if (!ehTipoNivel(input.tipo)) throw new ErroDeDominio("entrada_invalida", { cause: "tipo" });
  if (!ehNivelFerramenta(input.nivel)) throw new ErroDeDominio("entrada_invalida", { cause: "nivel" });
  const agenteId = await alcance(deps, input.agenteId);
  if (!(await deps.repos.conectores.buscarPorSlug(input.conector))) throw new ErroDeDominio("nao_encontrado");
  const nivel: NivelDeFerramenta = { agenteId, conector: input.conector, ferramenta, tipo: input.tipo, nivel: input.nivel };
  await deps.repos.ajustesAprovacao.definirNivel(nivel);
  return { data: { nivel }, events: [eventoAjustes(deps, agenteId)] };
};

/** O só leitura do bot (só a dona). Ligar vale já na próxima ação, como o modo (ADR-059 §3). */
export const definirSoLeitura: CasoDeUso<{ agenteId: unknown; soLeitura: unknown }, { agente: Agente }> = async (deps, input) => {
  if (typeof input.soLeitura !== "boolean") throw new ErroDeDominio("entrada_invalida", { cause: "soLeitura" });
  const existente = await botDaDona(deps, input.agenteId);
  const agente = await deps.repos.agentes.definirSoLeitura(existente.id, input.soLeitura);
  if (!agente) throw new ErroDeDominio("nao_permitido");
  return { data: { agente }, events: [eventoAjustes(deps, agente.id)] };
};

/** O teto do modo para o time inteiro (o tenant). Só o admin; null tira o teto dele. */
export const definirTetoModo: CasoDeUso<{ teto: unknown; admins: readonly string[] }, { teto: TetoModo | null }> = async (deps, input) => {
  if (input.teto !== null && !ehTetoModo(input.teto)) throw new ErroDeDominio("entrada_invalida", { cause: "teto" });
  if (!(await ehAdmin(deps, input.admins))) throw new ErroDeDominio("nao_permitido");
  await deps.repos.ajustesAprovacao.definirTeto(input.teto);
  return { data: { teto: await deps.repos.ajustesAprovacao.teto() }, events: [eventoAjustes(deps, null)] };
};

/** Para o executor da revisão: o id da regra "Pode fazer sem perguntar" que o veredito citou (P1 = a primeira). */
export function regraCitada(regras: RegrasDoBot, citada: { lista: ListaRegra; indice: number } | null | undefined): string | null {
  if (!citada) return null;
  return regras[citada.lista][citada.indice]?.id ?? null;
}
