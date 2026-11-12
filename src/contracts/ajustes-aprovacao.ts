import type { ModoAprovacao } from "./agente.ts";

/**
 * Ajustes > Aprovações (definido em 2026-11-12, ADR-166; decisões 2 e 4 do Marlon no comparativo). Só tipos e
 * `as const`: a regra mora em src/domain/ajustes-aprovacao.ts; a web importa daqui só com `import type`.
 */

/** As duas listas do revisor: "Pode fazer sem perguntar" (permitir) e "Sempre me pergunte" (perguntar). */
export const LISTAS_REGRA = ["permitir", "perguntar"] as const;
export type ListaRegra = (typeof LISTAS_REGRA)[number];

/** De onde veio a frase: digitada nos Ajustes ou salva do cartão a partir da sugestão do revisor. */
export type OrigemRegra = "pessoa" | "sugestao";

export type RegraRevisor = {
  id: string;
  /** null = o padrão da pessoa (vale para todos os bots). */
  agenteId: string | null;
  lista: ListaRegra;
  texto: string;
  origem: OrigemRegra;
  criadoEm: number;
};

/** Os quatro níveis por ferramenta (decisão 4): sem linha = `revisor` (o modo do bot decide, como hoje). */
export const NIVEIS_FERRAMENTA = ["sempre_permitir", "sempre_pedir", "bloqueado", "revisor"] as const;
export type NivelFerramenta = (typeof NIVEIS_FERRAMENTA)[number];

export const TIPOS_NIVEL = ["leitura", "escrita"] as const;
export type TipoNivel = (typeof TIPOS_NIVEL)[number];

export type NivelDeFerramenta = {
  /** null = o padrão da pessoa. */
  agenteId: string | null;
  conector: string;
  /** "" = o app inteiro naquele tipo. */
  ferramenta: string;
  tipo: TipoNivel;
  nivel: NivelFerramenta;
};

/** O teto que o admin do time põe no modo de todos os bots do tenant. Sem teto = o modo pedido vale. */
export const TETOS_MODO = ["so_leitura", "manual", "automatico"] as const;
export type TetoModo = (typeof TETOS_MODO)[number];

/** O que a tela de Ajustes > Aprovações lê de uma vez (GET /api/aprovacoes/ajustes?agente=). */
export type AjustesAprovacao = {
  /** O bot escolhido em "Vale para"; null = Todos os bots (o padrão). */
  agenteId: string | null;
  /** O modo que a pessoa escolheu para o bot (null em "Todos os bots"). */
  modoPedido: ModoAprovacao | null;
  /** O modo que vale depois do teto do admin (null em "Todos os bots"). */
  modoEfetivo: ModoAprovacao | null;
  soLeitura: boolean;
  /** O teto do admin do time, se houver; `soLeituraPeloTeto` = o teto força só leitura. */
  teto: TetoModo | null;
  /** A pessoa é admin do time (pode mudar o teto). */
  admin: boolean;
  revisorLigado: boolean;
  regras: { padrao: RegraRevisor[]; doBot: RegraRevisor[] };
  niveis: NivelDeFerramenta[];
  /** Os apps ligados da pessoa, para a lista de níveis (slug e nome). */
  apps: { slug: string; nome: string }[];
  limites: { regrasPorLista: number; caracteresPorRegra: number };
};
