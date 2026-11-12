import type { ModoAprovacao } from "../contracts/agente.ts";
import {
  LISTAS_REGRA,
  NIVEIS_FERRAMENTA,
  TETOS_MODO,
  TIPOS_NIVEL,
  type ListaRegra,
  type NivelDeFerramenta,
  type NivelFerramenta,
  type RegraRevisor,
  type TetoModo,
  type TipoNivel,
} from "../contracts/ajustes-aprovacao.ts";

/**
 * Ajustes > Aprovações (definido em 2026-11-12, ADR-166; decisões 2 e 4 do Marlon no comparativo). Puro:
 * validação das regras em texto do revisor, o nível de cada ferramenta (sempre permitir, sempre pedir, bloqueado, o revisor
 * decide), o só leitura e o teto do modo que o admin do time define.
 */

/** definido em 2026-11-12 (decisão 2): até 20 regras por lista, até 1000 caracteres cada. */
export const REGRAS_POR_LISTA = 20;
export const CARACTERES_POR_REGRA = 1000;

export const ROTULO_LISTA: Readonly<Record<ListaRegra, string>> = {
  permitir: "Pode fazer sem perguntar",
  perguntar: "Sempre me pergunte",
};

export function ehListaRegra(x: unknown): x is ListaRegra {
  return typeof x === "string" && (LISTAS_REGRA as readonly string[]).includes(x);
}
export function ehNivelFerramenta(x: unknown): x is NivelFerramenta {
  return typeof x === "string" && (NIVEIS_FERRAMENTA as readonly string[]).includes(x);
}
export function ehTipoNivel(x: unknown): x is TipoNivel {
  return typeof x === "string" && (TIPOS_NIVEL as readonly string[]).includes(x);
}
export function ehTetoModo(x: unknown): x is TetoModo {
  return typeof x === "string" && (TETOS_MODO as readonly string[]).includes(x);
}

/**
 * O texto de uma regra como fica guardado: sem controles nem invisíveis (Cf: direção, largura zero), espaços juntos, sem
 * pontas. Vazio ou acima de 1000 = null (a rota responde `entrada_invalida`). Não corta: a pessoa vê o limite na tela.
 */
export function limparTextoDaRegra(texto: unknown): string | null {
  if (typeof texto !== "string") return null;
  const limpo = texto.replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, " ").replace(/\s+/g, " ").trim();
  if (limpo === "" || limpo.length > CARACTERES_POR_REGRA) return null;
  return limpo;
}

/** A mesma regra escrita de novo (sem caixa, acento nem pontuação final) não entra duas vezes na mesma lista. */
export function chaveDaRegra(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[.!;,\s]+$/u, "").replace(/\s+/g, " ").trim();
}

export type ErroDaRegra = "texto_invalido" | "lista_cheia" | "repetida";

/** Pode entrar mais esta regra na lista (do bot ou do padrão)? `existentes` = as da MESMA lista e do mesmo alcance. */
export function conferirNovaRegra(existentes: readonly Pick<RegraRevisor, "id" | "texto">[], texto: unknown, editandoId?: string): { ok: true; texto: string } | { ok: false; erro: ErroDaRegra } {
  const limpo = limparTextoDaRegra(texto);
  if (limpo === null) return { ok: false, erro: "texto_invalido" };
  const outras = existentes.filter((r) => r.id !== editandoId);
  if (editandoId === undefined && outras.length >= REGRAS_POR_LISTA) return { ok: false, erro: "lista_cheia" };
  const chave = chaveDaRegra(limpo);
  if (outras.some((r) => chaveDaRegra(r.texto) === chave)) return { ok: false, erro: "repetida" };
  return { ok: true, texto: limpo };
}

/** As regras que valem para um bot: o padrão da pessoa e as do bot, cada lista na ordem em que foram criadas. */
export type RegrasDoBot = { permitir: readonly RegraRevisor[]; perguntar: readonly RegraRevisor[] };

export function regrasQueValem(todas: readonly RegraRevisor[], agenteId: string): RegrasDoBot {
  const valem = todas.filter((r) => r.agenteId === null || r.agenteId === agenteId).sort((a, b) => a.criadoEm - b.criadoEm || a.id.localeCompare(b.id));
  // Uma frase igual no padrão e no bot conta uma vez só (a do padrão, que vem antes na ordem de criação ou não: a primeira).
  const vistas = new Set<string>();
  const unicas = valem.filter((r) => {
    const k = `${r.lista}:${chaveDaRegra(r.texto)}`;
    if (vistas.has(k)) return false;
    vistas.add(k);
    return true;
  });
  return { permitir: unicas.filter((r) => r.lista === "permitir"), perguntar: unicas.filter((r) => r.lista === "perguntar") };
}

