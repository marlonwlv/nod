/**
 * NOD-119: a barra lateral no app do Mac. Mora fora de desktop.ts pelo gatilho de 200 linhas da EMENDA 26 (revisão 5 do
 * #597): os valores guardados no preferencias.json, as decisões do card do chat e os métodos da ponte. Os canais ficam
 * em CANAIS_DESKTOP, com os outros.
 */
/**
 * ADR-179: a barra redimensionável guardada por computador (web/lib/densidade.ts; userData no app do Mac): a última
 * largura expandida, em px inteiros entre LIMITES_BARRA_DESKTOP, e se está compacta (88 px). Recolher não perde a largura.
 */
export type BarraDesktop = { larguraExpandida: number; compacta: boolean };
export const LIMITES_BARRA_DESKTOP = { min: 240, max: 400 } as const;
/**
 * Os valores do modelo antigo de densidades (ADR-060/NOD-119), que ainda podem estar no preferencias.json de quem
 * atualizou o app. O preload os repõe na chave antiga e a web migra uma vez (web/lib/densidade.ts, migrarAntiga).
 */
export const VALORES_BARRA_ANTIGOS = ["compacta", "compacta:recolhida", "compacta:larga", "confortavel:recolhida"] as const;
export type BarraAntigaDesktop = (typeof VALORES_BARRA_ANTIGOS)[number];
/** O que o preferencias.json pode guardar: o valor novo ou, até a primeira gravação, o antigo. */
export type BarraGuardadaDesktop = BarraDesktop | BarraAntigaDesktop;
/**
 * As decisões do card (aplicada ou recusada) por mensagem, guardadas no preferencias.json do app do Mac, que apaga o
 * localStorage a cada conexão (revisão 4 do #597). Só as últimas MAX_DECISOES_BARRA_DESKTOP.
 */
export type DecisaoBarraDesktop = "aplicada" | "recusada";
export type DecisoesBarraDesktop = Record<string, DecisaoBarraDesktop>;
export const MAX_DECISOES_BARRA_DESKTOP = 50;

/** Os métodos da barra na ponte (NodDesktop). Opcionais: o app instalado antes da NOD-119 não tem, a web confere. */
export type PonteBarraDesktop = {
  /** A largura expandida e o estado compacto da barra; null = o padrão. */
  definirBarra?(barra: BarraDesktop | null): Promise<void>;
  /** A decisão do card do chat, que o preload repõe no localStorage a cada conexão. */
  definirDecisaoBarra?(mensagemId: string, decisao: DecisaoBarraDesktop): Promise<void>;
};
