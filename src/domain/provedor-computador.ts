import { type ConfigProvedores, type IdProvedorComputador, PROVEDORES_COMPUTADOR } from "../contracts/provedor-computador.ts";

/**
 * ADR-168 (definido em 2026-11-12): a escolha do provedor do computador é configuração, lida só no boot (compor.ts).
 *
 *   NOD_COMPUTADORES=docker                  o que já existia: liga o computador e dá o PADRÃO (nada muda sem pedir)
 *   NOD_COMPUTADOR_PROVEDOR=orgo             o provedor GLOBAL (vale para todos os bots sem escolha própria)
 *   NOD_COMPUTADOR_PROVEDOR_POR_PESSOA='{"<pessoaId>":"orgo"}'
 *   NOD_COMPUTADOR_PROVEDOR_POR_BOT='{"<agenteId>":"docker"}'
 *
 * Precedência: bot > pessoa > global > padrão. Valor desconhecido é IGNORADO (com o aviso no boot), nunca vira outro
 * provedor por engano: um JSON torto não pode mandar o computador de alguém para a nuvem de um terceiro.
 */

export const ehProvedor = (v: unknown): v is IdProvedorComputador => typeof v === "string" && (PROVEDORES_COMPUTADOR as readonly string[]).includes(v);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Um mapa id → provedor vindo do env; devolve o que vale e o que foi descartado (para o log do boot). */
export function lerMapaDeProvedores(bruto: string | undefined): { mapa: Record<string, IdProvedorComputador>; descartados: string[] } {
  const mapa: Record<string, IdProvedorComputador> = {};
  const descartados: string[] = [];
  if (!bruto?.trim()) return { mapa, descartados };
  let lido: unknown;
  try {
    lido = JSON.parse(bruto);
  } catch {
    return { mapa, descartados: ["<json_invalido>"] };
  }
  if (!lido || typeof lido !== "object" || Array.isArray(lido)) return { mapa, descartados: ["<nao_e_objeto>"] };
  for (const [id, valor] of Object.entries(lido as Record<string, unknown>)) {
    if (UUID.test(id) && ehProvedor(valor)) mapa[id.toLowerCase()] = valor;
    else descartados.push(id);
  }
  return { mapa, descartados };
}

export function configDeProvedores(env: Readonly<Record<string, string | undefined>>): { config: ConfigProvedores; avisos: string[] } {
  const avisos: string[] = [];
  const legado = env.NOD_COMPUTADORES;
  // O motor (ADR-122) é um computador POR PESSOA com uma tela por bot: segue no caminho próprio dele (compor.ts) e não
  // entra no seletor por bot. Aqui o legado só dá o padrão docker.
  const padrao = legado === "docker" ? legado : null;
  const globalBruto = env.NOD_COMPUTADOR_PROVEDOR?.trim() || null;
  const global = globalBruto && ehProvedor(globalBruto) ? globalBruto : null;
  if (globalBruto && !global) avisos.push(`NOD_COMPUTADOR_PROVEDOR desconhecido: ${globalBruto}`);
  const pessoa = lerMapaDeProvedores(env.NOD_COMPUTADOR_PROVEDOR_POR_PESSOA);
  const bot = lerMapaDeProvedores(env.NOD_COMPUTADOR_PROVEDOR_POR_BOT);
  if (pessoa.descartados.length) avisos.push(`NOD_COMPUTADOR_PROVEDOR_POR_PESSOA ignorou: ${pessoa.descartados.join(", ")}`);
  if (bot.descartados.length) avisos.push(`NOD_COMPUTADOR_PROVEDOR_POR_BOT ignorou: ${bot.descartados.join(", ")}`);
  return { config: { padrao, global, porPessoa: pessoa.mapa, porBot: bot.mapa }, avisos };
}

/** Quem dá o computador deste bot desta pessoa. null = nenhum provedor configurado (o computador fica desligado). */
export function escolherProvedor(config: ConfigProvedores, quem: { pessoaId?: string | null; agenteId?: string | null }, sobrepor?: IdProvedorComputador | null): IdProvedorComputador | null {
  if (sobrepor) return sobrepor;
  const bot = quem.agenteId ? config.porBot[quem.agenteId.toLowerCase()] : undefined;
  if (bot) return bot;
  const pessoa = quem.pessoaId ? config.porPessoa[quem.pessoaId.toLowerCase()] : undefined;
  if (pessoa) return pessoa;
  return config.global ?? config.padrao;
}

/** Os provedores que alguma regra pode escolher: o servidor monta só estes no boot. */
export function provedoresEmUso(config: ConfigProvedores): IdProvedorComputador[] {
  const todos = new Set<IdProvedorComputador>();
  if (config.padrao) todos.add(config.padrao);
  if (config.global) todos.add(config.global);
  for (const p of Object.values(config.porPessoa)) todos.add(p);
  for (const p of Object.values(config.porBot)) todos.add(p);
  return PROVEDORES_COMPUTADOR.filter((p) => todos.has(p));
}

/**
 * definido em 2026-11-12 (ADR-168): o quadro de quem só tem primitivas, igual ao do runtime do nod (runtime.mjs): cada
 * observação ganha um quadro ligado à revisão atual; qualquer ação que muda a tela troca a revisão; o quadro vale 2 min.
 * Puro: o relógio e o gerador de ids vêm de fora.
 */
export const PRAZO_QUADRO_MS = 120_000;
export const TETO_QUADROS = 256;
export type EstadoQuadros = { revisao: string; quadros: Map<string, { revisao: string; em: number }> };

export function novoEstadoQuadros(revisao: string): EstadoQuadros {
  return { revisao, quadros: new Map() };
}

export function anotarQuadro(e: EstadoQuadros, quadro: string, agora: number): void {
  e.quadros.set(quadro, { revisao: e.revisao, em: agora });
  for (const [id, q] of e.quadros) if (agora - q.em > PRAZO_QUADRO_MS || e.quadros.size > TETO_QUADROS) e.quadros.delete(id);
}

export function quadroValido(e: EstadoQuadros, quadro: string, agora: number): boolean {
  const q = e.quadros.get(quadro);
  return !!q && q.revisao === e.revisao && agora - q.em <= PRAZO_QUADRO_MS;
}

export function mudarRevisao(e: EstadoQuadros, nova: string): void {
  e.revisao = nova;
  e.quadros.clear();
}

/** Aspas simples de shell: o único jeito de passar texto da pessoa a um `bash -c` sem interpretação. */
export function aspasShell(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** O caminho que um provedor de fora aceita: absoluto, sem NUL nem quebra de linha. */
export function caminhoSeguro(caminho: string): boolean {
  // eslint-disable-next-line no-control-regex
  return caminho.startsWith("/") && caminho.length <= 1024 && !/[\x00-\x1f]/.test(caminho);
}