/**
 * O nível que vale para uma ferramenta de um app (decisão 4). Do mais específico ao mais geral, o primeiro que existe:
 *
 *  1. o bot, a ferramenta
 *  2. o bot, o app inteiro
 *  3. o padrão da pessoa, a ferramenta
 *  4. o padrão da pessoa, o app inteiro
 *  5. nada → `revisor` (o modo decide, como antes desta ADR)
 */
export function nivelDaFerramenta(niveis: readonly NivelDeFerramenta[], agenteId: string, conector: string, ferramenta: string, tipo: TipoNivel): NivelFerramenta {
  const achar = (bot: string | null, f: string) => niveis.find((n) => n.agenteId === bot && n.conector === conector && n.ferramenta === f && n.tipo === tipo)?.nivel;
  return achar(agenteId, ferramenta) ?? achar(agenteId, "") ?? achar(null, ferramenta) ?? achar(null, "") ?? "revisor";
}

/** Rótulos da tela (título + frase, como toda linha de Ajustes). */
export const ROTULO_NIVEL: Readonly<Record<NivelFerramenta, { titulo: string; frase: string }>> = {
  revisor: { titulo: "O revisor decide", frase: "Segue o modo do bot e as suas regras." },
  sempre_permitir: { titulo: "Sempre permitir", frase: "Roda sem perguntar, em qualquer modo." },
  sempre_pedir: { titulo: "Sempre pedir", frase: "Pede você toda vez, até no Automático e no Total." },
  bloqueado: { titulo: "Bloqueado", frase: "O bot não usa, nem pedindo." },
};

/** A ordem do mais fechado ao mais aberto: o teto corta o que passa dele. */
const ORDEM_MODO: Readonly<Record<ModoAprovacao, number>> = { manual: 0, automatico: 1, total: 2 };

/**
 * O modo que vale depois do teto do admin (o modo pedido × o efetivo). O teto
 * `so_leitura` corta o modo para o manual e liga o só leitura (`soLeituraEfetivo`); `manual` e `automatico` cortam o que
 * passa deles. Sem teto, o pedido.
 */
export function modoEfetivo(pedido: ModoAprovacao, teto: TetoModo | null | undefined): ModoAprovacao {
  if (!teto) return pedido;
  const limite: ModoAprovacao = teto === "so_leitura" ? "manual" : teto;
  return ORDEM_MODO[pedido] > ORDEM_MODO[limite] ? limite : pedido;
}

export function soLeituraEfetivo(doBot: boolean, teto: TetoModo | null | undefined): boolean {
  return doBot || teto === "so_leitura";
}

/** Entre vários tetos (um por admin que gravou), vale o mais fechado. */
export function tetoMaisFechado(tetos: readonly TetoModo[]): TetoModo | null {
  if (tetos.includes("so_leitura")) return "so_leitura";
  if (tetos.includes("manual")) return "manual";
  if (tetos.includes("automatico")) return "automatico";
  return null;
}

/** A frase que o bot lê quando o só leitura barra uma escrita (vai na negação; a pessoa lê na pílula). */
export const FRASE_SO_LEITURA = "Este bot está em só leitura: ele pode ler, mas nada que muda algo sai. A dona muda isso em Ajustes > Aprovações.";
/** A frase do nível Bloqueado. */
export const FRASE_BLOQUEADO = "A dona bloqueou esta ferramenta em Ajustes > Aprovações: não use nem peça aprovação para ela.";

/**
 * O que a pessoa ou o admin barrou de antemão, antes de qualquer modo (decisão 4): `bloqueado` e o só leitura na escrita
 * negam sem cartão; o resto segue a decisão de sempre. Pura: quem chama sabe se a ferramenta só lê.
 */
export function barradoDeAntemao(nivel: NivelFerramenta, soLeitura: boolean, leitura: boolean): "bloqueado" | "so_leitura" | null {
  if (nivel === "bloqueado") return "bloqueado";
  if (soLeitura && !leitura) return "so_leitura";
  return null;
}

/**
 * A regra pronta que o cartão sugere quando o revisor não sugeriu uma (decisão 2: "o cartão sugere uma regra pronta").
 * Vem da frase da ação que o servidor já monta (`fraseDaAcao`, sem texto de modelo): "Mandar mensagem no #produto?" vira
 * "Pode mandar mensagem no #produto sem perguntar". Sem frase útil, null (o cartão oferece o campo vazio).
 */
export function regraSugeridaDaFrase(frase: string | null | undefined): string | null {
  if (!frase) return null;
  const limpa = frase.replace(/[?¿]+$/u, "").replace(/\s+/g, " ").trim();
  if (limpa.length < 4 || limpa.length > 160) return null;
  const inicio = limpa.charAt(0).toLowerCase() + limpa.slice(1);
  return limparTextoDaRegra(`Pode ${inicio} sem perguntar`);
}
